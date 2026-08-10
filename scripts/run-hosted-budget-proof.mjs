import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const proofPrefix = '/__llmkit_staging_proof';
const receiptOutput = resolve(repoRoot, 'audits', 'llmkit-hosted-staging-budget-proof.json');
const recoveryOutput = resolve(repoRoot, 'audits', 'llmkit-hosted-staging-recovery.json');
const HOSTED_COORDINATION_THRESHOLDS_MS = {
  median: 50,
  p95: 150,
};
const rawArgs = process.argv.slice(2);
const recoveryMode = rawArgs.includes('--recover');

function fail(message) {
  throw new Error(message);
}

function option(name) {
  const index = rawArgs.indexOf(name);
  if (index === -1) return undefined;
  const value = rawArgs[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

for (let index = 0; index < rawArgs.length; index += 1) {
  if (rawArgs[index] === '--recover') continue;
  if (rawArgs[index] === '--confirm') {
    index += 1;
    continue;
  }
  fail(`Unknown hosted-proof argument: ${rawArgs[index]}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing required environment value: ${name}.`);
  return value;
}

function git(...args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`git ${args.join(' ')} failed.`);
  return result.stdout.trim();
}

function exactOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be an absolute URL.`);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    fail(`${label} must be an HTTPS origin without credentials, path, query, or fragment.`);
  }
  return parsed;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function serviceHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function responseDetail(response) {
  const text = await response.text().catch(() => '');
  return text.slice(0, 500).replace(/[\r\n]+/g, ' ');
}

const baseUrl = exactOrigin(requiredEnv('LLMKIT_STAGING_BASE_URL'), 'LLMKIT_STAGING_BASE_URL');
assert(
  /^llmkit-proxy-staging\.[a-z0-9-]+\.workers\.dev$/.test(baseUrl.hostname),
  'LLMKIT_STAGING_BASE_URL must target the isolated llmkit-proxy-staging workers.dev host.',
);
const projectRef = requiredEnv('LLMKIT_STAGING_SUPABASE_PROJECT_REF');
assert(/^[a-z0-9]{20}$/.test(projectRef), 'LLMKIT_STAGING_SUPABASE_PROJECT_REF must be an exact 20-character project ref.');
const productionProjectRef = requiredEnv('LLMKIT_PRODUCTION_SUPABASE_PROJECT_REF');
assert(/^[a-z0-9]{20}$/.test(productionProjectRef), 'LLMKIT_PRODUCTION_SUPABASE_PROJECT_REF must be an exact 20-character project ref.');
assert(projectRef !== productionProjectRef, 'Staging proof refuses the production Supabase project ref.');
const supabaseUrl = exactOrigin(requiredEnv('LLMKIT_STAGING_SUPABASE_URL'), 'LLMKIT_STAGING_SUPABASE_URL');
assert(
  supabaseUrl.origin === `https://${projectRef}.supabase.co`,
  'Staging Supabase URL does not match LLMKIT_STAGING_SUPABASE_PROJECT_REF.',
);

const proofToken = requiredEnv('LLMKIT_STAGING_PROOF_TOKEN');
const serviceKey = requiredEnv('LLMKIT_STAGING_SUPABASE_KEY');
const providerKey = recoveryMode ? undefined : requiredEnv('LLMKIT_STAGING_PROVIDER_KEY');
const provider = recoveryMode ? undefined : requiredEnv('LLMKIT_STAGING_PROVIDER');
const model = recoveryMode ? undefined : requiredEnv('LLMKIT_STAGING_MODEL');
if (!recoveryMode) {
  assert(/^[a-z0-9_-]{2,32}$/.test(provider), 'LLMKIT_STAGING_PROVIDER is malformed.');
  assert(model.length <= 128 && !/[\r\n]/.test(model), 'LLMKIT_STAGING_MODEL is malformed.');
}

const approval = `staging:${baseUrl.hostname}:db:${projectRef}`;
if (option('--confirm') !== approval || process.env.LLMKIT_HOSTED_PROOF_APPROVED !== approval) {
  fail(`Hosted proof requires both --confirm ${approval} and LLMKIT_HOSTED_PROOF_APPROVED=${approval}.`);
}
if (!recoveryMode) assert(git('status', '--porcelain') === '', 'Hosted proof requires a clean worktree.');
const sourceCommit = git('rev-parse', 'HEAD');

