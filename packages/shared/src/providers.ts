import { PREFIXES, PRICING_DATA } from './pricing-data.js';
import type { CostBreakdown, ExtraCost, ExtraCostDimension, ProviderName, TokenUsage } from './types.js';

export interface ExtraRateDefinition {
  dimension: ExtraCostDimension;
  rate: number;
  per: number;
  label: string;
}

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  extraRates?: ExtraRateDefinition[];
}

type PricingTable = Record<string, ModelPricing>;

// xAI server-side tool pricing (Responses API only, not Chat Completions):
// web_search $5/1K, x_search $5/1K, code_execution/code_interpreter $5/1K,
// attachment_search $10/1K, collections_search/file_search $2.50/1K.
// User-defined function calls via Chat Completions are FREE.

// pricing data loaded from pricing.json via generated pricing-data.ts
const PRICING: Record<ProviderName, PricingTable> = {} as Record<ProviderName, PricingTable>;

for (const [provider, models] of Object.entries(PRICING_DATA)) {
  const table: PricingTable = {};
  for (const [model, p] of Object.entries(models)) {
    const entry: ModelPricing = {
      inputPerMillion: p.input,
      outputPerMillion: p.output,
      cacheReadPerMillion: p.cacheRead,
      cacheWritePerMillion: p.cacheWrite,
    };
    if (p.extraRates) {
      entry.extraRates = Object.entries(p.extraRates).map(([dim, r]) => ({
        dimension: dim as ExtraCostDimension,
        rate: (r as { rate: number; per: number }).rate,
        per: (r as { rate: number; per: number }).per,
        label: dim.replace(/_/g, ' '),
      }));
    }
    table[model] = entry;
  }
  PRICING[provider as ProviderName] = table;
}

const MODEL_PREFIXES: [string, ProviderName][] = PREFIXES as [string, ProviderName][];

export function stripDateSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function getModelPricing(
  provider: ProviderName,
  model: string
): ModelPricing | undefined {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return undefined;

  if (providerPricing[model]) return providerPricing[model];

  const stripped = stripDateSuffix(model);
  if (stripped !== model && providerPricing[stripped]) return providerPricing[stripped];

  let best: ModelPricing | undefined;
  let bestLen = 0;

  for (const [key, pricing] of Object.entries(providerPricing)) {
    if (model.startsWith(key) && key.length > bestLen) {
      bestLen = key.length;
      best = pricing;
    }
    if (key.startsWith(model) && key.length > bestLen) {
      const remainder = key.slice(model.length);
      if (/^-\d{8}$/.test(remainder) || /^-\d{4}-\d{2}-\d{2}$/.test(remainder)) {
        bestLen = key.length;
        best = pricing;
      }
    }
  }

  return best;
}

export function calculateCostFromPricing(
  pricing: ModelPricing,
  usage: TokenUsage,
  extraUsage?: Array<{ dimension: ExtraCostDimension; quantity: number }>,
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

  let extraCosts: ExtraCost[] | undefined;
  if (extraUsage?.length && pricing.extraRates?.length) {
    extraCosts = [];
    for (const eu of extraUsage) {
      const rateDef = pricing.extraRates.find(r => r.dimension === eu.dimension);
      if (rateDef && eu.quantity > 0 && rateDef.per > 0 && rateDef.rate >= 0) {
        const cost = (eu.quantity / rateDef.per) * rateDef.rate;
        extraCosts.push({
          dimension: eu.dimension,
          quantity: eu.quantity,
          unitCost: +(rateDef.rate / rateDef.per).toFixed(8),
          totalCost: +cost.toFixed(8),
        });
      }
    }
    if (extraCosts.length === 0) extraCosts = undefined;
  }

  const extraTotal = extraCosts?.reduce((s, c) => s + c.totalCost, 0) ?? 0;

  return {
    inputCost: +inputCost.toFixed(8),
    outputCost: +outputCost.toFixed(8),
    cacheReadCost: cacheReadCost ? +cacheReadCost.toFixed(8) : undefined,
    cacheWriteCost: cacheWriteCost ? +cacheWriteCost.toFixed(8) : undefined,
    extraCosts,
    totalCost: +(inputCost + outputCost + cacheReadCost + cacheWriteCost + extraTotal).toFixed(8),
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

export function inferProvider(model: string): ProviderName | undefined {
  const lower = model.toLowerCase();
  for (const [prefix, provider] of MODEL_PREFIXES) {
    if (lower.startsWith(prefix)) return provider;
  }
  return undefined;
}

export type { ModelPricing, PricingTable };
export { PRICING };
