// live API tests - requires real provider keys and running proxy
// usage: OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... node test/live-test.mjs

const BASE = 'http://localhost:8787';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!OPENAI_KEY && !ANTHROPIC_KEY && !GEMINI_KEY) {
  console.error('set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY');
  process.exit(1);
}

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// shared SSE parser - reads stream, returns { chunks: string[], doneEvent }
async function parseSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const chunks = [];
  let doneEvent = null;
  let nextIsData = null; // 'delta' or 'done'

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line === 'event: delta') {
        nextIsData = 'delta';
      } else if (line === 'event: done') {
        nextIsData = 'done';
      } else if (line.startsWith('data: ') && nextIsData) {
        const payload = JSON.parse(line.slice(6));
        if (nextIsData === 'delta' && payload.text) {
          chunks.push(payload.text);
        } else if (nextIsData === 'done') {
          doneEvent = payload;
        }
        nextIsData = null;
      }
    }
  }

  return { chunks, doneEvent };
}

// --- LIVE OPENAI TESTS ---

test('openai chat completion', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': OPENAI_KEY,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reply with exactly: pong' }],
      temperature: 0,
      max_tokens: 10,
    }),
  });

  assert(res.status === 200, `expected 200, got ${res.status}`);
  const json = await res.json();

  console.log('        response:', JSON.stringify(json, null, 2).split('\n').slice(0, 8).join('\n'));

  assert(json.provider === 'openai', `expected provider openai, got ${json.provider}`);
  assert(json.model, 'missing model');
  assert(json.content, 'missing content');
  assert(json.content.toLowerCase().includes('pong'), `expected pong, got: ${json.content}`);
  assert(json.usage, 'missing usage');
  assert(json.usage.inputTokens > 0, 'inputTokens should be > 0');
  assert(json.usage.outputTokens > 0, 'outputTokens should be > 0');
  assert(json.cost, 'missing cost');
  assert(json.cost.totalCost > 0, 'totalCost should be > 0');
  assert(json.cost.currency === 'USD', `expected USD, got ${json.cost.currency}`);
  assert(typeof json.latencyMs === 'number', 'missing latencyMs');
});

test('openai streaming', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': OPENAI_KEY,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reply with exactly one word: hello' }],
      temperature: 0,
      max_tokens: 5,
      stream: true,
    }),
  });

  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.headers.get('content-type')?.includes('text/event-stream'), 'expected SSE content-type');

  const { chunks, doneEvent } = await parseSSE(res);
  const fullText = chunks.join('');
  console.log(`        streamed: "${fullText}" (${chunks.length} chunks)`);

  assert(chunks.length > 0, 'expected at least 1 text chunk');
  assert(fullText.length > 0, 'expected non-empty streamed text');
  assert(doneEvent, 'missing done event');
  assert(doneEvent.usage, 'done event missing usage');
  assert(doneEvent.usage.inputTokens > 0, 'inputTokens should be > 0');
  assert(doneEvent.cost, 'done event missing cost');
  assert(doneEvent.cost.totalCost > 0, 'totalCost should be > 0');
  console.log(`        cost: $${doneEvent.cost.totalCost}`);
});

test('openai with maxTokens camelCase', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': OPENAI_KEY,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'say hi' }],
      maxTokens: 5,
    }),
  });

  assert(res.status === 200, `expected 200, got ${res.status}`);
  const json = await res.json();
  assert(json.usage.outputTokens <= 10, `maxTokens not respected, got ${json.usage.outputTokens} tokens`);
});

test('openai wrong model -> provider error (not crash)', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': OPENAI_KEY,
    },
    body: JSON.stringify({
      model: 'gpt-nonexistent-9000',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });

  // should be 503 (provider failed) not 500 (crash)
  assert(res.status === 503, `expected 503, got ${res.status}`);
  const json = await res.json();
  assert(json.error, 'expected error in response');
});

test('fallback chain openai -> openai (same, tests the loop)', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': OPENAI_KEY,
      'x-llmkit-fallback': 'openai',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reply with exactly one word: yes' }],
      temperature: 0,
      max_tokens: 5,
    }),
  });

  assert(res.status === 200, `expected 200, got ${res.status}`);
  const json = await res.json();
  assert(json.content, 'missing content');
});

