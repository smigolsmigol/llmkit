import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { pricingRouter } from '../src/routes/pricing';

let requestId = 0;

interface PricingModelResponse {
  key: string;
  rates: Record<string, number | null>;
  costs: Record<string, number | string>;
}

interface PricingResponse {
  schemaVersion: number;
  snapshot: Record<string, string | boolean>;
  selection: Record<string, string | boolean>;
  usage: Record<string, number>;
  models: PricingModelResponse[];
}

interface ErrorResponse {
  error: {
    code: string;
    field: string;
  };
}

const allowAllRateLimit = {
  idFromName: (name: string) => name,
  get: () => ({
    hit: async ({ limit }: { limit: number }) => ({
      allowed: true,
      count: 1,
      limit,
      remaining: limit - 1,
    }),
  }),
};

const bindings = {
  RATE_LIMIT_DO: allowAllRateLimit,
} as unknown as Env['Bindings'];

function request(query: string): Promise<Response> {
  requestId += 1;
  return pricingRouter.request(`https://api.llmkit.test/pricing/compare?${query}`, {
    headers: { 'cf-connecting-ip': `198.51.100.${requestId}` },
  }, bindings);
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

const VALID_QUERY = [
  'mode=text-token',
  'models=anthropic%2Fclaude-sonnet-4-6%2Copenai%2Fgpt-4o',
  'input=1000',
  'output=500',
  'cacheRead=0',
  'cacheWrite=0',
].join('&');

describe('GET /pricing/compare', () => {
  it('prices only explicit exact model keys and returns the snapshot boundary', async () => {
    const response = await request(VALID_QUERY);
    const body = await json<PricingResponse>(response);

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe(2);
    expect(body.snapshot).toMatchObject({
      date: '2026-03-25',
      liveQuote: false,
      sourceModalityEncoded: false,
      rateUnit: 'USD_PER_MILLION_TOKENS',
    });
    expect(body.selection).toEqual({
      mode: 'text-token',
      basis: 'explicit-model-keys',
      recommendation: false,
    });
    expect(body.usage).toEqual({ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 });
    expect(body.models).toHaveLength(2);
    expect(body.models.map((entry) => entry.key).sort()).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-4o',
    ]);
    for (const entry of body.models) {
      expect(entry.rates).toEqual(expect.objectContaining({
        inputPerMillion: expect.any(Number),
        outputPerMillion: expect.any(Number),
      }));
      expect(entry.costs).toEqual(expect.objectContaining({
        input: expect.any(Number),
        output: expect.any(Number),
        cacheRead: expect.any(Number),
        cacheWrite: expect.any(Number),
        total: expect.any(Number),
        currency: 'USD',
      }));
    }
  });

  it('preserves exact model names that contain slashes', async () => {
    const response = await request([
      'mode=text-token',
      'models=fireworks%2Faccounts%2Ffireworks%2Fmodels%2Fllama-v3p3-70b-instruct',
      'input=1',
      'output=0',
      'cacheRead=0',
      'cacheWrite=0',
    ].join('&'));
    const body = await json<PricingResponse>(response);

    expect(response.status).toBe(200);
    expect(body.models[0].key).toBe('fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct');
  });

  it('returns explicit cache-read and cache-write components', async () => {
    const response = await request([
      'mode=text-token',
      'models=anthropic%2Fclaude-sonnet-4-6',
      'input=0',
      'output=0',
      'cacheRead=200',
      'cacheWrite=100',
    ].join('&'));
    const body = await json<PricingResponse>(response);

    expect(response.status).toBe(200);
    expect(body.models[0]?.costs.cacheRead).toBeGreaterThan(0);
    expect(body.models[0]?.costs.cacheWrite).toBeGreaterThan(0);
    expect(body.models[0]?.costs.total).toBe(
      Number(body.models[0]?.costs.cacheRead) + Number(body.models[0]?.costs.cacheWrite),
    );
  });

  it('uses provider and model as deterministic tie-breakers', async () => {
    const response = await request([
      'mode=text-token',
      'models=anthropic%2Fclaude-opus-4-6%2Canthropic%2Fclaude-opus-4-5',
      'input=1',
      'output=0',
      'cacheRead=0',
      'cacheWrite=0',
    ].join('&'));
    const body = await json<PricingResponse>(response);

    expect(response.status).toBe(200);
    expect(body.models.map((entry) => entry.key)).toEqual([
      'anthropic/claude-opus-4-5',
      'anthropic/claude-opus-4-6',
    ]);
  });

  it.each([
    ['', 'mode'],
    [VALID_QUERY.replace('mode=text-token&', ''), 'mode'],
    [VALID_QUERY.replace('input=1000', 'input='), 'input'],
    [VALID_QUERY.replace('input=1000', 'input=-1'), 'input'],
    [VALID_QUERY.replace('input=1000', 'input=1.5'), 'input'],
    [VALID_QUERY.replace('input=1000', 'input=NaN'), 'input'],
    [VALID_QUERY.replace('input=1000', 'input=Infinity'), 'input'],
    [VALID_QUERY.replace('input=1000', 'input=null'), 'input'],
    [VALID_QUERY.replace('input=1000', 'input=9007199254740992'), 'input'],
    [VALID_QUERY.replace('mode=text-token', 'mode=image'), 'mode'],
    [`${VALID_QUERY}&input=1`, 'input'],
    [`${VALID_QUERY}&provider=anthropic`, 'provider'],
  ])('rejects invalid or ambiguous query %s', async (query, field) => {
    const response = await request(query);
    const body = await json<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_PRICING_QUERY');
    expect(body.error.field).toBe(field);
  });

  it('rejects a zero-work comparison', async () => {
    const query = VALID_QUERY
      .replace('input=1000', 'input=0')
      .replace('output=500', 'output=0');
    const response = await request(query);
    const body = await json<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: 'INVALID_PRICING_QUERY', field: 'usage' });
  });

  it('rejects duplicate and unknown exact model keys', async () => {
    const duplicate = await request(VALID_QUERY.replace(
      'anthropic%2Fclaude-sonnet-4-6%2Copenai%2Fgpt-4o',
      'openai%2Fgpt-4o%2Copenai%2Fgpt-4o',
    ));
    expect(duplicate.status).toBe(400);
    expect((await json<ErrorResponse>(duplicate)).error.code).toBe('INVALID_PRICING_QUERY');

    const unknown = await request(VALID_QUERY.replace('openai%2Fgpt-4o', 'openai%2Fmissing-model'));
    expect(unknown.status).toBe(400);
    expect((await json<ErrorResponse>(unknown)).error.code).toBe('UNKNOWN_PRICING_MODEL');
  });
});
