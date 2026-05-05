import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-cli-test-"));
}

function runCli(cwd, args) {
  const cliEntry = join(process.cwd(), "dist/index.js");
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeProjectFixture(cwd, options = {}) {
  const testsDir = join(cwd, "ai-tests");
  mkdirSync(testsDir, { recursive: true });

  const provider = options.provider ?? "openai";
  const model = options.model ?? "gpt-4.1-mini";
  writeFileSync(
    join(cwd, "agentguard.config.ts"),
    `export default {
  provider: "${provider}",
  model: "${model}",
  testsDir: "./ai-tests"
};`,
    "utf8",
  );

  const coreEntry = pathToFileURL(join(process.cwd(), "..", "core", "dist", "index.js")).href;
  writeFileSync(
    join(testsDir, "suite.test.ts"),
    `import { testAgent } from "${coreEntry}";
testAgent("alpha pass", {
  input: "a",
  expected: { mustInclude: ["stubbed response"] }
});
testAgent("beta fail", {
  input: "b",
  expected: { mustInclude: ["value-that-will-not-appear"] }
});`,
    "utf8",
  );
}

test("test command returns exit code 1 when assertions fail", () => {
  const cwd = createTempDir();
  try {
    writeProjectFixture(cwd);
    const result = runCli(cwd, ["test"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL beta fail/);
    assert.match(result.stdout, /Failed:/);
    assert.match(result.stdout, /\[beta fail\]/);
    assert.match(result.stdout, /Run summary:/);
    assert.match(result.stdout, /- tests: 2/);
    assert.match(result.stdout, /- passed: 1/);
    assert.match(result.stdout, /- failed: 1/);
    assert.match(result.stdout, /- inconclusive: 0/);
    assert.match(result.stdout, /- costUsd: 0\.000/);
    assert.match(result.stdout, /- latencyMs: \d+/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("test command returns exit code 2 on config/runtime errors", () => {
  const cwd = createTempDir();
  try {
    const result = runCli(cwd, ["test"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /agentguard test failed:/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("test command supports --grep, --ci, --provider and --model flags", () => {
  const cwd = createTempDir();
  try {
    writeProjectFixture(cwd, { provider: "deepseek", model: "deepseek-chat" });
    const result = runCli(cwd, [
      "test",
      "--provider",
      "openai",
      "--model",
      "gpt-4.1-mini",
      "--grep",
      "alpha",
      "--ci",
    ]);

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /TEST\|PASSED\|alpha pass\|latencyMs=\d+\|estimatedCostUsd=0\.000\|failures=0/,
    );
    assert.doesNotMatch(result.stdout, /beta fail/);
    assert.match(
      result.stdout,
      /SUMMARY\|tests=1\|passed=1\|failed=0\|inconclusive=0\|costUsd=0\.000\|latencyMs=\d+/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("test command supports --reporter json for machine-readable CI output", () => {
  const cwd = createTempDir();
  try {
    writeProjectFixture(cwd);
    const result = runCli(cwd, ["test", "--grep", "alpha", "--reporter", "json"]);

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.summary.total, 1);
    assert.equal(parsed.summary.passed, 1);
    assert.equal(parsed.summary.failed, 0);
    assert.equal(parsed.tests.length, 1);
    assert.equal(parsed.tests[0].id, "alpha pass");
    assert.equal(parsed.tests[0].status, "passed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("test command supports --execution provider and fails clearly without api key", () => {
  const cwd = createTempDir();
  try {
    writeProjectFixture(cwd, { provider: "deepseek", model: "deepseek-chat" });
    const result = runCli(cwd, ["test", "--grep", "alpha", "--execution", "provider"]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Missing DEEPSEEK_API_KEY/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
