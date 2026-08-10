export const MAX_BUFFERED_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_PROVIDER_ERROR_DETAIL_BYTES = 64 * 1024;

export type BoundedResponseBody =
  | { kind: 'complete'; body: ArrayBuffer }
  | { kind: 'too_large'; declaredBytes?: number };

export class ResponseBodyTooLargeError extends Error {
  readonly maxBytes: number;
  readonly declaredBytes?: number;

  constructor(maxBytes: number, declaredBytes?: number) {
    super(`response body exceeded the ${maxBytes}-byte buffer limit`);
    this.name = 'ResponseBodyTooLargeError';
    this.maxBytes = maxBytes;
    this.declaredBytes = declaredBytes;
  }
}

function declaredContentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function assertValidMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }
}

export async function readResponseBodyBounded(
  response: Response,
  maxBytes = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES,
): Promise<BoundedResponseBody> {
  assertValidMaxBytes(maxBytes);

  const declaredBytes = declaredContentLength(response);
  if (declaredBytes !== undefined && declaredBytes > maxBytes) {
    await response.body?.cancel(new ResponseBodyTooLargeError(maxBytes, declaredBytes)).catch(() => {});
    return { kind: 'too_large', declaredBytes };
  }
  if (!response.body) return { kind: 'complete', body: new ArrayBuffer(0) };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (totalBytes + value.byteLength > maxBytes) {
        await reader.cancel(new ResponseBodyTooLargeError(maxBytes, declaredBytes)).catch(() => {});
        return { kind: 'too_large', ...(declaredBytes !== undefined && { declaredBytes }) };
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'complete', body: body.buffer };
}

export async function readTextResponseBounded(
  response: Response,
  maxBytes = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES,
): Promise<string> {
  const result = await readResponseBodyBounded(response, maxBytes);
  if (result.kind === 'too_large') {
    throw new ResponseBodyTooLargeError(maxBytes, result.declaredBytes);
  }
  return new TextDecoder().decode(result.body);
}

export async function readJsonResponseBounded<T>(
  response: Response,
  maxBytes = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES,
): Promise<T> {
  return JSON.parse(await readTextResponseBounded(response, maxBytes)) as T;
}

export async function readProviderErrorDetail(response: Response): Promise<string> {
  try {
    return await readTextResponseBounded(response, MAX_PROVIDER_ERROR_DETAIL_BYTES);
  } catch (error) {
    if (error instanceof ResponseBodyTooLargeError) {
      return `[provider error body exceeded ${MAX_PROVIDER_ERROR_DETAIL_BYTES} bytes]`;
    }
    throw error;
  }
}
