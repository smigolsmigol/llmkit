import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import {
  ProviderError,
  AllProvidersFailedError,
  getModelPricing,
  type ProviderName,
  type CostBreakdown,
} from '@llmkit/shared';
import { getAdapter } from '../providers';
import type { ProviderRequest, ProviderResponse } from '../providers';

export const providerRouter = new Hono();

providerRouter.post('/chat/completions', async (c) => {
  const body = await c.req.json();
  const wantStream = body.stream === true;
  const provider = (c.req.header('x-llmkit-provider') || body.provider || 'anthropic') as ProviderName;

  // fallback chain from header or default to single provider
  const fallbackHeader = c.req.header('x-llmkit-fallback');
  const chain: ProviderName[] = fallbackHeader
    ? (fallbackHeader.split(',').map((s: string) => s.trim()) as ProviderName[])
    : [provider];

  // TODO: get provider API keys from encrypted storage
  // for now, expect them in headers (dev mode only)
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

async function handleChat(c: any, req: ProviderRequest, chain: ProviderName[]) {
  const errors: ProviderError[] = [];

  for (const providerName of chain) {
    try {
      const adapter = getAdapter(providerName);
      const start = Date.now();
      const result = await adapter.chat(req);
      const latency = Date.now() - start;

      const cost = buildCost(providerName, result);

      // stash metadata for the logger middleware
      c.set('llmkit_response', { ...result, provider: providerName, cost, latency });

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

async function handleStream(c: any, req: ProviderRequest, chain: ProviderName[]) {
  const errors: ProviderError[] = [];

  for (const providerName of chain) {
    try {
      const adapter = getAdapter(providerName);
      const readable = await adapter.chatStream(req);

      // pass the SSE stream through to the client
      return stream(c, async (s) => {
        const reader = readable.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await s.write(value);
          }
        } finally {
          reader.releaseLock();

          // grab usage metadata captured during streaming
          const meta = (readable as unknown as Record<string, any>).__llmkit;
          if (meta) {
            const { usage, model, id } = meta.getMetadata();
            if (usage) {
              const cost = buildCost(providerName, { usage, model, id, content: '', finishReason: '' });
              c.set('llmkit_response', { provider: providerName, cost, usage });
            }
          }
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
