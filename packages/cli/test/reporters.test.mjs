import assert from "node:assert/strict";
import test from "node:test";

import { formatTerminalReport } from "../dist/reporters.js";

const baseResult = {
  config: {
    provider: "openai",
    model: "gpt-4.1-mini",
    testsDir: "./ai-tests",
    maxCostPerRun: 0.2,
    timeoutMs: 30000,
    retries: 1,
    temperature: 0.1,
    ci: { failOnInconclusive: true },
    redaction: { enabled: true },
  },
  discoveredFiles: ["a.ts"],
  tests: [],
  results: [
    {
      testId: "alpha",
      status: "passed",
      durationMs: 11,
      responseText: "ok",
      failures: undefined,
      costUsd: 0.01,
      error: undefined,
    },
    {
      testId: "beta",
      status: "failed",
      durationMs: 22,
      responseText: "bad",
      failures: ["missing required text"],
      costUsd: 0.02,
      error: undefined,
    },
  ],
  summary: {
    total: 2,
    passed: 1,
    failed: 1,
    inconclusive: 0,
    durationMs: 33,
    totalCostUsd: 0.03,
    results: [],
  },
};

test("pretty reporter output is structured and readable", () => {
  const output = formatTerminalReport(baseResult, "pretty");

  assert.equal(
    output,
    [
      "PASS alpha (latencyMs=11, estimatedCostUsd=0.010)",
      "FAIL beta (latencyMs=22, estimatedCostUsd=0.020)",
      "",
      "Failed:",
      "- [beta] missing required text",
      "",
      "Run summary:",
      "- tests: 2",
      "- passed: 1",
      "- failed: 1",
      "- inconclusive: 0",
      "- costUsd: 0.030",
      "- latencyMs: 33",
      "",
    ].join("\n"),
  );
});

test("ci reporter output is stable and concise", () => {
  const output = formatTerminalReport(baseResult, "ci");

  assert.equal(
    output,
    [
      "TEST|PASSED|alpha|latencyMs=11|estimatedCostUsd=0.010|failures=0",
      "TEST|FAILED|beta|latencyMs=22|estimatedCostUsd=0.020|failures=1",
      "FAILURE|beta|missing required text",
      "SUMMARY|tests=2|passed=1|failed=1|inconclusive=0|costUsd=0.030|latencyMs=33",
      "",
    ].join("\n"),
  );
});

test("reporters include judge rationale when judge is enabled", () => {
  const resultWithJudge = {
    ...baseResult,
    results: [
      {
        ...baseResult.results[0],
        testId: "judge-test",
        status: "inconclusive",
        judge: {
          enabled: true,
          passed: false,
          nonCritical: true,
          score: 0.3,
          threshold: 0.7,
          rationale: "judge=fail; policy=non-critical; rule=\"x\"; response=\"y\"",
        },
        failures: [
          "Judge assertion reported a non-critical mismatch: judge=fail; policy=non-critical; rule=\"x\"; response=\"y\"",
        ],
      },
    ],
    summary: {
      ...baseResult.summary,
      total: 1,
      passed: 0,
      failed: 0,
      inconclusive: 1,
      totalCostUsd: 0.01,
    },
  };

  const pretty = formatTerminalReport(resultWithJudge, "pretty");
  assert.match(pretty, /judge: fail \(non-critical/);
  assert.match(pretty, /policy=non-critical/);

  const ci = formatTerminalReport(resultWithJudge, "ci");
  assert.match(ci, /JUDGE\|judge-test\|passed=false\|nonCritical=true\|score=0.30\|threshold=0.70\|rationale=/);
});

test("json reporter output is stable and machine-readable", () => {
  const output = formatTerminalReport(baseResult, "json");
  const parsed = JSON.parse(output);

  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(parsed.summary, {
    total: 2,
    passed: 1,
    failed: 1,
    inconclusive: 0,
    durationMs: 33,
    totalCostUsd: 0.03,
  });
  assert.equal(parsed.tests.length, 2);
  assert.equal(parsed.tests[0].id, "alpha");
  assert.equal(parsed.tests[0].status, "passed");
  assert.equal(parsed.tests[1].id, "beta");
  assert.equal(parsed.tests[1].failureCount, 1);
  assert.deepEqual(parsed.tests[1].failures, ["missing required text"]);
});

test("pretty reporter labels inconclusive status explicitly", () => {
  const inconclusiveResult = {
    ...baseResult,
    results: [
      {
        testId: "gamma",
        status: "inconclusive",
        durationMs: 7,
        responseText: "timeout",
        failures: ["provider timeout"],
        costUsd: undefined,
        error: "provider timeout",
      },
    ],
    summary: {
      ...baseResult.summary,
      total: 1,
      passed: 0,
      failed: 0,
      inconclusive: 1,
      durationMs: 7,
      totalCostUsd: undefined,
    },
  };

  const output = formatTerminalReport(inconclusiveResult, "pretty");
  assert.match(output, /^INCONCLUSIVE gamma/m);
});
