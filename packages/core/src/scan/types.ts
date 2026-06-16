import type { AgentContract } from "../contract/schema.js";
import type { LoadedSources } from "../knowledge/loader.js";
import type { TestSuite } from "../suite/schema.js";
import type { ResolvedAgentGuardConfig } from "../types.js";
import type { Manifest } from "../artifacts/manifest-store.js";
import type { ScanReport } from "../artifacts/report-store.js";
import type { AgentTargetTurnOutput, ConversationMessage, ObservedToolCall, RetrievedContextEntry } from "../targets/types.js";

export type ArtifactGenerationStatus = "created" | "reused" | "regenerated" | "stale";

export type ScenarioTurnRun = {
  turnIndex: number;
  request: string;
  response: string;
  latencyMs: number;
  retryCount: number;
  inputTokens?: number;
  outputTokens?: number;
  httpStatus?: number;
  error?: string;
  timedOut: boolean;
  toolCalls: ObservedToolCall[];
  retrievedContext: RetrievedContextEntry[];
  metadata?: Record<string, unknown>;
  raw?: unknown;
};

export type ScenarioExecutionResult = {
  scenarioId: string;
  title: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  repetition: number;
  sessionId: string;
  conversation: ConversationMessage[];
  turns: ScenarioTurnRun[];
  passed: boolean;
  critical: boolean;
  score: number;
  metrics: Record<string, number>;
  reasons: string[];
  evidence: string[];
  sourceRefs: import("../contract/schema.js").SourceRef[];
  toolCalls: ObservedToolCall[];
  recommendations: string[];
  technicalErrors: string[];
};

export type ScanRunResult = {
  dryRun: boolean;
  runId: string;
  config: ResolvedAgentGuardConfig;
  sources: LoadedSources;
  contract?: AgentContract;
  suite?: TestSuite;
  manifest?: Manifest;
  contractStatus: ArtifactGenerationStatus;
  suiteStatus: ArtifactGenerationStatus;
  warnings: string[];
  artifactPaths: {
    contract: string;
    suite: string;
    manifest: string;
    reportJson?: string;
    reportHtml?: string;
    runReportJson?: string;
    runReportHtml?: string;
    baseline?: string;
  };
  requiresRegenerate: boolean;
  scenarioResults: ScenarioExecutionResult[];
  report?: ScanReport;
};

export type DoctorCheckStatus = "ok" | "warn" | "error";

export type DoctorCheck = {
  id: string;
  status: DoctorCheckStatus;
  message: string;
};

export type DoctorResult = {
  status: DoctorCheckStatus;
  checks: DoctorCheck[];
};
