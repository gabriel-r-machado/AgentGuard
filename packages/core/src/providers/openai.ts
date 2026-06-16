import {
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
  normalizeHttpFailure,
  normalizeToolCall,
  normalizeUsage,
  readTextContent,
  runWithTimeout,
  safeReadJson,
  withRetry,
} from "./common.js";

type OpenAIAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

type ChatCompletionResponse = {
  id?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
    code?: string;
  };
};

export function createOpenAIProviderAdapter(
  options: OpenAIAdapterOptions = {},
): ProviderAdapter {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";

  return {
    name: "openai",
    provider: "openai",
    invoke(input) {
      return this.invokeText(normalizeProviderInput(input));
    },
    invokeText(input: TextGenerationInput): Promise<TextGenerationResult> {
      if (!apiKey) {
        throw new ConfigurationProviderError(
          "Missing OPENAI_API_KEY. Set OPENAI_API_KEY to use the OpenAI provider.",
          { provider: "openai" },
        );
      }

      return withRetry({
        provider: "openai",
        retries: input.retries,
        operation: async () =>
          runWithTimeout({
            provider: "openai",
            timeoutMs: input.timeoutMs ?? 30_000,
            onTimeoutMessage: `OpenAI request timed out after ${input.timeoutMs ?? 30_000}ms.`,
            operation: async (signal) => {
              const response = await fetchFn(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: input.model,
                  temperature: input.temperature,
                  max_tokens: input.maxTokens,
                  messages: buildProviderMessages(input),
                  tools: input.tools?.map((tool) => ({
                    type: "function",
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                }),
                signal,
              });

              const payload = (await safeReadJson(response)) as ChatCompletionResponse;
              if (response.status === 401 || response.status === 403) {
                throw normalizeHttpFailure({
                  provider: "openai",
                  status: response.status,
                  message: `OpenAI authentication failed (HTTP ${response.status}). Check OPENAI_API_KEY.`,
                });
              }
              if (!response.ok) {
                const providerMessage =
                  payload.error?.message ?? `OpenAI request failed with HTTP ${response.status}.`;
                throw normalizeHttpFailure({
                  provider: "openai",
                  status: response.status,
                  message: providerMessage,
                });
              }

              const message = payload.choices?.[0]?.message;
              const text = readTextContent(message?.content);
              const toolCalls = (message?.tool_calls ?? [])
                .map((entry) =>
                  normalizeToolCall(entry.function?.name, entry.function?.arguments),
                )
                .filter((entry) => entry !== undefined);

              return createTextResult({
                text,
                raw: payload,
                toolCalls,
                usage: normalizeUsage({
                  inputTokens: payload.usage?.prompt_tokens,
                  outputTokens: payload.usage?.completion_tokens,
                  totalTokens: payload.usage?.total_tokens,
                }),
                finishReason: payload.choices?.[0]?.finish_reason,
                requestId: payload.id,
              });
            },
          }),
      });
    },
    async invokeStructured<T>(
      input: StructuredGenerationInput<T>,
    ): Promise<StructuredGenerationResult<T>> {
      const enhancedInput: TextGenerationInput = {
        ...input,
        userInput: [input.userInput, buildStructuredPromptSuffix(input)]
          .filter(Boolean)
          .join("\n\n"),
      };
      const response = await this.invokeText(enhancedInput);
      return createStructuredOutput(
        response,
        response.json ?? JSON.parse(response.text),
        input.schema,
        "openai",
      );
    },
  };
}
