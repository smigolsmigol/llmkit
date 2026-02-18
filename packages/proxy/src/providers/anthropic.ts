import type { TokenUsage } from '@llmkit/shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from './types';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
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

  async chatStream(req: ProviderRequest): Promise<ReadableStream> {
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

    // pass through the SSE stream and intercept the final message_delta for usage
    const upstream = res.body;
    let usage: TokenUsage | null = null;
    let fullContent = '';
    let messageId = '';
    let model = req.model;

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);

        // parse SSE events from chunk to capture usage
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;

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
              fullContent += event.delta.text;
            }

            if (event.type === 'message_delta' && event.usage) {
              // final usage from anthropic includes output tokens
              const finalUsage = event.usage;
              if (usage) {
                usage.outputTokens = finalUsage.output_tokens;
                usage.totalTokens = usage.inputTokens + usage.outputTokens;
              }
            }
          } catch {
            // partial JSON, skip
          }
        }
      },
    });

    // attach metadata to the stream so the logger can read it after
    const readable = upstream.pipeThrough(transform);
    (readable as unknown as Record<string, unknown>).__llmkit = {
      getMetadata: () => ({
        id: messageId,
        content: fullContent,
        model,
        usage,
      }),
    };

    return readable;
  }
}

function splitSystem(messages: Array<{ role: string; content: string }>) {
  let system: string | undefined;
  const filtered: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      filtered.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
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
