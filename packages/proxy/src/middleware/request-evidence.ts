import { ValidationError } from '@f3d1/llmkit-shared';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { MAX_BUFFERED_PROVIDER_RESPONSE_BYTES, readResponseBodyBounded } from '../response-body';
import { attachReceiptResponseHash } from './budget';

const EVIDENCED_POST_PATHS = new Set(['/v1/chat/completions', '/v1/responses']);
const ATTRIBUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,254}$/;

function attributionHeader(c: { req: { header(name: string): string | undefined } }, name: string): string | undefined {
  const value = c.req.header(name)?.trim();
  if (!value) return undefined;
  if (!ATTRIBUTION_ID_PATTERN.test(value)) {
    throw new ValidationError(`${name} must be a 1-255 character stable identifier`);
  }
  return value;
}

export async function sha256ResponseBody(
  response: Response,
  maxBytes = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES,
): Promise<string | undefined> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('text/event-stream')) return undefined;
  const bodyResult = await readResponseBodyBounded(response.clone(), maxBytes);
  if (bodyResult.kind === 'too_large') return undefined;
  const digest = await crypto.subtle.digest('SHA-256', bodyResult.body);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function requestEvidence() {
  return createMiddleware<Env>(async (c, next) => {
    if (c.req.method !== 'POST' || !EVIDENCED_POST_PATHS.has(c.req.path)) return await next();

    const apiKeyId = c.get('apiKeyId');
    const userId = c.get('userId');
    if (!apiKeyId || !userId) return await next();

    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.set('customerId', attributionHeader(c, 'x-llmkit-customer-id') || userId);
    c.set('workflowId', attributionHeader(c, 'x-llmkit-workflow-id'));
    c.set('agentId', attributionHeader(c, 'x-llmkit-agent-id'));
    c.set('sessionId', attributionHeader(c, 'x-llmkit-session-id'));
    c.set('endUserId', attributionHeader(c, 'x-llmkit-user-id'));
    c.header('x-llmkit-request-id', requestId);

    await next();

    // An idempotent replay carries the original receipt id in its stored
    // headers. Never replace it with the fresh middleware-local candidate.
    const responseRequestId = c.res.headers.get('x-llmkit-request-id') || requestId;
    if (!c.res.headers.has('x-llmkit-request-id')) c.header('x-llmkit-request-id', requestId);
    if (responseRequestId !== requestId || !c.get('budgetReservationId')) return;

    const responseSha256 = await sha256ResponseBody(c.res);
    if (!responseSha256) return;
    c.set('responseSha256', responseSha256);
    c.executionCtx.waitUntil(attachReceiptResponseHash(
      c.env.BUDGET_DO,
      c.get('budgetId'),
      requestId,
      responseSha256,
    ));
  });
}
