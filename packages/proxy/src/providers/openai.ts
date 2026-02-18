import type { TokenUsage } from '@llmkit/shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

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

  async *chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
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
        buffer = lines.pop()!;

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

            if (parsed.usage) {
              usage = {
                inputTokens: parsed.usage.prompt_tokens,
                outputTokens: parsed.usage.completion_tokens,
                totalTokens: parsed.usage.total_tokens,
              };
            }
          } catch {
            // partial JSON from chunk boundary
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'end', usage: usage ?? undefined, id: messageId, model };
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
