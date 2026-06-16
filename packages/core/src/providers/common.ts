import {
  AgentGuardProviderError,
  AuthenticationProviderError,
  ContentBlockedError,
  ProviderUnavailableError,
  RateLimitProviderError,
  TimeoutProviderError,
  type ProviderMessage,
  type StructuredGenerationInput,
  type TextGenerationInput,
  type TextGenerationResult,
  type TokenUsage,
} from "./types.js";

import type { AgentProvider } from "../types.js";

export function buildProviderMessages(input: TextGenerationInput): ProviderMessage[] {
  if (input.messages && input.messages.length > 0) {
    return input.messages;
  }

  const messages: ProviderMessage[] = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  for (const contextEntry of input.context ?? []) {
    messages.push({ role: "system", content: `Context: ${contextEntry}` });
  }
  if (input.userInput) {
    messages.push({ role: "user", content: input.userInput });
  }
  return messages;
}

export function readTextContent(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((entry) => entry.type === "text" || entry.text)
    .map((entry) => entry.text ?? "")
    .join("\n")
    .trim();
}

export function normalizeToolCall(
  name: string | undefined,
  argumentsJson: string | undefined,
): { name: string; arguments: unknown } | undefined {
  if (!name) {
    return undefined;
  }
  if (!argumentsJson) {
    return { name, arguments: {} };
  }
  try {
    return { name, arguments: JSON.parse(argumentsJson) };
  } catch {
    return { name, arguments: argumentsJson };
  }
}

export function parseJsonIfPossible(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function normalizeUsage(input?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}): TokenUsage | undefined {
  if (!input) {
    return undefined;
  }
  const usage: TokenUsage = {
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
  };
  if (input.totalTokens !== undefined) {
    usage.totalTokens = input.totalTokens;
  }
  if (input.cachedTokens !== undefined) {
    usage.cachedTokens = input.cachedTokens;
  }
  return usage;
}

export async function withRetry<T>(input: {
  provider: AgentProvider;
  retries?: number;
  operation: () => Promise<T>;
}): Promise<T> {
  const maxRetries = input.retries ?? 0;
  let attempt = 0;

  while (true) {
    try {
      return await input.operation();
    } catch (error) {
      if (!(error instanceof AgentGuardProviderError) || !error.retryable || attempt >= maxRetries) {
        throw error;
      }
      attempt += 1;
      await sleep(calculateBackoffDelay(attempt));
    }
  }
}

export function calculateBackoffDelay(attempt: number): number {
  const capped = Math.min(attempt, 5);
  const baseDelay = 250 * 2 ** (capped - 1);
  const jitter = Math.floor(Math.random() * 100);
  return baseDelay + jitter;
}

export async function runWithTimeout<T>(input: {
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
  onTimeoutMessage: string;
  provider: AgentProvider;
}): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(
        new TimeoutProviderError(input.onTimeoutMessage, {
          provider: input.provider,
        }),
      );
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([input.operation(controller.signal), timeoutPromise]);
  } catch (error) {
    if (isAbortError(error)) {
      throw new TimeoutProviderError(input.onTimeoutMessage, {
        provider: input.provider,
      });
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function normalizeHttpFailure(input: {
  provider: AgentProvider;
  status: number;
  message: string;
}): AgentGuardProviderError {
  if (input.status === 401 || input.status === 403) {
    return new AuthenticationProviderError(input.message, {
      provider: input.provider,
      statusCode: input.status,
    });
  }
  if (input.status === 408 || input.status === 504) {
    return new TimeoutProviderError(input.message, {
      provider: input.provider,
      statusCode: input.status,
    });
  }
  if (input.status === 429) {
    return new RateLimitProviderError(input.message, {
      provider: input.provider,
      statusCode: input.status,
    });
  }
  if (input.status >= 500) {
    return new ProviderUnavailableError(input.message, {
      provider: input.provider,
      statusCode: input.status,
    });
  }
  return new AgentGuardProviderError("provider", input.message, {
    provider: input.provider,
    statusCode: input.status,
  });
}

export function buildStructuredPromptSuffix<T>(
  input: StructuredGenerationInput<T>,
): string {
  const instructions = [
    input.instructions,
    `Return only JSON that matches the "${input.schemaName}" schema.`,
  ].filter(Boolean);
  return instructions.join("\n");
}

export function createTextResult(input: {
  text: string;
  raw: unknown;
  usage?: TokenUsage;
  toolCalls?: Array<{ name: string; arguments: unknown }>;
  finishReason?: string;
  requestId?: string;
}): TextGenerationResult {
  return {
    text: input.text,
    json: parseJsonIfPossible(input.text),
    toolCalls: input.toolCalls && input.toolCalls.length > 0 ? input.toolCalls : undefined,
    usage: input.usage,
    finishReason: input.finishReason,
    requestId: input.requestId,
    raw: input.raw,
  };
}

export function maybeThrowBlockedError(input: {
  provider: AgentProvider;
  blocked: boolean;
  message: string;
}): void {
  if (input.blocked) {
    throw new ContentBlockedError(input.message, { provider: input.provider });
  }
}

export function redactSecrets(value: string, secrets: string[]): string {
  let output = value;
  for (const secret of secrets.filter(Boolean)) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
