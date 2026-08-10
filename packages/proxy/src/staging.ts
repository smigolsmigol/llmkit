import { Hono } from 'hono';
import type { RequestInsert } from './db';
import type { Env } from './env';
import productionApp from './index';

const PROOF_PREFIX = '/__llmkit_staging_proof';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ATTRIBUTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,254}$/;

function crashTimeoutReceipt(input: unknown, budgetId: string): RequestInsert | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const expected = [
    'requestId', 'userId', 'apiKeyId', 'customerId', 'workflowId',
    'agentId', 'sessionId', 'endUserId', 'provider', 'model',
  ];
  if (Object.keys(value).some((key) => !expected.includes(key))) return undefined;
  if (
    typeof value.requestId !== 'string'
    || !UUID_PATTERN.test(value.requestId)
    || typeof value.apiKeyId !== 'string'
    || !UUID_PATTERN.test(value.apiKeyId)
  ) return undefined;
  for (const field of expected.filter((field) => !['requestId', 'apiKeyId'].includes(field))) {
    if (typeof value[field] !== 'string' || !ATTRIBUTION_PATTERN.test(value[field])) return undefined;
  }
  const customerId = value.customerId as string;
  const workflowId = value.workflowId as string;
  const agentId = value.agentId as string;
  const sessionId = value.sessionId as string;
  const endUserId = value.endUserId as string;
  const provider = value.provider as string;
  const model = value.model as string;
  const userId = value.userId as string;
  return {
    id: value.requestId,
    user_id: userId,
    api_key_id: value.apiKeyId,
    customer_id: customerId,
    workflow_id: workflowId,
    agent_id: agentId,
    session_id: sessionId,
    end_user_id: endUserId,
    budget_id: budgetId,
    budget_reservation_id: null,
    reserved_cost_cents: 1,
    settlement_status: 'pending',
    idempotency_key_hash: null,
    response_sha256: null,
    provider,
    model,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_cents: null,
    latency_ms: 0,
    status: 'pending',
    error_code: null,
    source: 'proxy',
    tool_calls: null,
  };
}

async function proofTokenMatches(expected: string | undefined, authorization: string | undefined): Promise<boolean> {
  if (!expected || !authorization?.startsWith('Bearer ')) return false;
  const provided = authorization.slice('Bearer '.length);
  const encoder = new TextEncoder();
  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
  ]);
  return crypto.subtle.timingSafeEqual(expectedHash, providedHash);
}

const stagingApp = new Hono<Env>();

stagingApp.use(`${PROOF_PREFIX}/*`, async (c, next) => {
  if (c.env.STAGING_PROOF_ENABLED !== 'true') return c.json({ error: 'not found' }, 404);
  const expectedRef = c.env.STAGING_SUPABASE_PROJECT_REF;
  if (
    !expectedRef
    || !/^[a-z0-9]{20}$/.test(expectedRef)
    || c.env.SUPABASE_URL !== `https://${expectedRef}.supabase.co`
  ) {
    return c.json({ error: 'staging database identity mismatch' }, 503);
  }
  if (!/^[a-f0-9]{40}$/.test(c.env.STAGING_SOURCE_COMMIT || '')) {
    return c.json({ error: 'staging deployment identity mismatch' }, 503);
  }
  const token = c.env.STAGING_PROOF_TOKEN;
  if (!await proofTokenMatches(token, c.req.header('authorization'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

stagingApp.get(`${PROOF_PREFIX}/meta`, (c) => c.json({
  sourceCommit: c.env.STAGING_SOURCE_COMMIT,
  databaseProjectRef: c.env.STAGING_SUPABASE_PROJECT_REF,
}));

stagingApp.get(`${PROOF_PREFIX}/budget/:id`, async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'invalid budget proof identity' }, 400);
  const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(id));
  c.header('cache-control', 'no-store');
  return c.json(await stub.stagingProofSnapshot());
});

stagingApp.post(`${PROOF_PREFIX}/budget/:id/latency`, async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'invalid budget proof identity' }, 400);
  const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(id));
  const started = performance.now();
  const admission = await stub.check({
    estimatedCents: 1,
    budgetConfig: { limitCents: 1_000, period: 'total' },
  });
  if (!admission.allowed || !admission.reservationId) {
    return c.json({ error: 'latency proof admission failed' }, 409);
  }
  await stub.release(admission.reservationId);
  c.header('cache-control', 'no-store');
  return c.json({ coordinationMs: performance.now() - started });
});

stagingApp.post(`${PROOF_PREFIX}/budget/:id/crash-timeout`, async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'invalid budget proof identity' }, 400);
  const receipt = crashTimeoutReceipt(await c.req.json().catch(() => undefined), id);
  if (!receipt) return c.json({ error: 'invalid crash-timeout proof input' }, 400);
  const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(id));
  const admission = await stub.check({
    sessionId: receipt.session_id || undefined,
    estimatedCents: 1,
    budgetConfig: { limitCents: 1, period: 'total' },
    dispatching: true,
    receipt,
  });
  if (!admission.allowed || !admission.reservationId) {
    return c.json({ error: 'crash-timeout proof admission failed' }, 409);
  }
  const expiredReservations = await stub.stagingProofExpireDispatchedReservations();
  if (expiredReservations !== 1) {
    return c.json({ error: 'crash-timeout proof did not expire exactly one reservation' }, 500);
  }
  c.header('cache-control', 'no-store');
  return c.json({ reservationId: admission.reservationId, snapshot: await stub.stagingProofSnapshot() });
});

stagingApp.delete(`${PROOF_PREFIX}/budget/:id`, async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'invalid budget proof identity' }, 400);
  const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(id));
  await stub.stagingProofPurge();
  return c.json({ purged: true });
});

stagingApp.delete(`${PROOF_PREFIX}/idempotency/:id`, async (c) => {
  const id = c.req.param('id');
  if (!SHA256_PATTERN.test(id)) return c.json({ error: 'invalid idempotency proof identity' }, 400);
  const stub = c.env.IDEMPOTENCY_DO.get(c.env.IDEMPOTENCY_DO.idFromName(id));
  await stub.stagingProofPurge();
  return c.json({ purged: true });
});

stagingApp.get(`${PROOF_PREFIX}/idempotency/:id`, async (c) => {
  const id = c.req.param('id');
  if (!SHA256_PATTERN.test(id)) return c.json({ error: 'invalid idempotency proof identity' }, 400);
  const stub = c.env.IDEMPOTENCY_DO.get(c.env.IDEMPOTENCY_DO.idFromName(id));
  c.header('cache-control', 'no-store');
  return c.json(await stub.stagingProofSnapshot());
});

stagingApp.get(`${PROOF_PREFIX}/ratelimit/:id`, async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'invalid rate-limit proof identity' }, 400);
  const stub = c.env.RATE_LIMIT_DO.get(c.env.RATE_LIMIT_DO.idFromName(id));
  c.header('cache-control', 'no-store');
  return c.json(await stub.stagingProofSnapshot());
});

stagingApp.delete(`${PROOF_PREFIX}/ratelimit/:id`, async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'invalid rate-limit proof identity' }, 400);
  const stub = c.env.RATE_LIMIT_DO.get(c.env.RATE_LIMIT_DO.idFromName(id));
  await stub.stagingProofPurge();
  return c.json({ purged: true });
});

stagingApp.route('/', productionApp);

export { BudgetDO, IdempotencyDO, RateLimitDO } from './index';
export default stagingApp;
