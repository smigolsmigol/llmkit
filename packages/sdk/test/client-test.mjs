// SDK hosted-client boundary tests.
// usage: node packages/sdk/test/client-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function assertRejects(operation, expected) {
  try {
    await operation();
  } catch (error) {
    assert(error.message.includes(expected), `expected ${expected}, got ${error.message}`);
    return;
  }
  throw new Error(`expected rejection containing ${expected}`);
}

const { LLMKit } = await import('../dist/client.js');

async function captureRequest(config) {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ content: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await new LLMKit(config).chat({ model: 'gpt-4.1', messages: [] });
    return request;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('hosted client uses the canonical API origin', async () => {
  const request = await captureRequest({ apiKey: 'llmk_test' });
  assert(
    request?.url === 'https://api.llmkit.sh/v1/chat/completions',
    `unexpected URL: ${request?.url}`,
  );
});

test('explicit self-hosted origin remains authoritative', async () => {
  const request = await captureRequest({ apiKey: 'llmk_test', baseUrl: 'http://127.0.0.1:8787' });
  assert(
    request?.url === 'http://127.0.0.1:8787/v1/chat/completions',
    `unexpected URL: ${request?.url}`,
  );
});

test('self-hosted trailing slash is normalized and request headers are preserved', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ content: 'ok' }), { status: 200 });
  };
  try {
    const client = new LLMKit({
      apiKey: 'llmk_test',
      baseUrl: 'http://127.0.0.1:8787/',
      sessionId: 'session-1',
    });
    await client.chat({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert(request.url === 'http://127.0.0.1:8787/v1/chat/completions', request.url);
    assert(request.init.headers['x-llmkit-session-id'] === 'session-1', 'session header');
    assert(request.init.headers['x-llmkit-provider'] === 'anthropic', 'provider header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('session creates an isolated ID and plain-text errors remain visible', async () => {
  const originalFetch = globalThis.fetch;
  let sessionHeader;
  globalThis.fetch = async (_url, init) => {
    sessionHeader = init.headers['x-llmkit-session-id'];
    return new Response('gateway unavailable', { status: 503, statusText: 'Service Unavailable' });
  };
  try {
    const client = new LLMKit({ apiKey: 'llmk_test' }).session('task-1');
    await assertRejects(
      () => client.chat({ model: 'gpt-4.1', messages: [] }),
      'gateway unavailable',
    );
    assert(sessionHeader === 'task-1', 'explicit session ID');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatStream parses final unterminated SSE data and exposes metadata', async () => {
  const originalFetch = globalThis.fetch;
  const sse = [
    'event: delta',
    'data: {"text":"hello"}',
    '',
    'data: not-json',
    '',
    'event: done',
    'data: {"usage":{"inputTokens":3,"outputTokens":1},"cost":{"totalCost":0.01},"model":"gpt-4.1","provider":"openai","id":"resp-1"}',
  ].join('\n');
  globalThis.fetch = async () => new Response(sse, { status: 200 });
  try {
    const stream = await new LLMKit({ apiKey: 'llmk_test' }).chatStream({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert(chunks.join('') === 'hello', `chunks: ${chunks.join('')}`);
    assert(stream.usage.inputTokens === 3, 'usage');
    assert(stream.cost.totalCost === 0.01, 'cost');
    assert(stream.model === 'gpt-4.1' && stream.provider === 'openai', 'routing metadata');
    assert(stream.id === 'resp-1', 'response ID');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatStream rejects connection errors and missing bodies', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'budget exceeded' } }),
      { status: 402 },
    );
    await assertRejects(
      () => new LLMKit({ apiKey: 'k' }).chatStream({ model: 'gpt', messages: [] }),
      'budget exceeded',
    );

    globalThis.fetch = async () => new Response(null, { status: 200 });
    const stream = await new LLMKit({ apiKey: 'k' }).chatStream({ model: 'gpt', messages: [] });
    await assertRejects(async () => {
      for await (const _chunk of stream) {
        // no chunks expected
      }
    }, 'No response body');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const entry of tests) {
  try {
    await entry.fn();
    passed++;
    console.log(`  PASS  ${entry.name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${entry.name}: ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
