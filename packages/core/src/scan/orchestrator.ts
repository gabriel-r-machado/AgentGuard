import { AGENT_CONTRACT_SCHEMA_VERSION } from "../contract/schema.js";
import { createContentHash, createObjectHash } from "../contract/source-hash.js";
import { TEST_SUITE_SCHEMA_VERSION } from "../suite/schema.js";
import { readAgentContract, writeAgentContract, getContractPath } from "../artifacts/contract-store.js";
import {
  getManifestPath,
  readManifest,
  writeManifest,
  type Manifest,
} from "../artifacts/manifest-store.js";
import {
  readBaselineReport,
  writeBaselineReport,
  writeScanReport,
  type ScanReport,
} from "../artifacts/report-store.js";
import { getSuitePath, readTestSuite, writeTestSuite } from "../artifacts/suite-store.js";
import { loadAgentGuardConfig } from "../config.js";
import { createContractExtractor } from "../contract/extractor.js";
import { createSourceLoader } from "../knowledge/loader.js";
import { createLlmProvider, createProviderAdapter } from "../providers/factory.js";
import { type LlmProvider } from "../providers/types.js";
import { createScenarioGenerator } from "../suite/generator.js";
import { evaluateScenarioExecution } from "./evaluate.js";
import { createHttpAgentTarget } from "../targets/http.js";
import { createProviderAgentTarget } from "../targets/provider.js";

import type { ScanRunResult, ScenarioExecutionResult, ScenarioTurnRun } from "./types.js";
import type { AgentContract, SourceRef } from "../contract/schema.js";
import type { TestSuite, SuiteScenario } from "../suite/schema.js";
import type { AgentTarget, ConversationMessage } from "../targets/types.js";
import type { ResolvedLlmRoleConfig } from "../types.js";

export type RunScanOptions = {
  cwd?: string;
  configFile?: string;
  dryRun?: boolean;
  regenerate?: boolean;
  saveBaseline?: boolean;
  ci?: boolean;
  llmProvider?: LlmProvider;
  generatorLlmProvider?: LlmProvider;
  judgeLlmProvider?: LlmProvider;
  providerFetch?: typeof fetch;
  targetFetch?: typeof fetch;
};

