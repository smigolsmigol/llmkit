import {
  type CostBreakdown,
  calculateCostFromPricing,
  type ExtraCostDimension,
  getModelPricing,
  type ModelPricing,
  type ProviderName,
  stripDateSuffix,
  type TokenUsage,
} from '@f3d1/llmkit-shared';

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  litellm_provider?: string;
}

let cache: Record<string, LiteLLMEntry> | null = null;
let cacheTs = 0;
const TTL = 24 * 60 * 60 * 1000;
const SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

async function fetchPricingDB(): Promise<Record<string, LiteLLMEntry>> {
  if (cache && Date.now() - cacheTs < TTL) return cache;
  try {
    const res = await fetch(SOURCE, {
      headers: { 'User-Agent': 'llmkit-proxy/1.0' },
    });
    if (!res.ok) throw new Error(`litellm pricing: ${res.status}`);
    cache = await res.json() as Record<string, LiteLLMEntry>;
    cacheTs = Date.now();
    console.log(`litellm pricing loaded: ${Object.keys(cache).length} models`);
    return cache;
  } catch (err) {
    console.warn('litellm pricing fetch failed, using static table:', err);
    return cache || {};
  }
}

const PROVIDER_PREFIX: Record<string, string[]> = {
  anthropic: ['anthropic/', ''],
  openai: ['openai/', ''],
  gemini: ['gemini/', 'vertex_ai/', ''],
  groq: ['groq/', ''],
  together: ['together_ai/', ''],
  fireworks: ['fireworks_ai/', ''],
  deepseek: ['deepseek/', ''],
  mistral: ['mistral/', ''],
  xai: ['xai/', ''],
};

function entryToPricing(e: LiteLLMEntry): ModelPricing {
  return {
    inputPerMillion: (e.input_cost_per_token || 0) * 1_000_000,
    outputPerMillion: (e.output_cost_per_token || 0) * 1_000_000,
    cacheReadPerMillion: e.cache_read_input_token_cost
      ? e.cache_read_input_token_cost * 1_000_000
      : undefined,
    cacheWritePerMillion: e.cache_creation_input_token_cost
      ? e.cache_creation_input_token_cost * 1_000_000
      : undefined,
  };
}

function lookupLiteLLM(
  db: Record<string, LiteLLMEntry>,
  provider: string,
  model: string,
): ModelPricing | undefined {
  const prefixes = PROVIDER_PREFIX[provider] || [''];

  for (const prefix of prefixes) {
    const entry = db[prefix + model];
    if (entry?.input_cost_per_token != null) return entryToPricing(entry);
  }

  const stripped = stripDateSuffix(model);
  if (stripped !== model) {
    for (const prefix of prefixes) {
      const entry = db[prefix + stripped];
      if (entry?.input_cost_per_token != null) return entryToPricing(entry);
    }
  }

  return undefined;
}

export async function resolvePricing(
  provider: ProviderName,
  model: string,
): Promise<ModelPricing | undefined> {
  const staticMatch = getModelPricing(provider, model);
  if (staticMatch) return staticMatch;

  const db = await fetchPricingDB();
  const litellmMatch = lookupLiteLLM(db, provider, model);
  if (litellmMatch) return litellmMatch;

  console.warn(`MISSING PRICING: ${provider}/${model} not found in static table or litellm`);
  return undefined;
}

export async function resolveCost(
  provider: ProviderName,
  model: string,
  usage: TokenUsage,
  extraUsage?: Array<{ dimension: ExtraCostDimension; quantity: number }>,
): Promise<CostBreakdown> {
  const pricing = await resolvePricing(provider, model);
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' };
  }
  return calculateCostFromPricing(pricing, usage, extraUsage);
}