async function postgrest(path, init = {}) {
  const headers = serviceHeaders(serviceKey, {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  });
  const response = await fetch(`${supabaseUrl.origin}/rest/v1/${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    fail(`Staging database operation failed (${response.status}): ${await responseDetail(response)}`);
  }
  return response;
}

async function proofRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${proofToken}`);
  const response = await fetch(`${baseUrl.origin}${proofPrefix}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    fail(`Staging proof endpoint failed (${response.status}): ${await responseDetail(response)}`);
  }
  return response;
}

async function poll(label, read, accept, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  fail(`${label} did not converge before the ${timeoutMs}ms deadline.`);
}

function createFixture(label, limitCents) {
  const suffix = randomBytes(8).toString('hex');
  const userId = `llmkit-hosted-proof-${label}-${suffix}`;
  const apiKey = `llmk_proof_${randomBytes(24).toString('base64url')}`;
  return {
    label,
    userId,
    customerId: `customer-${suffix}`,
    apiKeyId: randomUUID(),
    workflowId: randomUUID(),
    budgetId: randomUUID(),
    apiKey,
    apiKeyHash: sha256(apiKey),
    apiKeyPrefix: apiKey.slice(0, 12),
    sessionId: `session-${suffix}`,
    agentId: `agent-${suffix}`,
    endUserId: `end-user-${suffix}`,
    limitCents,
  };
}

async function provision(fixture) {
  await postgrest('budgets', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: fixture.budgetId,
      user_id: fixture.userId,
      name: `hosted-proof-${fixture.label}`,
      limit_cents: fixture.limitCents,
      period: 'total',
      scope: 'key',
    }),
  });
  await postgrest('api_keys', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: fixture.apiKeyId,
      user_id: fixture.userId,
      key_hash: fixture.apiKeyHash,
      key_prefix: fixture.apiKeyPrefix,
      name: `hosted-proof-${fixture.label}`,
      budget_id: fixture.budgetId,
      rpm_limit: 120,
    }),
  });
}

async function workerRequest(fixture, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      'content-type': 'application/json',
      'x-llmkit-provider': provider,
      'x-llmkit-provider-key': providerKey,
      'x-llmkit-customer-id': fixture.customerId,
      'x-llmkit-workflow-id': fixture.workflowId,
      'x-llmkit-agent-id': fixture.agentId,
      'x-llmkit-session-id': fixture.sessionId,
      'x-llmkit-user-id': fixture.endUserId,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const responseBody = Buffer.from(await response.arrayBuffer());
  const result = {
    status: response.status,
    requestId: response.headers.get('x-llmkit-request-id'),
    idempotencyStatus: response.headers.get('x-llmkit-idempotency-status'),
    settlementStatus: response.headers.get('x-llmkit-settlement-status'),
    responseSha256: sha256(responseBody),
  };
  return result;
}

async function requestRows(fixture) {
  const response = await postgrest(
    `requests?user_id=eq.${encodeURIComponent(fixture.userId)}`
      + '&select=id,user_id,api_key_id,customer_id,workflow_id,agent_id,session_id,end_user_id,budget_id,budget_reservation_id,reserved_cost_cents,cost_cents,settlement_status,idempotency_key_hash,response_sha256,provider,model,status,error_code,source'
      + '&order=created_at.asc',
    { headers: { Prefer: 'count=exact' } },
  );
  return response.json();
}

function assertAttribution(rows, fixture) {
  assert(rows.every((row) => row.user_id === fixture.userId), `${fixture.label} lost tenant attribution.`);
  assert(rows.every((row) => row.api_key_id === fixture.apiKeyId), `${fixture.label} lost API key attribution.`);
  assert(rows.every((row) => row.customer_id === fixture.customerId), `${fixture.label} lost customer attribution.`);
  assert(rows.every((row) => row.workflow_id === fixture.workflowId), `${fixture.label} lost workflow attribution.`);
  assert(rows.every((row) => row.agent_id === fixture.agentId), `${fixture.label} lost agent attribution.`);
  assert(rows.every((row) => row.session_id === fixture.sessionId), `${fixture.label} lost session attribution.`);
  assert(rows.every((row) => row.end_user_id === fixture.endUserId), `${fixture.label} lost end-user attribution.`);
  assert(rows.every((row) => row.budget_id === fixture.budgetId), `${fixture.label} lost budget attribution.`);
  assert(rows.every((row) => row.provider === provider && row.model === model), `${fixture.label} lost provider/model attribution.`);
  assert(rows.every((row) => row.source === 'proxy'), `${fixture.label} wrote an unexpected request source.`);
}

async function budgetSnapshot(fixture) {
  return (await proofRequest(`/budget/${fixture.budgetId}`)).json();
}

async function rateLimitSnapshot(fixture) {
  return (await proofRequest(`/ratelimit/${fixture.apiKeyId}`)).json();
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

async function runCoordinationLatencyScenario(fixture) {
  const warmups = 5;
  const samples = 40;
  const serverMs = [];
  const clientMs = [];
  for (let index = 0; index < warmups + samples; index += 1) {
    const started = performance.now();
    const response = await proofRequest(`/budget/${fixture.budgetId}/latency`, { method: 'POST' });
    const elapsed = performance.now() - started;
    const body = await response.json();
    assert(Number.isFinite(body.coordinationMs) && body.coordinationMs >= 0, 'Hosted coordination latency sample was invalid.');
    if (index >= warmups) {
      serverMs.push(body.coordinationMs);
      clientMs.push(elapsed);
    }
  }
  const observed = {
    medianMs: percentile(serverMs, 0.5),
    p95Ms: percentile(serverMs, 0.95),
    clientMedianMs: percentile(clientMs, 0.5),
    clientP95Ms: percentile(clientMs, 0.95),
  };
  assert(
    observed.medianMs <= HOSTED_COORDINATION_THRESHOLDS_MS.median
      && observed.p95Ms <= HOSTED_COORDINATION_THRESHOLDS_MS.p95,
    `Hosted budget coordination latency exceeded its kill threshold: ${JSON.stringify(observed)}.`,
  );
  const ledger = await budgetSnapshot(fixture);
  assert(
    ledger.root?.usedCents === 0
      && ledger.root?.reservedCents === 0
      && ledger.reservations === 0
      && ledger.outbox === 0,
    'Hosted latency sampling left budget or receipt work in flight.',
  );
  return {
    warmups,
    samples,
    thresholdsMs: HOSTED_COORDINATION_THRESHOLDS_MS,
    observedMs: observed,
    ledger,
  };
}

async function runCrashOutboxScenario(fixture) {
  const requestId = randomUUID();
  const injected = await proofRequest(`/budget/${fixture.budgetId}/crash-timeout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId,
      userId: fixture.userId,
      apiKeyId: fixture.apiKeyId,
      customerId: fixture.customerId,
      workflowId: fixture.workflowId,
      agentId: fixture.agentId,
      sessionId: fixture.sessionId,
      endUserId: fixture.endUserId,
      provider,
      model,
    }),
  });
  const injectedState = await injected.json();
  assert(
    injectedState.snapshot?.root?.usedCents === 1
      && injectedState.snapshot?.root?.reservedCents === 0
      && injectedState.snapshot?.reservations === 0
      && injectedState.snapshot?.settlements === 1
      && injectedState.snapshot?.evidence === 1
      && injectedState.snapshot?.outbox === 1,
    'Hosted crash injection did not conservatively commit and retain failed receipt delivery.',
  );
  assert((await requestRows(fixture)).length === 0, 'Crash receipt reached the database before its missing-parent fault was repaired.');

  await provision(fixture);
  const ledger = await poll(
    'crash receipt outbox recovery',
    () => budgetSnapshot(fixture),
    (snapshot) => snapshot.root?.usedCents === 1
      && snapshot.root?.reservedCents === 0
      && snapshot.reservations === 0
      && snapshot.evidence === 1
      && snapshot.outbox === 0,
  );
  const rows = await poll(
    'crash receipt database recovery',
    () => requestRows(fixture),
    (current) => current.length === 1
      && current[0]?.id === requestId
      && current[0]?.status === 'error'
      && current[0]?.error_code === 'RESERVATION_TIMEOUT'
      && current[0]?.settlement_status === 'committed_ceiling',
  );
  assertAttribution(rows, fixture);
  assert(
    Number(rows[0]?.reserved_cost_cents) === 1
      && Number(rows[0]?.cost_cents) === 1
      && typeof rows[0]?.budget_reservation_id === 'string',
    'Recovered crash receipt lost its one-cent reservation and committed ceiling.',
  );
  return {
    requestId,
    injectedOutboxFailure: true,
    crashTimeoutFaultInjectedThroughAlarmHandler: true,
    outboxRecoveredByScheduledAlarm: true,
    ledger,
    database: { rows: 1, terminal: 'committed_ceiling', attributed: true },
  };
}