export async function runScan(options: RunScanOptions = {}): Promise<ScanRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const runId = createRunId();
  const config = await loadAgentGuardConfig({
    cwd,
    configFile: options.configFile,
  });

  const sourceLoader = createSourceLoader();
  const extractor = createContractExtractor();
  const generator = createScenarioGenerator();

  const sources = await sourceLoader.load({ cwd, config });
  const manifest = readManifest(cwd);
  const staleReasons = manifest ? detectStaleReasons(manifest, sources.sourceHash, config) : [];
  const contractPath = getContractPath(cwd);
  const suitePath = getSuitePath(cwd);
  const manifestPath = getManifestPath(cwd);

  if (manifest && staleReasons.length > 0 && !options.regenerate) {
    return {
      dryRun,
      runId,
      config,
      sources,
      contract: readAgentContract(cwd),
      suite: readTestSuite(cwd),
      manifest,
      contractStatus: "stale",
      suiteStatus: "stale",
      warnings: [
        ...staleReasons,
        'Artifacts are out of date. Re-run with "--regenerate" to rebuild contract and suite.',
      ],
      artifactPaths: {
        contract: contractPath,
        suite: suitePath,
        manifest: manifestPath,
      },
      requiresRegenerate: true,
      scenarioResults: [],
    };
  }

  const generatorLlmProvider =
    options.generatorLlmProvider ??
    options.llmProvider ??
    createConfiguredLlmProvider(config.llm.generator, options.providerFetch);
  const judgeLlmProvider =
    options.judgeLlmProvider ??
    options.llmProvider ??
    createConfiguredLlmProvider(config.llm.judge, options.providerFetch);

  const prepared = await prepareArtifacts({
    cwd,
    config,
    sources,
    manifest,
    regenerate: options.regenerate ?? false,
    extractor,
    generator,
    llmProvider: generatorLlmProvider,
  });

  const warnings = [...prepared.warnings];
  const scenarioResults: ScenarioExecutionResult[] = [];
  if (hasExecutableTarget(config)) {
    const target = createTarget(config, options.targetFetch);
    const tasks = createScenarioTasks(prepared.suite, config);
    const startedAt = Date.now();
    const executions = await runWithConcurrency(tasks, config.scan.concurrency, async (task) =>
      executeScenario({
        contract: prepared.contract,
        scenario: task.scenario,
        repetition: task.repetition,
        target,
        llmProvider: judgeLlmProvider,
        judgeConfig: config.llm.judge,
        config,
        sources,
      }),
    );
    scenarioResults.push(...executions);
    warnings.push(...collectExecutionWarnings(executions));

    const report = buildScanReport({
      runId,
      dryRun,
      contract: prepared.contract,
      suite: prepared.suite,
      scenarioResults,
      generatedAt: new Date().toISOString(),
      baseline: readBaselineReport(cwd),
      latencyMs: Date.now() - startedAt,
    });

    const reportPaths = writeScanReport(cwd, runId, report);
    let baselinePath: string | undefined;
    if (options.saveBaseline) {
      baselinePath = writeBaselineReport(cwd, report, options.regenerate ?? false);
      warnings.push(`Baseline saved at "${baselinePath}".`);
    }

    return {
      dryRun,
      runId,
      config,
      sources,
      contract: prepared.contract,
      suite: prepared.suite,
      manifest: prepared.manifest,
      contractStatus: prepared.contractStatus,
      suiteStatus: prepared.suiteStatus,
      warnings:
        dryRun
          ? [
              ...warnings,
              "Dry-run requested: execution validated target behavior without allowing real side effects.",
            ]
          : warnings,
      artifactPaths: {
        contract: contractPath,
        suite: suitePath,
        manifest: manifestPath,
        reportJson: reportPaths.reportJsonPath,
        reportHtml: reportPaths.reportHtmlPath,
        runReportJson: reportPaths.runReportJsonPath,
        runReportHtml: reportPaths.runReportHtmlPath,
        baseline: baselinePath,
      },
      requiresRegenerate: false,
      scenarioResults,
      report,
    };
  }

  warnings.push(
    "Scan skipped target execution because no explicit scan.target is configured.",
  );

  return {
    dryRun,
    runId,
    config,
    sources,
    contract: prepared.contract,
    suite: prepared.suite,
    manifest: prepared.manifest,
    contractStatus: prepared.contractStatus,
    suiteStatus: prepared.suiteStatus,
    warnings,
    artifactPaths: {
      contract: contractPath,
      suite: suitePath,
      manifest: manifestPath,
    },
    requiresRegenerate: false,
    scenarioResults,
  };
}

async function prepareArtifacts(input: {
  cwd: string;
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>;
  sources: Awaited<ReturnType<ReturnType<typeof createSourceLoader>["load"]>>;
  manifest: Manifest | undefined;
  regenerate: boolean;
  extractor: ReturnType<typeof createContractExtractor>;
  generator: ReturnType<typeof createScenarioGenerator>;
  llmProvider?: LlmProvider;
}): Promise<{
  contract: AgentContract;
  suite: TestSuite;
  manifest: Manifest;
  contractStatus: ScanRunResult["contractStatus"];
  suiteStatus: ScanRunResult["suiteStatus"];
  warnings: string[];
}> {
  if (input.manifest && !input.regenerate) {
    const contract = readAgentContract(input.cwd);
    const suite = readTestSuite(input.cwd);
    if (contract && suite) {
      return {
        contract,
        suite,
        manifest: input.manifest,
        contractStatus: "reused",
        suiteStatus: "reused",
        warnings: [],
      };
    }
  }

  const contract = await input.extractor.extract({
    config: input.config,
    sources: input.sources,
    llmProvider: input.llmProvider,
  });
  const suite = input.generator.generate({
    config: input.config,
    contract,
    sources: input.sources,
    llmProvider: input.llmProvider,
  });
  const resolvedSuite = await suite;

  const contractHash = createObjectHash(contract);
  const suiteHash = createObjectHash(resolvedSuite);
  const manifest: Manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    preset: input.config.project.preset,
    seed: input.config.generation.seed,
    sourceHash: input.sources.sourceHash,
    contractHash,
    suiteHash,
    contractSchemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
    suiteSchemaVersion: TEST_SUITE_SCHEMA_VERSION,
    generation: {
      scenarios: input.config.generation.scenarios,
      maxTurns: input.config.generation.maxTurns,
    },
  };

  writeAgentContract(input.cwd, contract);
  writeTestSuite(input.cwd, resolvedSuite);
  writeManifest(input.cwd, manifest);

  return {
    contract,
    suite: resolvedSuite,
    manifest,
    contractStatus: input.manifest ? "regenerated" : "created",
    suiteStatus: input.manifest ? "regenerated" : "created",
    warnings: [],
  };
}

