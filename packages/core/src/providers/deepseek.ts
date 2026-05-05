import {
  AgentGuardProviderError,
  type NormalizedProviderInput,
  type NormalizedProviderOutput,
  type ProviderAdapter,
} from "./types.js";

type DeepSeekAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

type ChatCompletionResponse = {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  choices?: Array<{
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
    async invoke(input: NormalizedProviderInput): Promise<NormalizedProviderOutput> {
      if (!apiKey) {
        throw new AgentGuardProviderError(
          "auth",
          "Missing DEEPSEEK_API_KEY. Set DEEPSEEK_API_KEY to run DeepSeek provider tests.",
        );
      }

      const controller = new AbortController();
      const timeoutMs = input.timeoutMs ?? 30_000;
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: input.model,
            temperature: input.temperature,
            messages: buildMessages(input),
            tools: input.tools?.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }),
          signal: controller.signal,
        });

        const payload = (await safeReadJson(response)) as ChatCompletionResponse;

        if (response.status === 401 || response.status === 403) {
          throw new AgentGuardProviderError(
            "auth",
            `DeepSeek authentication failed (HTTP ${response.status}). Check DEEPSEEK_API_KEY.`,
          );
        }

        if (!response.ok) {
          const providerMessage = payload.error?.message ?? `HTTP ${response.status}`;
          throw new AgentGuardProviderError(
            "provider",
            `DeepSeek request failed: ${providerMessage}`,
            { retryable: response.status >= 500 || response.status === 429 },
          );
        }

        const message = payload.choices?.[0]?.message;
        const text = readTextContent(message?.content);
        const toolCalls = (message?.tool_calls ?? [])
          .map((entry) => normalizeToolCall(entry.function?.name, entry.function?.arguments))
          .filter((entry) => entry !== undefined);
        const usage = payload.usage
          ? {
              inputTokens: payload.usage.prompt_tokens ?? 0,
              outputTokens: payload.usage.completion_tokens ?? 0,
            }
          : undefined;

        return {
          text,
          json: parseJsonIfPossible(text),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
          raw: payload,
        };
      } catch (error) {
        if (isAbortError(error)) {
          throw new AgentGuardProviderError(
            "timeout",
            `DeepSeek request timed out after ${timeoutMs}ms.`,
            { retryable: true },
          );
        }
        if (error instanceof AgentGuardProviderError) {
          throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new AgentGuardProviderError(
          "network",
          `DeepSeek request failed due to a network/runtime error: ${reason}`,
          { retryable: true },
        );
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  };
}

function buildMessages(input: NormalizedProviderInput): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  for (const contextEntry of input.context ?? []) {
    messages.push({ role: "system", content: `Context: ${contextEntry}` });
  }
  messages.push({ role: "user", content: input.userInput });
  return messages;
}

function readTextContent(
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

function normalizeToolCall(
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

function parseJsonIfPossible(text: string): unknown {
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

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
