#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  runAgentTests,
  runDoctor,
  runScan,
} from "../../core/dist/index.js";
import {
  formatDoctorReport,
  type DiagnosticReporter,
  formatScanReport,
  formatTerminalReport,
  type TerminalReporter,
} from "./reporters.js";

type Provider = "openai" | "deepseek" | "gemini" | "anthropic";

const PROVIDER_VALUES = ["openai", "deepseek", "gemini", "anthropic"] as const;
const DEFAULT_PROVIDER: Provider = "openai";

type InitOptions = {
  cwd: string;
  provider: Provider;
  generatorProvider: Provider;
  generatorModel: string;
  judgeProvider: Provider;
  judgeModel: string;
  yes: boolean;
  withGithubAction: boolean;
};

type TestOptions = {
  cwd: string;
  provider?: Provider;
  model?: string;
  grep?: string;
  ci: boolean;
  reporter?: TerminalReporter;
  execution: "stub" | "provider";
};

type InitFileStatus = "created" | "updated" | "unchanged" | "skipped";

type InitFileResult = {
  path: string;
  status: InitFileStatus;
  reason?: string;
};

type InitResult = {
  files: InitFileResult[];
};

type ScanOptions = {
  cwd: string;
  dryRun: boolean;
  regenerate: boolean;
  saveBaseline: boolean;
  ci: boolean;
};

type DoctorOptions = {
  cwd: string;
  ci: boolean;
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    process.stdout.write("AgentGuard CLI\n");
    return 0;
  }

  if (command === "init") {
    const parsed = parseInitArgs(rest);
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }

    const result = runInit(parsed.options);
    for (const entry of result.files) {
      const reason = entry.reason ? ` (${entry.reason})` : "";
      process.stdout.write(`${entry.status}: ${entry.path}${reason}\n`);
    }
    process.stdout.write(
      [
        'next: edit "agentguard.config.ts" to set "scan.target" for real execution.',
        'next: run "npx agentguard scan --dry-run" to generate contract and suite artifacts.',
        "note: the target stays separate from llm.generator and llm.judge provider settings.",
      ].join("\n") + "\n",
    );
    return 0;
  }

  if (command === "test") {
    const parsed = parseTestArgs(rest);
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    return runTest(parsed.options);
  }

  if (command === "scan") {
    const parsed = parseScanArgs(rest);
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    return runScanCommand(parsed.options);
  }

  if (command === "doctor") {
    const parsed = parseDoctorArgs(rest);
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    return runDoctorCommand(parsed.options);
  }

  process.stderr.write(`Unknown command "${command}".\n`);
  return 2;
}

function parseInitArgs(args: string[]):
  | { ok: true; options: InitOptions }
  | { ok: false; error: string } {
  let provider: Provider = DEFAULT_PROVIDER;
  let generatorProvider: Provider | undefined;
  let generatorModel: string | undefined;
  let judgeProvider: Provider | undefined;
  let judgeModel: string | undefined;
  let yes = false;
  let withGithubAction = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--yes") {
      yes = true;
      continue;
    }
    if (current === "--provider") {
      const value = args[index + 1];
      if (!isProvider(value)) {
        return {
          ok: false,
          error: `Invalid value for "--provider". Use ${formatProviderList()}.`,
        };
      }
      provider = value;
      index += 1;
      continue;
    }
    if (current === "--generator-provider") {
      const value = args[index + 1];
      if (!isProvider(value)) {
        return {
          ok: false,
          error: `Invalid value for "--generator-provider". Use ${formatProviderList()}.`,
        };
      }
      generatorProvider = value;
      index += 1;
      continue;
    }
    if (current === "--generator-model") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return {
          ok: false,
          error: 'Missing value for "--generator-model".',
        };
      }
      generatorModel = value;
      index += 1;
      continue;
    }
    if (current === "--judge-provider") {
      const value = args[index + 1];
      if (!isProvider(value)) {
        return {
          ok: false,
          error: `Invalid value for "--judge-provider". Use ${formatProviderList()}.`,
        };
      }
      judgeProvider = value;
      index += 1;
      continue;
    }
    if (current === "--judge-model") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return {
          ok: false,
          error: 'Missing value for "--judge-model".',
        };
      }
      judgeModel = value;
      index += 1;
      continue;
    }
    if (current === "--with-github-action") {
      withGithubAction = true;
      continue;
    }

    return {
      ok: false,
      error: `Unknown flag "${current}" for "init".`,
    };
  }

  const resolvedGeneratorProvider = generatorProvider ?? provider;
  const resolvedJudgeProvider = judgeProvider ?? provider;
  return {
    ok: true,
    options: {
      cwd: process.cwd(),
      provider: resolvedGeneratorProvider,
      generatorProvider: resolvedGeneratorProvider,
      generatorModel: generatorModel ?? getDefaultModel(resolvedGeneratorProvider),
      judgeProvider: resolvedJudgeProvider,
      judgeModel: judgeModel ?? getDefaultModel(resolvedJudgeProvider),
      yes,
      withGithubAction,
    },
  };
}

