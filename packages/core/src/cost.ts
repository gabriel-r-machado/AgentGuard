import type { AgentProvider } from "./types.js";

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type PriceRate = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

const OPENAI_DEFAULT_RATE: PriceRate = {
  inputPerMillionUsd: 0.4,
  outputPerMillionUsd: 1.6,
};

const DEEPSEEK_DEFAULT_RATE: PriceRate = {
  inputPerMillionUsd: 0.14,
  outputPerMillionUsd: 0.28,
};

const MODEL_PRICE_RATES: Record<string, PriceRate> = {
  "gpt-4.1-mini": OPENAI_DEFAULT_RATE,
  "gpt-4.1-mini-2025-04-14": OPENAI_DEFAULT_RATE,
  "deepseek-chat": DEEPSEEK_DEFAULT_RATE,
  "deepseek-v4-flash": DEEPSEEK_DEFAULT_RATE,
  "deepseek-reasoner": {
    inputPerMillionUsd: 0.435,
    outputPerMillionUsd: 0.87,
  },
  "deepseek-v4-pro": {
    inputPerMillionUsd: 0.435,
    outputPerMillionUsd: 0.87,
  },
};

export function estimateModelCostUsd(input: {
  provider: AgentProvider;
  model: string;
  usage: TokenUsage | undefined;
}): number | undefined {
  if (!input.usage) {
    return undefined;
  }

  const rate = resolveRate(input.provider, input.model);
  const inputCost = (input.usage.inputTokens / 1_000_000) * rate.inputPerMillionUsd;
  const outputCost = (input.usage.outputTokens / 1_000_000) * rate.outputPerMillionUsd;
  return roundUsd(inputCost + outputCost);
}

export function formatUsd(value: number): string {
  return value.toFixed(6);
}

function resolveRate(provider: AgentProvider, model: string): PriceRate {
  const normalizedModel = model.trim().toLocaleLowerCase("en-US");
  const explicit = MODEL_PRICE_RATES[normalizedModel];
  if (explicit) {
    return explicit;
  }
  return provider === "deepseek" ? DEEPSEEK_DEFAULT_RATE : OPENAI_DEFAULT_RATE;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
