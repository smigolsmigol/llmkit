import { type CostBreakdown, type ExtraCostDimension, inferProvider, type ProviderName, ValidationError } from '@f3d1/llmkit-shared';
import { Hono } from 'hono';
import { decrypt } from '../crypto';
import { findProviderKey } from '../db';
import type { Env, ResponseMeta } from '../env';
import { admitBudgetForDispatch } from '../middleware/budget';
import { resolveCost } from '../pricing';
import { getProviderBaseUrl } from '../providers';
import { providerRequestSignal } from '../providers/request';
import { readJsonResponseBounded, readProviderErrorDetail } from '../response-body';

const TOOL_OUTPUT_DIMENSIONS: Record<string, ExtraCostDimension> = {
  web_search_call: 'web_search',
  x_search_call: 'x_search',
  code_execution_call: 'code_execution',
  code_interpreter_call: 'code_interpreter',
  attachment_search_call: 'attachment_search',
  collections_search_call: 'collections_search',
  file_search_call: 'file_search',
};

function countToolInvocations(
  output?: Array<{ type: string; name?: string; id?: string }>,
): Array<{ dimension: ExtraCostDimension; quantity: number }> | undefined {
  if (!output?.length) return undefined;
  const counts = new Map<string, number>();
  for (const item of output) {
    const dimension = TOOL_OUTPUT_DIMENSIONS[item.type];
    if (dimension) counts.set(dimension, (counts.get(dimension) || 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].map(([dimension, quantity]) => ({ dimension: dimension as ExtraCostDimension, quantity }));
}

function parseProviderCost(rawUsage: Record<string, number> | undefined): number | undefined {
  const ticks = rawUsage?.cost_in_usd_ticks;
  return typeof ticks === 'number' && Number.isFinite(ticks) && ticks >= 0
    ? ticks / 10_000_000_000
    : undefined;
}

function wantsLLMKitFormat(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return c.req.header('x-llmkit-format') === 'llmkit';
}

function setCostHeaders(c: { header: (name: string, value: string) => void }, cost: CostBreakdown, provider: string, latency: number, providerCostUsd?: number) {
  c.header('x-llmkit-cost', String(cost.totalCost));
  c.header('x-llmkit-provider', provider);
  c.header('x-llmkit-latency-ms', String(latency));
  if (providerCostUsd != null) c.header('x-llmkit-provider-cost', String(providerCostUsd));
  if (cost.extraCosts?.length) c.header('x-llmkit-extra-costs', JSON.stringify(cost.extraCosts));
}

export const responsesRouter = new Hono<Env>();

responsesRouter.post('/responses', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }

  if (!body.model || typeof body.model !== 'string') throw new ValidationError('model is required');

  const model = body.model as string;
  const provider = (c.req.header('x-llmkit-provider') || body.provider || inferProvider(model) || 'openai') as ProviderName;

  let providerKey = c.req.header('x-llmkit-provider-key') || '';

  const userId = c.get('userId');
  if (!providerKey && userId && c.env.ENCRYPTION_KEY && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
    const stored = await findProviderKey(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, userId, provider);
    if (stored) {
      try {
        providerKey = await decrypt(stored.encrypted_key, stored.iv, c.env.ENCRYPTION_KEY, `${stored.user_id}:${stored.provider}`);
      } catch {
        throw new ValidationError('stored provider key could not be decrypted');
      }
    }
  }

  if (!providerKey) {
    throw new ValidationError(`no ${provider} API key found. add one in the dashboard Providers tab or pass x-llmkit-provider-key header.`);
  }

  const baseUrl = getProviderBaseUrl(provider);
  const start = Date.now();

  await admitBudgetForDispatch(c, body, [provider]);

  c.set('providerDispatchStarted', true);
  const res = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${providerKey}`,
    },
    body: JSON.stringify(body),
    signal: providerRequestSignal(),
  });

  if (!res.ok) {
    const detail = await readProviderErrorDetail(res);
    throw new Error(`${provider} returned ${res.status}: ${detail}`);
  }

  const data = await readJsonResponseBounded<Record<string, unknown>>(res);
  const latency = Date.now() - start;

  // extract usage - Responses API uses input_tokens/output_tokens (not prompt_tokens/completion_tokens)
  const rawUsage = data.usage as Record<string, number> | undefined;
  const usage = {
    inputTokens: rawUsage?.input_tokens ?? rawUsage?.prompt_tokens ?? 0,
    outputTokens: rawUsage?.output_tokens ?? rawUsage?.completion_tokens ?? 0,
    totalTokens: rawUsage?.total_tokens ?? 0,
  };

  // extract tool calls - Responses API uses output[] array (not choices[].message.tool_calls)
  const output = data.output as Array<{ type: string; name?: string; id?: string }> | undefined;
  const toolCalls = output
    ?.filter((o): o is { type: string; name: string; id: string } => o.type !== 'message' && !!o.name)
    .map(o => ({ id: o.id || '', name: o.name, arguments: '' }));
  const extraUsage = countToolInvocations(output);
  const providerCostUsd = parseProviderCost(rawUsage);

  // calculate cost including non-token dimensions
  const cost = await resolveCost(provider, model, usage, extraUsage);

  const meta: ResponseMeta = {
    provider,
    model: (data.model as string) || model,
    cost,
    usage,
    latency,
    toolCalls,
    providerCostUsd,
  };
  c.set('llmkit_response', meta);

  if (wantsLLMKitFormat(c)) {
    return c.json({
      ...data,
      provider,
      cost,
      latencyMs: latency,
      ...(extraUsage?.length && { extraUsage }),
    });
  }

  setCostHeaders(c, cost, provider, latency, providerCostUsd);
  return c.json(data);
});