async function runConcurrencyScenario(fixture) {
  const bodyFor = (index) => ({
    model,
    messages: [{ role: 'user', content: `Reply with one digit. Hosted budget proof ${index}.` }],
    max_tokens: 1,
  });
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, index) => workerRequest(fixture, bodyFor(index))),
  );
  const successes = responses.filter((response) => response.status === 200).length;
  const denied = responses.filter((response) => response.status === 402).length;
  assert(successes === 5 && denied === 15, `Concurrency gate expected 5 successes and 15 denials; got ${successes}/${denied}.`);

  const ledger = await poll(
    'concurrency budget ledger',
    () => budgetSnapshot(fixture),
    (snapshot) => snapshot.root?.usedCents === 5
      && snapshot.root?.reservedCents === 0
      && snapshot.reservations === 0
      && snapshot.outbox === 0,
  );
  const rows = await poll(
    'concurrency request attribution',
    () => requestRows(fixture),
    (current) => current.length === 20 && current.every((row) => row.status !== 'pending'),
  );
  assertAttribution(rows, fixture);
  assert(rows.filter((row) => row.status === 'success').length === 5, 'Concurrency DB proof lost successful executions.');
  assert(rows.filter((row) => row.status === 'error').length === 15, 'Concurrency DB proof lost budget denials.');
  assert(
    rows.filter((row) => row.status === 'success').every((row) => (
      row.settlement_status === 'settled_actual'
      && typeof row.budget_reservation_id === 'string'
      && Number(row.reserved_cost_cents) === 1
      && /^[a-f0-9]{64}$/.test(row.response_sha256)
    )),
    'Concurrency DB proof lost terminal reservation or response evidence.',
  );
  assert(
    rows.filter((row) => row.status === 'error').every((row) => row.settlement_status === 'not_applicable'),
    'Pre-admission denials were misrepresented as settled model cost.',
  );
  const responseIds = new Set(responses.map((response) => response.requestId));
  assert(responseIds.size === 20 && rows.every((row) => responseIds.has(row.id)), 'Concurrency receipt identities did not join HTTP to DB.');
  const attributedCostCents = rows
    .filter((row) => row.status === 'success')
    .reduce((sum, row) => sum + Number(row.cost_cents), 0);
  assert(
    attributedCostCents > 0 && attributedCostCents <= 5,
    'Concurrency DB cost is outside the five-cent conservative ledger boundary.',
  );
  return {
    responses: { success: successes, budgetDenied: denied },
    ledger,
    database: { rows: rows.length, success: 5, error: 15, attributedCostCents, attributed: true, joinedReceiptIds: true },
  };
}

