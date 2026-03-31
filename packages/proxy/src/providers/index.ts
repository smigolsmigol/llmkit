import { type ProviderName, ValidationError } from '@f3d1/llmkit-shared';
import { AnthropicAdapter } from './anthropic';
import { GeminiAdapter } from './gemini';
import { OpenAIAdapter } from './openai';
import type { ProviderAdapter } from './types';

// every provider that speaks the OpenAI chat completions protocol
// gets a configured OpenAIAdapter instance - no separate adapter needed
const adapters: Record<string, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
  gemini: new GeminiAdapter(),
  groq: new OpenAIAdapter('groq', 'https://api.groq.com/openai/v1'),
  together: new OpenAIAdapter('together', 'https://api.together.xyz/v1'),
  fireworks: new OpenAIAdapter('fireworks', 'https://api.fireworks.ai/inference/v1'),
  deepseek: new OpenAIAdapter('deepseek', 'https://api.deepseek.com'),
  mistral: new OpenAIAdapter('mistral', 'https://api.mistral.ai/v1'),
  xai: new OpenAIAdapter('xai', 'https://api.x.ai/v1'),
  ollama: new OpenAIAdapter('ollama', 'http://localhost:11434/v1'),
  openrouter: new OpenAIAdapter('openrouter', 'https://openrouter.ai/api/v1'),
};

export function getAdapter(provider: ProviderName): ProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new ValidationError(`unsupported provider: ${provider}`);
  return adapter;
}

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  deepseek: 'https://api.deepseek.com',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function getProviderBaseUrl(provider: ProviderName): string {
  return BASE_URLS[provider] || 'https://api.openai.com/v1';
}

export type { ProviderAdapter, ProviderRequest, ProviderResponse } from './types';
