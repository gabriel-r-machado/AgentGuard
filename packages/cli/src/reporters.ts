import type {
  DoctorResult,
  RunAgentTestsResult,
  ScanRunResult,
  TestResult,
} from "@agentguard/core";

export type TerminalReporter = "pretty" | "ci" | "json";
export type DiagnosticReporter = "pretty" | "ci";

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

export function formatScanReport(
  result: ScanRunResult,
  reporter: DiagnosticReporter = "pretty",
): string {
  if (reporter === "ci") {
    return formatScanCiReport(result);
  }
  return formatScanPrettyReport(result);
}

export function formatDoctorReport(
  result: DoctorResult,
  reporter: DiagnosticReporter = "pretty",
): string {
  if (reporter === "ci") {
    return formatDoctorCiReport(result);
  }

  const lines = [`Doctor status: ${result.status.toUpperCase()}`];
  for (const check of result.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
  }
  return `${lines.join("\n")}\n`;
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

function formatScanPrettyReport(result: ScanRunResult): string {
  const lines = [
    "Scan summary:",
    `- mode: ${result.dryRun ? "dry-run" : "live"}`,
    `- contract: ${result.contractStatus} (${result.artifactPaths.contract})`,
    `- suite: ${result.suiteStatus} (${result.artifactPaths.suite})`,
    `- manifest: ${result.artifactPaths.manifest}`,
    `- sourceHash: ${result.sources.sourceHash}`,
    `- facts: ${result.contract?.facts.length ?? 0}`,
    `- scenarios: ${result.suite?.scenarios.length ?? 0}`,
  ];

  if (result.report) {
    lines.push(`- result: ${result.report.summary.failedScenarios > 0 ? "fail" : "pass"}`);
    lines.push(`- executedScenarios: ${result.report.summary.totalScenarios}`);
    lines.push(`- passedScenarios: ${result.report.summary.passedScenarios}`);
    lines.push(`- failedScenarios: ${result.report.summary.failedScenarios}`);
    lines.push(`- criticalFailures: ${result.report.summary.criticalFailures}`);
    lines.push(`- overallScore: ${(result.report.summary.overallScore * 100).toFixed(1)}%`);
    lines.push(`- consistency: ${(result.report.summary.consistency * 100).toFixed(1)}%`);
    lines.push(`- reportJson: ${result.artifactPaths.reportJson ?? "n/a"}`);
    if (result.artifactPaths.reportHtml) {
      lines.push(`- reportHtml: ${result.artifactPaths.reportHtml}`);
    }
    if (result.artifactPaths.baseline) {
      lines.push(`- baseline: ${result.artifactPaths.baseline}`);
    }
    if (result.report.baselineComparison) {
      lines.push(
        `- baselineDelta: ${formatSignedPercent(
          result.report.baselineComparison.currentOverallScore -
            (result.report.baselineComparison.previousOverallScore ?? 0),
        )}`,
      );
    }
  } else {
    lines.push(
      `- execution: ${(result.scenarioResults?.length ?? 0) > 0 ? "completed" : "skipped"}`,
    );
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatScanCiReport(result: ScanRunResult): string {
  const status = getScanStatus(result);
  const summary = result.report?.summary;
  const lines = [
    [
      "SCAN",
      `status=${status}`,
      `dryRun=${String(result.dryRun)}`,
      `contract=${result.contractStatus}`,
      `suite=${result.suiteStatus}`,
      `scenarios=${summary?.totalScenarios ?? result.suite?.scenarios.length ?? 0}`,
      `failed=${summary?.failedScenarios ?? 0}`,
      `critical=${summary?.criticalFailures ?? 0}`,
      `score=${summary ? summary.overallScore.toFixed(3) : "n/a"}`,
    ].join("|"),
  ];

  if (result.artifactPaths.reportJson) {
    lines.push(`PATH|reportJson=${result.artifactPaths.reportJson}`);
  }
  if (result.artifactPaths.reportHtml) {
    lines.push(`PATH|reportHtml=${result.artifactPaths.reportHtml}`);
  }
  if (result.artifactPaths.baseline) {
    lines.push(`PATH|baseline=${result.artifactPaths.baseline}`);
  }
  for (const warning of result.warnings) {
    lines.push(`WARNING|${sanitizeForCi(warning)}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatDoctorCiReport(result: DoctorResult): string {
  const lines = [`DOCTOR|status=${result.status}`];
  for (const check of result.checks) {
    lines.push(
      `CHECK|${check.status.toUpperCase()}|${check.id}|${sanitizeForCi(check.message)}`,
    );
  }
  return `${lines.join("\n")}\n`;
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

function getScanStatus(result: ScanRunResult): "PASS" | "FAIL" | "STALE" {
  if (result.requiresRegenerate) {
    return "STALE";
  }
  if ((result.report?.summary.failedScenarios ?? 0) > 0) {
    return "FAIL";
  }
  return "PASS";
}

function formatSignedPercent(value: number): string {
  const percent = (value * 100).toFixed(1);
  return value > 0 ? `+${percent}%` : `${percent}%`;
}
