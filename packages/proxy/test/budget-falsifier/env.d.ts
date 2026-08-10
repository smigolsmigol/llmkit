import type { BudgetDO } from '../../src/do/budget-do';
import type { IdempotencyDO } from '../../src/do/idempotency-do';
import type { RateLimitDO } from '../../src/do/ratelimit-do';
import type { FailingRecordBudgetDO, SoftBudgetDO } from './worker';

declare global {
  namespace Cloudflare {
    interface Env {
      BUDGET_DO: DurableObjectNamespace<BudgetDO>;
      FAIL_RECORD_BUDGET_DO: DurableObjectNamespace<FailingRecordBudgetDO>;
      IDEMPOTENCY_DO: DurableObjectNamespace<IdempotencyDO>;
      RATE_LIMIT_DO: DurableObjectNamespace<RateLimitDO>;
      SOFT_BUDGET_DO: DurableObjectNamespace<SoftBudgetDO>;
    }

    interface GlobalProps {
      mainModule: typeof import('./worker');
      durableNamespaces: 'BudgetDO' | 'FailingRecordBudgetDO' | 'IdempotencyDO' | 'RateLimitDO' | 'SoftBudgetDO';
    }
  }
}

export {};
