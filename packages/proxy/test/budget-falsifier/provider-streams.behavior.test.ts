import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from '../../src/providers/anthropic';
import { GeminiAdapter } from '../../src/providers/gemini';
import { OpenAIAdapter } from '../../src/providers/openai';
import {
  MAX_PROVIDER_STREAM_FRAME_BYTES,
  readSseLines,
} from '../../src/providers/sse-lines';
import type { ProviderAdapter, ProviderRequest } from '../../src/providers/types';

const encoder = new TextEncoder();
const request: ProviderRequest = {
  model: 'fixture-model',
  messages: [{ role: 'user', content: 'hello' }],
  apiKey: 'fixture-provider-key',
};

async function consume(adapter: ProviderAdapter): Promise<void> {
  for await (const event of adapter.chatStream(request)) void event;
}

async function capturedJsonRequest(
  responseBody: unknown,
  run: () => Promise<unknown>,
): Promise<{ url: string; headers: Headers; body: Record<string, unknown> }> {
  let captured: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    captured = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return Response.json(responseBody);
  });
  await run();
  if (!captured) throw new Error('provider request was not dispatched');
  return captured;
}

describe('bounded provider SSE frames', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Anthropic', () => new AnthropicAdapter(), [{ type: 'text' }], 'anthropic text blocks require text'],
    ['Anthropic', () => new AnthropicAdapter(), [{ type: 'image_url' }], 'anthropic image blocks require image_url.url'],
    ['Gemini', () => new GeminiAdapter(), [{ type: 'text' }], 'gemini text blocks require text'],
    ['Gemini', () => new GeminiAdapter(), [{ type: 'image_url' }], 'gemini image blocks require image_url.url'],
  ])('rejects malformed %s content before provider dispatch', async (_name, createAdapter, content, expected) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected provider dispatch'));
    const malformedRequest = {
      ...request,
      messages: [{ role: 'user', content }],
    } as unknown as ProviderRequest;

    await expect(createAdapter().chat(malformedRequest)).rejects.toThrow(expected);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reassembles a legitimate UTF-8 line across chunks and strips CRLF', async () => {
    const encoded = encoder.encode('data: {"text":"caffè"}\r\ndata: done\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, encoded.length - 4));
        controller.enqueue(encoded.subarray(encoded.length - 4));
        controller.close();
      },
    });

    const lines: string[] = [];
    for await (const line of readSseLines(body, 64)) lines.push(line);

    expect(lines).toEqual(['data: {"text":"caffè"}', 'data: done', '']);
  });

  it('cancels upstream when the consumer stops before the stream ends', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('data: first\n'));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    for await (const line of readSseLines(body, 64)) {
      expect(line).toBe('data: first');
      break;
    }

    expect(cancelled).toBe(true);
  });

  it('rejects an invalid frame bound before reading upstream', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled = true;
      },
    }, { highWaterMark: 0 });

    await expect(readSseLines(body, -1).next()).rejects.toThrow(RangeError);
    expect(pulled).toBe(false);
  });

  it.each([
    ['OpenAI', () => new OpenAIAdapter()],
    ['Anthropic', () => new AnthropicAdapter()],
    ['Gemini', () => new GeminiAdapter()],
  ])('cancels an oversized unterminated %s frame', async (_name, createAdapter) => {
    let cancelled = false;
    let pulled = false;
    const frame = new Uint8Array(MAX_PROVIDER_STREAM_FRAME_BYTES + 1);
    frame.fill(0x61);
    frame.set(encoder.encode('data: '));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled) return;
        pulled = true;
        controller.enqueue(frame);
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    await expect(consume(createAdapter())).rejects.toMatchObject({
      name: 'ProviderStreamFrameTooLargeError',
      maxBytes: MAX_PROVIDER_STREAM_FRAME_BYTES,
    });
    expect(cancelled).toBe(true);
  });

  it('maps OpenAI multimodal, function calling, JSON, and usage contracts through production', async () => {
    const adapter = new OpenAIAdapter();
    let providerResponse: Awaited<ReturnType<typeof adapter.chat>> | undefined;
    const priorToolCalls = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'lookup', arguments: '{"q":"llmkit"}' },
    }];
    const providerRequest = {
      model: 'gpt-4.1',
      apiKey: 'openai-secret',
      maxTokens: 256,
      temperature: 0,
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: true, schema: { type: 'object' } },
      },
      messages: [
        { role: 'developer', content: 'Answer with the schema.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect this image' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'low' } },
          ],
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: priorToolCalls,
        },
        { role: 'tool', tool_call_id: 'call-1', name: 'lookup', content: 'found' },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      toolChoice: { type: 'function', function: { name: 'lookup' } },
      extra: { seed: 7 },
    } as unknown as ProviderRequest;

    const captured = await capturedJsonRequest({
      id: 'chatcmpl-1',
      model: 'gpt-4.1-2026-08-01',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '{"answer":"done"}',
          tool_calls: [{
            id: 'call-2',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"done"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 30 },
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    }, async () => {
      providerResponse = await adapter.chat(providerRequest);
    });

    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(captured.headers.get('authorization')).toBe('Bearer openai-secret');
    expect(captured.body).toMatchObject({
      model: 'gpt-4.1',
      max_tokens: 256,
      temperature: 0,
      response_format: providerRequest.responseFormat,
      tool_choice: providerRequest.toolChoice,
      tools: providerRequest.tools,
      seed: 7,
      messages: [
        { role: 'developer', content: 'Answer with the schema.' },
        { role: 'user', content: providerRequest.messages[1]?.content },
        { role: 'assistant', content: null, tool_calls: priorToolCalls },
        { role: 'tool', content: 'found', tool_call_id: 'call-1', name: 'lookup' },
      ],
    });
    expect(providerResponse).toMatchObject({
      id: 'chatcmpl-1',
      content: '{"answer":"done"}',
      model: 'gpt-4.1-2026-08-01',
      finishReason: 'tool_calls',
      usage: {
        inputTokens: 70,
        outputTokens: 20,
        totalTokens: 120,
        cacheReadTokens: 30,
        reasoningTokens: 5,
      },
      toolCalls: [{ id: 'call-2', name: 'lookup', arguments: '{"q":"done"}' }],
    });
  });

  it('maps a full Anthropic request and response through the production adapter', async () => {
    const adapter = new AnthropicAdapter();
    let providerResponse: Awaited<ReturnType<typeof adapter.chat>> | undefined;
    const longSystem = 'system '.repeat(40);
    const longUser = 'user '.repeat(50);
    const providerRequest = {
      model: 'claude-sonnet-4-6',
      apiKey: 'anthropic-secret',
      maxTokens: 512,
      temperature: 0.2,
      messages: [
        { role: 'system', content: longSystem },
        { role: 'developer', content: 'developer policy' },
        { role: 'user', content: longUser },
        {
          role: 'assistant',
          content: 'checking',
          tool_calls: [{ id: 'call-1', function: { name: 'lookup', arguments: '{"q":"llmkit"}' } }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'found' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
            { type: 'document', document: { url: 'https://files.example/document.pdf' } },
          ],
        },
      ],
      tools: [{ function: { name: 'lookup', description: 'look up data', parameters: { type: 'object' } } }],
      toolChoice: { type: 'function', function: { name: 'lookup' } },
      extra: { anthropicBeta: 'prompt-caching-2024-07-31', metadata: { user_id: 'user-1' } },
    } as unknown as ProviderRequest;
    const captured = await capturedJsonRequest({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: 'llmkit' } },
        { type: 'thinking', thinking: 'brief reasoning' },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      },
    }, async () => {
      providerResponse = await adapter.chat(providerRequest);
    });

    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured.headers.get('x-api-key')).toBe('anthropic-secret');
    expect(captured.headers.get('anthropic-beta')).toBe('prompt-caching-2024-07-31');
    expect(captured.body).toMatchObject({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      temperature: 0.2,
      tool_choice: { type: 'tool', name: 'lookup' },
      metadata: { user_id: 'user-1' },
    });
    expect(JSON.stringify(captured.body)).toContain('cache_control');
    expect(providerResponse).toMatchObject({
      id: 'msg-1',
      content: 'done',
      finishReason: 'tool_use',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        totalTokens: 180,
        reasoningTokens: 4,
      },
      toolCalls: [{ id: 'tool-1', name: 'lookup', arguments: '{"q":"llmkit"}' }],
    });
  });

  it('maps Gemini multimodal, tool, JSON, and usage contracts through production', async () => {
    const adapter = new GeminiAdapter();
    let providerResponse: Awaited<ReturnType<typeof adapter.chat>> | undefined;
    const providerRequest = {
      model: 'gemini-2.5-pro',
      apiKey: 'gemini-secret',
      maxTokens: 256,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Answer as JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect this image' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
          ],
        },
        { role: 'tool', name: 'lookup', content: 'found' },
        { role: 'assistant', content: 'working' },
      ],
      tools: [{ function: { name: 'lookup', description: 'look up data', parameters: { type: 'object' } } }],
      toolChoice: { type: 'function', function: { name: 'lookup' } },
      extra: { safetySettings: [] },
    } as unknown as ProviderRequest;
    const captured = await capturedJsonRequest({
      responseId: 'response-1',
      modelVersion: 'gemini-2.5-pro-001',
      candidates: [{
        index: 0,
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [
            { text: '{"answer":"done"}' },
            { functionCall: { name: 'lookup', args: { q: 'llmkit' } } },
          ],
        },
      }],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 30,
        totalTokenCount: 150,
        cachedContentTokenCount: 20,
        thoughtsTokenCount: 5,
      },
    }, async () => {
      providerResponse = await adapter.chat(providerRequest);
    });

    expect(captured.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    );
    expect(captured.headers.get('x-goog-api-key')).toBe('gemini-secret');
    expect(captured.body).toMatchObject({
      system_instruction: { parts: [{ text: 'Answer as JSON.' }] },
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0,
        responseMimeType: 'application/json',
      },
      tool_config: {
        function_calling_config: { mode: 'ANY', allowedFunctionNames: ['lookup'] },
      },
      safetySettings: [],
    });
    expect(JSON.stringify(captured.body)).toContain('inlineData');
    expect(JSON.stringify(captured.body)).toContain('functionResponse');
    expect(providerResponse).toMatchObject({
      id: 'response-1',
      content: '{"answer":"done"}',
      model: 'gemini-2.5-pro-001',
      finishReason: 'STOP',
      usage: {
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 150,
        cacheReadTokens: 20,
        reasoningTokens: 5,
      },
      toolCalls: [{ id: 'call_0', name: 'lookup', arguments: '{"q":"llmkit"}' }],
    });
  });

  it('rejects an unsafe Gemini model path before dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected provider dispatch'));
    await expect(new GeminiAdapter().chat({
      ...request,
      model: '../models/escape',
    })).rejects.toThrow('invalid model name');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
