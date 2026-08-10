import { type ProviderName, ValidationError } from '@f3d1/llmkit-shared';

const SUPPORTED_PROVIDERS = new Set<ProviderName>([
  'anthropic',
  'openai',
  'gemini',
  'groq',
  'together',
  'fireworks',
  'deepseek',
  'mistral',
  'xai',
  'ollama',
  'openrouter',
]);

export const MAX_PROVIDER_CHAIN_LENGTH = 5;

export function resolveProviderChain(
  primary: ProviderName,
  fallbackHeader: string | undefined,
): ProviderName[] {
  const values = fallbackHeader === undefined ? [primary] : fallbackHeader.split(',').map((value) => value.trim());
  if (values.some((value) => value.length === 0)) {
    throw new ValidationError('fallback provider chain contains an empty provider');
  }
  if (values.length > MAX_PROVIDER_CHAIN_LENGTH) {
    throw new ValidationError(`fallback provider chain cannot exceed ${MAX_PROVIDER_CHAIN_LENGTH} providers`);
  }

  const seen = new Set<string>();
  const chain: ProviderName[] = [];
  for (const value of values) {
    if (!SUPPORTED_PROVIDERS.has(value as ProviderName)) {
      throw new ValidationError(`unsupported provider in fallback chain: ${value}`);
    }
    if (seen.has(value)) {
      throw new ValidationError(`duplicate provider in fallback chain: ${value}`);
    }
    seen.add(value);
    chain.push(value as ProviderName);
  }
  return chain;
}
