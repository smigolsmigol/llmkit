import type { ProviderName, TokenUsage } from '@f3d1/llmkit-shared';
import { readJsonResponseBounded, readProviderErrorDetail } from '../response-body';
import { providerFetch, providerRequestSignal } from './request';
import { readSseLines } from './sse-lines';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

interface OpenAIMessage {
  role: 'developer' | 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  cost_in_usd_ticks?: number;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  index?: number;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string; tool_calls?: OpenAIToolCall[] };
    finish_reason: string;
  }>;
  usage: OpenAIUsage;
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    delta: { role?: string; content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason: string | null;
  }>;
  usage?: OpenAIUsage;
}

function toOpenAIMessage(message: ProviderRequest['messages'][number]): OpenAIMessage {
  const source = message as unknown as Record<string, unknown>;
  const mapped: OpenAIMessage = {
    role: message.role as OpenAIMessage['role'],
    content: message.content as OpenAIMessage['content'],
  };
  if (typeof source.name === 'string') mapped.name = source.name;
  if (typeof source.tool_call_id === 'string') mapped.tool_call_id = source.tool_call_id;
  if (Array.isArray(source.tool_calls)) mapped.tool_calls = source.tool_calls as OpenAIToolCall[];
  return mapped;
}

// reusable for any provider that speaks the OpenAI chat completions protocol
export class OpenAIAdapter implements ProviderAdapter {
  name: ProviderName;
  private baseUrl: string;

  constructor(name: ProviderName = 'openai', baseUrl = 'https://api.openai.com/v1') {
    this.name = name;
    this.baseUrl = baseUrl;
  }

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    const messages = req.messages.map(toOpenAIMessage);

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) body.tools = req.tools;
    if (req.toolChoice !== undefined) body.tool_choice = req.toolChoice;
    if (req.responseFormat) body.response_format = req.responseFormat;
    if (req.extra) Object.assign(body, req.extra);

    const res = await providerFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: providerRequestSignal(),
    }, req.beforeDispatch);

    if (!res.ok) {
      const detail = await readProviderErrorDetail(res);
      console.error(`provider error (${this.name} ${res.status}): ${detail}`);
      throw new Error(`${this.name} returned ${res.status}`);
    }

    const data = await readJsonResponseBounded<OpenAIResponse>(res);
    return parseResponse(data);
  }

  async *chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const messages = req.messages.map(toOpenAIMessage);

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) body.tools = req.tools;
    if (req.toolChoice !== undefined) body.tool_choice = req.toolChoice;
    if (req.responseFormat) body.response_format = req.responseFormat;
    if (req.extra) Object.assign(body, req.extra);

    const res = await providerFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: providerRequestSignal(),
    }, req.beforeDispatch);

    if (!res.ok) {
      const detail = await readProviderErrorDetail(res);
      console.error(`provider error (${this.name} ${res.status}): ${detail}`);
      throw new Error(`${this.name} returned ${res.status}`);
    }

    if (!res.body) throw new Error('No response body for stream');

    let usage: TokenUsage | null = null;
    let providerCostUsd: number | undefined;
    let finishReason = 'stop';
    let messageId = '';
    let model = req.model;

    for await (const line of readSseLines(res.body)) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;

      try {
        const parsed = JSON.parse(raw) as OpenAIStreamChunk;
        messageId = parsed.id;
        model = parsed.model;

        const choice = parsed.choices[0];
        const delta = choice?.delta?.content;
        if (delta) {
          yield { type: 'text' as const, text: delta };
        }

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            yield {
              type: 'tool' as const,
              toolCallId: tc.id,
              toolName: tc.function?.name,
              toolArguments: tc.function?.arguments,
              toolIndex: tc.index,
            };
          }
        }

        const fr = choice?.finish_reason;
        if (fr) finishReason = fr;

        if (parsed.usage) {
          usage = parseUsage(parsed.usage);
          providerCostUsd = parseProviderCost(parsed.usage);
        }
      } catch {
        // Ignore malformed provider events.
      }
    }

    yield { type: 'end', usage: usage ?? undefined, finishReason, id: messageId, model, providerCostUsd };
  }
}

function parseUsage(u: OpenAIUsage): TokenUsage {
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    // OpenAI's prompt_tokens includes cached_tokens as a subset - subtract to avoid double-counting
    inputTokens: cached ? u.prompt_tokens - cached : u.prompt_tokens,
    outputTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
    cacheReadTokens: cached || undefined,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens || undefined,
  };
}

function parseProviderCost(u: OpenAIUsage): number | undefined {
  if (u.cost_in_usd_ticks == null) return undefined;
  return u.cost_in_usd_ticks / 10_000_000_000;
}

function parseResponse(data: OpenAIResponse): ProviderResponse {
  const choice = data.choices[0];
  const rawTools = choice?.message?.tool_calls;
  const toolCalls = rawTools?.map(t => ({
    id: t.id,
    name: t.function.name,
    arguments: t.function.arguments,
  }));

  return {
    id: data.id,
    content: choice?.message?.content || '',
    model: data.model,
    usage: parseUsage(data.usage),
    finishReason: choice?.finish_reason || 'unknown',
    providerCostUsd: parseProviderCost(data.usage),
    ...(toolCalls?.length && { toolCalls }),
  };
}
