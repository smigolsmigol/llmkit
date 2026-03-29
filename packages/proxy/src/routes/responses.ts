import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { inferProvider, ValidationError, type CostBreakdown, type ExtraCostDimension, type ProviderName } from '@f3d1/llmkit-shared';
import type { Env, ResponseMeta } from '../env';
import { findProviderKey } from '../db';
import { decrypt } from '../crypto';
import { trackRequest } from '../middleware/logger';
import { resolveCost } from '../pricing';
import { getProviderBaseUrl } from '../providers';
import type { ToolCall } from '../providers/types';

function countToolInvocations(toolCalls?: ToolCall[]): Array<{ dimension: ExtraCostDimension; quantity: number }> | undefined {
  if (!toolCalls?.length) return undefined;
  const counts = new Map<string, number>();
  for (const tc of toolCalls) {
    const dim = tc.name;
    if (['web_search', 'x_search', 'code_execution', 'file_attachment', 'rag_search'].includes(dim)) {
      counts.set(dim, (counts.get(dim) || 0) + 1);
    }
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].map(([dimension, quantity]) => ({ dimension: dimension as ExtraCostDimension, quantity }));
}

function wantsLLMKitFormat(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return c.req.header('x-llmkit-format') === 'llmkit';
}

function setCostHeaders(c: { header: (name: string, value: string) => void }, cost: CostBreakdown, provider: string, latency: number, providerCostUsd?: number) {
  c.header('x-llmkit-cost', String(cost.totalCost));
  c.header('x-llmkit-provider', provider);
  c.header('x-llmkit-latency-ms', String(latency));
  if (providerCostUsd) c.header('x-llmkit-provider-cost', String(providerCostUsd));
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

  if (!providerKey && c.get('userId') && c.env.ENCRYPTION_KEY && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
    const stored = await findProviderKey(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, c.get('userId')!, provider);
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

  const res = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${providerKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${provider} returned ${res.status}: ${detail}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const latency = Date.now() - start;

  // extract usage
  const rawUsage = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
  const usage = {
    inputTokens: rawUsage?.prompt_tokens ?? 0,
    outputTokens: rawUsage?.completion_tokens ?? 0,
    totalTokens: rawUsage?.total_tokens ?? 0,
  };

  // extract tool calls for cost tracking
  const choices = data.choices as Array<{ message?: { tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }> | undefined;
  const rawToolCalls = choices?.[0]?.message?.tool_calls;
  const toolCalls = rawToolCalls?.map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
  const extraUsage = countToolInvocations(toolCalls);

  // calculate cost including non-token dimensions
  const cost = await resolveCost(provider, model, usage, extraUsage);

  const meta: ResponseMeta = {
    provider,
    model: (data.model as string) || model,
    cost,
    usage,
    latency,
    toolCalls,
    providerCostUsd: undefined,
  };
  c.set('llmkit_response', meta);

  // log the request
  await trackRequest({
    sessionId: c.req.header('x-llmkit-session-id') || undefined,
    endUserId: c.req.header('x-llmkit-user-id') || undefined,
    toolCalls,
    providerCostUsd: undefined,
    apiKey: c.get('apiKey'),
    apiKeyId: c.get('apiKeyId'),
    userId: c.get('userId'),
    budgetId: c.get('budgetId'),
    budgetReservationId: c.get('budgetReservationId'),
    provider,
    model: (data.model as string) || model,
    usage,
    cost,
    latencyMs: latency,
    env: c.env,
    ctx: c.executionCtx,
  });

  if (wantsLLMKitFormat(c)) {
    return c.json({
      ...data,
      provider,
      cost,
      latencyMs: latency,
      ...(extraUsage?.length && { extraUsage }),
    });
  }

  setCostHeaders(c, cost, provider, latency);
  return c.json(data);
});
