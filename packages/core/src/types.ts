export type AgentProvider = "openai" | "deepseek";
export type SnapshotMode = "contract" | "text";

export type AgentGuardConfig = {
  provider: AgentProvider;
  model: string;
  testsDir: string;
  maxCostPerRun?: number;
  timeoutMs?: number;
  retries?: number;
  temperature?: number;
  ci?: {
    failOnInconclusive?: boolean;
  };
  redaction?: {
    enabled: boolean;
    patterns?: string[];
  };
};

export type ResolvedAgentGuardConfig = {
  provider: AgentProvider;
  model: string;
  testsDir: string;
  maxCostPerRun: number;
  timeoutMs: number;
  retries: number;
  temperature: number;
  ci: {
    failOnInconclusive: boolean;
  };
  redaction: {
    enabled: boolean;
    patterns?: string[];
  };
};

export type AgentTestSpec = {
  input: string;
  context?: string | string[];
  expected: {
    mustInclude?: string[];
    mustNotInclude?: string[];
    zodSchema?: unknown;
    judge?: {
      rule: string;
      model?: string;
      threshold?: number;
    };
    toolCalls?: {
      mustCall?: string[];
      mustNotCall?: string[];
    };
    snapshot?: {
      enabled?: boolean;
      mode?: SnapshotMode;
      id?: string;
    };
  };
};

export type TestStatus = "passed" | "failed" | "inconclusive";

export type TestResult = {
  testId: string;
  status: TestStatus;
  durationMs: number;
  responseText?: string;
  failures?: string[];
  costUsd?: number;
  error?: string;
  toolCalls?: { name: string; arguments: unknown }[];
  judge?: {
    enabled: boolean;
    passed: boolean;
    nonCritical: boolean;
    score: number;
    threshold: number;
    rationale: string;
  };
};

export type RunSummary = {
  total: number;
  passed: number;
  failed: number;
  inconclusive: number;
  durationMs: number;
  totalCostUsd?: number;
  results: TestResult[];
};
