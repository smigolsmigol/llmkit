import type { ProviderName } from './types';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

type PricingTable = Record<string, ModelPricing>;

// last updated: 2026-02-18
// TODO: add automated freshness checks
const PRICING: Record<ProviderName, PricingTable> = {
  anthropic: {
    'claude-sonnet-4-20250514': {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
    'claude-haiku-3.5-20241022': {
      inputPerMillion: 0.8,
      outputPerMillion: 4.0,
      cacheReadPerMillion: 0.08,
      cacheWritePerMillion: 1.0,
    },
    'claude-opus-4-20250514': {
      inputPerMillion: 15.0,
      outputPerMillion: 75.0,
      cacheReadPerMillion: 1.5,
      cacheWritePerMillion: 18.75,
    },
  },

  openai: {
    'gpt-4o': {
      inputPerMillion: 2.5,
      outputPerMillion: 10.0,
    },
    'gpt-4o-mini': {
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    },
    'o3': {
      inputPerMillion: 10.0,
      outputPerMillion: 40.0,
    },
    'o3-mini': {
      inputPerMillion: 1.1,
      outputPerMillion: 4.4,
    },
  },

  gemini: {
    'gemini-2.0-flash': {
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
    },
    'gemini-2.0-pro': {
      inputPerMillion: 1.25,
      outputPerMillion: 10.0,
    },
  },

  ollama: {},
};

export function getModelPricing(
  provider: ProviderName,
  model: string
): ModelPricing | undefined {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return undefined;

  // exact match first
  if (providerPricing[model]) return providerPricing[model];

  // prefix match for versioned models (e.g. "claude-sonnet-4" matches "claude-sonnet-4-20250514")
  for (const [key, pricing] of Object.entries(providerPricing)) {
    if (key.startsWith(model) || model.startsWith(key)) return pricing;
  }

  return undefined;
}

export function calculateCost(
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const pricing = getModelPricing(provider, model);
  if (!pricing) return 0;

  let cost = 0;
  cost += (inputTokens / 1_000_000) * pricing.inputPerMillion;
  cost += (outputTokens / 1_000_000) * pricing.outputPerMillion;

  if (pricing.cacheReadPerMillion && cacheReadTokens > 0) {
    cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  }
  if (pricing.cacheWritePerMillion && cacheWriteTokens > 0) {
    cost += (cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;
  }

  return cost;
}

export { PRICING };
export type { ModelPricing, PricingTable };
