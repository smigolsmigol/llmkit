import type {
  JSONObject,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolChoice,
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
      return { unified: 'stop', raw };
    case 'length':
    case 'max_tokens':
      return { unified: 'length', raw };
    case 'content_filter':
      return { unified: 'content-filter', raw };
    case 'tool_calls':
    case 'tool_use':
      return { unified: 'tool-calls', raw };
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

function convertTools(tools: LanguageModelV3CallOptions['tools']): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools
    .filter((t): t is LanguageModelV3FunctionTool => t.type === 'function')
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
}

function convertToolChoice(tc: LanguageModelV3ToolChoice | undefined): unknown {
  if (!tc) return undefined;
  switch (tc.type) {
    case 'auto': return 'auto';
    case 'none': return 'none';
    case 'required': return 'required';
    case 'tool': return { type: 'function', function: { name: tc.toolName } };
    default: return undefined;
  }
}

function convertResponseFormat(rf: LanguageModelV3CallOptions['responseFormat']): unknown {
  if (!rf || rf.type === 'text') return undefined;
  if (rf.type === 'json') {
    if (rf.schema) {
      return { type: 'json_schema', json_schema: { schema: rf.schema, strict: true, name: rf.name ?? 'response' } };
    }
    return { type: 'json_object' };
  }
  return undefined;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: string;
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
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
        const tools = convertTools(options.tools);
        const toolChoice = convertToolChoice(options.toolChoice);
        const responseFormat = convertResponseFormat(options.responseFormat);

        const body: Record<string, unknown> = {
          model: modelId,
          messages,
          max_tokens: options.maxOutputTokens,
          temperature: options.temperature,
        };
        if (options.topP !== undefined) body.top_p = options.topP;
        if (options.topK !== undefined) body.top_k = options.topK;
        if (options.frequencyPenalty !== undefined) body.frequency_penalty = options.frequencyPenalty;
        if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty;
        if (options.seed !== undefined) body.seed = options.seed;
        if (options.stopSequences?.length) body.stop = options.stopSequences;
        if (tools) body.tools = tools;
        if (toolChoice !== undefined) body.tool_choice = toolChoice;
        if (responseFormat) body.response_format = responseFormat;

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        });

        if (!res.ok) {
          const errBody = (await res.text()).slice(0, 500);
          throw new Error(`LLMKit ${res.status}: ${errBody}`);
        }

        const raw = await res.json() as Record<string, unknown>;

        // LLMKit format response
        const usage = raw.usage as Record<string, number> | undefined;
        const cost = raw.cost as Record<string, unknown> | undefined;
        const textContent = typeof raw.content === 'string' ? raw.content : '';
        const finishReason = raw.finishReason as string | undefined;
        const rawToolCalls = raw.toolCalls as Array<{ id: string; name: string; arguments: string }> | undefined;

        // also handle OpenAI format (when not using x-llmkit-format)
        const choices = raw.choices as Array<{ message: { content?: string; tool_calls?: OpenAIToolCall[] }; finish_reason?: string }> | undefined;
        const choice = choices?.[0];

        const content: LanguageModelV3Content[] = [];
        const text = textContent || choice?.message?.content || '';
        if (text) content.push({ type: 'text', text });

        const toolCalls = rawToolCalls ?? choice?.message?.tool_calls;
        if (toolCalls?.length) {
          for (const tc of toolCalls) {
            const asOpenAI = tc as { id: string; function?: { name: string; arguments: string }; name?: string; arguments?: string };
            content.push({
              type: 'tool-call',
              toolCallId: asOpenAI.id,
              toolName: asOpenAI.name ?? asOpenAI.function?.name ?? '',
              input: asOpenAI.arguments ?? asOpenAI.function?.arguments ?? '{}',
            });
          }
        }

        const fr = finishReason ?? choice?.finish_reason;

        return {
          content,
          finishReason: mapFinishReason(fr),
          usage: parseUsage(usage ?? raw.usage as Record<string, number> | undefined),
          providerMetadata: parseCostMetadata(cost),
          warnings: [],
        };
      },

      async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        const messages = flattenPrompt(options.prompt);
        const tools = convertTools(options.tools);
        const toolChoice = convertToolChoice(options.toolChoice);
        const responseFormat = convertResponseFormat(options.responseFormat);

        const body: Record<string, unknown> = {
          model: modelId,
          messages,
          max_tokens: options.maxOutputTokens,
          temperature: options.temperature,
          stream: true,
        };
        if (options.topP !== undefined) body.top_p = options.topP;
        if (options.topK !== undefined) body.top_k = options.topK;
        if (options.frequencyPenalty !== undefined) body.frequency_penalty = options.frequencyPenalty;
        if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty;
        if (options.seed !== undefined) body.seed = options.seed;
        if (options.stopSequences?.length) body.stop = options.stopSequences;
        if (tools) body.tools = tools;
        if (toolChoice !== undefined) body.tool_choice = toolChoice;
        if (responseFormat) body.response_format = responseFormat;

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          body: JSON.stringify(body),
          signal: options.abortSignal,
        });

        if (!res.ok) {
          const errBody = (await res.text()).slice(0, 500);
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

            controller.enqueue({ type: 'stream-start', warnings: [] });

            // tool call accumulation (OpenAI streams tool calls by index)
            const toolAccum = new Map<number, { id: string; name: string; args: string; started: boolean }>();

            let metadataEmitted = false;
            for await (const event of parts) {
              if (!metadataEmitted) {
                const id = event.data.id as string | undefined;
                const model = event.data.model as string | undefined;
                if (id || model) {
                  controller.enqueue({ type: 'response-metadata', id, modelId: model, timestamp: new Date() });
                  metadataEmitted = true;
                }
              }
              // LLMKit format: event.type === 'delta'
              if (event.type === 'delta' && event.data.text !== undefined) {
                if (!textBlockId) {
                  textBlockId = String(partCounter++);
                  controller.enqueue({ type: 'text-start', id: textBlockId });
                }
                controller.enqueue({ type: 'text-delta', id: textBlockId, delta: String(event.data.text) });
              }

              // OpenAI format: choices[0].delta
              const choices = event.data.choices as Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }> | undefined;
              const delta = choices?.[0]?.delta;

              if (delta?.content) {
                if (!textBlockId) {
                  textBlockId = String(partCounter++);
                  controller.enqueue({ type: 'text-start', id: textBlockId });
                }
                controller.enqueue({ type: 'text-delta', id: textBlockId, delta: delta.content });
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  let entry = toolAccum.get(tc.index);
                  if (!entry) {
                    entry = { id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? '', args: '', started: false };
                    toolAccum.set(tc.index, entry);
                  }
                  if (tc.id) entry.id = tc.id;
                  if (tc.function?.name) entry.name = tc.function.name;
                  if (tc.function?.arguments) entry.args += tc.function.arguments;

                  if (!entry.started && entry.name) {
                    entry.started = true;
                    controller.enqueue({ type: 'tool-input-start', id: entry.id, toolName: entry.name });
                  }
                  if (entry.started && tc.function?.arguments) {
                    controller.enqueue({ type: 'tool-input-delta', id: entry.id, delta: tc.function.arguments });
                  }
                }
              }

              if (event.type === 'done' || (choices?.[0]?.finish_reason && choices[0].finish_reason !== 'null')) {
                if (textBlockId) {
                  controller.enqueue({ type: 'text-end', id: textBlockId });
                  textBlockId = '';
                }

                // close all tool calls
                for (const [, entry] of toolAccum) {
                  if (entry.started) {
                    controller.enqueue({ type: 'tool-input-end', id: entry.id });
                    controller.enqueue({
                      type: 'tool-call',
                      toolCallId: entry.id,
                      toolName: entry.name,
                      input: entry.args || '{}',
                    });
                  }
                }

                const usage = event.data.usage as Record<string, number> | undefined;
                const cost = event.data.cost as Record<string, unknown> | undefined;
                const finishReason = (event.data.finishReason as string) ?? choices?.[0]?.finish_reason;
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
        if (!payload || payload === '[DONE]') continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(payload);
        } catch {
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

export function flattenPrompt(prompt: LanguageModelV3Prompt): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  for (const msg of prompt) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: msg.content });
      continue;
    }

    if (msg.role === 'user') {
      const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text });
        } else if (part.type === 'file' && typeof part.mediaType === 'string' && part.mediaType.startsWith('image/')) {
          if (part.data instanceof URL || (typeof part.data === 'string' && part.data.startsWith('http'))) {
            parts.push({ type: 'image_url', image_url: { url: String(part.data) } });
          } else if (typeof part.data === 'string') {
            parts.push({ type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } });
          }
        }
      }
      if (parts.length === 1 && parts[0]?.type === 'text') {
        out.push({ role: 'user', content: parts[0]?.text });
      } else {
        out.push({ role: 'user', content: parts });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts = msg.content.filter((p) => p.type === 'text');
      const toolCallParts = msg.content.filter((p) => p.type === 'tool-call');

      const m: OpenAIMessage = { role: 'assistant' };
      const text = textParts.map((p) => (p as { text: string }).text).join('');
      if (text) m.content = text;

      if (toolCallParts.length) {
        m.tool_calls = toolCallParts.map((p) => {
          const tc = p as { toolCallId: string; toolName: string; input: unknown };
          return {
            id: tc.toolCallId,
            type: 'function' as const,
            function: { name: tc.toolName, arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input) },
          };
        });
      }
      out.push(m);
      continue;
    }

    if (msg.role === 'tool') {
      for (const part of msg.content) {
        if ((part as { type: string }).type !== 'tool-result') continue;
        const tp = part as unknown as { toolCallId: string; output?: Array<{ type: string; value?: unknown; text?: string }> };
        let resultText = '';
        if (tp.output) {
          for (const o of tp.output) {
            if (o.type === 'text') resultText += o.value ?? o.text ?? '';
            else if (o.type === 'json') resultText += JSON.stringify(o.value);
            else if (o.type === 'error-text') resultText += o.value ?? '';
          }
        }
        out.push({ role: 'tool', tool_call_id: tp.toolCallId, content: resultText || '{}' });
      }
      continue;
    }
  }

  return out;
}
