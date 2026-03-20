import type { CostBreakdown, ProviderName, TokenUsage } from './types.js';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

type PricingTable = Record<string, ModelPricing>;

// last updated: 2026-03-20
// prices in USD per 1M tokens
const PRICING: Record<ProviderName, PricingTable> = {
  anthropic: {
    'claude-opus-4-6': {
      inputPerMillion: 5.0,
      outputPerMillion: 25.0,
      cacheReadPerMillion: 0.5,
      cacheWritePerMillion: 6.25,
    },
    'claude-sonnet-4-6': {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
    'claude-opus-4-5': {
      inputPerMillion: 5.0,
      outputPerMillion: 25.0,
      cacheReadPerMillion: 0.5,
      cacheWritePerMillion: 6.25,
    },
    'claude-sonnet-4-5': {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
    'claude-haiku-4-5': {
      inputPerMillion: 1.0,
      outputPerMillion: 5.0,
      cacheReadPerMillion: 0.1,
      cacheWritePerMillion: 1.25,
    },
    'claude-sonnet-4-20250514': {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
    'claude-3-5-haiku-20241022': {
      inputPerMillion: 0.8,
      outputPerMillion: 4.0,
      cacheReadPerMillion: 0.08,
      cacheWritePerMillion: 1.0,
    },
    'claude-3-haiku-20240307': {
      inputPerMillion: 0.25,
      outputPerMillion: 1.25,
    },
    'claude-opus-4-20250514': {
      inputPerMillion: 15.0,
      outputPerMillion: 75.0,
      cacheReadPerMillion: 1.5,
      cacheWritePerMillion: 18.75,
    },
  },

  openai: {
    'gpt-4.1': { inputPerMillion: 2.0, outputPerMillion: 8.0 },
    'gpt-4.1-mini': { inputPerMillion: 0.40, outputPerMillion: 1.60 },
    'gpt-4.1-nano': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
    'o4-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },
    'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    'o3': { inputPerMillion: 2.0, outputPerMillion: 8.0 },
    'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
    'gpt-4-turbo': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
  },

  gemini: {
    'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
    'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },

  groq: {
    // mixtral-8x7b discontinued on Groq as of late 2025
    'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
    'gemma2-9b-it': { inputPerMillion: 0.20, outputPerMillion: 0.20 },
  },

  together: {
    'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo': { inputPerMillion: 0.88, outputPerMillion: 0.88 },
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo': { inputPerMillion: 0.18, outputPerMillion: 0.18 },
    'Qwen/Qwen2.5-72B-Instruct-Turbo': { inputPerMillion: 1.20, outputPerMillion: 1.20 },
    'mistralai/Mixtral-8x7B-Instruct-v0.1': { inputPerMillion: 0.60, outputPerMillion: 0.60 },
  },

  fireworks: {
    // fireworks gives 50% discount on cached input automatically
    'accounts/fireworks/models/llama-v3p3-70b-instruct': {
      inputPerMillion: 0.90, outputPerMillion: 0.90,
      cacheReadPerMillion: 0.45,
    },
    'accounts/fireworks/models/llama-v3p1-8b-instruct': {
      inputPerMillion: 0.20, outputPerMillion: 0.20,
      cacheReadPerMillion: 0.10,
    },
  },

  deepseek: {
    // V3.2 unified pricing (Sep 2025) - both models same rate
    // cache hits are 90% cheaper, auto-caching no config needed
    'deepseek-chat': {
      inputPerMillion: 0.28,
      outputPerMillion: 0.42,
      cacheReadPerMillion: 0.028,
    },
    'deepseek-reasoner': {
      inputPerMillion: 0.28,
      outputPerMillion: 0.42,
      cacheReadPerMillion: 0.028,
    },
  },

  mistral: {
    'mistral-large-latest': { inputPerMillion: 2.0, outputPerMillion: 6.0 },
    'mistral-small-latest': { inputPerMillion: 0.06, outputPerMillion: 0.18 },
    'codestral-latest': { inputPerMillion: 0.30, outputPerMillion: 0.90 },
  },

  xai: {
    'grok-4.20-0309-reasoning': { inputPerMillion: 2.0, outputPerMillion: 6.0, cacheReadPerMillion: 0.2 },
    'grok-4.20-0309-non-reasoning': { inputPerMillion: 2.0, outputPerMillion: 6.0, cacheReadPerMillion: 0.2 },
    'grok-4.20-multi-agent-0309': { inputPerMillion: 2.0, outputPerMillion: 6.0, cacheReadPerMillion: 0.2 },
    'grok-4-1-fast-reasoning': { inputPerMillion: 0.2, outputPerMillion: 0.5, cacheReadPerMillion: 0.05 },
    'grok-4-1-fast-non-reasoning': { inputPerMillion: 0.2, outputPerMillion: 0.5, cacheReadPerMillion: 0.05 },
    'grok-4': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    'grok-3': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    'grok-3-mini': { inputPerMillion: 0.30, outputPerMillion: 0.50 },
    'grok-2': { inputPerMillion: 2.0, outputPerMillion: 10.0 },
  },

  // local models - no cost
  ollama: {},

  // meta-gateway, pricing varies per model - tracked by underlying provider
  openrouter: {},
};

export function stripDateSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function getModelPricing(
  provider: ProviderName,
  model: string
): ModelPricing | undefined {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return undefined;

  // exact match first
  if (providerPricing[model]) return providerPricing[model];

  // try without date suffix: gpt-4.1-mini-2025-04-14 -> gpt-4.1-mini
  const stripped = stripDateSuffix(model);
  if (stripped !== model && providerPricing[stripped]) return providerPricing[stripped];

  // prefix match for versioned models (e.g. "claude-sonnet-4" matches "claude-sonnet-4-20250514")
  // longest match wins to avoid "gpt-4o" matching before "gpt-4o-mini"
  let best: ModelPricing | undefined;
  let bestLen = 0;

  for (const [key, pricing] of Object.entries(providerPricing)) {
    if (model.startsWith(key) && key.length > bestLen) {
      bestLen = key.length;
      best = pricing;
    }
    if (key.startsWith(model) && model.length > bestLen) {
      bestLen = model.length;
      best = pricing;
    }
  }

  return best;
}

export function calculateCostFromPricing(
  pricing: ModelPricing,
  usage: TokenUsage,
): CostBreakdown {
  const perM = 1_000_000;
  const inputCost = (usage.inputTokens / perM) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / perM) * pricing.outputPerMillion;
  const cacheReadCost = (usage.cacheReadTokens && pricing.cacheReadPerMillion)
    ? (usage.cacheReadTokens / perM) * pricing.cacheReadPerMillion
    : 0;
  const cacheWriteCost = (usage.cacheWriteTokens && pricing.cacheWritePerMillion)
    ? (usage.cacheWriteTokens / perM) * pricing.cacheWritePerMillion
    : 0;

  return {
    inputCost: +inputCost.toFixed(8),
    outputCost: +outputCost.toFixed(8),
    cacheReadCost: cacheReadCost ? +cacheReadCost.toFixed(8) : undefined,
    cacheWriteCost: cacheWriteCost ? +cacheWriteCost.toFixed(8) : undefined,
    totalCost: +(inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(8),
    currency: 'USD',
  };
}

export function calculateCostBreakdown(
  provider: ProviderName,
  model: string,
  usage: TokenUsage,
): CostBreakdown {
  const pricing = getModelPricing(provider, model);
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' };
  }
  return calculateCostFromPricing(pricing, usage);
}

export function calculateCost(
  provider: ProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  return calculateCostBreakdown(provider, model, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
  }).totalCost;
}

const MODEL_PREFIXES: [string, ProviderName][] = [
  ['gpt-', 'openai'],
  ['o1-', 'openai'],
  ['o3-', 'openai'],
  ['o4-', 'openai'],
  ['chatgpt-', 'openai'],
  ['claude-', 'anthropic'],
  ['gemini-', 'gemini'],
  ['deepseek-', 'deepseek'],
  ['mistral-', 'mistral'],
  ['mixtral-', 'mistral'],
  ['codestral-', 'mistral'],
  ['pixtral-', 'mistral'],
  ['grok-', 'xai'],
  ['llama-', 'groq'],
  ['llama3', 'groq'],
];

export function inferProvider(model: string): ProviderName | undefined {
  const lower = model.toLowerCase();
  for (const [prefix, provider] of MODEL_PREFIXES) {
    if (lower.startsWith(prefix)) return provider;
  }
  return undefined;
}

export { PRICING };
export type { ModelPricing, PricingTable };