async function runIdempotencyScenario(fixture) {
  const idempotencyKey = `hosted-proof-${randomBytes(12).toString('hex')}`;
  fixture.idempotencyObjectName = sha256(`${fixture.apiKeyId}\n${idempotencyKey}`);
  await writeRecovery('idempotency-identity-allocated');
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with one digit. Hosted idempotency proof.' }],
    max_tokens: 1,
  };
  const headers = { 'Idempotency-Key': idempotencyKey };
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () => workerRequest(fixture, body, headers)),
  );
  const created = concurrent.filter((response) => response.idempotencyStatus === 'created');
  const inProgress = concurrent.filter((response) => response.idempotencyStatus === 'in-progress');
  const replayed = concurrent.filter((response) => response.idempotencyStatus === 'replayed');
  assert(created.length === 1, `Idempotency gate expected one owner; got ${created.length}.`);
  assert(
    concurrent.every((response) => (
      (response.status === 200 && ['created', 'replayed'].includes(response.idempotencyStatus))
      || (response.status === 409 && response.idempotencyStatus === 'in-progress')
    )),
    'Idempotency gate returned an unexpected concurrent response.',
  );

  const replay = await workerRequest(fixture, body, headers);
  assert(replay.status === 200 && replay.idempotencyStatus === 'replayed', 'Explicit idempotency replay was not served.');
  assert(replay.settlementStatus === null, 'Idempotency replay leaked the original pending settlement header.');
  assert(replay.requestId === created[0]?.requestId, 'Idempotency replay changed the durable request receipt id.');
  assert(replay.responseSha256 === created[0]?.responseSha256, 'Idempotency replay changed the response bytes.');

  const ledger = await poll(
    'idempotency budget ledger',
    () => budgetSnapshot(fixture),
    (snapshot) => snapshot.root?.usedCents === 1
      && snapshot.root?.reservedCents === 0
      && snapshot.reservations === 0
      && snapshot.outbox === 0,
  );
  const rows = await poll(
    'idempotency request attribution',
    () => requestRows(fixture),
    (current) => current.length === 1
      && current[0]?.status === 'success'
      && current[0]?.settlement_status === 'settled_actual'
      && /^[a-f0-9]{64}$/.test(current[0]?.response_sha256 || ''),
  );
  assertAttribution(rows, fixture);
  const attributedCostCents = Number(rows[0]?.cost_cents);
  assert(
    rows[0]?.status === 'success' && attributedCostCents > 0 && attributedCostCents <= 1,
    'Idempotency DB proof is not exactly one execution inside the conservative one-cent boundary.',
  );
  assert(rows[0]?.id === created[0]?.requestId, 'Idempotency DB proof did not join to the HTTP receipt id.');
  assert(rows[0]?.response_sha256 === created[0]?.responseSha256, 'Idempotency DB proof response hash drifted.');
  assert(rows[0]?.idempotency_key_hash === fixture.idempotencyObjectName, 'Idempotency DB proof key hash drifted.');
  return {
    objectName: fixture.idempotencyObjectName,
    responses: { created: 1, inProgress: inProgress.length, concurrentReplayed: replayed.length, explicitReplay: true, receiptReplayStable: true },
    ledger,
    database: { rows: 1, success: 1, attributedCostCents, attributed: true, responseHashMatched: true },
  };
}

