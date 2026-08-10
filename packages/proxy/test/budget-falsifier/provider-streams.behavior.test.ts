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

describe('bounded provider SSE frames', () => {
  afterEach(() => vi.restoreAllMocks());

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
});
