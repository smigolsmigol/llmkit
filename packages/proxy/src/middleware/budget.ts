import { createMiddleware } from 'hono/factory';
import { BudgetExceededError } from '@llmkit/shared';

export function budgetCheck() {
  return createMiddleware(async (c, next) => {
    const budgetId = c.req.header('x-llmkit-budget-id');
    if (!budgetId) return await next();

    // TODO: check budget from KV, reject if over limit
    // this is the pre-request check - conservative estimate
    // post-request update happens in the logger middleware

    await next();
  });
}
