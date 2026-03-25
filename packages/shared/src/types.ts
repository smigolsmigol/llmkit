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

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageUrlBlock {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentBlock = TextBlock | ImageUrlBlock;

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
}

export type ExtraCostDimension =
  | 'tool_call'
  | 'image'
  | 'video_sec'
  | 'voice_min'
  | 'rag_search';

export interface ExtraCost {
  dimension: ExtraCostDimension;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  extraCosts?: ExtraCost[];
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
  scope?: 'key' | 'session';
}

export interface BudgetAlert {
  type: 'budget.threshold';
  budgetId: string;
  usedCents: number;
  limitCents: number;
  percentage: number;
  period: string;
  timestamp: string;
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

export type ProviderName =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'deepseek'
  | 'mistral'
  | 'xai'
  | 'ollama'
  | 'openrouter';

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
