import { collectAgentTestsFromFiles } from "./dsl.js";
import { discoverAgentTestFiles } from "./discovery.js";
import { loadAgentGuardConfig } from "./config.js";
import { runAssertions } from "./assertions.js";
import { createProviderAdapter } from "./providers/factory.js";
import { AgentGuardProviderError } from "./providers/types.js";
import { estimateModelCostUsd, formatUsd } from "./cost.js";
import { persistRunArtifact } from "./results-store.js";
import { runSnapshotAssertion } from "./snapshot.js";
import { createPluginRuntime, runPluginAssertions } from "./plugins.js";

import type {
  AgentProvider,
  ResolvedAgentGuardConfig,
  TestResult,
  RunSummary,
  TestStatus,
} from "./types.js";
import type { RegisteredAgentTest } from "./dsl.js";
import type { AgentGuardPlugin } from "./plugins.js";

export type StubExecutorOutput = {
  status?: TestStatus;
  responseText?: string;
  toolCalls?: { name: string; arguments: unknown }[];
  failures?: string[];
  costUsd?: number;
  error?: string;
};

export type StubExecutor = (context: {
  test: RegisteredAgentTest;
  config: ResolvedAgentGuardConfig;
}) => Promise<StubExecutorOutput> | StubExecutorOutput;

export type RunAgentTestsOptions = {
  cwd?: string;
  configFile?: string;
  executor?: StubExecutor;
  provider?: AgentProvider;
  model?: string;
  grep?: string;
  ci?: boolean;
  execution?: "stub" | "provider";
  providerFetch?: typeof fetch;
  persistResults?: boolean;
  plugins?: AgentGuardPlugin[];
};

export type RunAgentTestsResult = {
  config: ResolvedAgentGuardConfig;
  discoveredFiles: string[];
  tests: RegisteredAgentTest[];
  results: TestResult[];
  summary: RunSummary;
  artifactFilePath?: string;
};

const defaultStubExecutor: StubExecutor = ({ test }) => ({
  status: "passed",
  responseText: `stubbed response for "${test.name}"`,
  failures: [],
  costUsd: 0,
});

export async function runAgentTests(
  options: RunAgentTestsOptions = {},
): Promise<RunAgentTestsResult> {
  const cwd = options.cwd ?? process.cwd();
  const baseConfig = await loadAgentGuardConfig({
    cwd,
    configFile: options.configFile,
  });
  const config: ResolvedAgentGuardConfig = {
    ...baseConfig,
    provider: options.provider ?? baseConfig.provider,
    model: options.model ?? baseConfig.model,
    ci: options.ci ? { ...baseConfig.ci, failOnInconclusive: true } : baseConfig.ci,
  };

  const discoveredFiles = discoverAgentTestFiles(config.testsDir, { cwd });
  const collectedTests = await collectAgentTestsFromFiles(discoveredFiles, { cwd });
  const tests = filterTestsByGrep(collectedTests, options.grep);

  const executor =
    options.executor ??
    (options.execution === "provider"
      ? createProviderExecutor(config, { fetchFn: options.providerFetch })
      : defaultStubExecutor);
  const pluginRuntime = createPluginRuntime(options.plugins);
  const startedAt = Date.now();
  const results: TestResult[] = [];
  let accumulatedCostUsd = 0;

  for (let index = 0; index < tests.length; index += 1) {
    const registered = tests[index];
    const testStartedAt = Date.now();
    const execution = await executor({ test: registered, config });
    const responseText =
      execution.responseText ?? `stubbed response for "${registered.name}"`;
    const assertionResult = runAssertions({
      spec: registered.spec,
      responseText,
      toolCalls: execution.toolCalls,
    });
    const snapshotResult = runSnapshotAssertion({
      cwd,
      testId: registered.name,
      spec: registered.spec,
      responseText,
    });
    const pluginFailures = await runPluginAssertions(pluginRuntime, {
      testId: registered.name,
      spec: registered.spec,
      responseText,
      toolCalls: execution.toolCalls,
    });
    let mergedFailures = [
      ...(execution.failures ?? []),
      ...assertionResult.failures,
      ...snapshotResult.failures,
      ...pluginFailures,
    ];
    let status = mergedFailures.length > 0 ? "failed" : execution.status ?? "passed";

    if (assertionResult.judge && !assertionResult.judge.passed && assertionResult.judge.nonCritical) {
      if (status !== "failed") {
        status = "inconclusive";
      }
      mergedFailures = [
        ...mergedFailures,
        `Judge assertion reported a non-critical mismatch: ${assertionResult.judge.rationale}`,
      ];
    }

    const result: TestResult = {
      testId: registered.name,
      status,
      durationMs: Date.now() - testStartedAt,
      responseText,
      failures: mergedFailures.length > 0 ? mergedFailures : undefined,
      costUsd: execution.costUsd,
      error: execution.error,
      toolCalls: execution.toolCalls,
      judge: assertionResult.judge,
    };
    results.push(result);

    if (typeof result.costUsd === "number") {
      accumulatedCostUsd += result.costUsd;
      accumulatedCostUsd = Math.round(accumulatedCostUsd * 1_000_000) / 1_000_000;
    }

    if (accumulatedCostUsd > config.maxCostPerRun) {
      const guardMessage = `Run cost guard triggered: estimated run cost $${formatUsd(
        accumulatedCostUsd,
      )} exceeded maxCostPerRun $${formatUsd(config.maxCostPerRun)}.`;

      result.status = "failed";
      result.failures = [...(result.failures ?? []), guardMessage];
      result.error = result.error ?? guardMessage;

      for (let remaining = index + 1; remaining < tests.length; remaining += 1) {
        const remainingTest = tests[remaining];
        results.push({
          testId: remainingTest.name,
          status: "inconclusive",
          durationMs: 0,
          responseText: undefined,
          failures: ["Skipped because maxCostPerRun was exceeded earlier in this run."],
          costUsd: undefined,
          error: "Skipped due to run cost guard.",
        });
      }

      break;
    }
  }

  const summary = buildRunSummary(results, Date.now() - startedAt);
  const shouldPersistResults = options.persistResults ?? true;
  const artifactFilePath = shouldPersistResults
    ? persistRunArtifact({ cwd, summary }).filePath
    : undefined;

  return {
    config,
    discoveredFiles,
    tests,
    results,
    summary,
    artifactFilePath,
  };
}

