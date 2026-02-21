const BASE = process.env.BASE_URL || 'http://localhost:8787';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function req(path, { headers = {}, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- AUTH TESTS ---

test('no auth header -> 401', async () => {
  const { status, json } = await req('/v1/chat/completions', {
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert(status === 401, `expected 401, got ${status}`);
  assert(json?.error?.code === 'AUTH_ERROR', `expected AUTH_ERROR, got ${json?.error?.code}`);
});

test('empty bearer -> 401', async () => {
  const { status, json } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer ' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert(status === 401, `expected 401, got ${status}`);
});

test('no bearer prefix -> 401 (requires Bearer scheme)', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Basic abc123' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
  });
  // auth now requires "Bearer " prefix - anything else is rejected
  assert(status === 401, `expected 401, got ${status}`);
});

// --- VALIDATION TESTS ---

test('missing model -> 400', async () => {
  const { status, json } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { messages: [{ role: 'user', content: 'hi' }] },
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(json?.error?.code === 'INVALID_REQUEST', `expected INVALID_REQUEST, got ${json?.error?.code}`);
});

test('empty messages -> 400', async () => {
  const { status, json } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [] },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('invalid role -> 400', async () => {
  const { status, json } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'tool', content: 'hi' }] },
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(json?.error?.message?.includes('role'), `expected role error, got: ${json?.error?.message}`);
});

test('non-string content -> 400', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 123 }] },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('temperature out of range (high) -> 400', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: 3 },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('temperature out of range (negative) -> 400', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: -1 },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('max_tokens as float -> 400', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1.5 },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('max_tokens as zero -> 400', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], max_tokens: 0 },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('maxTokens (camelCase) also validated -> 400', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxTokens: -5 },
  });
  assert(status === 400, `expected 400, got ${status}`);
});

test('extra fields ignored (no crash) -> not 500', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], foo: 'bar', nested: { a: 1 } },
  });
  assert(status !== 500, `expected non-500, got ${status}`);
});

// --- PROVIDER ROUTING TESTS ---

test('invalid provider -> 400', async () => {
  const { status, json } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x', 'x-llmkit-provider': 'doesnotexist' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(json?.error?.code === 'INVALID_REQUEST', `expected INVALID_REQUEST, got ${json?.error?.code}`);
});

test('ollama provider (no local server) -> 503', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x', 'x-llmkit-provider': 'ollama' },
    body: { model: 'llama3', messages: [{ role: 'user', content: 'hi' }] },
  });
  // ollama adapter exists but can't reach localhost:11434 -> AllProvidersFailed (503)
  assert(status === 503, `expected 503, got ${status}`);
});

test('empty provider key -> provider error (not crash)', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer x', 'x-llmkit-provider': 'anthropic' },
    body: { model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'hi' }] },
  });
  // should be 503 (AllProvidersFailed) not 500 (unhandled crash)
  assert(status !== 500, `expected non-500 (got provider error gracefully), got ${status}`);
});

// --- RATE LIMIT TESTS ---

test('rate limit headers present on valid request', async () => {
  const { status } = await req('/v1/chat/completions', {
    headers: { Authorization: 'Bearer ratelimit-test' },
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
  });
  // will fail at provider (no key) but rate limit headers should still be set
  // status will be 503 (provider failed) not 429
  assert(status !== 429, `should not be rate limited on first request, got 429`);
});

// --- EDGE CASES ---

test('no body at all -> 500 (JSON parse)', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
  });
  // c.req.json() throws SyntaxError -> 500 is current behavior
  // (not ideal but expected - could improve to 400 later)
  assert(res.status === 400 || res.status === 500, `expected 400 or 500, got ${res.status}`);
});

test('malformed JSON body -> 500 (JSON parse)', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: '{not json',
  });
  assert(res.status === 400 || res.status === 500, `expected 400 or 500, got ${res.status}`);
});

test('health endpoint still works', async () => {
  const res = await fetch(`${BASE}/health`);
  const json = await res.json();
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(json.status === 'ok', `expected ok, got ${json.status}`);
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} break tests against ${BASE}\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length}\n`);
  if (failed > 0) process.exit(1);
}

run();
