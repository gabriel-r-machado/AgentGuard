import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { runAgentTests } from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-runner-"));
}

test("runner discovers tests from testsDir and returns stub output", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "b.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("test-b", {
  input: "B",
  expected: { mustInclude: ["b"] }
});`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "a.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("test-a", {
  input: "A",
  expected: { mustInclude: ["a"] }
});`,
      "utf8",
    );

    const result = await runAgentTests({ cwd });

    assert.equal(result.discoveredFiles.length, 2);
    assert.deepEqual(
      result.tests.map((entry) => entry.name),
      ["test-a", "test-b"],
    );
    assert.equal(result.results[0].responseText, 'stubbed response for "test-a"');
    assert.equal(result.results[1].responseText, 'stubbed response for "test-b"');
    assert.deepEqual(result.summary, {
      total: 2,
      passed: 2,
      failed: 0,
      inconclusive: 0,
      durationMs: result.summary.durationMs,
      totalCostUsd: 0,
      results: result.results,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runner persists stable run artifacts under .agentguard/results", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("pass-case", {
  input: "ok",
  expected: { mustInclude: ["ok"] }
});
testAgent("fail-case", {
  input: "nope",
  expected: { mustInclude: ["required"] }
});`,
      "utf8",
    );

    const result = await runAgentTests({
      cwd,
      executor: async ({ test: registered }) => ({
        status: "passed",
        responseText: registered.name === "pass-case" ? "ok response" : "not matching",
      }),
    });

    const artifactsDir = join(cwd, ".agentguard", "results");
    const files = readdirSync(artifactsDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.json$/);
    assert.equal(result.artifactFilePath, join(artifactsDir, files[0]));

    const artifact = JSON.parse(readFileSync(join(artifactsDir, files[0]), "utf8"));
    assert.equal(artifact.schemaVersion, 1);
    assert.match(artifact.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(artifact.summary.total, 2);
    assert.equal(artifact.summary.passed, 1);
    assert.equal(artifact.summary.failed, 1);
    assert.equal(artifact.failures.length, 1);
    assert.equal(artifact.failures[0].testId, "fail-case");
    assert.equal(artifact.failures[0].status, "failed");
    assert.match(artifact.failures[0].failures[0], /Missing required text/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("snapshot contract mode is opt-in and ignores raw JSON value changes by default", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "snapshot.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("snapshot-contract", {
  input: "return contract json",
  expected: {
    snapshot: {}
  }
});`,
      "utf8",
    );

    const first = await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: '{"answer":"yes","score":1}',
      }),
    });
    assert.equal(first.summary.failed, 0);

    const second = await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: '{"answer":"no","score":999}',
      }),
    });
    assert.equal(second.summary.failed, 0);

    const snapshotPath = join(cwd, ".agentguard", "snapshots", "snapshot-contract.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    assert.equal(snapshot.mode, "contract");
    assert.equal(snapshot.value.kind, "json");
    assert.equal(snapshot.value.contract.type, "object");
    assert.deepEqual(snapshot.value.contract.keys, ["answer", "score"]);
    assert.equal(snapshot.value.contract.properties.answer.type, "string");
    assert.equal(snapshot.value.contract.properties.score.type, "number");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("snapshot contract mode fails when response shape changes", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "snapshot.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("snapshot-shape-break", {
  input: "return contract json",
  expected: {
    snapshot: {}
  }
});`,
      "utf8",
    );

    await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: '{"answer":"yes","score":1}',
      }),
    });

    const second = await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: '[{"answer":"yes"}]',
      }),
    });

    assert.equal(second.summary.failed, 1);
    assert.equal(second.results[0].status, "failed");
    assert.match(second.results[0].failures[0], /Snapshot assertion failed/);
    assert.match(second.results[0].failures[0], /snapshot-shape-break/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runner executes tests sequentially with custom stub executor", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("one", {
  input: "1",
  expected: { mustInclude: ["1"] }
});
testAgent("two", {
  input: "2",
  expected: { mustInclude: ["2"] }
});
testAgent("three", {
  input: "3",
  expected: { mustInclude: ["3"] }
});`,
      "utf8",
    );

    const executionOrder = [];
    const result = await runAgentTests({
      cwd,
      executor: async ({ test: registered }) => {
        executionOrder.push(registered.name);
        if (registered.name === "two") {
          return {
            status: "failed",
            responseText: "value 2 failed",
            failures: ["expected value missing"],
            costUsd: 0.01,
          };
        }
        return {
          status: "passed",
          responseText: `value ${registered.spec.input} ok`,
          costUsd: 0.01,
        };
      },
    });

    assert.deepEqual(executionOrder, ["one", "two", "three"]);
    assert.deepEqual(
      result.results.map((entry) => entry.status),
      ["passed", "failed", "passed"],
    );
    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.passed, 2);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.summary.inconclusive, 0);
    assert.equal(result.summary.totalCostUsd, 0.03);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runner executes with openai provider adapter when provider mode is enabled", async () => {
  const cwd = createTempDir();
  const previousApiKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "test-key";
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("provider-pass", {
  input: "say ok",
  expected: { mustInclude: ["ok"] }
});`,
      "utf8",
    );

    const providerFetch = async () =>
      new Response(
        JSON.stringify({
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          choices: [{ message: { content: "ok from provider" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const result = await runAgentTests({
      cwd,
      execution: "provider",
      providerFetch,
    });

    assert.equal(result.summary.total, 1);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.results[0].status, "passed");
    assert.equal(result.results[0].responseText, "ok from provider");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runner executes with deepseek provider adapter without DSL changes", async () => {
  const cwd = createTempDir();
  const previousApiKey = process.env.DEEPSEEK_API_KEY;
  try {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "deepseek",
  model: "deepseek-chat",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("provider-pass", {
  input: "say ok",
  expected: { mustInclude: ["ok"] }
});`,
      "utf8",
    );

    const providerFetch = async () =>
      new Response(
        JSON.stringify({
          usage: { prompt_tokens: 7, completion_tokens: 4 },
          choices: [{ message: { content: "ok from deepseek" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const result = await runAgentTests({
      cwd,
      execution: "provider",
      providerFetch,
    });

    assert.equal(result.summary.total, 1);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.results[0].status, "passed");
    assert.equal(result.results[0].responseText, "ok from deepseek");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previousApiKey;
    }
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runner blocks predictably when maxCostPerRun is exceeded", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests",
  maxCostPerRun: 0.015
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("cost-1", {
  input: "1",
  expected: { mustInclude: ["ok"] }
});
testAgent("cost-2", {
  input: "2",
  expected: { mustInclude: ["ok"] }
});
testAgent("cost-3", {
  input: "3",
  expected: { mustInclude: ["ok"] }
});`,
      "utf8",
    );

    const result = await runAgentTests({
      cwd,
      executor: async ({ test: registered }) => ({
        status: "passed",
        responseText: `ok ${registered.name}`,
        costUsd: 0.01,
      }),
    });

    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.summary.inconclusive, 1);
    assert.equal(result.summary.totalCostUsd, 0.02);

    assert.equal(result.results[0].testId, "cost-1");
    assert.equal(result.results[0].status, "passed");
    assert.equal(result.results[1].testId, "cost-2");
    assert.equal(result.results[1].status, "failed");
    assert.match(result.results[1].failures[0], /Run cost guard triggered/);
    assert.equal(result.results[2].testId, "cost-3");
    assert.equal(result.results[2].status, "inconclusive");
    assert.match(result.results[2].failures[0], /Skipped because maxCostPerRun/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("judge-only assertion does not act as sole critical gate by default", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("judge-only", {
  input: "test input",
  expected: {
    judge: { rule: "response should mention refunds", threshold: 0.9 }
  }
});`,
      "utf8",
    );

    const result = await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: "hello world",
      }),
    });

    assert.equal(result.summary.total, 1);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.inconclusive, 1);
    assert.equal(result.results[0].status, "inconclusive");
    assert.equal(result.results[0].judge.enabled, true);
    assert.equal(result.results[0].judge.nonCritical, true);
    assert.match(result.results[0].judge.rationale, /non-critical/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("judge rationale is returned and critical when combined with deterministic assertions", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("judge-critical", {
  input: "test input",
  expected: {
    mustInclude: ["hello"],
    judge: { rule: "response should mention refunds", threshold: 0.9 }
  }
});`,
      "utf8",
    );

    const result = await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: "hello world",
      }),
    });

    assert.equal(result.summary.total, 1);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.results[0].status, "failed");
    assert.equal(result.results[0].judge.enabled, true);
    assert.equal(result.results[0].judge.nonCritical, false);
    assert.match(result.results[0].judge.rationale, /critical/);
    assert.match(result.results[0].failures[0], /Judge assertion failed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runner fails with actionable output on incorrect tool behavior", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("tool-contract", {
  input: "run tool flow",
  expected: {
    toolCalls: {
      mustCall: ["lookupUser"],
      mustNotCall: ["deleteAccount"]
    }
  }
});`,
      "utf8",
    );

    const result = await runAgentTests({
      cwd,
      executor: async () => ({
        status: "passed",
        responseText: "ok",
        toolCalls: [{ name: "deleteAccount", arguments: { id: "u1" } }],
      }),
    });

    assert.equal(result.summary.failed, 1);
    assert.equal(result.results[0].status, "failed");
    assert.equal(result.results[0].toolCalls.length, 1);
    assert.match(result.results[0].failures[0], /mustCall/);
    assert.match(result.results[0].failures[1], /mustNotCall/);
    assert.match(result.results[0].failures[0], /lookupUser/);
    assert.match(result.results[0].failures[1], /deleteAccount/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