async function cleanupFixture(fixture) {
  const cleanupErrors = [];
  let ledger;
  let remaining;
  let keys;
  let budgets;
  let rateLimit;
  const attempt = async (label, operation) => {
    try {
      return await operation();
    } catch (error) {
      cleanupErrors.push(`${label}: ${error.message}`);
      return undefined;
    }
  };
  await attempt('budget Durable Object purge', () => proofRequest(`/budget/${fixture.budgetId}`, { method: 'DELETE' }));
  await attempt('rate-limit Durable Object purge', () => proofRequest(`/ratelimit/${fixture.apiKeyId}`, { method: 'DELETE' }));
  await attempt('request row purge', () => postgrest(`requests?user_id=eq.${encodeURIComponent(fixture.userId)}`, { method: 'DELETE' }));
  await attempt('API key purge', () => postgrest(`api_keys?user_id=eq.${encodeURIComponent(fixture.userId)}`, { method: 'DELETE' }));
  await attempt('budget row purge', () => postgrest(`budgets?user_id=eq.${encodeURIComponent(fixture.userId)}`, { method: 'DELETE' }));
  remaining = await attempt('request cleanup readback', () => requestRows(fixture));
  keys = await attempt('API key cleanup readback', async () => (
    await (await postgrest(`api_keys?user_id=eq.${encodeURIComponent(fixture.userId)}&select=id`)).json()
  ));
  budgets = await attempt('budget cleanup readback', async () => (
    await (await postgrest(`budgets?user_id=eq.${encodeURIComponent(fixture.userId)}&select=id`)).json()
  ));
  ledger = await attempt('budget Durable Object readback', () => budgetSnapshot(fixture));
  rateLimit = await attempt('rate-limit Durable Object readback', () => rateLimitSnapshot(fixture));
  if (cleanupErrors.length > 0) fail(`${fixture.label} cleanup errors: ${cleanupErrors.join('; ')}`);
  assert(remaining.length === 0 && keys.length === 0 && budgets.length === 0, `${fixture.label} database cleanup is incomplete.`);
  assert(
    !ledger.root
      && ledger.reservations === 0
      && ledger.settlements === 0
      && ledger.evidence === 0
      && ledger.outbox === 0,
    `${fixture.label} budget Durable Object cleanup is incomplete.`,
  );
  assert(rateLimit.count === 0 && rateLimit.storedEntries === 0, `${fixture.label} rate-limit Durable Object cleanup is incomplete.`);
  return { databaseRows: 0, apiKeys: 0, budgets: 0, budgetDurableObjectEmpty: true, rateLimitDurableObjectEmpty: true };
}

