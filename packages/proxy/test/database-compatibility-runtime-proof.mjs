import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const proxyRoot = join(root, 'packages', 'proxy');
const supabaseLauncher = join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
const wranglerLauncher = join(proxyRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const databaseContainer = 'supabase_db_llmkit';
const docker = process.platform === 'win32'
  ? join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Docker',
      'Docker',
      'resources',
      'bin',
      'docker.exe',
    )
  : 'docker';
const tenantA = 'foundation-runtime-a';
const tenantB = 'foundation-runtime-b';
const budgetAId = '50000000-0000-4000-8000-0000000000a1';
const keyAId = '60000000-0000-4000-8000-0000000000a1';
const keyBId = '60000000-0000-4000-8000-0000000000b1';
const receiptASettledId = '70000000-0000-4000-8000-0000000000a1';
const receiptAUnknownId = '70000000-0000-4000-8000-0000000000a2';
const receiptBId = '70000000-0000-4000-8000-0000000000b1';
const keyA = 'llmk_foundation_runtime_a_20260716';
const keyB = 'llmk_foundation_runtime_b_20260716';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}).`);
  }
  return result;
}

function dockerReady(command, runner = spawnSync) {
  const result = runner(command, ['version'], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function runSelfTest() {
  assert(
    dockerReady('docker', () => ({ status: 0 })),
    'A ready Docker PATH command was rejected.',
  );
  assert(
    !dockerReady('docker', () => ({ status: 1 })),
    'A failing Docker daemon probe was accepted.',
  );
  assert(
    !dockerReady('docker', () => ({ status: null, error: new Error('missing') })),
    'A missing Docker command was accepted.',
  );
  console.log('WORKER_DATABASE_PREREQUISITE_SELF_TEST PASS (ready + unavailable fixtures)');
}

function readLocalStatus() {
  const result = run(process.execPath, [supabaseLauncher, 'status', '--output', 'json']);
  const status = JSON.parse(result.stdout);
  if (!status.API_URL || !status.SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase status omitted the API URL or service-role key.');
  }
  return { url: status.API_URL, serviceKey: status.SERVICE_ROLE_KEY };
}

function cleanupFixture() {
  const sql = `
begin;
delete from public.requests where user_id in ('${tenantA}', '${tenantB}');
delete from public.api_keys where user_id in ('${tenantA}', '${tenantB}');
delete from public.budgets where user_id in ('${tenantA}', '${tenantB}');
delete from public.accounts where user_id in ('${tenantA}', '${tenantB}');
commit;
`;
  run(docker, [
    'exec',
    '-i',
    databaseContainer,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--no-psqlrc',
    '-v',
    'ON_ERROR_STOP=1',
  ], { input: sql });
}

function assertFixtureRemoved() {
  const sql = `
select
  (select count(*) from public.requests where user_id in ('${tenantA}', '${tenantB}'))
  + (select count(*) from public.api_keys where user_id in ('${tenantA}', '${tenantB}'))
  + (select count(*) from public.budgets where user_id in ('${tenantA}', '${tenantB}'))
  + (select count(*) from public.accounts where user_id in ('${tenantA}', '${tenantB}'));
`;
  const result = run(docker, [
    'exec',
    databaseContainer,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--command',
    sql,
  ]);
  assert(Number(result.stdout.trim()) === 0, 'Runtime proof fixtures remained after cleanup.');
}

async function postgrest(url, serviceKey, path, body) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Fixture insert ${path} failed (${response.status}): ${await response.text()}`);
  }
}

