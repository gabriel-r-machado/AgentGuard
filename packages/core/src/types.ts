export type AgentProvider = "openai" | "deepseek" | "gemini" | "anthropic";
export type SnapshotMode = "contract" | "text";
export type PresetName =
  | "customer-support"
  | "lead-scheduling"
  | "healthcare-lead-scheduling";
export type HttpMethod = "POST" | "PUT" | "PATCH";
export type LlmRoleName = "generator" | "judge";

export type FileSource = {
  type: "file";
  path: string;
};

export type GlobSource = {
  type: "glob";
  pattern: string;
};

export type SnapshotSource = {
  type: "snapshot";
  path: string;
};

export type SystemPromptSource = FileSource | SnapshotSource;
export type KnowledgeSource = FileSource | GlobSource | SnapshotSource;

export type ProjectConfig = {
  name: string;
  locale?: string;
  preset?: PresetName;
};

export type GenerationConfig = {
  scenarios?: number;
  maxTurns?: number;
  seed?: number;
};

export type LlmRoleConfig = {
  provider?: AgentProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
};

export type HttpAgentTargetConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  request?: {
    method?: HttpMethod;
    body?: unknown;
    timeoutMs?: number;
    retries?: number;
  };
  response?: {
    textPath: string;
    toolCallsPath?: string;
    retrievedContextPath?: string;
    metadataPath?: string;
    inputTokensPath?: string;
    outputTokensPath?: string;
  };
};

export type DirectProviderTargetConfig = {
  type: "provider";
  provider?: AgentProvider;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
};

export type ScanConfig = {
  dryRunTools?: boolean;
  llmProvider?: AgentProvider;
  llmModel?: string;
  target?: HttpAgentTargetConfig | DirectProviderTargetConfig;
  concurrency?: number;
  repetitions?: {
    default?: number;
    high?: number;
    critical?: number;
  };
  reportHtml?: boolean;
};

export type AgentGuardConfig = {
  provider?: AgentProvider;
  model?: string;
  llm?: {
    generator?: LlmRoleConfig;
    judge?: LlmRoleConfig;
  };
  testsDir?: string;
  maxCostPerRun?: number;
  timeoutMs?: number;
  retries?: number;
  temperature?: number;
  ci?: {
    failOnInconclusive?: boolean;
  };
  redaction?: {
    enabled?: boolean;
    patterns?: string[];
  };
  project?: ProjectConfig;
  sources?: {
    systemPrompt?: SystemPromptSource;
    knowledge?: KnowledgeSource[];
  };
  generation?: GenerationConfig;
  scan?: ScanConfig;
};

export type ResolvedLlmRoleConfig = {
  provider?: AgentProvider;
  model?: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  retries: number;
};

export type ResolvedAgentGuardConfig = {
  provider?: AgentProvider;
  model?: string;
  llm: {
    generator: ResolvedLlmRoleConfig;
    judge: ResolvedLlmRoleConfig;
  };
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
  project: {
    name: string;
    locale: string;
    preset: PresetName;
  };
  sources: {
    systemPrompt?: SystemPromptSource;
    knowledge: KnowledgeSource[];
  };
  generation: {
    scenarios: number;
    maxTurns: number;
    seed: number;
  };
  scan: {
    dryRunTools: boolean;
    llmProvider?: AgentProvider;
    llmModel?: string;
    target?: HttpAgentTargetConfig | DirectProviderTargetConfig;
    concurrency: number;
    repetitions: {
      default: number;
      high: number;
      critical: number;
    };
    reportHtml: boolean;
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
