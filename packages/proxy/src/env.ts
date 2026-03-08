import type { CostBreakdown, TokenUsage } from '@f3d1/llmkit-shared';
import type { BudgetDO } from './do/budget-do';
import type { RateLimitDO } from './do/ratelimit-do';

export interface ResponseMeta {
  provider: string;
  cost: CostBreakdown;
  usage: TokenUsage;
  model?: string;
  latency?: number;
}

export type Env = {
  Bindings: {
    BUDGET_DO: DurableObjectNamespace<BudgetDO>;
    RATE_LIMIT_DO: DurableObjectNamespace<RateLimitDO>;
    SUPABASE_URL?: string;
    SUPABASE_KEY?: string;
    DEV_MODE?: string;
    ENCRYPTION_KEY?: string; // base64 32-byte AES key. rotation requires re-encrypting all provider_keys rows.
  };
  Variables: {
    apiKey: string;
    apiKeyId?: string;
    userId?: string;
    budgetId?: string;
    budgetConfig?: { limitCents: number; period: string };
    budgetScope?: 'key' | 'session';
    budgetMaxTokens?: number;
    budgetReservationId?: string;
    rpmLimit?: number;
    requestModel?: string;
    requestProvider?: string;
    llmkit_response?: ResponseMeta;
  };
};
