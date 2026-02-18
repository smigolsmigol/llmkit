import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Context } from 'hono';
import {
  ProviderError,
  AllProvidersFailedError,
  getModelPricing,
  type ProviderName,
  type CostBreakdown,
} from '@llmkit/shared';
import type { Env, ResponseMeta } from '../env';
import { getAdapter } from '../providers';
import type { ProviderRequest, ProviderResponse } from '../providers';
import { recordUsage } from '../middleware/budget';
import { logRequest } from '../db';

const encoder = new TextEncoder();

export const providerRouter = new Hono<Env>();

providerRouter.post('/chat/completions', async (c) => {
  const body = await c.req.json();
  const wantStream = body.stream === true;
  const provider = (c.req.header('x-llmkit-provider') || body.provider || 'anthropic') as ProviderName;

  const fallbackHeader = c.req.header('x-llmkit-fallback');
  const chain: ProviderName[] = fallbackHeader
    ? (fallbackHeader.split(',').map((s: string) => s.trim()) as ProviderName[])
    : [provider];

  // TODO: get provider API keys from encrypted storage
  const providerKey = c.req.header('x-llmkit-provider-key') || '';

  const req: ProviderRequest = {
    model: body.model,
    messages: body.messages,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    apiKey: providerKey,
  };

  if (wantStream) {
    return handleStream(c, req, chain);
  }

  return handleChat(c, req, chain);
});

async function handleChat(c: Context<Env>, req: ProviderRequest, chain: ProviderName[]) {
  const errors: ProviderError[] = [];

  for (const providerName of chain) {
    try {
      const adapter = getAdapter(providerName);
      const start = Date.now();
      const result = await adapter.chat(req);
      const latency = Date.now() - start;

      const cost = buildCost(providerName, result);

      const meta: ResponseMeta = {
        provider: providerName,
        model: result.model,
        cost,
        usage: result.usage,
        latency,
      };
      c.set('llmkit_response', meta);

      return c.json({
        id: result.id,
        provider: providerName,
        model: result.model,
        content: result.content,
        usage: result.usage,
        cost,
        latencyMs: latency,
        cached: false,
        sessionId: c.req.header('x-llmkit-session-id') || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(new ProviderError(msg, providerName));
    }
  }

  throw new AllProvidersFailedError(errors);
}

async function handleStream(c: Context<Env>, req: ProviderRequest, chain: ProviderName[]) {
  const errors: ProviderError[] = [];
  const budgetId: string | undefined = c.get('budgetId');
  const apiKeyId: string | undefined = c.get('apiKeyId');
  const sessionId = c.req.header('x-llmkit-session-id');

  for (const providerName of chain) {
    try {
      const adapter = getAdapter(providerName);
      const events = adapter.chatStream(req);

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');

      return stream(c, async (s) => {
        let finalUsage: ProviderResponse['usage'] | undefined;
        let finalModel = req.model;
        let finalId = '';

        for await (const event of events) {
          if (event.type === 'text' && event.text) {
            await s.write(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: event.text })}\n\n`));
          }

          if (event.type === 'end') {
            finalUsage = event.usage;
            finalModel = event.model || req.model;
            finalId = event.id || '';
          }
        }

        if (!finalUsage) return;

        const cost = buildCost(providerName, {
          usage: finalUsage,
          model: finalModel,
          id: finalId,
          content: '',
          finishReason: '',
        });

        // emit final event with usage + cost so the SDK can read it
        await s.write(encoder.encode(`event: done\ndata: ${JSON.stringify({
          id: finalId,
          model: finalModel,
          provider: providerName,
          usage: finalUsage,
          cost,
        })}\n\n`));

        const meta: ResponseMeta = { provider: providerName, cost, usage: finalUsage, model: finalModel };
        c.set('llmkit_response', meta);

        // budget
        const costCents = Math.ceil(cost.totalCost * 100);
        if (budgetId) {
          await recordUsage(c.env.BUDGET, budgetId, costCents);
        }

        // request log
        if (apiKeyId && c.env.SUPABASE_URL) {
          c.executionCtx.waitUntil(logRequest(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
            api_key_id: apiKeyId,
            session_id: sessionId || null,
            provider: providerName,
            model: finalModel,
            input_tokens: finalUsage.inputTokens,
            output_tokens: finalUsage.outputTokens,
            cache_read_tokens: finalUsage.cacheReadTokens || 0,
            cache_write_tokens: finalUsage.cacheWriteTokens || 0,
            cost_cents: +(cost.totalCost * 100).toFixed(4),
            latency_ms: 0,
            status: 'success',
            error_code: null,
          }));
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(new ProviderError(msg, providerName));
    }
  }

  throw new AllProvidersFailedError(errors);
}

function buildCost(provider: ProviderName, result: ProviderResponse): CostBreakdown {
  const { usage } = result;
  const pricing = getModelPricing(provider, result.model);
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' };
  }

  const perM = 1_000_000;
  const inputCost = (usage.inputTokens / perM) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / perM) * pricing.outputPerMillion;
  let cacheReadCost = 0;
  let cacheWriteCost = 0;

  if (usage.cacheReadTokens && pricing.cacheReadPerMillion) {
    cacheReadCost = (usage.cacheReadTokens / perM) * pricing.cacheReadPerMillion;
  }
  if (usage.cacheWriteTokens && pricing.cacheWritePerMillion) {
    cacheWriteCost = (usage.cacheWriteTokens / perM) * pricing.cacheWritePerMillion;
  }

  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return {
    inputCost: +inputCost.toFixed(8),
    outputCost: +outputCost.toFixed(8),
    cacheReadCost: cacheReadCost ? +cacheReadCost.toFixed(8) : undefined,
    cacheWriteCost: cacheWriteCost ? +cacheWriteCost.toFixed(8) : undefined,
    totalCost: +totalCost.toFixed(8),
    currency: 'USD',
  };
}
