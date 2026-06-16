import { createAnthropicProviderAdapter } from "./anthropic.js";
import { createDeepSeekProviderAdapter } from "./deepseek.js";
import { createGeminiProviderAdapter } from "./gemini.js";
import { createOpenAIProviderAdapter } from "./openai.js";
import { createLlmProviderFromAdapter, type LlmProvider, type ProviderAdapter } from "./types.js";

import type { AgentProvider } from "../types.js";

export function createProviderAdapter(
  provider: AgentProvider,
  options: { fetchFn?: typeof fetch } = {},
): ProviderAdapter {
  if (provider === "openai") {
    return createOpenAIProviderAdapter({ fetchFn: options.fetchFn });
  }
  if (provider === "deepseek") {
    return createDeepSeekProviderAdapter({ fetchFn: options.fetchFn });
  }
  if (provider === "gemini") {
    return createGeminiProviderAdapter();
  }
  return createAnthropicProviderAdapter();
}

export function createLlmProvider(
  provider: AgentProvider,
  options: { fetchFn?: typeof fetch } = {},
): LlmProvider {
  return createLlmProviderFromAdapter(createProviderAdapter(provider, options));
}
