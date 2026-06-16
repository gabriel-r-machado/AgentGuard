import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { stablePrettyJson } from "../contract/source-hash.js";

export const scanReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  runId: z.string().min(1),
  dryRun: z.boolean(),
  baselineComparison: z
    .object({
      previousOverallScore: z.number().min(0).max(1).optional(),
      currentOverallScore: z.number().min(0).max(1),
      improvedScenarioIds: z.array(z.string()),
      regressedScenarioIds: z.array(z.string()),
      newCriticalFailures: z.array(z.string()),
      resolvedCriticalFailures: z.array(z.string()),
    })
    .strict()
    .optional(),
  summary: z.object({
    totalScenarios: z.number().int().min(0),
    totalTurns: z.number().int().min(0),
    passedScenarios: z.number().int().min(0),
    failedScenarios: z.number().int().min(0),
    criticalFailures: z.number().int().min(0),
    overallScore: z.number().min(0).max(1),
    consistency: z.number().min(0).max(1),
    latencyMs: z.number().int().min(0),
    metrics: z.record(z.string(), z.number().min(0).max(1)),
  }).strict(),
  scenarios: z.array(z.object({
    scenarioId: z.string(),
    title: z.string(),
    category: z.string(),
    severity: z.string(),
    repetition: z.number().int().min(1),
    passed: z.boolean(),
    critical: z.boolean(),
    score: z.number().min(0).max(1),
    reasons: z.array(z.string()),
    evidence: z.array(z.string()),
    sourceRefs: z.array(z.unknown()),
    recommendations: z.array(z.string()),
    technicalErrors: z.array(z.string()),
    toolCalls: z.array(z.unknown()),
    turns: z.array(z.unknown()),
  }).strict()),
}).strict();

export type ScanReport = z.infer<typeof scanReportSchema>;

export function getReportJsonPath(cwd: string): string {
  return join(cwd, ".agentguard", "report.json");
}

export function getReportHtmlPath(cwd: string): string {
  return join(cwd, ".agentguard", "report.html");
}

export function getRunsDirectory(cwd: string): string {
  return join(cwd, ".agentguard", "runs");
}

export function getRunDirectory(cwd: string, runId: string): string {
  return join(getRunsDirectory(cwd), runId);
}

export function writeScanReport(cwd: string, runId: string, report: ScanReport): {
  reportJsonPath: string;
  reportHtmlPath: string;
  runReportJsonPath: string;
  runReportHtmlPath: string;
} {
  const runDir = getRunDirectory(cwd, runId);
  mkdirSync(runDir, { recursive: true });
  mkdirSync(join(cwd, ".agentguard"), { recursive: true });

  const html = renderStandaloneHtml(report);
  const reportJsonPath = getReportJsonPath(cwd);
  const reportHtmlPath = getReportHtmlPath(cwd);
  const runReportJsonPath = join(runDir, "report.json");
  const runReportHtmlPath = join(runDir, "report.html");

  writeFileSync(reportJsonPath, stablePrettyJson(report), "utf8");
  writeFileSync(runReportJsonPath, stablePrettyJson(report), "utf8");
  writeFileSync(reportHtmlPath, html, "utf8");
  writeFileSync(runReportHtmlPath, html, "utf8");

  return {
    reportJsonPath,
    reportHtmlPath,
    runReportJsonPath,
    runReportHtmlPath,
  };
}

