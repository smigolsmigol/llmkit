import { ValidationError, type ProviderName } from '@llmkit/shared';
import type { ProviderAdapter } from './types';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';
import { GeminiAdapter } from './gemini';

const adapters: Record<string, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
  gemini: new GeminiAdapter(),
};

export function getAdapter(provider: ProviderName): ProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new ValidationError(`unsupported provider: ${provider}`);
  return adapter;
}

export type { ProviderAdapter, ProviderRequest, ProviderResponse } from './types';