async function seedFixture(url, serviceKey) {
  cleanupFixture();
  await postgrest(url, serviceKey, 'accounts', [
    { user_id: tenantA, plan: 'pro' },
    { user_id: tenantB, plan: 'pro' },
  ]);
  await postgrest(url, serviceKey, 'budgets', [
    {
      id: budgetAId,
      user_id: tenantA,
      name: 'foundation runtime A',
      limit_cents: 1_000,
      period: 'monthly',
      scope: 'key',
    },
  ]);
  await postgrest(url, serviceKey, 'api_keys', [
    {
      id: keyAId,
      user_id: tenantA,
      key_hash: createHash('sha256').update(keyA).digest('hex'),
      key_prefix: 'llmk_foundation_a',
      name: 'foundation runtime A',
      budget_id: budgetAId,
    },
    {
      id: keyBId,
      user_id: tenantB,
      key_hash: createHash('sha256').update(keyB).digest('hex'),
      key_prefix: 'llmk_foundation_b',
      name: 'foundation runtime B',
      budget_id: null,
    },
  ]);
  await postgrest(url, serviceKey, 'requests', [
    {
      id: receiptASettledId,
      user_id: tenantA,
      api_key_id: keyAId,
      customer_id: 'customer-runtime-a',
      workflow_id: 'workflow-runtime-a',
      agent_id: 'agent-runtime-a',
      session_id: 'session-runtime-a',
      end_user_id: 'end-user-runtime-a',
      budget_id: budgetAId,
      budget_reservation_id: '71000000-0000-4000-8000-0000000000a1',
      reserved_cost_cents: 13,
      idempotency_key_hash: 'a'.repeat(64),
      response_sha256: 'b'.repeat(64),
      requested_provider: 'openai',
      requested_model: 'foundation-model-a',
      last_dispatched_provider: 'openai',
      last_dispatched_model: 'foundation-model-a',
      provider_response_id: 'chatcmpl-runtime-a',
      dispatch_status: 'dispatched',
      provider: 'openai',
      model: 'foundation-model-a',
      input_tokens: 100,
      output_tokens: 25,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      cost_cents: 12.5,
      settlement_status: 'settled_actual',
      latency_ms: 100,
      status: 'success',
      error_code: null,
      source: 'proxy',
    },
    {
      id: receiptAUnknownId,
      user_id: tenantA,
      api_key_id: keyAId,
      customer_id: 'customer-runtime-a',
      workflow_id: 'workflow-runtime-a',
      agent_id: 'agent-runtime-a',
      session_id: 'session-runtime-a',
      end_user_id: 'end-user-runtime-a',
      budget_id: null,
      budget_reservation_id: null,
      reserved_cost_cents: null,
      idempotency_key_hash: null,
      response_sha256: null,
      requested_provider: null,
      requested_model: null,
      last_dispatched_provider: null,
      last_dispatched_model: null,
      provider_response_id: null,
      dispatch_status: null,
      provider: 'openai',
      model: 'foundation-model-a-unknown-cost',
      input_tokens: 20,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_cents: null,
      settlement_status: 'unknown',
      latency_ms: 80,
      status: 'error',
      error_code: 'UNKNOWN_COST_FIXTURE',
      source: 'proxy',
    },
    {
      id: receiptBId,
      user_id: tenantB,
      api_key_id: keyBId,
      customer_id: 'customer-runtime-b',
      workflow_id: 'workflow-runtime-b',
      agent_id: 'agent-runtime-b',
      session_id: 'session-runtime-b',
      end_user_id: 'end-user-runtime-b',
      budget_id: null,
      budget_reservation_id: null,
      reserved_cost_cents: null,
      idempotency_key_hash: null,
      response_sha256: null,
      requested_provider: null,
      requested_model: null,
      last_dispatched_provider: null,
      last_dispatched_model: null,
      provider_response_id: null,
      dispatch_status: null,
      provider: 'anthropic',
      model: 'tenant-b-private-model',
      input_tokens: 999,
      output_tokens: 99,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_cents: 999,
      settlement_status: 'settled_actual',
      latency_ms: 999,
      status: 'success',
      error_code: null,
      source: 'proxy',
    },
  ]);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error('Could not allocate a local Worker proof port.');
  return port;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForWorker(child, baseUrl, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited before readiness (${child.exitCode}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Worker readiness timed out after ${logs.length} log chunks.`);
}

async function fetchUsage(baseUrl, key) {
  const response = await fetch(`${baseUrl}/v1/analytics/usage?period=month`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  return { response, body: await response.json() };
}

async function fetchReceipt(baseUrl, key, receiptId) {
  const response = await fetch(`${baseUrl}/v1/analytics/receipts/${receiptId}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  return { response, body: await response.json() };
}

async function main() {
  if (!existsSync(supabaseLauncher) || !existsSync(wranglerLauncher) || !dockerReady(docker)) {
    throw new Error('Pinned Supabase CLI, Wrangler, and a ready Docker daemon are required.');
  }

  const { url, serviceKey } = readLocalStatus();
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  let worker;
  let proofError;
  try {
    await seedFixture(url, serviceKey);
    worker = spawn(process.execPath, [
      wranglerLauncher,
      'dev',
      '--local',
      '--port',
      String(port),
      '--var',
      `SUPABASE_URL:${url}`,
      '--var',
      `SUPABASE_KEY:${serviceKey}`,
    ], {
      cwd: proxyRoot,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const redact = (chunk) => String(chunk)
      .replaceAll(serviceKey, '[REDACTED]')
      .replaceAll(keyA, '[REDACTED]')
      .replaceAll(keyB, '[REDACTED]');
    worker.stdout.on('data', (chunk) => logs.push(redact(chunk)));
    worker.stderr.on('data', (chunk) => logs.push(redact(chunk)));
    await waitForWorker(worker, baseUrl, logs);

    const missing = await fetchUsage(baseUrl);
    assert(missing.response.status === 401, 'Missing bearer was not denied.');

    const usageA = await fetchUsage(baseUrl, keyA);
    assert(usageA.response.status === 200, `Tenant A usage returned ${usageA.response.status}.`);
    assert(usageA.body.requests === 2, 'Deployed aggregate signature did not return tenant A data.');
    assert(usageA.body.pricedRequests === 1, 'Tenant A priced-request count was incorrect.');
    assert(usageA.body.unknownCostRequests === 1, 'Tenant A unknown-cost count was erased.');
    assert(usageA.body.costComplete === false, 'Tenant A incomplete cost was marked complete.');
    assert(Number(usageA.body.totalCostCents) === 12.5, 'Tenant A cost total was incorrect.');
    assert(!JSON.stringify(usageA.body).includes('tenant-b-private-model'), 'Tenant B data leaked.');

    const settledReceipt = await fetchReceipt(baseUrl, keyA, receiptASettledId);
    assert(settledReceipt.response.status === 200, 'Tenant A could not read its settled receipt.');
    assert(
      settledReceipt.body.receipt?.id === receiptASettledId
        && settledReceipt.body.receipt?.customer_id === 'customer-runtime-a'
        && settledReceipt.body.receipt?.workflow_id === 'workflow-runtime-a'
        && settledReceipt.body.receipt?.agent_id === 'agent-runtime-a'
        && settledReceipt.body.receipt?.session_id === 'session-runtime-a'
        && settledReceipt.body.receipt?.budget_id === budgetAId
        && settledReceipt.body.receipt?.budget_reservation_id === '71000000-0000-4000-8000-0000000000a1'
        && settledReceipt.body.receipt?.settlement_status === 'settled_actual'
        && settledReceipt.body.receipt?.idempotency_key_hash === 'a'.repeat(64)
        && settledReceipt.body.receipt?.response_sha256 === 'b'.repeat(64)
        && settledReceipt.body.receipt?.requested_provider === 'openai'
        && settledReceipt.body.receipt?.requested_model === 'foundation-model-a'
        && settledReceipt.body.receipt?.last_dispatched_provider === 'openai'
        && settledReceipt.body.receipt?.last_dispatched_model === 'foundation-model-a'
        && settledReceipt.body.receipt?.provider_response_id === 'chatcmpl-runtime-a'
        && settledReceipt.body.receipt?.dispatch_status === 'dispatched',
      'Settled receipt detail lost dispatch, replay, or attribution evidence.',
    );
    const unknownReceipt = await fetchReceipt(baseUrl, keyA, receiptAUnknownId);
    assert(
      unknownReceipt.response.status === 200
        && unknownReceipt.body.receipt?.cost_cents === null
        && unknownReceipt.body.receipt?.settlement_status === 'unknown',
      'Unknown-cost receipt detail was erased or misclassified.',
    );
    const crossTenantReceipt = await fetchReceipt(baseUrl, keyB, receiptASettledId);
    assert(crossTenantReceipt.response.status === 404, 'Tenant B could read tenant A receipt detail.');
    const invalidReceipt = await fetchReceipt(baseUrl, keyA, 'not-a-uuid');
    assert(invalidReceipt.response.status === 400, 'Malformed receipt identity was accepted.');

    const usageB = await fetchUsage(baseUrl, keyB);
    assert(
      usageB.response.status === 200
        && usageB.body.requests === 1
        && usageB.body.pricedRequests === 1
        && usageB.body.unknownCostRequests === 0
        && usageB.body.costComplete === true
        && Number(usageB.body.totalCostCents) === 999,
      'Tenant B control result was incorrect.',
    );
    console.log('WORKER_DATABASE_COMPATIBILITY_PROOF PASS (real Worker + receipt API + hardened local schema)');
  } catch (error) {
    proofError = error;
  } finally {
    await stopProcess(worker);
    try {
      cleanupFixture();
      assertFixtureRemoved();
    } catch (cleanupError) {
      proofError = proofError
        ? new AggregateError([proofError, cleanupError], 'Proof and cleanup both failed.')
        : cleanupError;
    }
  }
  if (proofError) throw proofError;
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
