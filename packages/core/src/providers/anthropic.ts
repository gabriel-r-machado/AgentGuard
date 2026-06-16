import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  AgentGuardProviderError,
  ConfigurationProviderError,
  ContentBlockedError,
  createStructuredOutput,
  normalizeProviderInput,
  type ProviderAdapter,
  type StructuredGenerationInput,
  type StructuredGenerationResult,
  type TextGenerationInput,
  type TextGenerationResult,
} from "./types.js";
import {
  createTextResult,
  normalizeHttpFailure,
  redactSecrets,
  runWithTimeout,
  withRetry,
} from "./common.js";

type AnthropicAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  clientFactory?: (options: {
    apiKey: string;
    baseURL?: string;
    timeout?: number;
    maxRetries: number;
  }) => Pick<Anthropic, "messages">;
};

export function createAnthropicProviderAdapter(
  options: AnthropicAdapterOptions = {},
): ProviderAdapter {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const baseURL = options.baseUrl;
  const clientFactory = options.clientFactory;

  return {
    name: "anthropic",
    provider: "anthropic",
    invoke(input) {
      return this.invokeText(normalizeProviderInput(input));
    },
    invokeText(input: TextGenerationInput): Promise<TextGenerationResult> {
      if (!apiKey) {
        throw new ConfigurationProviderError(
          "Missing ANTHROPIC_API_KEY. Set ANTHROPIC_API_KEY to use the Anthropic provider.",
          { provider: "anthropic" },
        );
      }

      return withRetry({
        provider: "anthropic",
        retries: input.retries,
        operation: async () =>
          runWithTimeout({
            provider: "anthropic",
            timeoutMs: input.timeoutMs ?? 30_000,
            onTimeoutMessage: `Anthropic request timed out after ${input.timeoutMs ?? 30_000}ms.`,
            operation: async () => {
              const client = createAnthropicClient(apiKey, baseURL, input.timeoutMs, clientFactory);
              try {
                const message = await client.messages.create({
                  model: input.model,
                  max_tokens: input.maxTokens ?? 1024,
                  ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
                  ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
                  messages: renderAnthropicMessages(input),
                });

                if (message.stop_reason === "refusal") {
                  throw new ContentBlockedError(
                    message.stop_details?.explanation ?? "Anthropic refused the request.",
                    { provider: "anthropic" },
                  );
                }

                return createTextResult({
                  text: extractAnthropicText(message.content),
                  raw: message,
                  toolCalls: message.content
                    .filter((entry) => entry.type === "tool_use")
                    .map((entry) => ({
                      name: entry.name,
                      arguments: entry.input,
                    })),
                  usage: {
                    inputTokens:
                      message.usage.input_tokens +
                      (message.usage.cache_creation_input_tokens ?? 0) +
                      (message.usage.cache_read_input_tokens ?? 0),
                    outputTokens: message.usage.output_tokens,
                    cachedTokens:
                      (message.usage.cache_creation_input_tokens ?? 0) +
                      (message.usage.cache_read_input_tokens ?? 0),
                  },
                  finishReason: message.stop_reason ?? undefined,
                  requestId: message.id,
                });
              } catch (error) {
                throw normalizeAnthropicError(error, apiKey);
              }
            },
          }),
      });
    },
    async invokeStructured<T>(
      input: StructuredGenerationInput<T>,
    ): Promise<StructuredGenerationResult<T>> {
      if (!apiKey) {
        throw new ConfigurationProviderError(
          "Missing ANTHROPIC_API_KEY. Set ANTHROPIC_API_KEY to use the Anthropic provider.",
          { provider: "anthropic" },
        );
      }

      const jsonSchema =
        input.jsonSchema ??
        unwrapJsonSchema(
          zodToJsonSchema(input.schema, {
            name: input.schemaName,
            target: "jsonSchema7",
          }),
          input.schemaName,
        );

      return withRetry({
        provider: "anthropic",
        retries: input.retries,
        operation: async () =>
          runWithTimeout({
            provider: "anthropic",
            timeoutMs: input.timeoutMs ?? 30_000,
            onTimeoutMessage: `Anthropic request timed out after ${input.timeoutMs ?? 30_000}ms.`,
            operation: async () => {
              const client = createAnthropicClient(apiKey, baseURL, input.timeoutMs, clientFactory);
              try {
                const message = await client.messages.parse({
                  model: input.model,
                  max_tokens: input.maxTokens ?? 2048,
                  ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
                  ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
                  messages: renderAnthropicMessages({
                    ...input,
                    userInput: [input.userInput, input.instructions]
                      .filter(Boolean)
                      .join("\n\n"),
                  }),
                  output_config: {
                    format: jsonSchemaOutputFormat(jsonSchema as never),
                  },
                });

                if (message.stop_reason === "refusal") {
                  throw new ContentBlockedError(
                    message.stop_details?.explanation ??
                      "Anthropic refused the structured request.",
                    { provider: "anthropic" },
                  );
                }

                const textResult = createTextResult({
                  text: extractAnthropicText(message.content),
                  raw: message,
                  usage: {
                    inputTokens:
                      message.usage.input_tokens +
                      (message.usage.cache_creation_input_tokens ?? 0) +
                      (message.usage.cache_read_input_tokens ?? 0),
                    outputTokens: message.usage.output_tokens,
                    cachedTokens:
                      (message.usage.cache_creation_input_tokens ?? 0) +
                      (message.usage.cache_read_input_tokens ?? 0),
                  },
                  finishReason: message.stop_reason ?? undefined,
                  requestId: message.id,
                });

                return createStructuredOutput(
                  textResult,
                  message.parsed_output ?? textResult.json ?? JSON.parse(textResult.text),
                  input.schema,
                  "anthropic",
                );
              } catch (error) {
                throw normalizeAnthropicError(error, apiKey);
              }
            },
          }),
      });
    },
  };
}

