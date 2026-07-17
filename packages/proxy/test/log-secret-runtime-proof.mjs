import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const workerPort = 8787;
const providerPort = 11434;
const workerUrl = `http://127.0.0.1:${workerPort}`;
const bearerCanary = `llmk_runtime_bearer_${crypto.randomUUID().replaceAll('-', '')}`;
const providerCanary = `provider_runtime_secret_${crypto.randomUUID().replaceAll('-', '')}`;
const displayedBearerPrefix = `${bearerCanary.slice(0, 8)}...`;
const proxyRoot = resolve(import.meta.dirname, '..');
const wranglerBin = resolve(proxyRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForWorker(child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited before readiness with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${workerUrl}/health`);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Wrangler. Captured ${logs.length} log chunks.`);
}

async function waitForCostLog(logs) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (logs.join('').includes('"provider":"ollama"')) return;
    await sleep(125);
  }
  throw new Error('The successful request did not reach the cost logger.');
}

let providerSawSecret = false;
const provider = createServer((request, response) => {
  providerSawSecret = request.headers.authorization === `Bearer ${providerCanary}`;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    id: 'chatcmpl-runtime-proof',
    model: 'runtime-proof-model',
    choices: [{
      message: { role: 'assistant', content: 'runtime-proof-ok' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  }));
});

let worker;
try {
  await new Promise((resolvePromise, reject) => {
    provider.once('error', reject);
    provider.listen(providerPort, '127.0.0.1', resolvePromise);
  });

  const logs = [];
  worker = spawn(process.execPath, [
    wranglerBin,
    'dev',
    '--local',
    '--port',
    String(workerPort),
    '--var',
    'DEV_MODE:true',
  ], {
    cwd: proxyRoot,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  worker.stdout.on('data', (chunk) => logs.push(String(chunk)));
  worker.stderr.on('data', (chunk) => logs.push(String(chunk)));

  await waitForWorker(worker, logs);
  const response = await fetch(`${workerUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerCanary}`,
      'Content-Type': 'application/json',
      'x-llmkit-provider': 'ollama',
      'x-llmkit-provider-key': providerCanary,
    },
    body: JSON.stringify({
      model: 'runtime-proof-model',
      messages: [{ role: 'user', content: 'runtime proof' }],
    }),
  });
  const body = await response.json();
  assert(response.status === 200, `Proof request returned ${response.status}: ${JSON.stringify(body)}`);
  assert(
    body.choices?.[0]?.message?.content === 'runtime-proof-ok',
    'Mock provider response did not traverse the Worker.',
  );
  assert(providerSawSecret, 'The provider credential did not reach the mock provider as an outbound secret.');

  await waitForCostLog(logs);
  const combinedLogs = logs.join('');
  assert(!combinedLogs.includes(bearerCanary), 'Runtime logs exposed the full LLMKit bearer canary.');
  assert(!combinedLogs.includes(displayedBearerPrefix), 'Runtime logs exposed the LLMKit key display prefix.');
  assert(!combinedLogs.includes(providerCanary), 'Runtime logs exposed the provider-key canary.');

  console.log('LOG_SECRET_RUNTIME_PROOF PASS (real Worker + mock provider)');
} finally {
  await stopProcess(worker);
  await new Promise((resolvePromise) => provider.close(resolvePromise));
}
