export interface LLMRequest {
  provider: ProviderName;
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  sessionId?: string;
}

export interface LLMResponse {
  id: string;
  provider: ProviderName;
  model: string;
  content: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  cached: boolean;
  sessionId?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  totalCost: number;
  currency: 'USD';
}

export interface Budget {
  id: string;
  keyId: string;
  limitCents: number;
  usedCents: number;
  period: 'daily' | 'weekly' | 'monthly';
  resetAt: Date;
}

export interface SessionSummary {
  sessionId: string;
  requestCount: number;
  totalCost: CostBreakdown;
  totalTokens: TokenUsage;
  providers: ProviderName[];
  startedAt: Date;
  lastRequestAt: Date;
  durationMs: number;
}

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
  baseUrl?: string;
  priority: number;
  enabled: boolean;
}

export interface FallbackConfig {
  providers: ProviderName[];
  retryOn: number[];
  maxRetries: number;
}

export interface LLMKitConfig {
  apiKey: string;
  baseUrl?: string;
  defaultProvider?: ProviderName;
  fallback?: FallbackConfig;
  sessionId?: string;
  budgetId?: string;
}