async function executeScenario(input: {
  contract: AgentContract;
  scenario: SuiteScenario;
  repetition: number;
  target: AgentTarget;
  llmProvider?: LlmProvider;
  judgeConfig: Awaited<ReturnType<typeof loadAgentGuardConfig>>["llm"]["judge"];
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>;
  sources: Awaited<ReturnType<ReturnType<typeof createSourceLoader>["load"]>>;
}): Promise<ScenarioExecutionResult> {
  const sessionId = createSessionId(
    input.scenario.id,
    input.repetition,
    input.config.generation.seed,
  );
  const history: ConversationMessage[] = [];
  const turnOutputs: ScenarioTurnRun[] = [];
  const rawTurnOutputs = [];

  for (let index = 0; index < input.scenario.turns.length; index += 1) {
    const turn = input.scenario.turns[index];
    const output = await input.target.executeTurn({
      scenarioId: input.scenario.id,
      scenarioTitle: input.scenario.title,
      category: input.scenario.category,
      severity: input.scenario.severity,
      repetition: input.repetition,
      turnIndex: index,
      sessionId,
      dryRun: input.config.scan.dryRunTools,
      userMessage: turn.message,
      history,
      systemPrompt: input.sources.systemPrompt.content,
      metadata: {
        projectName: input.config.project.name,
        preset: input.config.project.preset,
      },
      timeoutMs:
        input.config.scan.target?.type === "http"
          ? (input.config.scan.target.request?.timeoutMs ?? input.config.timeoutMs)
          : input.config.timeoutMs,
      retries:
        input.config.scan.target?.type === "http"
          ? (input.config.scan.target.request?.retries ?? input.config.retries)
          : input.config.retries,
    });
    rawTurnOutputs.push(output);
    turnOutputs.push({
      turnIndex: index,
      request: turn.message,
      response: output.text,
      latencyMs: output.latencyMs,
      retryCount: output.retryCount,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      httpStatus: output.httpStatus,
      error: output.error,
      timedOut: Boolean(output.timedOut),
      toolCalls: output.toolCalls,
      retrievedContext: output.retrievedContext,
      metadata: output.metadata,
      raw: output.raw,
    });
    history.push({ role: "user", content: turn.message });
    history.push({ role: "assistant", content: output.text });
  }

  const evaluation = await evaluateScenarioExecution({
    contract: input.contract,
    scenario: input.scenario,
    repetition: input.repetition,
    sessionId,
    turnOutputs: rawTurnOutputs,
    llmProvider: input.llmProvider,
    judgeConfig: input.judgeConfig,
  });

  return {
    scenarioId: evaluation.scenarioId,
    title: evaluation.title,
    category: evaluation.category,
    severity: evaluation.severity,
    repetition: evaluation.repetition,
    sessionId: evaluation.sessionId,
    conversation: history,
    turns: turnOutputs,
    passed: evaluation.passed,
    critical: evaluation.criticalFailures.length > 0,
    score: evaluation.score,
    metrics: evaluation.metrics,
    reasons: evaluation.reasons,
    evidence: evaluation.evidence,
    sourceRefs: evaluation.sourceRefs,
    toolCalls: evaluation.toolCalls,
    recommendations: evaluation.recommendations,
    technicalErrors: evaluation.technicalErrors,
  };
}

