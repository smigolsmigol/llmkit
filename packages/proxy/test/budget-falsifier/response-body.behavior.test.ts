import { describe, expect, it } from 'vitest';
import { sha256ResponseBody } from '../../src/middleware/request-evidence';
import type { ResponseBodyTooLargeError } from '../../src/response-body';
import {
  readJsonResponseBounded,
  readResponseBodyBounded,
} from '../../src/response-body';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('bounded response-body consumption', () => {
  it('rejects a declared oversized body before pulling bytes and cancels the stream', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(bytes('unreachable'));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    const result = await readResponseBodyBounded(new Response(body, {
      headers: { 'content-length': '9' },
    }), 8);

    expect(result).toEqual({ kind: 'too_large', declaredBytes: 9 });
    expect(pulls).toBe(0);
    expect(cancelled).toBe(true);
  });

  it('stops and cancels an unknown-length stream as soon as the cap is crossed', async () => {
    let pulls = 0;
    let cancelled = false;
    const chunks = [bytes('12345'), bytes('67890'), bytes('unreachable')];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulls];
        pulls += 1;
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    await expect(readJsonResponseBounded(new Response(body), 8)).rejects.toMatchObject({
      name: 'ResponseBodyTooLargeError',
      maxBytes: 8,
    } satisfies Partial<ResponseBodyTooLargeError>);
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
  });

  it('reassembles an in-range multi-chunk body byte-identically', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes('{"ok":'));
        controller.enqueue(bytes('true}'));
        controller.close();
      },
    });

    await expect(readJsonResponseBounded<{ ok: boolean }>(new Response(body), 11)).resolves.toEqual({ ok: true });
  });

  it('omits an oversized evidence hash without consuming the response sent to the caller', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes('12345'));
        controller.enqueue(bytes('67890'));
        controller.close();
      },
    }), { headers: { 'content-type': 'application/json' } });

    await expect(sha256ResponseBody(response, 8)).resolves.toBeUndefined();
    await expect(response.text()).resolves.toBe('1234567890');
  });

  it('rejects invalid bounds without touching the stream', async () => {
    const response = new Response('ok');
    await expect(readResponseBodyBounded(response, -1)).rejects.toThrow(RangeError);
    await expect(response.text()).resolves.toBe('ok');
  });
});
