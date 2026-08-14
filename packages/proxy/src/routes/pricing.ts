import {
  calculateCostFromPricing,
  type ModelPricing,
  PRICING,
  PRICING_UPDATED_AT,
} from '@f3d1/llmkit-shared';
import { type Context, Hono } from 'hono';
import type { Env } from '../env';

const PRICING_RPM = 30;
const MAX_MODELS = 20;
const REQUIRED_QUERY_FIELDS = ['mode', 'models', 'input', 'output', 'cacheRead', 'cacheWrite'] as const;
const ALLOWED_QUERY_FIELDS = new Set<string>(REQUIRED_QUERY_FIELDS);

interface SelectedModel {
  key: string;
  provider: string;
  model: string;
  pricing: ModelPricing;
}

export const pricingRouter = new Hono<Env>();

pricingRouter.get('/pricing/compare', async (c) => {
  const clientIdentity = c.req.header('cf-connecting-ip') || 'unknown';
  const limiterName = `public-pricing:${clientIdentity}`;
  const limiter = c.env.RATE_LIMIT_DO.get(c.env.RATE_LIMIT_DO.idFromName(limiterName));
  const rate = await limiter.hit({ limit: PRICING_RPM });
  c.header('X-RateLimit-Limit', String(rate.limit));
  c.header('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds ?? 60));
    c.header('Cache-Control', 'no-store');
    return c.json({ error: { code: 'RATE_LIMITED', message: 'pricing API rate limit exceeded' } }, 429);
  }

  const params = new URL(c.req.url).searchParams;
  for (const name of params.keys()) {
    if (!ALLOWED_QUERY_FIELDS.has(name)) {
      return invalidQuery(c, `unknown query parameter: ${name}`, name);
    }
  }

  const values = new Map<string, string>();
  for (const name of REQUIRED_QUERY_FIELDS) {
    const matches = params.getAll(name);
    if (matches.length !== 1 || matches[0]?.trim() === '') {
      const reason = matches.length > 1 ? 'must appear exactly once' : 'is required and cannot be empty';
      return invalidQuery(c, `${name} ${reason}`, name);
    }
    values.set(name, matches[0] ?? '');
  }

  if (values.get('mode') !== 'text-token') {
    return invalidQuery(c, 'mode must be text-token', 'mode');
  }

  const parsedInput = parseTokenCount(values.get('input') ?? '', 'input');
  if (typeof parsedInput === 'string') return invalidTokenCount(c, parsedInput);
  const parsedOutput = parseTokenCount(values.get('output') ?? '', 'output');
  if (typeof parsedOutput === 'string') return invalidTokenCount(c, parsedOutput);
  const parsedCacheRead = parseTokenCount(values.get('cacheRead') ?? '', 'cacheRead');
  if (typeof parsedCacheRead === 'string') return invalidTokenCount(c, parsedCacheRead);
  const parsedCacheWrite = parseTokenCount(values.get('cacheWrite') ?? '', 'cacheWrite');
  if (typeof parsedCacheWrite === 'string') return invalidTokenCount(c, parsedCacheWrite);
  const input = parsedInput;
  const output = parsedOutput;
  const cacheRead = parsedCacheRead;
  const cacheWrite = parsedCacheWrite;
  if (input + output + cacheRead + cacheWrite === 0) {
    return invalidQuery(c, 'at least one token count must be greater than zero', 'usage');
  }

  const modelKeys = (values.get('models') ?? '').split(',');
  if (modelKeys.some((key) => key.trim() !== key || key === '')) {
    return invalidQuery(c, 'models must be a comma-separated list of exact provider/model keys', 'models');
  }
  if (modelKeys.length > MAX_MODELS) {
    return invalidQuery(c, `models accepts at most ${MAX_MODELS} keys`, 'models');
  }
  if (new Set(modelKeys).size !== modelKeys.length) {
    return invalidQuery(c, 'models cannot contain duplicate keys', 'models');
  }

  const selected: SelectedModel[] = [];
  const pricingTables = PRICING as Record<string, Record<string, ModelPricing>>;
  for (const key of modelKeys) {
    const separator = key.indexOf('/');
    if (separator <= 0 || separator === key.length - 1) {
      return invalidQuery(c, `invalid model key: ${key}`, 'models');
    }
    const provider = key.slice(0, separator);
    const model = key.slice(separator + 1);
    const pricing = pricingTables[provider]?.[model];
    if (!pricing) {
      return c.json({ error: { code: 'UNKNOWN_PRICING_MODEL', message: `unknown exact model key: ${key}`, field: 'models' } }, 400);
    }
    selected.push({ key, provider, model, pricing });
  }

  const usage = { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, totalTokens: input + output };
  const models = selected.map(({ key: modelKey, provider, model, pricing }) => {
    const cost = calculateCostFromPricing(pricing, usage);
    return {
      key: modelKey,
      provider,
      model,
      rates: {
        inputPerMillion: pricing.inputPerMillion,
        outputPerMillion: pricing.outputPerMillion,
        cacheReadPerMillion: pricing.cacheReadPerMillion ?? null,
        cacheWritePerMillion: pricing.cacheWritePerMillion ?? null,
      },
      costs: {
        input: cost.inputCost,
        output: cost.outputCost,
        cacheRead: cost.cacheReadCost ?? 0,
        cacheWrite: cost.cacheWriteCost ?? 0,
        total: cost.totalCost,
        currency: cost.currency,
      },
    };
  });

  models.sort((left, right) => (
    left.costs.total - right.costs.total
    || compareText(left.provider, right.provider)
    || compareText(left.model, right.model)
  ));

  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({
    schemaVersion: 2,
    snapshot: {
      date: PRICING_UPDATED_AT,
      liveQuote: false,
      sourceModalityEncoded: false,
      rateUnit: 'USD_PER_MILLION_TOKENS',
    },
    selection: {
      mode: 'text-token',
      basis: 'explicit-model-keys',
      recommendation: false,
    },
    usage: { input, output, cacheRead, cacheWrite },
    count: models.length,
    models,
    exclusions: [
      'Model modality is not encoded in the source snapshot; callers must verify that every selected model is token-billed.',
      'Estimates exclude tools, media, batch discounts, taxes, negotiated rates, and provider-specific billing rules.',
    ],
  });
});

function parseTokenCount(raw: string, field: string): number | string {
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    return `${field}:must be a non-negative base-10 integer`;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    return `${field}:must be a safe integer`;
  }
  return value;
}

function invalidTokenCount(c: Context<Env>, failure: string) {
  const separator = failure.indexOf(':');
  return invalidQuery(c, failure.slice(separator + 1), failure.slice(0, separator));
}

function invalidQuery(c: Context<Env>, message: string, field: string) {
  return c.json({ error: { code: 'INVALID_PRICING_QUERY', message, field } }, 400);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
