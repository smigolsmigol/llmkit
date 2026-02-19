import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Context } from 'hono';
import {
  ProviderError,
  AllProvidersFailedError,
  ValidationError,
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
  validateBody(body);

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
    maxTokens: body.max_tokens ?? body.maxTokens,
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
      if (err instanceof ValidationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(new ProviderError(msg, providerName));
    }
  }

  throw new AllProvidersFailedError(errors);
}

async function handleStream(c: Context<Env>, req: ProviderRequest, chain: ProviderName[]) {
  const errors: ProviderError[] = [];

  for (const providerName of chain) {
    try {
      const adapter = getAdapter(providerName);
      const start = Date.now();
      const gen = adapter.chatStream(req);

      // warm up: force the generator past the fetch() call so connection errors
      // are caught HERE (in the fallback loop), not inside the stream callback
      // where they'd just break the stream with no fallback.
      const first = await gen.next();

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');

      return stream(c, async (s) => {
        let finalUsage: ProviderResponse['usage'] | undefined;
        let finalModel = req.model;
        let finalId = '';

        // process the first event we already fetched during warm-up
        if (!first.done) {
          const event = first.value;
          if (event.type === 'text' && event.text) {
            await s.write(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: event.text })}\n\n`));
          }
          if (event.type === 'end') {
            finalUsage = event.usage;
            finalModel = event.model || req.model;
            finalId = event.id || '';
          }
        }

        for await (const event of gen) {
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

        const latency = Date.now() - start;
        const cost = buildCost(providerName, {
          usage: finalUsage,
          model: finalModel,
          id: finalId,
          content: '',
          finishReason: '',
        });

        await s.write(encoder.encode(`event: done\ndata: ${JSON.stringify({
          id: finalId,
          model: finalModel,
          provider: providerName,
          usage: finalUsage,
          cost,
        })}\n\n`));

        // costLogger middleware can't handle streams: c.set() runs after middleware
        // already read c.get(). streams handle budget + logging here directly.
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId: c.req.header('x-llmkit-session-id'),
          apiKey: c.get('apiKey'),
          provider: providerName,
          model: finalModel,
          latencyMs: latency,
          usage: finalUsage,
          cost,
        }));

        const budgetId: string | undefined = c.get('budgetId');
        if (budgetId && cost.totalCost > 0) {
          const costCents = Math.ceil(cost.totalCost * 100);
          await recordUsage(c.env.BUDGET, budgetId, costCents);
        }

        const apiKeyId: string | undefined = c.get('apiKeyId');
        if (apiKeyId && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
          c.executionCtx.waitUntil(
            logRequest(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
              api_key_id: apiKeyId,
              session_id: c.req.header('x-llmkit-session-id') || null,
              provider: providerName,
              model: finalModel,
              input_tokens: finalUsage.inputTokens,
              output_tokens: finalUsage.outputTokens,
              cache_read_tokens: finalUsage.cacheReadTokens || 0,
              cache_write_tokens: finalUsage.cacheWriteTokens || 0,
              cost_cents: +(cost.totalCost * 100).toFixed(4),
              latency_ms: latency,
              status: 'success',
              error_code: null,
            })
          );
        }
      });
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(new ProviderError(msg, providerName));
    }
  }

  throw new AllProvidersFailedError(errors);
}

const VALID_ROLES = new Set(['system', 'user', 'assistant']);

function validateBody(body: Record<string, unknown>): void {
  if (!body.model || typeof body.model !== 'string') {
    throw new ValidationError('model is required and must be a string');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ValidationError('messages is required and must be a non-empty array');
  }

  for (const msg of body.messages) {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('each message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (typeof m.role !== 'string' || !VALID_ROLES.has(m.role)) {
      throw new ValidationError(`message role must be one of: ${[...VALID_ROLES].join(', ')}`);
    }
    if (typeof m.content !== 'string') {
      throw new ValidationError('message content must be a string');
    }
  }

  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2) {
      throw new ValidationError('temperature must be a number between 0 and 2');
    }
  }

  const maxTokens = body.max_tokens ?? body.maxTokens;
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== 'number' || maxTokens < 1 || !Number.isInteger(maxTokens)) {
      throw new ValidationError('max_tokens must be a positive integer');
    }
  }
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
  const cacheReadCost = (usage.cacheReadTokens && pricing.cacheReadPerMillion)
    ? (usage.cacheReadTokens / perM) * pricing.cacheReadPerMillion
    : 0;
  const cacheWriteCost = (usage.cacheWriteTokens && pricing.cacheWritePerMillion)
    ? (usage.cacheWriteTokens / perM) * pricing.cacheWritePerMillion
    : 0;

  return {
    inputCost: +inputCost.toFixed(8),
    outputCost: +outputCost.toFixed(8),
    cacheReadCost: cacheReadCost ? +cacheReadCost.toFixed(8) : undefined,
    cacheWriteCost: cacheWriteCost ? +cacheWriteCost.toFixed(8) : undefined,
    totalCost: +(inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(8),
    currency: 'USD',
  };
}
