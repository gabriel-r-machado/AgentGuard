import { performance } from "node:perf_hooks";

import { createProviderAdapter as createAgentProviderAdapter } from "../providers/factory.js";

import type { ProviderAdapter } from "../providers/types.js";
import type { AgentProvider, DirectProviderTargetConfig, ResolvedAgentGuardConfig } from "../types.js";
import type { AgentTarget, AgentTargetTurnInput, AgentTargetTurnOutput } from "./types.js";

export function createProviderAgentTarget(options: {
  target?: DirectProviderTargetConfig;
  config: ResolvedAgentGuardConfig;
  fetchFn?: typeof fetch;
}): AgentTarget {
  const providerName = options.target?.provider ?? options.config.provider;
  const model = options.target?.model ?? options.config.model;
  if (!providerName || !model) {
    throw new Error(
      'Provider target requires a configured provider and model.',
    );
  }

  const adapter = createProviderAdapter(providerName, options.fetchFn);
  const timeoutMs = options.target?.timeoutMs ?? options.config.timeoutMs;
  const temperature = options.target?.temperature ?? options.config.temperature;

  return {
    name: `provider:${providerName}`,
    async executeTurn(input: AgentTargetTurnInput): Promise<AgentTargetTurnOutput> {
      const startedAt = performance.now();
      try {
        const context = input.history.map(
          (message) => `${message.role}: ${message.content}`,
        );
        const response = await adapter.invoke({
          model,
          systemPrompt: input.systemPrompt,
          userInput: input.userMessage,
          context,
          temperature,
          timeoutMs,
        });

        return {
          text: response.text,
          latencyMs: Math.round(performance.now() - startedAt),
          retryCount: 0,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          toolCalls: response.toolCalls ?? [],
          retrievedContext: [],
          raw: response.raw,
        };
      } catch (error) {
        return {
          text: "",
          latencyMs: Math.round(performance.now() - startedAt),
          retryCount: 0,
          toolCalls: [],
          retrievedContext: [],
          error: error instanceof Error ? error.message : String(error),
          raw: undefined,
        };
      }
    },
  };
}

function createProviderAdapter(
  provider: AgentProvider,
  fetchFn: typeof fetch | undefined,
): ProviderAdapter {
  return createAgentProviderAdapter(provider, { fetchFn });
}
