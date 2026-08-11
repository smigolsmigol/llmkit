// SDK hosted-client boundary tests.
// usage: node packages/sdk/test/client-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

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
