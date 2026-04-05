import { calculateCostFromPricing, PRICING } from '@f3d1/llmkit-shared';
import { Hono } from 'hono';
import type { Env } from '../env';

const pricingRequests = new Map<string, number>();
const PRICING_RPM = 30;

export const pricingRouter = new Hono<Env>();

pricingRouter.get('/pricing/compare', (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const window = Math.floor(Date.now() / 60_000);
  const key = `${ip}:${window}`;
  const count = (pricingRequests.get(key) || 0) + 1;
  pricingRequests.set(key, count);
  if (count > PRICING_RPM) {
    return c.json({ error: { code: 'RATE_LIMITED', message: 'pricing API rate limit exceeded' } }, 429);
  }
  // clean old windows
  for (const [k] of pricingRequests) { if (!k.endsWith(`:${window}`)) pricingRequests.delete(k); }
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
