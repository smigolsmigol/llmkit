import { calculateCostFromPricing, PRICING } from '@f3d1/llmkit-shared';
import { Hono } from 'hono';
import type { Env } from '../env';

export const pricingRouter = new Hono<Env>();

pricingRouter.get('/pricing/compare', (c) => {
  const input = Number(c.req.query('input')) || 0;
  const output = Number(c.req.query('output')) || 0;
  const cacheRead = Number(c.req.query('cacheRead')) || 0;
  const cacheWrite = Number(c.req.query('cacheWrite')) || 0;
  const filterProvider = c.req.query('provider') || undefined;

  const usage = { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, totalTokens: input + output };
  const models: Array<{ provider: string; model: string; inputCost: number; outputCost: number; cacheReadCost?: number; totalCost: number }> = [];

  for (const [provider, table] of Object.entries(PRICING)) {
    if (filterProvider && provider !== filterProvider) continue;

    for (const [model, pricing] of Object.entries(table)) {
      const cost = calculateCostFromPricing(pricing, usage);
      models.push({
        provider,
        model,
        inputCost: cost.inputCost,
        outputCost: cost.outputCost,
        cacheReadCost: cost.cacheReadCost,
        totalCost: cost.totalCost,
      });
    }
  }

  models.sort((a, b) => a.totalCost - b.totalCost);

  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({ input, output, cacheRead, cacheWrite, provider: filterProvider || 'all', count: models.length, models });
});
