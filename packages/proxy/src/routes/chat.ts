import {
  AllProvidersFailedError,
  type CostBreakdown,
  inferProvider,
  ProviderError,
  type ProviderName,
  type TokenUsage,
  ValidationError,
} from '@f3d1/llmkit-shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { StreamingApi } from 'hono/utils/stream';
import { decrypt } from '../crypto';
import { findProviderKey } from '../db';
import type { Env, ResponseMeta } from '../env';
import { trackRequest } from '../middleware/logger';
import { resolveCost } from '../pricing';
import type { ProviderRequest, ProviderResponse } from '../providers';
import { getAdapter } from '../providers';

const encoder = new TextEncoder();

function wantsLLMKitFormat(c: Context<Env>): boolean {
  return c.req.header('x-llmkit-format') === 'llmkit';
}

function setCostHeaders(c: Context<Env>, cost: CostBreakdown, provider: string, latencyMs: number, providerCostUsd?: number) {
  c.header('x-llmkit-cost', String(cost.totalCost));
  c.header('x-llmkit-provider', provider);
  c.header('x-llmkit-latency-ms', String(latencyMs));
  if (providerCostUsd != null) c.header('x-llmkit-provider-cost', String(providerCostUsd));
  const sid = c.req.header('x-llmkit-session-id');
  if (sid) c.header('x-llmkit-session-id', sid);
  const uid = c.req.header('x-llmkit-user-id');
  if (uid) c.header('x-llmkit-user-id', uid);
}

function toOpenAIFinishReason(reason: string): string {
  if (reason === 'end_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
  return reason || 'stop';
}

export const providerRouter = new Hono<Env>();

providerRouter.post('/chat/completions', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  validateBody(body);

  const wantStream = body.stream === true;
  const model = body.model as string;
  const provider = (c.req.header('x-llmkit-provider') || body.provider || inferProvider(model) || 'openai') as ProviderName;

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
      try {
        providerKey = await decrypt(stored.encrypted_key, stored.iv, c.env.ENCRYPTION_KEY, `${stored.user_id}:${stored.provider}`);
      } catch {
        throw new ValidationError('stored provider key could not be decrypted, please re-add it in the dashboard');
      }
    }
  }

  const userMaxTokens = body.max_tokens ?? body.maxTokens;
  const budgetMaxTokens: number | undefined = c.get('budgetMaxTokens');
  const effectiveMaxTokens = budgetMaxTokens
    ? (userMaxTokens ? Math.min(userMaxTokens as number, budgetMaxTokens) : budgetMaxTokens)
    : userMaxTokens as number | undefined;

  const req: ProviderRequest = {
    model: body.model as string,
    messages: body.messages as ProviderRequest['messages'],
    temperature: body.temperature as number | undefined,
    maxTokens: effectiveMaxTokens,
    apiKey: providerKey,
  };

  if (wantStream) {
    return handleStream(c, req, chain);
  }

  return handleChat(c, req, chain);
});

async function releaseReservation(c: Context<Env>): Promise<void> {
  const budgetId = c.get('budgetId');
  const reservationId = c.get('budgetReservationId');
  if (!budgetId || !reservationId) return;
  const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(budgetId));
  await stub.release(reservationId);
}

async function handleChat(c: Context<Env>, req: ProviderRequest, chain: ProviderName[]) {
  const errors: ProviderError[] = [];

  for (const providerName of chain) {
    try {
      const adapter = getAdapter(providerName);
      const start = Date.now();
      const result = await adapter.chat(req);
      const latency = Date.now() - start;

      const cost = await resolveCost(providerName, result.model, result.usage);

      const meta: ResponseMeta = {
        provider: providerName,
        model: result.model,
        cost,
        usage: result.usage,
        latency,
        toolCalls: result.toolCalls,
        providerCostUsd: result.providerCostUsd,
      };
      c.set('llmkit_response', meta);

      if (wantsLLMKitFormat(c)) {
        return c.json({
          id: result.id,
          provider: providerName,
          model: result.model,
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
          cost,
          latencyMs: latency,
          cached: false,
          sessionId: c.req.header('x-llmkit-session-id') || undefined,
          endUserId: c.req.header('x-llmkit-user-id') || undefined,
        });
      }

      setCostHeaders(c, cost, providerName, latency, result.providerCostUsd);
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

  await releaseReservation(c);
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
      const first = await gen.next();

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');

      const llmkitFmt = wantsLLMKitFormat(c);

      return stream(c, async (s) => {
        const usage = await consumeStream(s, gen, first, req.model, llmkitFmt);
        if (!usage) return;

        const latency = Date.now() - start;
        const cost = await resolveCost(providerName, usage.model, usage.tokens);

        await writeStreamFinale(s, llmkitFmt, {
          id: usage.id,
          model: usage.model,
          provider: providerName,
          tokens: usage.tokens,
          cost,
          finishReason: usage.finishReason,
          created: usage.created,
          streamId: usage.streamId,
        });

        await trackRequest({
          sessionId: c.req.header('x-llmkit-session-id') || undefined,
          endUserId: c.req.header('x-llmkit-user-id') || undefined,
          toolCalls: undefined,
          providerCostUsd: usage.providerCostUsd,
          apiKey: c.get('apiKey'),
          apiKeyId: c.get('apiKeyId'),
          userId: c.get('userId'),
          budgetId: c.get('budgetId'),
          budgetReservationId: c.get('budgetReservationId'),
          provider: providerName,
          model: usage.model,
          usage: usage.tokens,
          cost,
          latencyMs: latency,
          env: c.env,
          ctx: c.executionCtx,
        });
      });
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(new ProviderError(msg, providerName));
    }
  }

  await releaseReservation(c);
  throw new AllProvidersFailedError(errors);
}

