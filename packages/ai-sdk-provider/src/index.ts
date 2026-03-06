import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';

export interface LLMKitProviderConfig {
  apiKey: string;
  baseUrl?: string;
  sessionId?: string;
  budgetId?: string;
  provider?: 'anthropic' | 'openai' | 'gemini';
  providerKey?: string;
}

export function createLLMKit(config: LLMKitProviderConfig) {
  const baseUrl = (config.baseUrl || 'https://api.llmkit.dev').replace(/\/$/, '');

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

        return {
          content: [{ type: 'text' as const, text: raw.content as string }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: {
              total: usage?.inputTokens,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: usage?.outputTokens,
              text: undefined,
              reasoning: undefined,
            },
          },
          providerMetadata: cost ? {
            llmkit: cost as Record<string, undefined>,
          } : undefined,
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

        const upstream = res.body;
        let partId = 0;

        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async start(controller) {
            const reader = upstream.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let currentEvent = '';
            let textStarted = false;

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop()!;

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

                  try {
                    const data = JSON.parse(payload);

                    if (currentEvent === 'delta' && data.text !== undefined) {
                      const id = String(partId++);
                      if (!textStarted) {
                        controller.enqueue({ type: 'text-start', id });
                        textStarted = true;
                      }
                      controller.enqueue({ type: 'text-delta', id, delta: data.text });
                    }

                    if (currentEvent === 'done') {
                      if (textStarted) {
                        controller.enqueue({ type: 'text-end', id: String(partId++) });
                      }

                      const usage = data.usage as Record<string, number> | undefined;
                      controller.enqueue({
                        type: 'finish',
                        finishReason: { unified: 'stop', raw: 'stop' },
                        usage: {
                          inputTokens: {
                            total: usage?.inputTokens,
                            noCache: undefined,
                            cacheRead: undefined,
                            cacheWrite: undefined,
                          },
                          outputTokens: {
                            total: usage?.outputTokens,
                            text: undefined,
                            reasoning: undefined,
                          },
                        },
                        providerMetadata: data.cost ? {
                          llmkit: data.cost as Record<string, undefined>,
                        } : undefined,
                      });
                    }
                  } catch {
                    // partial json, skip
                  }
                }
              }
            } finally {
              reader.releaseLock();
              controller.close();
            }
          },
        });

        return { stream };
      },
    };
  }

  return { chat, languageModel: chat };
}

function buildHeaders(config: LLMKitProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'x-llmkit-format': 'llmkit',
  };
  if (config.sessionId) headers['x-llmkit-session-id'] = config.sessionId;
  if (config.provider) headers['x-llmkit-provider'] = config.provider;
  if (config.providerKey) headers['x-llmkit-provider-key'] = config.providerKey;
  return headers;
}

function flattenPrompt(prompt: LanguageModelV3Prompt): Array<{ role: string; content: string }> {
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
