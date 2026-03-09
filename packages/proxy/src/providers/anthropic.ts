import type { TokenUsage } from '@f3d1/llmkit-shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

type AnthropicContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
>;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  delta?: { type: string; text?: string; stop_reason?: string };
  usage?: AnthropicResponse['usage'];
  index?: number;
}

export class AnthropicAdapter implements ProviderAdapter {
  name = 'anthropic' as const;

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    const { system, messages } = splitSystem(req.messages);

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens || 4096,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    return parseResponse(data);
  }

  async *chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const { system, messages } = splitSystem(req.messages);

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens || 4096,
      stream: true,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }

    if (!res.body) throw new Error('No response body for stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | null = null;
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
            const event = JSON.parse(raw) as AnthropicStreamEvent;

            if (event.type === 'message_start' && event.message) {
              messageId = event.message.id;
              model = event.message.model;
              if (event.message.usage) {
                usage = mapUsage(event.message.usage);
              }
            }

            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield { type: 'text', text: event.delta.text };
            }

            if (event.type === 'message_delta' && event.usage) {
              if (usage) {
                usage.outputTokens = event.usage.output_tokens;
                usage.totalTokens = usage.inputTokens + usage.outputTokens;
              }
            }
          } catch {
            // partial JSON from chunk boundary, next chunk will complete it
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'end', usage: usage ?? undefined, id: messageId, model };
  }
}

function parseDataUri(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1]!, data: match[2]! };
}

function toAnthropicContent(content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>): AnthropicContent {
  if (typeof content === 'string') return content;

  return content.map((block) => {
    if (block.type === 'text') return { type: 'text' as const, text: block.text! };

    const url = block.image_url!.url;
    const parsed = parseDataUri(url);
    if (parsed) {
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: parsed.mimeType, data: parsed.data } };
    }
    return { type: 'image' as const, source: { type: 'url' as const, url } };
  });
}

function splitSystem(messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>) {
  let system: string | undefined;
  const filtered: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content as string;
    } else {
      filtered.push({ role: msg.role as 'user' | 'assistant', content: toAnthropicContent(msg.content) });
    }
  }

  return { system, messages: filtered };
}

function mapUsage(raw: AnthropicResponse['usage']): TokenUsage {
  const cacheRead = raw.cache_read_input_tokens || 0;
  const cacheWrite = raw.cache_creation_input_tokens || 0;

  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheReadTokens: cacheRead || undefined,
    cacheWriteTokens: cacheWrite || undefined,
    totalTokens: raw.input_tokens + raw.output_tokens,
  };
}

function parseResponse(data: AnthropicResponse): ProviderResponse {
  const content = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    id: data.id,
    content,
    model: data.model,
    usage: mapUsage(data.usage),
    finishReason: data.stop_reason,
  };
}