const previousRecovery = await readJsonIfPresent(recoveryOutput);
if (recoveryMode) {
  if (!previousRecovery || previousRecovery.status === 'clean') {
    fail(`No unresolved hosted-proof recovery journal exists at ${recoveryOutput}.`);
  }
  assert(previousRecovery.target?.workerHost === baseUrl.hostname, 'Recovery journal Worker host does not match the approved target.');
  assert(previousRecovery.target?.databaseProjectRef === projectRef, 'Recovery journal database does not match the approved target.');
  previousRecovery.status = 'cleanup-running';
  previousRecovery.updatedAtUtc = new Date().toISOString();
  await writeJsonAtomic(recoveryOutput, previousRecovery);
  const cleanupErrors = [];
  const idempotencyObjectName = previousRecovery.fixtures
    ?.map((fixture) => fixture.idempotencyObjectName)
    .find(Boolean);
  if (idempotencyObjectName) {
    try {
      await proofRequest(`/idempotency/${idempotencyObjectName}`, { method: 'DELETE' });
      const snapshot = await (await proofRequest(`/idempotency/${idempotencyObjectName}`)).json();
      assert(snapshot.entries === 0 && snapshot.alarmScheduled === false, 'Recovered idempotency state is not empty.');
      previousRecovery.idempotencyCleanup = 'clean';
    } catch (error) {
      cleanupErrors.push(`idempotency recovery: ${error.message}`);
    }
  }
  for (const fixture of previousRecovery.fixtures || []) {
    try {
      await cleanupFixture(fixture);
      fixture.cleanup = 'clean';
    } catch (error) {
      cleanupErrors.push(`${fixture.label} recovery: ${error.message}`);
    }
  }
  previousRecovery.status = cleanupErrors.length === 0 ? 'clean' : 'cleanup-failed';
  previousRecovery.updatedAtUtc = new Date().toISOString();
  await writeJsonAtomic(recoveryOutput, previousRecovery);
  if (cleanupErrors.length > 0) fail(cleanupErrors.join('; '));
  process.stdout.write(`HOSTED_BUDGET_PROOF_RECOVERY PASS ${recoveryOutput}\n`);
  process.exit(0);
}
if (previousRecovery && previousRecovery.status !== 'clean') {
  fail(`Unresolved hosted-proof recovery journal: ${recoveryOutput}. Clean those exact fixtures before starting another run.`);
}
const concurrency = createFixture('concurrency', 5);
const idempotency = createFixture('idempotency', 2);
const latency = createFixture('latency', 1_000);
const crashOutbox = createFixture('crash-outbox', 1);
const fixtures = [concurrency, idempotency, latency, crashOutbox];
const publicFixture = (fixture) => ({
  label: fixture.label,
  userId: fixture.userId,
  customerId: fixture.customerId,
  apiKeyId: fixture.apiKeyId,
  workflowId: fixture.workflowId,
  budgetId: fixture.budgetId,
  sessionId: fixture.sessionId,
  agentId: fixture.agentId,
  endUserId: fixture.endUserId,
  rateLimitObjectName: fixture.apiKeyId,
  idempotencyObjectName: fixture.idempotencyObjectName || null,
  cleanup: 'pending',
});
const recoveryJournal = {
  schemaVersion: 1,
  createdAtUtc: new Date().toISOString(),
  updatedAtUtc: undefined,
  sourceCommit,
  target: { workerHost: baseUrl.hostname, databaseProjectRef: projectRef },
  status: 'prepared',
  fixtures: fixtures.map(publicFixture),
  idempotencyCleanup: 'pending',
  note: 'Contains non-secret identities required to remove interrupted hosted-proof state.',
};
async function writeRecovery(status) {
  recoveryJournal.status = status;
  recoveryJournal.updatedAtUtc = new Date().toISOString();
  recoveryJournal.fixtures = fixtures.map(publicFixture).map((fixture, index) => ({
    ...fixture,
    cleanup: recoveryJournal.fixtures[index]?.cleanup || 'pending',
  }));
  await writeJsonAtomic(recoveryOutput, recoveryJournal);
}
await writeRecovery('prepared');
const receipt = {
  schemaVersion: 1,
  generatedAtUtc: undefined,
  sourceCommit,
  target: { workerHost: baseUrl.hostname, databaseProjectRef: projectRef },
  runtime: { node: process.version, provider, model },
  scenarios: {},
  cleanup: {},
  verdict: 'FAIL',
  error: undefined,
};
let executionError;

