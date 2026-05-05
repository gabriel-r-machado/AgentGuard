import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RunSummary, TestResult } from "./types.js";

export type RunArtifactFailure = {
  testId: string;
  status: TestResult["status"];
  failures: string[];
  error?: string;
};

export type RunArtifact = {
  schemaVersion: 1;
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    inconclusive: number;
    durationMs: number;
    totalCostUsd?: number;
  };
  failures: RunArtifactFailure[];
};

export function persistRunArtifact(options: {
  cwd: string;
  summary: RunSummary;
  timestamp?: Date;
}): { filePath: string; artifact: RunArtifact } {
  const timestampDate = options.timestamp ?? new Date();
  const timestamp = timestampDate.toISOString();
  const artifact: RunArtifact = {
    schemaVersion: 1,
    timestamp,
    summary: {
      total: options.summary.total,
      passed: options.summary.passed,
      failed: options.summary.failed,
      inconclusive: options.summary.inconclusive,
      durationMs: options.summary.durationMs,
      totalCostUsd: options.summary.totalCostUsd,
    },
    failures: collectFailures(options.summary.results),
  };

  const resultsDir = join(options.cwd, ".agentguard", "results");
  mkdirSync(resultsDir, { recursive: true });

  const fileName = `${formatTimestampForFileName(timestamp)}.json`;
  const filePath = join(resultsDir, fileName);
  writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return { filePath, artifact };
}

function collectFailures(results: TestResult[]): RunArtifactFailure[] {
  const failures: RunArtifactFailure[] = [];
  for (const result of results) {
    if (result.status === "passed") {
      continue;
    }
    failures.push({
      testId: result.testId,
      status: result.status,
      failures: result.failures ?? [],
      error: result.error,
    });
  }
  return failures;
}

function formatTimestampForFileName(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}
