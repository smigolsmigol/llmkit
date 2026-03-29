import type { TokenUsage } from '@f3d1/llmkit-shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
}

interface GeminiCandidate {
  content: { role: string; parts: Array<{ text?: string; functionCall?: { name: string; args: unknown } }> };
  finishReason?: string;
  index: number;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata: GeminiUsage;
  modelVersion: string;
  responseId?: string;
}

// only allow safe model names - blocks path traversal in URL interpolation
const MODEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function assertModelName(model: string): void {
  if (!MODEL_NAME_RE.test(model)) {
    throw new Error(`invalid model name: ${model}`);
  }
}

export class GeminiAdapter implements ProviderAdapter {
  name = 'gemini' as const;

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    assertModelName(req.model);
    const { systemInstruction, contents } = toGeminiFormat(req.messages);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.system_instruction = systemInstruction;

    const genConfig: Record<string, unknown> = {};
    if (req.maxTokens) genConfig.maxOutputTokens = req.maxTokens;
    if (req.temperature !== undefined) genConfig.temperature = req.temperature;
    if (req.responseFormat && (req.responseFormat as { type?: string }).type === 'json_object') {
      genConfig.responseMimeType = 'application/json';
    }
    if (Object.keys(genConfig).length) body.generationConfig = genConfig;

    if (req.tools?.length) {
      body.tools = [{ functionDeclarations: (req.tools as Array<{ function?: { name?: string; description?: string; parameters?: unknown } }>).map(t => ({
        name: t.function?.name,
        description: t.function?.description,
        parameters: t.function?.parameters,
      })) }];
    }
    if (req.extra) Object.assign(body, req.extra);

    const res = await fetch(`${BASE_URL}/${req.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`provider error (${this.name} ${res.status}): ${detail}`);
      throw new Error(`${this.name} returned ${res.status}`);
    }

    const data = (await res.json()) as GeminiResponse;
    return parseResponse(data, req.model);
  }

  async *chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    assertModelName(req.model);
    const { systemInstruction, contents } = toGeminiFormat(req.messages);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.system_instruction = systemInstruction;

    const genConfig: Record<string, unknown> = {};
    if (req.maxTokens) genConfig.maxOutputTokens = req.maxTokens;
    if (req.temperature !== undefined) genConfig.temperature = req.temperature;
    if (Object.keys(genConfig).length) body.generationConfig = genConfig;

    const res = await fetch(`${BASE_URL}/${req.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey,
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
    let finishReason = 'stop';
    let modelVersion = req.model;
    let responseId = '';

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
          if (!raw) continue;

          try {
            const chunk = JSON.parse(raw) as GeminiResponse;

            if (chunk.modelVersion) modelVersion = chunk.modelVersion;
            if (chunk.responseId) responseId = chunk.responseId;

            const candidate = chunk.candidates?.[0];
            if (candidate?.finishReason) finishReason = candidate.finishReason;
            const text = candidate?.content?.parts?.[0]?.text;
            if (text) {
              yield { type: 'text', text };
            }

            // full usage only on final chunk (has candidatesTokenCount)
            if (chunk.usageMetadata?.candidatesTokenCount) {
              usage = mapUsage(chunk.usageMetadata);
            }
          } catch {
            // partial json across chunk boundary
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'end', usage: usage ?? undefined, finishReason, id: responseId, model: modelVersion };
  }
}

function parseDataUri(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1]!, data: match[2]! };
}

function toGeminiParts(content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }];

  return content.map((block) => {
    if (block.type === 'text') return { text: block.text! };

    const url = block.image_url!.url;
    const parsed = parseDataUri(url);
    if (!parsed) throw new Error('gemini requires base64 data URIs for images, not URLs');
    return { inlineData: { mimeType: parsed.mimeType, data: parsed.data } };
  });
}

function toGeminiFormat(messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>) {
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content as string }] };
      continue;
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(msg.content),
    });
  }

  return { systemInstruction, contents };
}

function mapUsage(raw: GeminiUsage): TokenUsage {
  const cached = raw.cachedContentTokenCount || 0;
  return {
    // Gemini's promptTokenCount includes cachedContentTokenCount - subtract to avoid double-counting
    inputTokens: cached ? raw.promptTokenCount - cached : raw.promptTokenCount,
    outputTokens: raw.candidatesTokenCount,
    totalTokens: raw.totalTokenCount,
    cacheReadTokens: cached || undefined,
  };
}

function parseResponse(data: GeminiResponse, requestModel: string): ProviderResponse {
  const candidate = data.candidates?.[0];

  if (!candidate) {
    return {
      id: data.responseId || '',
      content: '',
      model: data.modelVersion || requestModel,
      usage: mapUsage(data.usageMetadata),
      finishReason: 'content_filter',
    };
  }

  const text = candidate.content?.parts
    ?.filter((p) => p.text)
    .map((p) => p.text)
    .join('') || '';

  const toolCalls = candidate.content?.parts
    ?.filter((p): p is { functionCall: { name: string; args: unknown } } => !!p.functionCall)
    .map((p, i) => ({
      id: `call_${i}`,
      name: p.functionCall.name,
      arguments: JSON.stringify(p.functionCall.args),
    }));

  return {
    id: data.responseId || '',
    content: text,
    model: data.modelVersion || requestModel,
    usage: mapUsage(data.usageMetadata),
    finishReason: candidate.finishReason || 'stop',
    ...(toolCalls?.length && { toolCalls }),
  };
}
