import type { CostBreakdown, TokenUsage } from '@llmkit/shared';

export interface BudgetRecord {
  limitCents: number;
  usedCents: number;
  period: 'daily' | 'weekly' | 'monthly' | 'total';
  resetAt: number; // unix ms, 0 for 'total'
  scope?: 'key' | 'session';
  alertThreshold?: number; // 0-1, default 0.8
  alertWebhookUrl?: string;
  lastAlertAt?: number; // unix ms, prevents duplicate alerts per period
}

export interface ResponseMeta {
  provider: string;
  cost: CostBreakdown;
  usage: TokenUsage;
  model?: string;
  latency?: number;
}

export type Env = {
  Bindings: {
    RATE_LIMIT: KVNamespace;
    BUDGET: KVNamespace;
    SUPABASE_URL?: string;
    SUPABASE_KEY?: string;
    DEV_MODE?: string;
  };
  Variables: {
    apiKey: string;
    apiKeyId?: string;
    userId?: string;
    budgetId?: string;
    budgetRecord?: BudgetRecord;
    budgetScope?: 'key' | 'session';
    budgetKvKey?: string; // resolved KV key (may include session suffix)
    llmkit_response?: ResponseMeta;
  };
};