function buildScanReport(input: {
  runId: string;
  dryRun: boolean;
  contract: AgentContract;
  suite: TestSuite;
  scenarioResults: ScenarioExecutionResult[];
  generatedAt: string;
  baseline: ScanReport | undefined;
  latencyMs: number;
}): ScanReport {
  const totalTurns = input.scenarioResults.reduce(
    (total, scenario) => total + scenario.turns.length,
    0,
  );
  const passedScenarios = input.scenarioResults.filter((scenario) => scenario.passed).length;
  const failedScenarios = input.scenarioResults.length - passedScenarios;
  const criticalFailures = input.scenarioResults.filter((scenario) => scenario.critical).length;
  const overallScore = Number(
    (
      input.scenarioResults.reduce((total, scenario) => total + scenario.score, 0) /
      Math.max(1, input.scenarioResults.length)
    ).toFixed(3),
  );
  const metrics = aggregateMetrics(input.scenarioResults);
  const consistency = calculateConsistency(input.scenarioResults);

  const baselineComparison = input.baseline
    ? {
        previousOverallScore: input.baseline.summary.overallScore,
        currentOverallScore: overallScore,
        improvedScenarioIds: findChangedScenarioIds(input.baseline, input.scenarioResults, "improved"),
        regressedScenarioIds: findChangedScenarioIds(input.baseline, input.scenarioResults, "regressed"),
        newCriticalFailures: findCriticalScenarioChanges(input.baseline, input.scenarioResults, "new"),
        resolvedCriticalFailures: findCriticalScenarioChanges(input.baseline, input.scenarioResults, "resolved"),
      }
    : undefined;

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    runId: input.runId,
    dryRun: input.dryRun,
    baselineComparison,
    summary: {
      totalScenarios: input.scenarioResults.length,
      totalTurns,
      passedScenarios,
      failedScenarios,
      criticalFailures,
      overallScore,
      consistency,
      latencyMs: input.latencyMs,
      metrics,
    },
    scenarios: input.scenarioResults.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      category: scenario.category,
      severity: scenario.severity,
      repetition: scenario.repetition,
      passed: scenario.passed,
      critical: scenario.critical,
      score: scenario.score,
      reasons: scenario.reasons,
      evidence: scenario.evidence,
      sourceRefs: scenario.sourceRefs,
      recommendations: scenario.recommendations,
      technicalErrors: scenario.technicalErrors,
      toolCalls: scenario.toolCalls,
      turns: scenario.turns,
    })),
  };
}

function aggregateMetrics(results: ScenarioExecutionResult[]): Record<string, number> {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const result of results) {
    for (const [key, value] of Object.entries(result.metrics)) {
      sums.set(key, (sums.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const aggregated: Record<string, number> = {};
  for (const [key, total] of sums.entries()) {
    aggregated[key] = Number((total / Math.max(1, counts.get(key) ?? 1)).toFixed(3));
  }
  aggregated.overallScore =
    results.length > 0
      ? Number(
          (
            results.reduce((total, result) => total + result.score, 0) /
            results.length
          ).toFixed(3),
        )
      : 0;
  return aggregated;
}

function calculateConsistency(results: ScenarioExecutionResult[]): number {
  const grouped = new Map<string, number[]>();
  for (const result of results) {
    const key = result.scenarioId;
    const scores = grouped.get(key) ?? [];
    scores.push(result.score);
    grouped.set(key, scores);
  }

  const consistencies = [...grouped.values()].map((scores) => {
    if (scores.length <= 1) {
      return 1;
    }
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    return Number((1 - (max - min)).toFixed(3));
  });

  return consistencies.length > 0
    ? Number(
        (
          consistencies.reduce((total, value) => total + value, 0) /
          consistencies.length
        ).toFixed(3),
      )
    : 1;
}

function findChangedScenarioIds(
  baseline: ScanReport,
  current: ScenarioExecutionResult[],
  mode: "improved" | "regressed",
): string[] {
  const baselineScores = new Map(
    baseline.scenarios.map((scenario) => [
      `${scenario.scenarioId}:${scenario.repetition}`,
      scenario.score,
    ]),
  );
  return current
    .filter((scenario) => {
      const previous = baselineScores.get(`${scenario.scenarioId}:${scenario.repetition}`);
      if (previous === undefined) {
        return false;
      }
      return mode === "improved" ? scenario.score > previous : scenario.score < previous;
    })
    .map((scenario) => scenario.scenarioId);
}

function findCriticalScenarioChanges(
  baseline: ScanReport,
  current: ScenarioExecutionResult[],
  mode: "new" | "resolved",
): string[] {
  const baselineCritical = new Map(
    baseline.scenarios.map((scenario) => [
      `${scenario.scenarioId}:${scenario.repetition}`,
      scenario.critical,
    ]),
  );

  return current
    .filter((scenario) => {
      const previous = baselineCritical.get(`${scenario.scenarioId}:${scenario.repetition}`);
      if (previous === undefined) {
        return mode === "new" ? scenario.critical : false;
      }
      return mode === "new" ? !previous && scenario.critical : previous && !scenario.critical;
    })
    .map((scenario) => scenario.scenarioId);
}

function createScenarioTasks(
  suite: TestSuite,
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>,
): Array<{ scenario: SuiteScenario; repetition: number }> {
  const tasks: Array<{ scenario: SuiteScenario; repetition: number }> = [];
  for (const scenario of suite.scenarios) {
    const repetitions =
      scenario.severity === "critical"
        ? config.scan.repetitions.critical
        : scenario.severity === "high"
          ? config.scan.repetitions.high
          : config.scan.repetitions.default;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      tasks.push({ scenario, repetition });
    }
  }
  return tasks;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]);
      }
    }),
  );

  return results;
}