interface StreamResult {
  tokens: ProviderResponse['usage'];
  finishReason: string;
  toolCallCount: number;
  providerCostUsd?: number;
  model: string;
  id: string;
  created: number;
  streamId: string;
}

async function consumeStream(
  s: StreamingApi,
  gen: AsyncGenerator<{ type: string; text?: string; usage?: ProviderResponse['usage']; finishReason?: string; model?: string; id?: string; providerCostUsd?: number }>,
  first: IteratorResult<{ type: string; text?: string; usage?: ProviderResponse['usage']; finishReason?: string; model?: string; id?: string; providerCostUsd?: number }>,
  requestModel: string,
  llmkitFmt: boolean,
): Promise<StreamResult | null> {
  let finalUsage: ProviderResponse['usage'] | undefined;
  let finalFinishReason = 'stop';
  let finalModel = requestModel;
  let finalId = '';
  let finalProviderCostUsd: number | undefined;
  const created = Math.floor(Date.now() / 1000);
  const streamId = `chatcmpl-${created}`;
  let sentRole = false;

  const writeText = async (text: string) => {
    if (llmkitFmt) {
      await s.write(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`));
      return;
    }
    if (!sentRole) {
      sentRole = true;
      await s.write(encoder.encode(`data: ${JSON.stringify({
        id: streamId, object: 'chat.completion.chunk', created, model: requestModel,
        choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }],
      })}\n\n`));
    }
    await s.write(encoder.encode(`data: ${JSON.stringify({
      id: streamId, object: 'chat.completion.chunk', created, model: requestModel,
      choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
    })}\n\n`));
  };

  let toolCallCount = 0;

  const processEvent = async (event: { type: string; text?: string; toolName?: string; usage?: ProviderResponse['usage']; finishReason?: string; model?: string; id?: string; providerCostUsd?: number }) => {
    if (event.type === 'text' && event.text) await writeText(event.text);
    if (event.type === 'tool') toolCallCount++;
    if (event.type === 'end') {
      finalUsage = event.usage;
      finalFinishReason = event.finishReason || 'stop';
      finalModel = event.model || requestModel;
      finalId = event.id || '';
      finalProviderCostUsd = event.providerCostUsd;
    }
  };

  if (!first.done) await processEvent(first.value);
  for await (const event of gen) await processEvent(event);

  if (!finalUsage) return null;
  return { tokens: finalUsage, finishReason: finalFinishReason, toolCallCount, providerCostUsd: finalProviderCostUsd, model: finalModel, id: finalId, created, streamId };
}

async function writeStreamFinale(
  s: StreamingApi,
  llmkitFmt: boolean,
  p: { id: string; model: string; provider: ProviderName; tokens: TokenUsage; cost: CostBreakdown; finishReason: string; created: number; streamId: string },
): Promise<void> {
  if (llmkitFmt) {
    await s.write(encoder.encode(`event: done\ndata: ${JSON.stringify({
      id: p.id, model: p.model, provider: p.provider, finishReason: p.finishReason, usage: p.tokens, cost: p.cost,
    })}\n\n`));
    return;
  }

  await s.write(encoder.encode(`data: ${JSON.stringify({
    id: p.streamId, object: 'chat.completion.chunk', created: p.created, model: p.model,
    choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
  })}\n\n`));
  await s.write(encoder.encode(`data: ${JSON.stringify({
    id: p.streamId, object: 'chat.completion.chunk', created: p.created, model: p.model,
    choices: [],
    usage: {
      prompt_tokens: p.tokens.inputTokens,
      completion_tokens: p.tokens.outputTokens,
      total_tokens: p.tokens.totalTokens,
    },
  })}\n\n`));
  await s.write(encoder.encode('data: [DONE]\n\n'));
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
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content)) {
      throw new ValidationError('message content must be a string or array of content blocks');
    }
    if (m.role === 'system') {
      throw new ValidationError('system messages must have string content');
    }
    for (const block of m.content as Array<Record<string, unknown>>) {
      if (!block || typeof block !== 'object') {
        throw new ValidationError('each content block must be an object');
      }
      if (block.type === 'text') {
        if (typeof block.text !== 'string') {
          throw new ValidationError('text block must have a text string');
        }
      } else if (block.type === 'image_url') {
        const img = block.image_url as Record<string, unknown> | undefined;
        if (!img || typeof img.url !== 'string') {
          throw new ValidationError('image_url block must have a url string');
        }
      } else {
        throw new ValidationError(`unknown content block type: ${String(block.type)}`);
      }
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