function createAnthropicClient(
  apiKey: string,
  baseURL: string | undefined,
  timeoutMs: number | undefined,
  clientFactory:
    | AnthropicAdapterOptions["clientFactory"]
    | undefined,
): Pick<Anthropic, "messages"> {
  const baseOptions = {
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    maxRetries: 0,
    timeout: timeoutMs,
  };
  return clientFactory
    ? clientFactory(baseOptions)
    : new Anthropic(baseOptions);
}

function renderAnthropicMessages(
  input: TextGenerationInput,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const contextEntry of input.context ?? []) {
    messages.push({
      role: "user",
      content: `Context: ${contextEntry}`,
    });
  }
  if (input.messages && input.messages.length > 0) {
    for (const message of input.messages) {
      if (message.role === "system") {
        continue;
      }
      messages.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      });
    }
  } else if (input.userInput) {
    messages.push({ role: "user", content: input.userInput });
  }

  return messages.length > 0 ? messages : [{ role: "user", content: input.userInput ?? "" }];
}

function extractAnthropicText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text ?? "")
    .join("\n")
    .trim();
}

function normalizeAnthropicError(error: unknown, apiKey: string): Error {
  if (
    error instanceof AgentGuardProviderError ||
    error instanceof ConfigurationProviderError
  ) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = redactSecrets(
      error instanceof Error ? error.message : String(error),
      [apiKey],
    );
    return normalizeHttpFailure({
      provider: "anthropic",
      status,
      message,
    });
  }

  if (error instanceof Error) {
    error.message = redactSecrets(error.message, [apiKey]);
    return error;
  }

  return new Error(redactSecrets(String(error), [apiKey]));
}

function unwrapJsonSchema(schema: unknown, schemaName: string): unknown {
  if (
    typeof schema === "object" &&
    schema !== null &&
    "$ref" in schema &&
    "definitions" in schema &&
    typeof (schema as { definitions?: Record<string, unknown> }).definitions === "object"
  ) {
    const definitions = (schema as { definitions: Record<string, unknown> }).definitions;
    const resolved = definitions[schemaName];
    if (resolved) {
      return resolved;
    }
  }
  return schema;
}