function parseScanArgs(args: string[]):
  | { ok: true; options: ScanOptions }
  | { ok: false; error: string } {
  let dryRun = false;
  let regenerate = false;
  let saveBaseline = false;
  let ci = false;

  for (const current of args) {
    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (current === "--regenerate") {
      regenerate = true;
      continue;
    }
    if (current === "--save-baseline") {
      saveBaseline = true;
      continue;
    }
    if (current === "--ci") {
      ci = true;
      continue;
    }

    return {
      ok: false,
      error: `Unknown flag "${current}" for "scan".`,
    };
  }

  return {
    ok: true,
    options: {
      cwd: process.cwd(),
      dryRun,
      regenerate,
      saveBaseline,
      ci,
    },
  };
}

function parseDoctorArgs(args: string[]):
  | { ok: true; options: DoctorOptions }
  | { ok: false; error: string } {
  let ci = false;

  for (const current of args) {
    if (current === "--ci") {
      ci = true;
      continue;
    }

    return {
      ok: false,
      error: `Unknown flag "${current}" for "doctor".`,
    };
  }

  return {
    ok: true,
    options: {
      cwd: process.cwd(),
      ci,
    },
  };
}

function parseTestArgs(args: string[]):
  | { ok: true; options: TestOptions }
  | { ok: false; error: string } {
  let provider: Provider | undefined;
  let model: string | undefined;
  let grep: string | undefined;
  let ci = false;
  let reporter: TerminalReporter | undefined;
  let execution: "stub" | "provider" = "stub";

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--ci") {
      ci = true;
      continue;
    }

    if (current === "--provider") {
      const value = args[index + 1];
      if (!isProvider(value)) {
        return {
          ok: false,
          error: `Invalid value for "--provider". Use ${formatProviderList()}.`,
        };
      }
      provider = value;
      index += 1;
      continue;
    }

    if (current === "--reporter") {
      const value = args[index + 1];
      if (value !== "pretty" && value !== "ci" && value !== "json") {
        return {
          ok: false,
          error: 'Invalid value for "--reporter". Use "pretty", "ci", or "json".',
        };
      }
      reporter = value;
      index += 1;
      continue;
    }

    if (current === "--model") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return {
          ok: false,
          error: 'Missing value for "--model".',
        };
      }
      model = value;
      index += 1;
      continue;
    }

    if (current === "--grep") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return {
          ok: false,
          error: 'Missing value for "--grep".',
        };
      }
      grep = value;
      index += 1;
      continue;
    }

    if (current === "--execution") {
      const value = args[index + 1];
      if (value !== "stub" && value !== "provider") {
        return {
          ok: false,
          error: 'Invalid value for "--execution". Use "stub" or "provider".',
        };
      }
      execution = value;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `Unknown flag "${current}" for "test".`,
    };
  }

  return {
    ok: true,
    options: {
      cwd: process.cwd(),
      provider,
      model,
      grep,
      ci,
      reporter,
      execution,
    },
  };
}