export function readBaselineReport(cwd: string): ScanReport | undefined {
  const path = join(cwd, ".agentguard", "baseline.json");
  if (!existsSync(path)) {
    return undefined;
  }
  return scanReportSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeBaselineReport(cwd: string, report: ScanReport, overwrite = false): string {
  const path = join(cwd, ".agentguard", "baseline.json");
  if (!overwrite && existsSync(path)) {
    throw new Error(
      'Baseline already exists at ".agentguard/baseline.json". Re-run with "--regenerate" to overwrite it intentionally.',
    );
  }
  mkdirSync(join(cwd, ".agentguard"), { recursive: true });
  writeFileSync(path, stablePrettyJson(report), "utf8");
  return path;
}

function renderStandaloneHtml(report: ScanReport): string {
  const escapedJson = JSON.stringify(report).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AgentGuard Report</title>
    <style>
      :root { color-scheme: light; --bg: #f7f4ee; --panel: #fffdfa; --ink: #1f252d; --muted: #5d6775; --ok: #1f7a4c; --fail: #b42318; --warn: #b06f00; --border: #d9d3c7; }
      body { margin: 0; font-family: Georgia, "Segoe UI", sans-serif; background: linear-gradient(180deg, #f7f4ee, #efe9dc); color: var(--ink); }
      main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .card { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 18px; box-shadow: 0 8px 28px rgba(48, 53, 61, 0.08); }
      h1, h2 { margin: 0 0 12px; }
      h1 { font-size: 2rem; }
      h2 { font-size: 1.1rem; }
      .score { font-size: 2.4rem; font-weight: 700; }
      .scenario { margin-top: 18px; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 0.82rem; margin-right: 8px; }
      .ok { background: #d8f3e3; color: var(--ok); }
      .fail { background: #fde1dc; color: var(--fail); }
      .warn { background: #fff0c2; color: var(--warn); }
      pre { white-space: pre-wrap; word-break: break-word; font-size: 0.9rem; }
      ul { padding-left: 18px; }
    </style>
  </head>
  <body>
    <main id="app"></main>
    <script>
      const report = ${escapedJson};
      const app = document.getElementById("app");
      const metricCards = Object.entries(report.summary.metrics).map(([name, value]) => (
        '<div class="card"><h2>' + name + '</h2><div class="score">' + (value * 100).toFixed(0) + '%</div></div>'
      )).join("");
      const scenarios = report.scenarios.map((scenario) => {
        const tone = scenario.passed ? "ok" : (scenario.critical ? "fail" : "warn");
        return '<section class="card scenario">' +
          '<div><span class="pill ' + tone + '">' + (scenario.passed ? "PASS" : (scenario.critical ? "CRITICAL" : "FAIL")) + '</span>' +
          '<span class="pill warn">' + scenario.category + '</span></div>' +
          '<h2>' + scenario.title + ' (rep ' + scenario.repetition + ')</h2>' +
          '<p><strong>Score:</strong> ' + (scenario.score * 100).toFixed(0) + '%</p>' +
          '<p><strong>Reasons:</strong></p><ul>' + scenario.reasons.map((reason) => '<li>' + reason + '</li>').join("") + '</ul>' +
          '<p><strong>Evidence:</strong></p><ul>' + scenario.evidence.map((reason) => '<li>' + reason + '</li>').join("") + '</ul>' +
          '<p><strong>Recommendations:</strong></p><ul>' + scenario.recommendations.map((reason) => '<li>' + reason + '</li>').join("") + '</ul>' +
          '<details><summary>Turns and tool calls</summary><pre>' + JSON.stringify({ turns: scenario.turns, toolCalls: scenario.toolCalls, technicalErrors: scenario.technicalErrors, sourceRefs: scenario.sourceRefs }, null, 2) + '</pre></details>' +
          '</section>';
      }).join("");
      app.innerHTML = '<h1>AgentGuard Scan Report</h1>' +
        '<div class="grid">' +
        '<div class="card"><h2>Overall Score</h2><div class="score">' + (report.summary.overallScore * 100).toFixed(0) + '%</div></div>' +
        '<div class="card"><h2>Scenarios</h2><div class="score">' + report.summary.totalScenarios + '</div></div>' +
        '<div class="card"><h2>Turns</h2><div class="score">' + report.summary.totalTurns + '</div></div>' +
        '<div class="card"><h2>Critical Failures</h2><div class="score">' + report.summary.criticalFailures + '</div></div>' +
        '</div>' +
        '<h2 style="margin-top:28px">Metrics</h2><div class="grid">' + metricCards + '</div>' +
        '<h2 style="margin-top:28px">Scenario Results</h2>' + scenarios;
    </script>
  </body>
</html>`;
}
