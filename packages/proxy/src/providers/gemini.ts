import type { TokenUsage } from '@f3d1/llmkit-shared';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
}

interface GeminiCandidate {
  content: { role: string; parts: Array<{ text: string }> };
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
    if (Object.keys(genConfig).length) body.generationConfig = genConfig;

    const res = await fetch(`${BASE_URL}/${req.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err}`);
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
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err}`);
    }

    if (!res.body) throw new Error('No response body for stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | null = null;
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

    yield { type: 'end', usage: usage ?? undefined, id: responseId, model: modelVersion };
  }
}

function toGeminiFormat(messages: Array<{ role: string; content: string }>) {
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  return { systemInstruction, contents };
}

function mapUsage(raw: GeminiUsage): TokenUsage {
  return {
    inputTokens: raw.promptTokenCount,
    outputTokens: raw.candidatesTokenCount,
    totalTokens: raw.totalTokenCount,
    cacheReadTokens: raw.cachedContentTokenCount || undefined,
  };
}

function parseResponse(data: GeminiResponse, requestModel: string): ProviderResponse {
  const candidate = data.candidates[0];
  const text = candidate?.content?.parts
    ?.filter((p) => p.text)
    .map((p) => p.text)
    .join('') || '';

  return {
    id: data.responseId || '',
    content: text,
    model: data.modelVersion || requestModel,
    usage: mapUsage(data.usageMetadata),
    finishReason: candidate?.finishReason || 'STOP',
  };
}
