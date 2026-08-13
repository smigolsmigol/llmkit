import 'server-only';

import { PRICING } from '@f3d1/llmkit-shared';
import pricingSource from '../../../shared/pricing.json';

export interface PublicModelPrice {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
}

export const PRICING_SNAPSHOT_DATE = pricingSource.updatedAt;

export function getPublicPricingModels(): PublicModelPrice[] {
  const models: PublicModelPrice[] = [];

  for (const [provider, providerModels] of Object.entries(PRICING)) {
    for (const [model, price] of Object.entries(providerModels)) {
      models.push({
        provider,
        model,
        input: price.inputPerMillion,
        output: price.outputPerMillion,
        cacheRead: price.cacheReadPerMillion,
      });
    }
  }

  return models.sort((left, right) => left.input - right.input);
}

export function getPublicPricingProviders(models = getPublicPricingModels()): string[] {
  return [...new Set(models.map((model) => model.provider))].sort();
}

export function getPublicProviderModels(provider: string): PublicModelPrice[] {
  return getPublicPricingModels().filter((model) => model.provider === provider);
}
