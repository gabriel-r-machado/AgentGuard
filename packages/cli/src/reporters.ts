import type { RunAgentTestsResult, TestResult } from "@agentguard/core";

export type TerminalReporter = "pretty" | "ci" | "json";

export function formatTerminalReport(
  result: RunAgentTestsResult,
  reporter: TerminalReporter,
): string {
  if (reporter === "json") {
    return formatJsonReport(result);
  }
  if (reporter === "ci") {
    return formatCiReport(result);
  }
  return formatPrettyReport(result);
}

function formatPrettyReport(result: RunAgentTestsResult): string {
  const lines: string[] = [];

  for (const testResult of result.results) {
    const statusLabel = formatStatusLabel(testResult.status);
    lines.push(
      `${statusLabel} ${testResult.testId} (latencyMs=${testResult.durationMs}, estimatedCostUsd=${formatCost(
        testResult.costUsd,
      )})`,
    );
    if (testResult.judge) {
      const judgeStatus = testResult.judge.passed ? "pass" : "fail";
      const judgeScope = testResult.judge.nonCritical ? "non-critical" : "critical";
      lines.push(
        `  judge: ${judgeStatus} (${judgeScope}, score=${testResult.judge.score.toFixed(
          2,
        )}, threshold=${testResult.judge.threshold.toFixed(2)}) - ${testResult.judge.rationale}`,
      );
    }
  }

  const failedDetails = collectFailureDetails(result.results);
  if (failedDetails.length > 0) {
    lines.push("");
    lines.push("Failed:");
    for (const detail of failedDetails) {
      lines.push(`- [${detail.testId}] ${detail.message}`);
    }
  }

  lines.push("");
  lines.push("Run summary:");
  lines.push(`- tests: ${result.summary.total}`);
  lines.push(`- passed: ${result.summary.passed}`);
  lines.push(`- failed: ${result.summary.failed}`);
  lines.push(`- inconclusive: ${result.summary.inconclusive}`);
  lines.push(`- costUsd: ${formatCost(result.summary.totalCostUsd)}`);
  lines.push(`- latencyMs: ${result.summary.durationMs}`);

  return `${lines.join("\n")}\n`;
}

function formatCiReport(result: RunAgentTestsResult): string {
  const lines: string[] = [];

  for (const testResult of result.results) {
    const statusLabel = testResult.status.toUpperCase();
    const failureCount = testResult.failures?.length ?? 0;
    lines.push(
      `TEST|${statusLabel}|${testResult.testId}|latencyMs=${testResult.durationMs}|estimatedCostUsd=${formatCost(
        testResult.costUsd,
      )}|failures=${failureCount}`,
    );

    if (testResult.judge) {
      lines.push(
        `JUDGE|${testResult.testId}|passed=${String(testResult.judge.passed)}|nonCritical=${String(
          testResult.judge.nonCritical,
        )}|score=${testResult.judge.score.toFixed(2)}|threshold=${testResult.judge.threshold.toFixed(
          2,
        )}|rationale=${sanitizeForCi(testResult.judge.rationale)}`,
      );
    }

    for (const failure of testResult.failures ?? []) {
      lines.push(`FAILURE|${testResult.testId}|${sanitizeForCi(failure)}`);
    }
  }

  lines.push(
    `SUMMARY|tests=${result.summary.total}|passed=${result.summary.passed}|failed=${result.summary.failed}|inconclusive=${result.summary.inconclusive}|costUsd=${formatCost(
      result.summary.totalCostUsd,
    )}|latencyMs=${result.summary.durationMs}`,
  );

  return `${lines.join("\n")}\n`;
}

function formatJsonReport(result: RunAgentTestsResult): string {
  const payload = {
    schemaVersion: 1,
    summary: {
      total: result.summary.total,
      passed: result.summary.passed,
      failed: result.summary.failed,
      inconclusive: result.summary.inconclusive,
      durationMs: result.summary.durationMs,
      totalCostUsd: result.summary.totalCostUsd,
    },
    tests: result.results.map((testResult) => ({
      id: testResult.testId,
      status: testResult.status,
      durationMs: testResult.durationMs,
      costUsd: testResult.costUsd,
      failureCount: testResult.failures?.length ?? 0,
      failures: testResult.failures ?? [],
      error: testResult.error,
      judge: testResult.judge,
    })),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function collectFailureDetails(results: TestResult[]): Array<{ testId: string; message: string }> {
  const details: Array<{ testId: string; message: string }> = [];
  for (const result of results) {
    for (const failure of result.failures ?? []) {
      details.push({ testId: result.testId, message: failure });
    }
  }
  return details;
}

function formatCost(cost: number | undefined): string {
  if (typeof cost !== "number") {
    return "n/a";
  }
  return cost.toFixed(3);
}

function sanitizeForCi(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function formatStatusLabel(status: TestResult["status"]): string {
  if (status === "passed") {
    return "PASS";
  }
  if (status === "inconclusive") {
    return "INCONCLUSIVE";
  }
  return "FAIL";
}
