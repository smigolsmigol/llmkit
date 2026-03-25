// AUTO-GENERATED from packages/shared/pricing.json
// Do not edit manually. Run: node scripts/generate-pricing.mjs

export const UPDATED_AT = '2026-03-25';

export const PRICING_DATA: Record<string, Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>> = {
  'anthropic': {
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-haiku-20241022': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
    'claude-opus-4-20250514': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  },
  'openai': {
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'o4-mini': { input: 1.1, output: 4.4 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'o3': { input: 2, output: 8 },
    'o3-mini': { input: 1.1, output: 4.4 },
    'gpt-4-turbo': { input: 10, output: 30 },
  },
  'gemini': {
    'gemini-2.0-flash': { input: 0.1, output: 0.4 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
    'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  },
  'groq': {
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
    'gemma2-9b-it': { input: 0.2, output: 0.2 },
  },
  'together': {
    'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo': { input: 0.88, output: 0.88 },
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo': { input: 0.18, output: 0.18 },
    'Qwen/Qwen2.5-72B-Instruct-Turbo': { input: 1.2, output: 1.2 },
    'mistralai/Mixtral-8x7B-Instruct-v0.1': { input: 0.6, output: 0.6 },
  },
  'fireworks': {
    'accounts/fireworks/models/llama-v3p3-70b-instruct': { input: 0.9, output: 0.9, cacheRead: 0.45 },
    'accounts/fireworks/models/llama-v3p1-8b-instruct': { input: 0.2, output: 0.2, cacheRead: 0.1 },
  },
  'deepseek': {
    'deepseek-chat': { input: 0.28, output: 0.42, cacheRead: 0.028 },
    'deepseek-reasoner': { input: 0.28, output: 0.42, cacheRead: 0.028 },
  },
  'mistral': {
    'mistral-large-latest': { input: 2, output: 6 },
    'mistral-small-latest': { input: 0.06, output: 0.18 },
    'codestral-latest': { input: 0.3, output: 0.9 },
  },
  'xai': {
    'grok-4.20-0309-reasoning': { input: 2, output: 6, cacheRead: 0.2 },
    'grok-4.20-0309-non-reasoning': { input: 2, output: 6, cacheRead: 0.2 },
    'grok-4.20-multi-agent-0309': { input: 2, output: 6, cacheRead: 0.2 },
    'grok-4-1-fast-reasoning': { input: 0.2, output: 0.5, cacheRead: 0.05 },
    'grok-4-1-fast-non-reasoning': { input: 0.2, output: 0.5, cacheRead: 0.05 },
    'grok-4': { input: 3, output: 15 },
    'grok-3': { input: 3, output: 15 },
    'grok-3-mini': { input: 0.3, output: 0.5 },
    'grok-2': { input: 2, output: 10 },
  },
  'ollama': {
  },
  'openrouter': {
  },
};

export const PREFIXES: [string, string][] = [
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
