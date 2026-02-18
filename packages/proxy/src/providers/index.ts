import type { ProviderName } from '@llmkit/shared';
import type { ProviderAdapter } from './types';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';

const adapters: Record<string, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
};

export function getAdapter(provider: ProviderName): ProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`Unknown provider: ${provider}`);
  return adapter;
}

export type { ProviderAdapter, ProviderRequest, ProviderResponse } from './types';
