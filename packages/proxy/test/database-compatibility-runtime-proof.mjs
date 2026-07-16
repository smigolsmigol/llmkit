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
const keyAId = '60000000-0000-4000-8000-0000000000a1';
const keyBId = '60000000-0000-4000-8000-0000000000b1';
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
    throw new Error(`Fixture insert ${path} failed (${response.status}).`);
  }
}

async function seedFixture(url, serviceKey) {
  cleanupFixture();
  await postgrest(url, serviceKey, 'accounts', [
    { user_id: tenantA, plan: 'pro' },
    { user_id: tenantB, plan: 'pro' },
  ]);
  await postgrest(url, serviceKey, 'api_keys', [
    {
      id: keyAId,
      user_id: tenantA,
      key_hash: createHash('sha256').update(keyA).digest('hex'),
      key_prefix: 'llmk_foundation_a',
      name: 'foundation runtime A',
    },
    {
      id: keyBId,
      user_id: tenantB,
      key_hash: createHash('sha256').update(keyB).digest('hex'),
      key_prefix: 'llmk_foundation_b',
      name: 'foundation runtime B',
    },
  ]);
  await postgrest(url, serviceKey, 'requests', [
    {
      user_id: tenantA,
      api_key_id: keyAId,
      provider: 'openai',
      model: 'foundation-model-a',
      input_tokens: 100,
      output_tokens: 25,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      cost_cents: 12.5,
      latency_ms: 100,
      status: 'success',
      source: 'proxy',
    },
    {
      user_id: tenantB,
      api_key_id: keyBId,
      provider: 'anthropic',
      model: 'tenant-b-private-model',
      input_tokens: 999,
      output_tokens: 99,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_cents: 999,
      latency_ms: 999,
      status: 'success',
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
    assert(usageA.body.requests === 1, 'Deployed aggregate signature did not return tenant A data.');
    assert(Number(usageA.body.totalCostCents) === 12.5, 'Tenant A cost total was incorrect.');
    assert(!JSON.stringify(usageA.body).includes('tenant-b-private-model'), 'Tenant B data leaked.');

    const usageB = await fetchUsage(baseUrl, keyB);
    assert(
      usageB.response.status === 200
        && usageB.body.requests === 1
        && Number(usageB.body.totalCostCents) === 999,
      'Tenant B control result was incorrect.',
    );
    console.log('WORKER_DATABASE_COMPATIBILITY_PROOF PASS (real Worker + hardened local schema)');
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
