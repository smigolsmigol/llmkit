import type { ProviderName, TokenUsage } from '@f3d1/llmkit-shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  cost_in_usd_ticks?: number;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: OpenAIUsage;
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: OpenAIUsage;
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
    const messages: OpenAIMessage[] = req.messages.map((m) => ({
      role: m.role as OpenAIMessage['role'],
      content: m.content as OpenAIMessage['content'],
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`provider error (${this.name} ${res.status}): ${detail}`);
      throw new Error(`${this.name} returned ${res.status}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return parseResponse(data);
  }

  async *chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const messages: OpenAIMessage[] = req.messages.map((m) => ({
      role: m.role as OpenAIMessage['role'],
      content: m.content as OpenAIMessage['content'],
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`provider error (${this.name} ${res.status}): ${detail}`);
      throw new Error(`${this.name} returned ${res.status}`);
    }

    if (!res.body) throw new Error('No response body for stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | null = null;
    let providerCostUsd: number | undefined;
    let finishReason = 'stop';
    let messageId = '';
    let model = req.model;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          try {
            const parsed = JSON.parse(raw) as OpenAIStreamChunk;
            messageId = parsed.id;
            model = parsed.model;

            const delta = parsed.choices[0]?.delta?.content;
            if (delta) {
              yield { type: 'text', text: delta };
            }

            const fr = parsed.choices[0]?.finish_reason;
            if (fr) finishReason = fr;

            if (parsed.usage) {
              usage = parseUsage(parsed.usage);
              providerCostUsd = parseProviderCost(parsed.usage);
            }
          } catch {
            // partial JSON from chunk boundary
          }
        }
      }
    } finally {
      reader.releaseLock();
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
  const rawTools = (choice?.message as { tool_calls?: { function?: { name?: string } }[] })?.tool_calls;
  const toolCalls = rawTools?.map(t => ({ name: t.function?.name ?? 'unknown' }));

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