function filterTestsByGrep(
  tests: RegisteredAgentTest[],
  grep: string | undefined,
): RegisteredAgentTest[] {
  if (!grep || grep.trim() === "") {
    return tests;
  }
  const normalizedPattern = grep.toLocaleLowerCase("en-US");
  return tests.filter((entry) =>
    entry.name.toLocaleLowerCase("en-US").includes(normalizedPattern),
  );
}

function buildRunSummary(results: TestResult[], durationMs: number): RunSummary {
  let passed = 0;
  let failed = 0;
  let inconclusive = 0;
  let totalCostUsd = 0;
  let hasCost = false;

  for (const result of results) {
    if (result.status === "passed") {
      passed += 1;
    } else if (result.status === "failed") {
      failed += 1;
    } else {
      inconclusive += 1;
    }

    if (typeof result.costUsd === "number") {
      totalCostUsd += result.costUsd;
      hasCost = true;
    }
  }

  return {
    total: results.length,
    passed,
    failed,
    inconclusive,
    durationMs,
    totalCostUsd: hasCost ? totalCostUsd : undefined,
    results,
  };
}

function createProviderExecutor(
  config: ResolvedAgentGuardConfig,
  options: { fetchFn?: typeof fetch } = {},
): StubExecutor {
  if (!config.provider || !config.model) {
    throw new Error(
      'Legacy test execution requires "provider" and "model" in agentguard.config.ts, or corresponding CLI overrides.',
    );
  }
  const provider = config.provider;
  const model = config.model;

  const adapter = createProviderAdapter(provider, { fetchFn: options.fetchFn });

  return async ({ test }) => {
    try {
      const context =
        typeof test.spec.context === "string"
          ? [test.spec.context]
          : test.spec.context;

      const response = await adapter.invoke({
        model,
        temperature: config.temperature,
        userInput: test.spec.input,
        context,
        timeoutMs: config.timeoutMs,
      });

      return {
        status: "passed",
        responseText: response.text,
        toolCalls: response.toolCalls,
        costUsd: estimateModelCostUsd({
          provider,
          model,
          usage: response.usage,
        }),
      };
    } catch (error) {
      if (error instanceof AgentGuardProviderError && error.code === "timeout") {
        const shouldFail = config.ci.failOnInconclusive;
        return {
          status: shouldFail ? "failed" : "inconclusive",
          failures: [error.message],
          error: error.message,
        };
      }

      throw error;
    }
  };
}
