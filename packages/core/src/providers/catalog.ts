import type { AgentProvider } from "../types.js";

export const PROVIDER_API_KEY_ENVS: Record<AgentProvider, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export function getProviderApiKeyEnv(provider: AgentProvider): string {
  return PROVIDER_API_KEY_ENVS[provider];
}
