import { ValidationError } from '@f3d1/llmkit-shared';
import { createMiddleware } from 'hono/factory';
import {
  IDEMPOTENCY_MAX_RESPONSE_BYTES,
  type IdempotencyResponse,
} from '../do/idempotency-do';
import type { Env } from '../env';
import { readResponseBodyBounded } from '../response-body';

const IDEMPOTENT_POST_PATHS = new Set(['/v1/chat/completions', '/v1/responses']);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const FINGERPRINT_HEADERS = [
  'x-llmkit-provider',
  'x-llmkit-provider-key',
  'x-llmkit-fallback',
  'x-llmkit-customer-id',
  'x-llmkit-workflow-id',
  'x-llmkit-agent-id',
  'x-llmkit-session-id',
  'x-llmkit-user-id',
  'x-llmkit-format',
  'x-llmkit-revenue',
  'x-llmkit-revenue-token',
] as const;

function selectedResponseHeaders(headers: Headers): Array<[string, string]> {
  const selected: Array<[string, string]> = [];
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase();
    if (
      normalized === 'content-type'
      || normalized === 'cache-control'
      || (normalized.startsWith('x-llmkit-') && normalized !== 'x-llmkit-settlement-status')
    ) {
      selected.push([normalized, value]);
    }
  }
  return selected;
}

