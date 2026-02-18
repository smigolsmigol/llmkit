import type { TokenUsage } from '@llmkit/shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from './types';

const BASE_URL = 'https://api.openai.com/v1';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: OpenAIResponse['usage'];
}

export class OpenAIAdapter implements ProviderAdapter {
  name = 'openai' as const;

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: OpenAIMessage[] = req.messages.map((m) => ({
      role: m.role as OpenAIMessage['role'],
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return parseResponse(data);
  }

  async chatStream(req: ProviderRequest): Promise<ReadableStream> {
    const messages: OpenAIMessage[] = req.messages.map((m) => ({
      role: m.role as OpenAIMessage['role'],
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI ${res.status}: ${err}`);
    }

    if (!res.body) throw new Error('No response body for stream');

    const upstream = res.body;
    let usage: TokenUsage | null = null;
    let fullContent = '';
    let messageId = '';
    let model = req.model;

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);

        const text = new TextDecoder().decode(chunk);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;

          try {
            const chunk = JSON.parse(raw) as OpenAIStreamChunk;
            messageId = chunk.id;
            model = chunk.model;

            const delta = chunk.choices[0]?.delta?.content;
            if (delta) fullContent += delta;

            // usage comes in the final chunk when stream_options.include_usage is true
            if (chunk.usage) {
              usage = {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              };
            }
          } catch {
            // partial JSON
          }
        }
      },
    });

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

function parseResponse(data: OpenAIResponse): ProviderResponse {
  const choice = data.choices[0];
  return {
    id: data.id,
    content: choice?.message?.content || '',
    model: data.model,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
    finishReason: choice?.finish_reason || 'unknown',
  };
}
