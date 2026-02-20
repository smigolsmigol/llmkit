import type { ProviderName } from '@llmkit/shared';

export interface ParsedUsage {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function parseOpenAIResponse(body: string): ParsedUsage | null {
  try {
    const data = JSON.parse(body);
    if (!data.usage) return null;
    return {
      provider: 'openai',
      model: data.model ?? 'unknown',
      inputTokens: data.usage.prompt_tokens ?? 0,
      outputTokens: data.usage.completion_tokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  } catch {
    return null;
  }
}

export function parseAnthropicResponse(body: string): ParsedUsage | null {
  try {
    const data = JSON.parse(body);
    if (!data.usage) return null;
    return {
      provider: 'anthropic',
      model: data.model ?? 'unknown',
      inputTokens: data.usage.input_tokens ?? 0,
      outputTokens: data.usage.output_tokens ?? 0,
      cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

// OpenAI streams: final chunk before [DONE] contains usage when
// stream_options.include_usage is true (Python SDK default since v1.3)
export function parseOpenAIStream(buffer: string): ParsedUsage | null {
  let model = 'unknown';
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;

  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === '[DONE]') continue;

    try {
      const chunk = JSON.parse(raw);
      if (chunk.model) model = chunk.model;
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
        found = true;
      }
    } catch {
      // partial JSON at chunk boundary
    }
  }

  return found ? { provider: 'openai', model, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } : null;
}

// Anthropic streams: message_start has input_tokens + cache tokens,
// message_delta has output_tokens
export function parseAnthropicStream(buffer: string): ParsedUsage | null {
  let model = 'unknown';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let found = false;

  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;

    try {
      const event = JSON.parse(raw);

      if (event.type === 'message_start' && event.message) {
        model = event.message.model ?? model;
        const usage = event.message.usage;
        if (usage) {
          inputTokens = usage.input_tokens ?? 0;
          cacheReadTokens = usage.cache_read_input_tokens ?? 0;
          cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
          found = true;
        }
      }

      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens ?? 0;
        found = true;
      }
    } catch {
      // partial JSON
    }
  }

  return found ? { provider: 'anthropic', model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } : null;
}
