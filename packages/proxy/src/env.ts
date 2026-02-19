import type { CostBreakdown, TokenUsage } from '@llmkit/shared';

export interface BudgetRecord {
  limitCents: number;
  usedCents: number;
  period: 'daily' | 'weekly' | 'monthly' | 'total';
  resetAt: number; // unix ms, 0 for 'total'
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
    llmkit_response?: ResponseMeta;
  };
};
