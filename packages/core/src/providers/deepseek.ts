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

type DeepSeekAdapterOptions = {
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

export function createDeepSeekProviderAdapter(
  options: DeepSeekAdapterOptions = {},
): ProviderAdapter {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.deepseek.com/v1";

  return {
    name: "deepseek",
    provider: "deepseek",
    invoke(input) {
      return this.invokeText(normalizeProviderInput(input));
    },
    invokeText(input: TextGenerationInput): Promise<TextGenerationResult> {
      if (!apiKey) {
        throw new ConfigurationProviderError(
          "Missing DEEPSEEK_API_KEY. Set DEEPSEEK_API_KEY to use the DeepSeek provider.",
          { provider: "deepseek" },
        );
      }

      return withRetry({
        provider: "deepseek",
        retries: input.retries,
        operation: async () =>
          runWithTimeout({
            provider: "deepseek",
            timeoutMs: input.timeoutMs ?? 30_000,
            onTimeoutMessage: `DeepSeek request timed out after ${input.timeoutMs ?? 30_000}ms.`,
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
                  provider: "deepseek",
                  status: response.status,
                  message: `DeepSeek authentication failed (HTTP ${response.status}). Check DEEPSEEK_API_KEY.`,
                });
              }
              if (!response.ok) {
                const providerMessage =
                  payload.error?.message ?? `DeepSeek request failed with HTTP ${response.status}.`;
                throw normalizeHttpFailure({
                  provider: "deepseek",
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
        "deepseek",
      );
    },
  };
}
