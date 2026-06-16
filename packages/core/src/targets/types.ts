import type { NormalizedProviderOutput } from "../providers/types.js";

export type ObservedToolCall = {
  name: string;
  arguments: unknown;
  raw?: unknown;
};

export type RetrievedContextEntry = {
  text: string;
  sourcePath?: string;
  score?: number;
  raw?: unknown;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentTargetTurnInput = {
  scenarioId: string;
  scenarioTitle: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  repetition: number;
  turnIndex: number;
  sessionId: string;
  dryRun: boolean;
  userMessage: string;
  history: ConversationMessage[];
  systemPrompt?: string;
  metadata: Record<string, unknown>;
  timeoutMs: number;
  retries: number;
};

export type AgentTargetTurnOutput = {
  text: string;
  latencyMs: number;
  retryCount: number;
  inputTokens?: number;
  outputTokens?: number;
  httpStatus?: number;
  toolCalls: ObservedToolCall[];
  retrievedContext: RetrievedContextEntry[];
  metadata?: Record<string, unknown>;
  error?: string;
  timedOut?: boolean;
  raw: unknown;
};

export interface AgentTarget {
  name: string;
  executeTurn(input: AgentTargetTurnInput): Promise<AgentTargetTurnOutput>;
}

export type ProviderBackedTargetOutput = NormalizedProviderOutput;
