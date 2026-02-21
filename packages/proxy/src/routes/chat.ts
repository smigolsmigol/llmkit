import {
  AllProvidersFailedError,
  type CostBreakdown,
  getModelPricing,
  ProviderError,
  type ProviderName,
  ValidationError,
} from '@llmkit/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { decrypt } from '../crypto';
import { findProviderKey, logRequest } from '../db';
import type { Env, ResponseMeta } from '../env';
import { maybeSendAlert, recordUsage } from '../middleware/budget';
import type { ProviderRequest, ProviderResponse } from '../providers';
import { getAdapter } from '../providers';

const encoder = new TextEncoder();

function wantsLLMKitFormat(c: Context<Env>): boolean {
  return c.req.header('x-llmkit-format') === 'llmkit';
}

function setCostHeaders(c: Context<Env>, cost: CostBreakdown, provider: string, latencyMs: number) {
  c.header('x-llmkit-cost', String(cost.totalCost));
  c.header('x-llmkit-provider', provider);
  c.header('x-llmkit-latency-ms', String(latencyMs));
  const sid = c.req.header('x-llmkit-session-id');
  if (sid) c.header('x-llmkit-session-id', sid);
}

function toOpenAIFinishReason(reason: string): string {
  if (reason === 'end_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
  return reason || 'stop';
}

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

  let providerKey = c.req.header('x-llmkit-provider-key') || '';

  if (!providerKey && c.get('userId') && c.env.ENCRYPTION_KEY && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
    const stored = await findProviderKey(
      c.env.SUPABASE_URL, c.env.SUPABASE_KEY, c.get('userId')!, provider,
    );
    if (stored) {
      providerKey = await decrypt(stored.encrypted_key, stored.iv, c.env.ENCRYPTION_KEY, `${stored.user_id}:${stored.provider}`);
    }
  }

  const userMaxTokens = body.max_tokens ?? body.maxTokens;
  const budgetMaxTokens: number | undefined = c.get('budgetMaxTokens');
  const effectiveMaxTokens = budgetMaxTokens
    ? (userMaxTokens ? Math.min(userMaxTokens, budgetMaxTokens) : budgetMaxTokens)
    : userMaxTokens;

  const req: ProviderRequest = {
    model: body.model,
    messages: body.messages,
    temperature: body.temperature,
    maxTokens: effectiveMaxTokens,
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

      if (wantsLLMKitFormat(c)) {
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
      }

      setCostHeaders(c, cost, providerName, latency);
      return c.json({
        id: result.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: toOpenAIFinishReason(result.finishReason),
        }],
        usage: {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens,
        },
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

      const llmkitFmt = wantsLLMKitFormat(c);

      return stream(c, async (s) => {
        let finalUsage: ProviderResponse['usage'] | undefined;
        let finalModel = req.model;
        let finalId = '';
        const created = Math.floor(Date.now() / 1000);
        const streamId = `chatcmpl-${created}`;
        let sentRole = false;

        const writeText = async (text: string) => {
          if (llmkitFmt) {
            await s.write(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`));
            return;
          }
          // OpenAI format: send role announcement on first chunk
          if (!sentRole) {
            sentRole = true;
            await s.write(encoder.encode(`data: ${JSON.stringify({
              id: streamId, object: 'chat.completion.chunk', created, model: req.model,
              choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }],
            })}\n\n`));
          }
          await s.write(encoder.encode(`data: ${JSON.stringify({
            id: streamId, object: 'chat.completion.chunk', created, model: req.model,
            choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
          })}\n\n`));
        };

        // process the first event we already fetched during warm-up
        if (!first.done) {
          const event = first.value;
          if (event.type === 'text' && event.text) await writeText(event.text);
          if (event.type === 'end') {
            finalUsage = event.usage;
            finalModel = event.model || req.model;
            finalId = event.id || '';
          }
        }

        for await (const event of gen) {
          if (event.type === 'text' && event.text) await writeText(event.text);
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

        if (llmkitFmt) {
          await s.write(encoder.encode(`event: done\ndata: ${JSON.stringify({
            id: finalId,
            model: finalModel,
            provider: providerName,
            usage: finalUsage,
            cost,
          })}\n\n`));
        } else {
          // OpenAI format: finish chunk + usage chunk + [DONE]
          await s.write(encoder.encode(`data: ${JSON.stringify({
            id: streamId, object: 'chat.completion.chunk', created, model: finalModel,
            choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
          })}\n\n`));
          await s.write(encoder.encode(`data: ${JSON.stringify({
            id: streamId, object: 'chat.completion.chunk', created, model: finalModel,
            choices: [],
            usage: {
              prompt_tokens: finalUsage.inputTokens,
              completion_tokens: finalUsage.outputTokens,
              total_tokens: finalUsage.totalTokens,
            },
          })}\n\n`));
          await s.write(encoder.encode('data: [DONE]\n\n'));
        }

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

        const kvKey: string | undefined = c.get('budgetKvKey');
        if (kvKey && cost.totalCost > 0) {
          const costCents = Math.ceil(cost.totalCost * 100);
          const updated = await recordUsage(c.env.BUDGET, kvKey, costCents);
          if (updated) {
            c.executionCtx.waitUntil(maybeSendAlert(c.env.BUDGET, kvKey, updated));
          }
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