try {
  const health = await fetch(`${baseUrl.origin}/health`, { signal: AbortSignal.timeout(30_000) });
  assert(health.ok, `Staging health failed with ${health.status}.`);
  await health.arrayBuffer();
  const meta = await (await proofRequest('/meta')).json();
  assert(meta.sourceCommit === sourceCommit, `Staging Worker is ${meta.sourceCommit || 'unbound'}, not local HEAD ${sourceCommit}.`);
  assert(meta.databaseProjectRef === projectRef, 'Staging Worker database project ref drifted.');

  await writeRecovery('provisioning');
  receipt.scenarios.coordinationLatency = await runCoordinationLatencyScenario(latency);
  await writeRecovery('latency-complete');
  await provision(concurrency);
  await writeRecovery('concurrency-provisioned');
  await provision(idempotency);
  await writeRecovery('fixtures-provisioned');
  receipt.scenarios.concurrency = await runConcurrencyScenario(concurrency);
  await writeRecovery('concurrency-complete');
  receipt.scenarios.idempotency = await runIdempotencyScenario(idempotency);
  await writeRecovery('idempotency-complete');
  receipt.scenarios.crashOutbox = await runCrashOutboxScenario(crashOutbox);
  await writeRecovery('scenarios-complete');
} catch (error) {
  executionError = error;
} finally {
  const cleanupErrors = [];
  await writeRecovery('cleanup-running');
  if (idempotency.idempotencyObjectName) {
    try {
      await proofRequest(`/idempotency/${idempotency.idempotencyObjectName}`, { method: 'DELETE' });
      const snapshot = await (await proofRequest(`/idempotency/${idempotency.idempotencyObjectName}`)).json();
      assert(snapshot.entries === 0 && snapshot.alarmScheduled === false, 'Idempotency Durable Object cleanup is incomplete.');
      recoveryJournal.idempotencyCleanup = 'clean';
      await writeRecovery('cleanup-running');
    } catch (error) {
      cleanupErrors.push(`idempotency Durable Object purge: ${error.message}`);
    }
  } else {
    recoveryJournal.idempotencyCleanup = 'not-created';
  }
  for (const [index, fixture] of fixtures.entries()) {
    try {
      receipt.cleanup[fixture.label] = await cleanupFixture(fixture);
      recoveryJournal.fixtures[index].cleanup = 'clean';
      await writeRecovery('cleanup-running');
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  if (cleanupErrors.length > 0) {
    const cleanupMessage = cleanupErrors.join('; ');
    executionError = executionError
      ? new Error(`${executionError.message}; cleanup also failed: ${cleanupMessage}`)
      : new Error(cleanupMessage);
    await writeRecovery('cleanup-failed');
  } else {
    await writeRecovery('clean');
  }
}

receipt.generatedAtUtc = new Date().toISOString();
if (executionError) receipt.error = executionError.message;
else receipt.verdict = 'PASS';
await writeJsonAtomic(receiptOutput, receipt);
const receiptSha256 = sha256(await readFile(receiptOutput));
process.stdout.write(`HOSTED_BUDGET_PROOF_RECEIPT ${receiptOutput}\nHOSTED_BUDGET_PROOF_SHA256 ${receiptSha256}\n`);
if (executionError) throw executionError;
process.stdout.write('HOSTED_BUDGET_PROOF PASS\n');
