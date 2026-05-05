#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runAgentTests } from "../../core/dist/index.js";
import { formatTerminalReport, type TerminalReporter } from "./reporters.js";

type Provider = "openai" | "deepseek";

type InitOptions = {
  cwd: string;
  provider: Provider;
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

  process.stderr.write(`Unknown command "${command}".\n`);
  return 2;
}

function parseInitArgs(args: string[]):
  | { ok: true; options: InitOptions }
  | { ok: false; error: string } {
  let provider: Provider = "openai";
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
      if (value !== "openai" && value !== "deepseek") {
        return {
          ok: false,
          error: 'Invalid value for "--provider". Use "openai" or "deepseek".',
        };
      }
      provider = value;
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

  return {
    ok: true,
    options: {
      cwd: process.cwd(),
      provider,
      yes,
      withGithubAction,
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
      if (value !== "openai" && value !== "deepseek") {
        return {
          ok: false,
          error: 'Invalid value for "--provider". Use "openai" or "deepseek".',
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `agentguard test failed: ${error.message}`;
  }
  return `agentguard test failed: ${String(error)}`;
}

function runInit(options: InitOptions): InitResult {
  const model = options.provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini";
  const fileMap: Array<{ path: string; content: string }> = [
    {
      path: "agentguard.config.ts",
      content: buildConfigContent(options.provider, model),
    },
    {
      path: "ai-tests/example.test.ts",
      content: buildExampleTestContent(),
    },
    {
      path: ".env.example",
      content: buildEnvExampleContent(options.provider),
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

const AGENTGUARD_GITIGNORE_RULES = [".agentguard/", ".agentguard-ci-report.json"];

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

function buildConfigContent(provider: Provider, model: string): string {
  return `export default {
  provider: "${provider}",
  model: "${model}",
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
};
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

function buildEnvExampleContent(provider: Provider): string {
  if (provider === "deepseek") {
    return "DEEPSEEK_API_KEY=\nOPENAI_API_KEY=\n";
  }
  return "OPENAI_API_KEY=\nDEEPSEEK_API_KEY=\n";
}

function buildGithubActionsWorkflowContent(provider: Provider): string {
  const secretName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
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
      - name: Run AgentGuard (CI)
        run: |
          set +e
          npx agentguard test --ci --reporter json > .agentguard-ci-report.json
          status=$?
          if [ ! -s .agentguard-ci-report.json ]; then
            printf '{"schemaVersion":1,"summary":{"failed":1},"tests":[],"error":"agentguard did not emit json report; check workflow logs"}\n' > .agentguard-ci-report.json
          fi
          exit $status
        env:
          ${secretName}: \${{ secrets.${secretName} }}
      - name: Upload AgentGuard report
        if: always()
        uses: actions/upload-artifact@v6
        with:
          name: agentguard-ci-report
          path: .agentguard-ci-report.json
`;
}

const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