function createTarget(
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>,
  fetchFn: typeof fetch | undefined,
): AgentTarget {
  if (config.scan.target?.type === "http") {
    return createHttpAgentTarget({
      target: config.scan.target,
      config,
      fetchFn,
    });
  }

  if (config.scan.target?.type === "provider") {
    return createProviderAgentTarget({
      target: config.scan.target,
      config,
      fetchFn,
    });
  }

  throw new Error(
    'Scan target execution was requested without an explicit "scan.target" configuration.',
  );
}

function hasExecutableTarget(config: Awaited<ReturnType<typeof loadAgentGuardConfig>>): boolean {
  return Boolean(config.scan.target);
}

function createConfiguredLlmProvider(
  config: ResolvedLlmRoleConfig,
  fetchFn: typeof fetch | undefined,
): LlmProvider | undefined {
  if (!config.provider) {
    return undefined;
  }
  return createLlmProvider(config.provider, { fetchFn });
}

function collectExecutionWarnings(results: ScenarioExecutionResult[]): string[] {
  const warnings: string[] = [];
  const technicalErrorCount = results.reduce(
    (total, scenario) => total + scenario.technicalErrors.length,
    0,
  );
  if (technicalErrorCount > 0) {
    warnings.push(`Observed ${technicalErrorCount} technical execution errors during scan.`);
  }
  return warnings;
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${createContentHash(timestamp).slice(0, 6)}`;
}

function createSessionId(scenarioId: string, repetition: number, seed: number): string {
  return `ag-${createContentHash(`${scenarioId}:${repetition}:${seed}`).slice(0, 12)}`;
}

function detectStaleReasons(
  manifest: Manifest,
  sourceHash: string,
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>,
): string[] {
  const reasons: string[] = [];

  if (manifest.sourceHash !== sourceHash) {
    reasons.push("Source content changed since the last generated contract and suite.");
  }
  if (manifest.preset !== config.project.preset) {
    reasons.push(
      `Preset changed from "${manifest.preset}" to "${config.project.preset}".`,
    );
  }
  if (manifest.seed !== config.generation.seed) {
    reasons.push(
      `Generation seed changed from ${manifest.seed} to ${config.generation.seed}.`,
    );
  }
  if (manifest.generation.scenarios !== config.generation.scenarios) {
    reasons.push(
      `Requested scenario count changed from ${manifest.generation.scenarios} to ${config.generation.scenarios}.`,
    );
  }
  if (manifest.generation.maxTurns !== config.generation.maxTurns) {
    reasons.push(
      `Max turns changed from ${manifest.generation.maxTurns} to ${config.generation.maxTurns}.`,
    );
  }

  return reasons;
}