async function runTest(options: TestOptions): Promise<number> {
  try {
    const result = await runAgentTests({
      cwd: options.cwd,
      provider: options.provider,
      model: options.model,
      grep: options.grep,
      ci: options.ci,
      execution: options.execution,
    });

    const reporter: TerminalReporter = options.reporter ?? (options.ci ? "ci" : "pretty");
    process.stdout.write(formatTerminalReport(result, reporter));

    if (result.summary.failed > 0) {
      return 1;
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    return 2;
  }
}

async function runScanCommand(options: ScanOptions): Promise<number> {
  try {
    const result = await runScan({
      cwd: options.cwd,
      dryRun: options.dryRun,
      regenerate: options.regenerate,
      saveBaseline: options.saveBaseline,
      ci: options.ci,
    });
    const reporter: DiagnosticReporter = options.ci ? "ci" : "pretty";
    process.stdout.write(formatScanReport(result, reporter));
    if (result.requiresRegenerate) {
      return 1;
    }
    if ((result.report?.summary.failedScenarios ?? 0) > 0) {
      return 1;
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${formatCommandError("scan", error)}\n`);
    return 2;
  }
}

async function runDoctorCommand(options: DoctorOptions): Promise<number> {
  try {
    const result = await runDoctor({
      cwd: options.cwd,
    });
    const reporter: DiagnosticReporter = options.ci ? "ci" : "pretty";
    process.stdout.write(formatDoctorReport(result, reporter));
    return result.status === "error" ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${formatCommandError("doctor", error)}\n`);
    return 2;
  }
}

function formatError(error: unknown): string {
  return formatCommandError("test", error);
}

function formatCommandError(command: string, error: unknown): string {
  if (error instanceof Error) {
    return `agentguard ${command} failed: ${error.message}`;
  }
  return `agentguard ${command} failed: ${String(error)}`;
}

function runInit(options: InitOptions): InitResult {
  const fileMap: Array<{ path: string; content: string }> = [
    {
      path: "agentguard.config.ts",
      content: buildConfigContent(options),
    },
    {
      path: "ai-tests/example.test.ts",
      content: buildExampleTestContent(),
    },
    {
      path: ".env.example",
      content: buildEnvExampleContent(),
    },
    {
      path: "agent-data/system-prompt.md",
      content: buildSystemPromptContent(),
    },
    {
      path: "agent-data/knowledge/faq.md",
      content: buildKnowledgeFaqContent(),
    },
  ];

  if (options.withGithubAction) {
    fileMap.push({
      path: ".github/workflows/agentguard.yml",
      content: buildGithubActionsWorkflowContent(options.provider),
    });
  }

  const results: InitFileResult[] = [];
  for (const file of fileMap) {
    results.push(writeFileSafely(options.cwd, file.path, file.content, options.yes));
  }
  results.push(ensureGitignoreRules(options.cwd));

  return { files: results };
}

const AGENTGUARD_GITIGNORE_RULES = [
  ".agentguard/",
  ".agentguard-ci-report.json",
  ".agentguard-ci-scan.txt",
];

function ensureGitignoreRules(cwd: string): InitFileResult {
  const relativePath = ".gitignore";
  const absolutePath = resolve(cwd, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  if (!existsSync(absolutePath)) {
    writeFileSync(
      absolutePath,
      `${AGENTGUARD_GITIGNORE_RULES.join("\n")}\n`,
      "utf8",
    );
    return { path: relativePath, status: "created" };
  }

  const current = readFileSync(absolutePath, "utf8");
  const existingRules = new Set(
    current
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const missingRules = AGENTGUARD_GITIGNORE_RULES.filter((rule) => !existingRules.has(rule));
  if (missingRules.length === 0) {
    return { path: relativePath, status: "unchanged" };
  }

  const normalizedCurrent = current.endsWith("\n") ? current : `${current}\n`;
  const next = `${normalizedCurrent}${missingRules.join("\n")}\n`;
  writeFileSync(absolutePath, next, "utf8");
  return { path: relativePath, status: "updated" };
}

function writeFileSafely(
  cwd: string,
  relativePath: string,
  content: string,
  forceOverwrite: boolean,
): InitFileResult {
  const absolutePath = resolve(cwd, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  if (!existsSync(absolutePath)) {
    writeFileSync(absolutePath, content, "utf8");
    return { path: relativePath, status: "created" };
  }

  const current = readFileSync(absolutePath, "utf8");
  if (current === content) {
    return { path: relativePath, status: "unchanged" };
  }

  if (!forceOverwrite) {
    return {
      path: relativePath,
      status: "skipped",
      reason: "already exists with different content; rerun with --yes to overwrite",
    };
  }

  writeFileSync(absolutePath, content, "utf8");
  return { path: relativePath, status: "updated" };
}

function buildConfigContent(options: InitOptions): string {
  return `import { defineConfig } from "agentguard";

export default defineConfig({
  provider: "${options.provider}",
  model: "${options.generatorModel}",
  llm: {
    generator: {
      provider: "${options.generatorProvider}",
      model: "${options.generatorModel}"
    },
    judge: {
      provider: "${options.judgeProvider}",
      model: "${options.judgeModel}"
    }
  },
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
  project: {
    name: "my-agent",
    locale: "en-US",
    preset: "customer-support"
  },
  sources: {
    systemPrompt: {
      type: "file",
      path: "./agent-data/system-prompt.md"
    },
    knowledge: [
      {
        type: "glob",
        pattern: "./agent-data/knowledge/**/*.{md,txt,json}"
      }
    ]
  },
  generation: {
    scenarios: 24,
    maxTurns: 4,
    seed: 42
  }
});
`;
}

function buildExampleTestContent(): string {
  return `import { testAgent } from "agentguard";

testAgent("profile-analysis: should include confidence and assumptions", {
  input:
    "Analyze this profile and summarize strengths, risks, and next steps. " +
    "Profile: Product analyst with 4 years of experience in SQL, A/B testing, and stakeholder communication. " +
    "Respond in English and include the exact words 'confidence' and 'assumptions'.",
  expected: {
    mustInclude: ["confidence", "assumptions"],
    mustNotInclude: ["salary guarantee"],
  },
});
`;
}

function buildEnvExampleContent(): string {
  return [
    "OPENAI_API_KEY=",
    "DEEPSEEK_API_KEY=",
    "GEMINI_API_KEY=",
    "ANTHROPIC_API_KEY=",
    "AGENTGUARD_GENERATOR_MODEL=",
    "AGENTGUARD_JUDGE_MODEL=",
    "",
  ].join("\n");
}

function buildSystemPromptContent(): string {
  return [
    "You are a concise and helpful customer support agent.",
    "Do not invent unsupported details.",
    "Ask clarifying questions before committing to an answer when information is missing.",
    "Hand sensitive situations to a human teammate when needed.",
  ].join("\n");
}

function buildKnowledgeFaqContent(): string {
  return [
    "# FAQ",
    "",
    "- Support hours: Monday to Friday, 08:00-18:00.",
    "- Collect name and preferred contact before scheduling.",
    "- Do not provide medical, legal, or financial advice in chat.",
  ].join("\n");
}

function buildGithubActionsWorkflowContent(provider: Provider): string {
  void provider;
  return `name: AgentGuard

on:
  pull_request:
  push:
    branches: [main]

jobs:
  agentguard:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Doctor check
        run: npx agentguard doctor --ci
      - name: Generate scan artifacts
        run: |
          npx agentguard scan --dry-run --ci | tee .agentguard-ci-scan.txt
      - name: Upload AgentGuard report
        if: always()
        uses: actions/upload-artifact@v6
        with:
          name: agentguard-artifacts
          path: |
            .agentguard/
            .agentguard-ci-scan.txt
`;
}

const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) {
  process.exitCode = exitCode;
}

function isProvider(value: string | undefined): value is Provider {
  return Boolean(value) && PROVIDER_VALUES.includes(value as Provider);
}

function formatProviderList(): string {
  return PROVIDER_VALUES.map((value) => `"${value}"`).join(", ");
}

function getDefaultModel(provider: Provider): string {
  if (provider === "deepseek") {
    return "deepseek-chat";
  }
  if (provider === "gemini") {
    return "gemini-2.5-flash";
  }
  if (provider === "anthropic") {
    return "claude-sonnet-4-0";
  }
  return "gpt-4.1-mini";
}
