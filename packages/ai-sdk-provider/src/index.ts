import type {
  JSONObject,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';

type ProviderName =
  | 'anthropic' | 'openai' | 'gemini' | 'groq' | 'together'
  | 'fireworks' | 'deepseek' | 'mistral' | 'xai' | 'ollama' | 'openrouter';

export interface LLMKitProviderConfig {
  apiKey: string;
  baseUrl?: string;
  sessionId?: string;
  userId?: string;
  provider?: ProviderName;
  providerKey?: string;
}

export function mapFinishReason(raw: string | undefined): LanguageModelV3FinishReason {
  switch (raw) {
    case 'stop':
    case 'end_turn':
      return { unified: 'stop', raw: raw };
    case 'length':
    case 'max_tokens':
      return { unified: 'length', raw: raw };
    case 'content_filter':
      return { unified: 'content-filter', raw: raw };
    case 'tool_calls':
    case 'tool_use':
      return { unified: 'tool-calls', raw: raw };
    default:
      return { unified: 'other', raw: raw ?? 'unknown' };
  }
}

export function parseUsage(usage: Record<string, number> | undefined) {
  return {
    inputTokens: {
      total: usage?.inputTokens ?? usage?.prompt_tokens,
      noCache: undefined,
      cacheRead: usage?.cacheReadTokens ?? usage?.cache_read_input_tokens,
      cacheWrite: usage?.cacheWriteTokens ?? usage?.cache_creation_input_tokens,
    },
    outputTokens: {
      total: usage?.outputTokens ?? usage?.completion_tokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}

function parseCostMetadata(cost: Record<string, unknown> | undefined): { llmkit: JSONObject } | undefined {
  if (!cost) return undefined;
  return { llmkit: cost as JSONObject };
}

export function createLLMKit(config: LLMKitProviderConfig) {
  const baseUrl = (config.baseUrl || 'https://llmkit-proxy.smigolsmigol.workers.dev').replace(/\/$/, '');

  function chat(modelId: string): LanguageModelV3 {
    return {
      specificationVersion: 'v3',
      provider: 'llmkit',
      modelId,
      supportedUrls: {},

      async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
        const messages = flattenPrompt(options.prompt);

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          body: JSON.stringify({
            model: modelId,
            messages,
            max_tokens: options.maxOutputTokens,
            temperature: options.temperature,
          }),
          signal: options.abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`LLMKit ${res.status}: ${errBody}`);
        }

        const raw = await res.json() as Record<string, unknown>;
        const usage = raw.usage as Record<string, number> | undefined;
        const cost = raw.cost as Record<string, unknown> | undefined;
        const content = typeof raw.content === 'string' ? raw.content : '';
        const finishReason = raw.finishReason as string | undefined;

        return {
          content: [{ type: 'text' as const, text: content }],
          finishReason: mapFinishReason(finishReason),
          usage: parseUsage(usage),
          providerMetadata: parseCostMetadata(cost),
          warnings: [],
        };
      },

      async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        const messages = flattenPrompt(options.prompt);

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          body: JSON.stringify({
            model: modelId,
            messages,
            max_tokens: options.maxOutputTokens,
            temperature: options.temperature,
            stream: true,
          }),
          signal: options.abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`LLMKit ${res.status}: ${errBody}`);
        }

        if (!res.body) throw new Error('No response body');

        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async start(controller) {
            const body = res.body;
            if (!body) { controller.close(); return; }
            const parts = parseSSEStream(body);
            let textBlockId = '';
            let partCounter = 0;

            for await (const event of parts) {
              if (event.type === 'delta' && event.data.text !== undefined) {
                if (!textBlockId) {
                  textBlockId = String(partCounter++);
                  controller.enqueue({ type: 'text-start', id: textBlockId });
                }
                controller.enqueue({ type: 'text-delta', id: textBlockId, delta: String(event.data.text) });
              }

              if (event.type === 'done') {
                if (textBlockId) {
                  controller.enqueue({ type: 'text-end', id: textBlockId });
                }
                const usage = event.data.usage as Record<string, number> | undefined;
                const cost = event.data.cost as Record<string, unknown> | undefined;
                const finishReason = event.data.finishReason as string | undefined;
                controller.enqueue({
                  type: 'finish',
                  finishReason: mapFinishReason(finishReason),
                  usage: parseUsage(usage),
                  providerMetadata: parseCostMetadata(cost),
                });
              }
            }

            controller.close();
          },
        });

        return { stream };
      },
    };
  }

  return { chat, languageModel: chat };
}

// SSE parser extracted from doStream to reduce complexity
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith('data: ')) {
          if (line === '') currentEvent = '';
          continue;
        }

        const payload = line.slice(6).trim();
        if (!payload) continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(payload);
        } catch {
          console.warn('llmkit: malformed SSE payload, skipping');
          continue;
        }

        yield { type: currentEvent, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function buildHeaders(config: LLMKitProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'x-llmkit-format': 'llmkit',
  };
  if (config.sessionId) headers['x-llmkit-session-id'] = config.sessionId;
  if (config.userId) headers['x-llmkit-user-id'] = config.userId;
  if (config.provider) headers['x-llmkit-provider'] = config.provider;
  if (config.providerKey) headers['x-llmkit-provider-key'] = config.providerKey;
  return headers;
}

export function flattenPrompt(prompt: LanguageModelV3Prompt): Array<{ role: string; content: string }> {
  return prompt.map((msg) => {
    if (msg.role === 'system') {
      return { role: 'system', content: msg.content };
    }

    if (msg.role === 'user') {
      const text = msg.content
        .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('');
      return { role: 'user', content: text };
    }

    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('');
      return { role: 'assistant', content: text };
    }

    return { role: 'tool', content: JSON.stringify(msg.content) };
  });
}
