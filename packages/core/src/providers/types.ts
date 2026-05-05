export type ToolDefinition = {
  name: string;
  description?: string;
  parameters?: unknown;
};

export type NormalizedProviderInput = {
  systemPrompt?: string;
  userInput: string;
  context?: string[];
  tools?: ToolDefinition[];
  model: string;
  temperature?: number;
  timeoutMs?: number;
};

export type NormalizedProviderOutput = {
  text: string;
  json?: unknown;
  toolCalls?: { name: string; arguments: unknown }[];
  usage?: { inputTokens: number; outputTokens: number };
  raw: unknown;
};

export interface ProviderAdapter {
  name: string;
  invoke(input: NormalizedProviderInput): Promise<NormalizedProviderOutput>;
}

export type ProviderErrorCode = "auth" | "timeout" | "network" | "provider";

export class AgentGuardProviderError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AgentGuardProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