// --- LIVE ANTHROPIC TESTS ---

if (ANTHROPIC_KEY) {

test('anthropic chat completion', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'anthropic',
      'x-llmkit-provider-key': ANTHROPIC_KEY,
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'reply with exactly: pong' }],
      temperature: 0,
      max_tokens: 10,
    }),
  });

  if (res.status !== 200) {
    const body = await res.text();
    const err = new Error(`expected 200, got ${res.status}`);
    err.responseBody = body;
    throw err;
  }
  const json = await res.json();

  console.log('        response:', JSON.stringify(json, null, 2).split('\n').slice(0, 8).join('\n'));

  assert(json.provider === 'anthropic', `expected provider anthropic, got ${json.provider}`);
  assert(json.model, 'missing model');
  assert(json.content, 'missing content');
  assert(json.usage, 'missing usage');
  assert(json.usage.inputTokens > 0, 'inputTokens should be > 0');
  assert(json.usage.outputTokens > 0, 'outputTokens should be > 0');
  assert(json.cost, 'missing cost');
  assert(json.cost.totalCost > 0, 'totalCost should be > 0');
});

test('anthropic streaming', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'anthropic',
      'x-llmkit-provider-key': ANTHROPIC_KEY,
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'reply with exactly: ok' }],
      temperature: 0,
      max_tokens: 5,
      stream: true,
    }),
  });

  assert(res.status === 200, `expected 200, got ${res.status}`);

  const { chunks, doneEvent } = await parseSSE(res);
  const fullText = chunks.join('');
  console.log(`        streamed: "${fullText}" (${chunks.length} chunks)`);

  assert(chunks.length > 0, 'expected at least 1 text chunk');
  assert(doneEvent, 'missing done event');
  assert(doneEvent.usage, 'done event missing usage');
  assert(doneEvent.cost, 'done event missing cost');
  assert(doneEvent.cost.totalCost > 0, 'totalCost should be > 0');
  console.log(`        cost: $${doneEvent.cost.totalCost}`);
});

} // end ANTHROPIC_KEY block

// --- LIVE GEMINI TESTS ---

if (GEMINI_KEY) {

test('gemini chat completion', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'gemini',
      'x-llmkit-provider-key': GEMINI_KEY,
    },
    body: JSON.stringify({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'reply with exactly: pong' }],
      temperature: 0,
      max_tokens: 10,
    }),
  });

  if (res.status !== 200) {
    const body = await res.text();
    const err = new Error(`expected 200, got ${res.status}`);
    err.responseBody = body;
    throw err;
  }
  const json = await res.json();

  console.log('        response:', JSON.stringify(json, null, 2).split('\n').slice(0, 8).join('\n'));

  assert(json.provider === 'gemini', `expected provider gemini, got ${json.provider}`);
  assert(json.model, 'missing model');
  assert(json.content, 'missing content');
  assert(json.usage, 'missing usage');
  assert(json.usage.inputTokens > 0, 'inputTokens should be > 0');
  assert(json.cost, 'missing cost');
});

test('gemini streaming', async () => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
      'x-llmkit-provider': 'gemini',
      'x-llmkit-provider-key': GEMINI_KEY,
    },
    body: JSON.stringify({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'reply with exactly: ok' }],
      temperature: 0,
      max_tokens: 5,
      stream: true,
    }),
  });

  assert(res.status === 200, `expected 200, got ${res.status}`);

  const { chunks, doneEvent } = await parseSSE(res);
  const fullText = chunks.join('');
  console.log(`        streamed: "${fullText}" (${chunks.length} chunks)`);

  assert(chunks.length > 0, 'expected at least 1 text chunk');
  assert(doneEvent, 'missing done event');
  assert(doneEvent.usage, 'done event missing usage');
  assert(doneEvent.cost, 'done event missing cost');
  console.log(`        cost: $${doneEvent.cost.totalCost}`);
});

} // end GEMINI_KEY block

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} live tests against ${BASE}\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
      if (err.responseBody) console.log(`        response: ${err.responseBody}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length}\n`);
  if (failed > 0) process.exit(1);
}

run();
