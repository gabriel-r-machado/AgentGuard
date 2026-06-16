import { z } from "zod";

import type { AgentProvider } from "../types.js";

export type ToolDefinition = {
  name: string;
  description?: string;
  parameters?: unknown;
};

export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cachedTokens?: number;
};

export type NormalizedProviderInput = {
  systemPrompt?: string;
  userInput: string;
  context?: string[];
  tools?: ToolDefinition[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
};

export type NormalizedProviderOutput = {
  text: string;
  json?: unknown;
  toolCalls?: { name: string; arguments: unknown }[];
  usage?: TokenUsage;
  finishReason?: string;
  requestId?: string;
  raw: unknown;
};

export type TextGenerationInput = {
  model: string;
  systemPrompt?: string;
  userInput?: string;
  context?: string[];
  messages?: ProviderMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
};

export type TextGenerationResult = NormalizedProviderOutput;

export type StructuredGenerationInput<T> = TextGenerationInput & {
  schemaName: string;
  schema: z.ZodType<T>;
  jsonSchema?: unknown;
  instructions?: string;
};

export type StructuredGenerationResult<T> = TextGenerationResult & {
  object: T;
};

export interface LlmProvider {
  name: string;
  provider: AgentProvider;
  generate(input: NormalizedProviderInput): Promise<NormalizedProviderOutput>;
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
  generateStructured<T>(
    input: StructuredGenerationInput<T>,
  ): Promise<StructuredGenerationResult<T>>;
}

export interface ProviderAdapter {
  name: string;
  provider: AgentProvider;
  invoke(input: NormalizedProviderInput): Promise<NormalizedProviderOutput>;
  invokeText(input: TextGenerationInput): Promise<TextGenerationResult>;
  invokeStructured<T>(
    input: StructuredGenerationInput<T>,
  ): Promise<StructuredGenerationResult<T>>;
}

export function createLlmProviderFromAdapter(adapter: ProviderAdapter): LlmProvider {
  return {
    name: adapter.name,
    provider: adapter.provider,
    generate(input: NormalizedProviderInput): Promise<NormalizedProviderOutput> {
      return adapter.invoke(input);
    },
    generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
      return adapter.invokeText(input);
    },
    generateStructured<T>(
      input: StructuredGenerationInput<T>,
    ): Promise<StructuredGenerationResult<T>> {
      return adapter.invokeStructured(input);
    },
  };
}

export type ProviderErrorCode =
  | "auth"
  | "timeout"
  | "network"
  | "provider"
  | "rate_limit"
  | "invalid_response"
  | "blocked"
  | "config"
  | "unavailable";

export class AgentGuardProviderError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;
  provider?: AgentProvider;
  statusCode?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      provider?: AgentProvider;
      statusCode?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "AgentGuardProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    if ("cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AuthenticationProviderError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("auth", message, options);
    this.name = "AuthenticationProviderError";
  }
}

export class RateLimitProviderError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("rate_limit", message, { retryable: true, ...options });
    this.name = "RateLimitProviderError";
  }
}

export class TimeoutProviderError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("timeout", message, { retryable: true, ...options });
    this.name = "TimeoutProviderError";
  }
}

export class InvalidStructuredOutputError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("invalid_response", message, options);
    this.name = "InvalidStructuredOutputError";
  }
}

export class ProviderUnavailableError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("unavailable", message, { retryable: true, ...options });
    this.name = "ProviderUnavailableError";
  }
}

export class ContentBlockedError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("blocked", message, options);
    this.name = "ContentBlockedError";
  }
}

export class ConfigurationProviderError extends AgentGuardProviderError {
  constructor(message: string, options: ConstructorParameters<typeof AgentGuardProviderError>[2] = {}) {
    super("config", message, options);
    this.name = "ConfigurationProviderError";
  }
}

export function isRecoverableProviderError(error: unknown): boolean {
  return error instanceof AgentGuardProviderError && error.retryable;
}

export function normalizeProviderInput(
  input: NormalizedProviderInput,
): TextGenerationInput {
  return {
    model: input.model,
    systemPrompt: input.systemPrompt,
    userInput: input.userInput,
    context: input.context,
    tools: input.tools,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    retries: input.retries,
  };
}

export function createStructuredOutput<T>(
  result: TextGenerationResult,
  parsed: unknown,
  schema: z.ZodType<T>,
  provider: AgentProvider,
): StructuredGenerationResult<T> {
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    throw new InvalidStructuredOutputError(
      `Provider "${provider}" returned structured output that did not match "${schema.description ?? "schema"}": ${issue?.message ?? "validation failed"}.`,
      { provider },
    );
  }
  return {
    ...result,
    object: validated.data,
  };
}
