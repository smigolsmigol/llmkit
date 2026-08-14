import type { CostBreakdown, TokenUsage } from '@f3d1/llmkit-shared';
import type { BudgetDO } from './do/budget-do';
import type { IdempotencyDO } from './do/idempotency-do';
import type { RateLimitDO } from './do/ratelimit-do';

export interface ResponseMeta {
  provider: string;
  cost: CostBreakdown;
  usage: TokenUsage;
  model?: string;
  latency?: number;
  toolCalls?: { name: string }[];
  providerCostUsd?: number;
}

export type Env = {
  Bindings: {
    BUDGET_DO: DurableObjectNamespace<BudgetDO>;
    IDEMPOTENCY_DO: DurableObjectNamespace<IdempotencyDO>;
    RATE_LIMIT_DO: DurableObjectNamespace<RateLimitDO>;
    CF_VERSION_METADATA?: { id?: string };
    SUPABASE_URL?: string;
    SUPABASE_KEY?: string;
    DEV_MODE?: string;
    ENCRYPTION_KEY?: string; // base64 32-byte AES key. rotation requires re-encrypting all provider_keys rows.
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    TELEGRAM_VERBOSE?: string;
    BENCH_ENABLED?: string;
    BENCH_INSTALL_ID?: string;
    BENCH_INSTALL_HMAC?: string;
    BENCH_INGEST_URL?: string;
    STAGING_PROOF_ENABLED?: string;
    STAGING_PROOF_TOKEN?: string;
    STAGING_SOURCE_COMMIT?: string;
    STAGING_SUPABASE_PROJECT_REF?: string;
  };
  Variables: {
    apiKey: string;
    apiKeyId?: string;
    userId?: string;
    budgetId?: string;
    budgetConfig?: { limitCents: number; period: string; scope?: string; alertWebhookUrl?: string | null };
    budgetScope?: 'key' | 'session';
    budgetReservationId?: string;
    budgetReservedCostCents?: number;
    budgetSettlementMode?: 'actual' | 'ceiling';
    requestId?: string;
    customerId?: string;
    workflowId?: string;
    agentId?: string;
    sessionId?: string;
    endUserId?: string;
    idempotencyKeyHash?: string;
    providerDispatchStarted?: boolean;
    responseSha256?: string;
    rpmLimit?: number;
    requestModel?: string;
    requestProvider?: string;
    llmkit_response?: ResponseMeta;
  };
};
