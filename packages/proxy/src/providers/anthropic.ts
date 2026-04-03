import type { TokenUsage } from '@f3d1/llmkit-shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] }
  | { type: 'thinking'; thinking: string };

type AnthropicContent = string | AnthropicContentBlock[];

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: AnthropicUsage;
}

interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  content_block?: { type: string; id?: string; name?: string; thinking?: string };
  delta?: { type: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string };
  usage?: AnthropicUsage;
  index?: number;
  error?: { type: string; message: string };
}

function buildHeaders(apiKey: string, extra?: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  };
  const beta = extra?.['anthropic-beta'] ?? extra?.anthropicBeta;
  if (typeof beta === 'string') headers['anthropic-beta'] = beta;
  return headers;
}

export class AnthropicAdapter implements ProviderAdapter {
  name = 'anthropic' as const;

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    const { system, messages } = splitSystem(req.messages);
    const body = buildBody(req, system, messages, false);
    const controller = new AbortController();

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: buildHeaders(req.apiKey, req.extra),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`provider error (anthropic ${res.status}): ${detail}`);
      throw new Error(`anthropic returned ${res.status}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    return parseResponse(data);
  }

  async *chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const { system, messages } = splitSystem(req.messages);
    const body = buildBody(req, system, messages, true);
    const controller = new AbortController();

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: buildHeaders(req.apiKey, req.extra),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`provider error (anthropic ${res.status}): ${detail}`);
      throw new Error(`anthropic returned ${res.status}`);
    }

    if (!res.body) throw new Error('No response body for stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | null = null;
    let finishReason = 'stop';
    let messageId = '';
    let model = req.model;
    let reasoningTokens = 0;

    const toolAccum = new Map<number, { id: string; name: string; args: string }>();

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

            if (event.type === 'error') {
              const msg = event.error?.message ?? 'unknown stream error';
              console.error(`anthropic stream error: ${event.error?.type} - ${msg}`);
              throw new Error(`anthropic stream error: ${msg}`);
            }

            if (event.type === 'message_start' && event.message) {
              messageId = event.message.id;
              model = event.message.model;
              if (event.message.usage) usage = mapUsage(event.message.usage);
            }

            if (event.type === 'content_block_start') {
              const idx = event.index ?? 0;
              if (event.content_block?.type === 'tool_use') {
                toolAccum.set(idx, { id: event.content_block.id ?? `call_${idx}`, name: event.content_block.name ?? '', args: '' });
              }
              // thinking blocks: just track that they exist (content comes via deltas)
            }

            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta' && event.delta.text) {
                yield { type: 'text' as const, text: event.delta.text };
              }
              if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                const idx = event.index ?? 0;
                const entry = toolAccum.get(idx);
                if (entry) entry.args += event.delta.partial_json;
              }
              if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
                reasoningTokens++;
                // thinking content not forwarded to clients (internal reasoning)
              }
            }

            if (event.type === 'content_block_stop') {
              const idx = event.index ?? 0;
              const entry = toolAccum.get(idx);
              if (entry && entry.name) {
                yield { type: 'tool' as const, toolCallId: entry.id, toolName: entry.name, toolArguments: entry.args, toolIndex: idx };
              }
            }

            if (event.type === 'message_delta') {
              if (event.usage && usage) {
                usage.outputTokens = event.usage.output_tokens;
                usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
              }
              if (event.delta?.stop_reason) finishReason = event.delta.stop_reason;
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('anthropic stream error')) throw e;
            // partial JSON from chunk boundary
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (usage && reasoningTokens > 0) usage.reasoningTokens = reasoningTokens;

    yield { type: 'end', usage: usage ?? undefined, finishReason, id: messageId, model };
  }
}

const CACHE_MARKER = { cache_control: { type: 'ephemeral' } };
const MIN_CACHEABLE_LENGTH = 200;

function buildBody(req: ProviderRequest, system: AnthropicContent | undefined, messages: AnthropicMessage[], stream: boolean): Record<string, unknown> {
  const noCache = req.extra?.['x-llmkit-no-cache'] === true;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: noCache ? messages : injectCacheBreakpoints(messages),
    max_tokens: req.maxTokens || 4096,
  };
  if (stream) body.stream = true;
  if (system) body.system = noCache ? system : cacheSystem(system);
  if (req.temperature !== undefined) body.temperature = req.temperature;

  if (req.tools?.length) {
    body.tools = (req.tools as Array<{ function?: { name?: string; description?: string; parameters?: unknown } }>).map(t => ({
      name: t.function?.name,
      description: t.function?.description,
      input_schema: t.function?.parameters,
    }));
  }

  if (req.toolChoice) {
    const tc = req.toolChoice as { type?: string; function?: { name?: string } };
    if (tc.type === 'none') body.tool_choice = { type: 'none' };
    else if (tc.type === 'required' || tc.type === 'any') body.tool_choice = { type: 'any' };
    else if (tc.type === 'function' && tc.function?.name) body.tool_choice = { type: 'tool', name: tc.function.name };
    else body.tool_choice = { type: 'auto' };
  }

  if (req.extra) {
    const { 'anthropic-beta': _, anthropicBeta: _2, 'x-llmkit-no-cache': _3, ...rest } = req.extra;
    Object.assign(body, rest);
  }

  return body;
}

function cacheSystem(system: AnthropicContent | undefined): AnthropicContent | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') {
    if (system.length < MIN_CACHEABLE_LENGTH) return system;
    return [{ type: 'text', text: system, ...CACHE_MARKER }];
  }
  if (!Array.isArray(system) || system.length === 0) return system;
  const last = system[system.length - 1];
  if (last && typeof last === 'object' && !('cache_control' in last)) {
    return [...system.slice(0, -1), { ...last, ...CACHE_MARKER }];
  }
  return system;
}

function injectCacheBreakpoints(messages: AnthropicMessage[]): AnthropicMessage[] {
  if (messages.length < 2) return messages;

  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i]!;
    if (msg.role !== 'user') continue;

    const content = msg.content;
    if (typeof content === 'string') {
      if (content.length >= MIN_CACHEABLE_LENGTH) {
        result[i] = { role: 'user', content: [{ type: 'text', text: content, ...CACHE_MARKER }] };
      }
      break;
    }
    if (Array.isArray(content) && content.length > 0) {
      const last = content[content.length - 1];
      if (last && typeof last === 'object' && !('cache_control' in last)) {
        const patched = [...content.slice(0, -1), { ...last, ...CACHE_MARKER }];
        result[i] = { role: 'user', content: patched as AnthropicContent };
      }
      break;
    }
    break;
  }

  return result;
}

function parseDataUri(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1]!, data: match[2]! };
}

function toAnthropicContent(
  content: string | Array<{ type: string; text?: string; image_url?: { url: string }; document?: { url: string; media_type?: string } }>,
): AnthropicContent {
  if (typeof content === 'string') return content;

  return content.map((block): AnthropicContentBlock => {
    if (block.type === 'text') return { type: 'text', text: block.text! };

    if (block.type === 'document' && block.document) {
      const parsed = parseDataUri(block.document.url);
      if (parsed) return { type: 'document', source: { type: 'base64', media_type: parsed.mimeType, data: parsed.data } };
      return { type: 'document', source: { type: 'url', url: block.document.url } };
    }

    const url = block.image_url!.url;
    const parsed = parseDataUri(url);
    if (parsed) return { type: 'image', source: { type: 'base64', media_type: parsed.mimeType, data: parsed.data } };
    return { type: 'image', source: { type: 'url', url } };
  });
}

function convertAssistantToolCalls(
  msg: { content?: string | Array<{ type: string; text?: string }>; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> },
): AnthropicContent {
  const blocks: AnthropicContentBlock[] = [];

  if (msg.content) {
    if (typeof msg.content === 'string' && msg.content) {
      blocks.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text });
      }
    }
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let input: unknown;
      try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }

  return blocks;
}

interface RawMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string }; document?: { url: string; media_type?: string } }>;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

function splitSystem(messages: RawMessage[]) {
  const systemParts: string[] = [];
  const filtered: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      systemParts.push(typeof msg.content === 'string' ? msg.content : msg.content.map(b => b.text ?? '').join(''));
    } else if (msg.role === 'tool') {
      filtered.push({
        role: 'user',
        content: [{ type: 'tool_result' as unknown as 'text', tool_use_id: msg.tool_call_id ?? '', content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }] as unknown as AnthropicContent,
      });
    } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
      filtered.push({ role: 'assistant', content: convertAssistantToolCalls(msg) });
    } else {
      filtered.push({ role: msg.role as 'user' | 'assistant', content: toAnthropicContent(msg.content) });
    }
  }

  const system: AnthropicContent | undefined = systemParts.length > 1
    ? systemParts.join('\n\n')
    : systemParts[0] || undefined;

  return { system, messages: filtered };
}

function mapUsage(raw: AnthropicUsage): TokenUsage {
  const cacheRead = raw.cache_read_input_tokens || 0;
  const cacheWrite = raw.cache_creation_input_tokens || 0;

  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheReadTokens: cacheRead || undefined,
    cacheWriteTokens: cacheWrite || undefined,
    totalTokens: raw.input_tokens + raw.output_tokens + cacheRead + cacheWrite,
  };
}

function parseResponse(data: AnthropicResponse): ProviderResponse {
  const content = data.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const toolCalls = data.content
    .filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) }));

  const thinkingBlocks = data.content.filter((b) => b.type === 'thinking');
  const usage = mapUsage(data.usage);
  if (thinkingBlocks.length > 0) {
    const thinkingText = thinkingBlocks.map((b) => (b as { thinking: string }).thinking).join('');
    usage.reasoningTokens = Math.ceil(thinkingText.length / 4);
  }

  return {
    id: data.id,
    content,
    model: data.model,
    usage,
    finishReason: data.stop_reason,
    ...(toolCalls.length > 0 && { toolCalls }),
  };
}
