import { MAX_BUFFERED_PROVIDER_RESPONSE_BYTES } from '../response-body';

export const MAX_PROVIDER_STREAM_FRAME_BYTES = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES;

export class ProviderStreamFrameTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`provider stream frame exceeded the ${maxBytes}-byte limit`);
    this.name = 'ProviderStreamFrameTooLargeError';
    this.maxBytes = maxBytes;
  }
}

function assertValidMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }
}

class SseFrameAccumulator {
  private readonly chunks: Uint8Array[] = [];
  private frameBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(segment: Uint8Array): void {
    if (segment.byteLength === 0) return;
    if (this.frameBytes + segment.byteLength > this.maxBytes) {
      throw new ProviderStreamFrameTooLargeError(this.maxBytes);
    }
    this.chunks.push(segment);
    this.frameBytes += segment.byteLength;
  }

  takeLine(): string {
    const frame = new Uint8Array(this.frameBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      frame.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.chunks.length = 0;
    this.frameBytes = 0;

    const decoded = new TextDecoder().decode(frame);
    return decoded.endsWith('\r') ? decoded.slice(0, -1) : decoded;
  }
}

function splitLines(value: Uint8Array, frame: SseFrameAccumulator): string[] {
  const lines: string[] = [];
  let lineStart = 0;
  for (let index = 0; index < value.byteLength; index += 1) {
    if (value[index] !== 0x0a) continue;
    frame.append(value.subarray(lineStart, index));
    lines.push(frame.takeLine());
    lineStart = index + 1;
  }
  frame.append(value.subarray(lineStart));
  return lines;
}

export async function* readSseLines(
  stream: ReadableStream<Uint8Array>,
  maxBytes = MAX_PROVIDER_STREAM_FRAME_BYTES,
): AsyncGenerator<string> {
  assertValidMaxBytes(maxBytes);

  const reader = stream.getReader();
  const frame = new SseFrameAccumulator(maxBytes);
  let finished = false;
  let cancelled = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      if (!value || value.byteLength === 0) continue;
      for (const line of splitLines(value, frame)) yield line;
    }
  } catch (error) {
    cancelled = true;
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    if (!finished && !cancelled) {
      await reader.cancel('provider stream consumer stopped').catch(() => {});
    }
    reader.releaseLock();
  }
}
