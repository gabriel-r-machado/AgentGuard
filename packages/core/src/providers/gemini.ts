import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  AgentGuardProviderError,
  ConfigurationProviderError,
  createStructuredOutput,
  normalizeProviderInput,
  type ProviderAdapter,
  type StructuredGenerationInput,
  type StructuredGenerationResult,
  type TextGenerationInput,
  type TextGenerationResult,
} from "./types.js";
import {
  buildProviderMessages,
  buildStructuredPromptSuffix,
  createTextResult,
  maybeThrowBlockedError,
  normalizeHttpFailure,
  redactSecrets,
  runWithTimeout,
  withRetry,
} from "./common.js";

type GeminiAdapterOptions = {
  apiKey?: string;
  clientFactory?: (apiKey: string) => Pick<GoogleGenAI, "models">;
};

export function createGeminiProviderAdapter(
  options: GeminiAdapterOptions = {},
): ProviderAdapter {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const createClient = options.clientFactory ?? ((key: string) => new GoogleGenAI({ apiKey: key }));

  return {
    name: "gemini",
    provider: "gemini",
    invoke(input) {
      return this.invokeText(normalizeProviderInput(input));
    },
    invokeText(input: TextGenerationInput): Promise<TextGenerationResult> {
      if (!apiKey) {
        throw new ConfigurationProviderError(
          "Missing GEMINI_API_KEY. Set GEMINI_API_KEY to use the Gemini provider.",
          { provider: "gemini" },
        );
      }

      return withRetry({
        provider: "gemini",
        retries: input.retries,
        operation: async () =>
          runWithTimeout({
            provider: "gemini",
            timeoutMs: input.timeoutMs ?? 30_000,
            onTimeoutMessage: `Gemini request timed out after ${input.timeoutMs ?? 30_000}ms.`,
            operation: async () => {
              const client = createClient(apiKey);
              try {
                const response = await client.models.generateContent({
                  model: input.model,
                  contents: renderGeminiContents(input),
                  config: {
                    systemInstruction: input.systemPrompt,
                    temperature: input.temperature,
                    maxOutputTokens: input.maxTokens,
                  },
                });

                maybeThrowBlockedError({
                  provider: "gemini",
                  blocked: Boolean(response.promptFeedback?.blockReason),
                  message:
                    response.promptFeedback?.blockReasonMessage ??
                    `Gemini blocked the request for reason "${response.promptFeedback?.blockReason ?? "unknown"}".`,
                });

                return createTextResult({
                  text: response.text ?? "",
                  raw: response,
                  toolCalls: (response.functionCalls ?? []).map((call) => ({
                    name: call.name ?? "unknown",
                    arguments: call.args ?? {},
                  })),
                  usage: {
                    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
                    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
                    totalTokens: response.usageMetadata?.totalTokenCount,
                    cachedTokens: response.usageMetadata?.cachedContentTokenCount,
                  },
                  finishReason: response.candidates?.[0]?.finishReason,
                  requestId: response.responseId,
                });
              } catch (error) {
                throw normalizeGeminiError(error, apiKey);
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
          "Missing GEMINI_API_KEY. Set GEMINI_API_KEY to use the Gemini provider.",
          { provider: "gemini" },
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

      const result = await withRetry({
        provider: "gemini",
        retries: input.retries,
        operation: async () =>
          runWithTimeout({
            provider: "gemini",
            timeoutMs: input.timeoutMs ?? 30_000,
            onTimeoutMessage: `Gemini request timed out after ${input.timeoutMs ?? 30_000}ms.`,
            operation: async () => {
              try {
                const client = createClient(apiKey);
                const response = await client.models.generateContent({
                  model: input.model,
                  contents: renderGeminiContents({
                    ...input,
                    userInput: [input.userInput, buildStructuredPromptSuffix(input)]
                      .filter(Boolean)
                      .join("\n\n"),
                  }),
                  config: {
                    systemInstruction: input.systemPrompt,
                    temperature: input.temperature,
                    maxOutputTokens: input.maxTokens,
                    responseMimeType: "application/json",
                    responseJsonSchema: jsonSchema,
                  },
                });

                maybeThrowBlockedError({
                  provider: "gemini",
                  blocked: Boolean(response.promptFeedback?.blockReason),
                  message:
                    response.promptFeedback?.blockReasonMessage ??
                    `Gemini blocked the request for reason "${response.promptFeedback?.blockReason ?? "unknown"}".`,
                });

                const textResult = createTextResult({
                  text: response.text ?? "",
                  raw: response,
                  usage: {
                    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
                    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
                    totalTokens: response.usageMetadata?.totalTokenCount,
                    cachedTokens: response.usageMetadata?.cachedContentTokenCount,
                  },
                  finishReason: response.candidates?.[0]?.finishReason,
                  requestId: response.responseId,
                });

                return createStructuredOutput(
                  textResult,
                  textResult.json ?? JSON.parse(textResult.text),
                  input.schema,
                  "gemini",
                );
              } catch (error) {
                throw normalizeGeminiError(error, apiKey);
              }
            },
          }),
      });

      return result;
    },
  };
}

function renderGeminiContents(input: TextGenerationInput): string {
  const messages = buildProviderMessages(input).filter((message) => message.role !== "system");
  if (messages.length === 0) {
    return input.userInput ?? "";
  }
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function normalizeGeminiError(error: unknown, apiKey: string): Error {
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
      provider: "gemini",
      status,
      message,
    });
  }
  if (
    error instanceof AgentGuardProviderError ||
    error instanceof ConfigurationProviderError
  ) {
    return error;
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