function jsonError(code: string, message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function captureResponse(response: Response): Promise<{
  outgoing: Response;
  stored: IdempotencyResponse;
}> {
  const originalHeaders = new Headers(response.headers);
  const bodyResult = await readResponseBodyBounded(response, IDEMPOTENCY_MAX_RESPONSE_BYTES);
  if (bodyResult.kind === 'complete') {
    return {
      outgoing: new Response(bodyResult.body, { status: response.status, headers: originalHeaders }),
      stored: {
        status: response.status,
        headers: selectedResponseHeaders(originalHeaders),
        body: bodyResult.body,
      },
    };
  }

  const replacementHeaders = new Headers(selectedResponseHeaders(originalHeaders));
  replacementHeaders.set('content-type', 'application/json; charset=UTF-8');
  const replacement = jsonError(
    'IDEMPOTENCY_RESPONSE_TOO_LARGE',
    `the provider response exceeded the ${IDEMPOTENCY_MAX_RESPONSE_BYTES}-byte idempotency replay limit`,
    502,
    replacementHeaders,
  );
  const replacementBody = await replacement.arrayBuffer();
  const headers = new Headers(replacement.headers);
  return {
    outgoing: new Response(replacementBody, { status: replacement.status, headers }),
    stored: {
      status: replacement.status,
      headers: selectedResponseHeaders(headers),
      body: replacementBody,
    },
  };
}

export function idempotency() {
  return createMiddleware<Env>(async (c, next) => {
    if (c.req.method !== 'POST' || !IDEMPOTENT_POST_PATHS.has(c.req.path)) return await next();

    const key = c.req.header('Idempotency-Key');
    if (!key) return await next();
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new ValidationError('Idempotency-Key must be 8-128 ASCII letters, digits, dots, underscores, colons, or hyphens');
    }

    const apiKeyId = c.get('apiKeyId');
    if (!apiKeyId) throw new ValidationError('Idempotency-Key requires a database-backed API key identity');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError('invalid JSON body');
    }
    if (body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).stream === true) {
      return jsonError(
        'IDEMPOTENCY_STREAM_UNSUPPORTED',
        'Idempotency-Key is supported only for non-streaming requests until byte-identical stream replay is available',
        400,
        { 'Idempotency-Key': key, 'x-llmkit-idempotency-status': 'rejected' },
      );
    }

    const fingerprintHeaders = Object.fromEntries(
      FINGERPRINT_HEADERS.map((name) => [name, c.req.header(name) || '']),
    );
    const fingerprint = await sha256Hex(JSON.stringify({
      method: c.req.method,
      path: c.req.path,
      headers: fingerprintHeaders,
      body,
    }));
    const objectName = await sha256Hex(`${apiKeyId}\n${key}`);
    c.set('idempotencyKeyHash', await sha256Hex(key));
    const stub = c.env.IDEMPOTENCY_DO.get(c.env.IDEMPOTENCY_DO.idFromName(objectName));
    const claim = await stub.claim({ fingerprint });

    if (claim.kind === 'conflict') {
      return jsonError(
        'IDEMPOTENCY_CONFLICT',
        'this Idempotency-Key was already used with a different request fingerprint',
        409,
        { 'Idempotency-Key': key, 'x-llmkit-idempotency-status': 'conflict' },
      );
    }
    if (claim.kind === 'in_progress') {
      return jsonError(
        'IDEMPOTENCY_IN_PROGRESS',
        'the original request is still in progress',
        409,
        {
          'Idempotency-Key': key,
          'Retry-After': String(Math.max(1, Math.ceil(claim.retryAfterMs / 1_000))),
          'x-llmkit-idempotency-status': 'in-progress',
        },
      );
    }
    if (claim.kind === 'indeterminate') {
      return jsonError(
        'IDEMPOTENCY_INDETERMINATE',
        claim.reason,
        409,
        { 'Idempotency-Key': key, 'x-llmkit-idempotency-status': 'indeterminate' },
      );
    }
    if (claim.kind === 'replay') {
      const headers = new Headers(claim.response.headers);
      headers.set('Idempotency-Key', key);
      headers.set('x-llmkit-idempotency-status', 'replayed');
      return new Response(claim.response.body, { status: claim.response.status, headers });
    }

    try {
      await next();
      if (c.error) {
        if (!c.get('providerDispatchStarted')) {
          const released = await stub.release({ ownerToken: claim.ownerToken });
          if (released === 'owner_lost') {
            return jsonError(
              'IDEMPOTENCY_STATE_LOST',
              'the request failed before provider dispatch after its idempotency ownership lease was lost',
              503,
              { 'Idempotency-Key': key, 'x-llmkit-idempotency-status': 'indeterminate' },
            );
          }
          const headers = new Headers(c.res.headers);
          headers.set('Idempotency-Key', key);
          headers.set('x-llmkit-idempotency-status', 'released');
          c.res = new Response(c.res.body, { status: c.res.status, headers });
          return;
        }
        await stub.markIndeterminate({
          ownerToken: claim.ownerToken,
          reason: 'the original execution failed after acquiring idempotency ownership; provider outcome must be verified before retrying',
        });
        return;
      }
      const captured = await captureResponse(c.res);
      const completed = await stub.complete({ ownerToken: claim.ownerToken, response: captured.stored });
      if (completed === 'response_too_large') {
        await stub.markIndeterminate({
          ownerToken: claim.ownerToken,
          reason: 'the original execution produced a response larger than the replay boundary',
        });
        return jsonError(
          'IDEMPOTENCY_RESPONSE_TOO_LARGE',
          `the provider response exceeded the ${IDEMPOTENCY_MAX_RESPONSE_BYTES}-byte idempotency replay limit`,
          502,
          { 'Idempotency-Key': key, 'x-llmkit-idempotency-status': 'indeterminate' },
        );
      }
      if (completed === 'owner_lost') {
        return jsonError(
          'IDEMPOTENCY_STATE_LOST',
          'the original execution completed after its idempotency ownership lease was lost',
          503,
          { 'Idempotency-Key': key, 'x-llmkit-idempotency-status': 'indeterminate' },
        );
      }
      const headers = new Headers(captured.outgoing.headers);
      headers.set('Idempotency-Key', key);
      headers.set('x-llmkit-idempotency-status', 'created');
      c.res = new Response(captured.outgoing.body, { status: captured.outgoing.status, headers });
    } catch (error) {
      if (c.get('providerDispatchStarted')) {
        await stub.markIndeterminate({
          ownerToken: claim.ownerToken,
          reason: 'the original execution failed after acquiring idempotency ownership; provider outcome must be verified before retrying',
        }).catch(() => {});
      } else {
        await stub.release({ ownerToken: claim.ownerToken }).catch(() => {});
      }
      throw error;
    }
  });
}
