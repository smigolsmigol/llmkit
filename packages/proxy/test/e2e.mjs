// e2e test for llmkit proxy
// usage: start `pnpm dev` in packages/proxy, then run `node test/e2e.mjs`
// optional: set ANTHROPIC_API_KEY or OPENAI_API_KEY for provider tests

const BASE = process.env.PROXY_URL || 'http://localhost:8787';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
  }
}

function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label || 'mismatch'}: got ${actual}, want ${expected}`);
}

function ok(val, label) {
  if (!val) throw new Error(label || 'expected truthy value');
}

async function main() {
  console.log(`\nllmkit proxy e2e (${BASE})\n`);

  // --- core ---

  await test('GET /health', async () => {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json();
    eq(res.status, 200, 'status');
    eq(body.status, 'ok', 'body.status');
  });

  await test('missing auth -> 401', async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    eq(res.status, 401, 'status');
    const body = await res.json();
    eq(body.error.code, 'AUTH_ERROR', 'error code');
  });

  await test('dev mode auth passes, provider fails gracefully', async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer lk_test_12345678',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    // auth passes (not 401), but provider call fails (no real key)
    ok(res.status !== 401, 'should not be 401');
    const body = await res.json();
    ok(body.error, 'should return error from provider');
    eq(body.error.code, 'ALL_PROVIDERS_FAILED', 'error code');
  });

  await test('non-existent budget passes through', async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer lk_test_12345678',
        'Content-Type': 'application/json',
        'x-llmkit-budget-id': 'nonexistent-budget-id',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    // budget not found in KV = unlimited, should pass to provider
    ok(res.status !== 402, 'should not be budget exceeded');
  });

  // --- provider tests (optional, need real API keys) ---

  if (ANTHROPIC_KEY) {
    await test('anthropic chat completion with cost', async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer lk_test_12345678',
          'Content-Type': 'application/json',
          'x-llmkit-provider': 'anthropic',
          'x-llmkit-provider-key': ANTHROPIC_KEY,
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'respond with just the word "pong"' }],
          max_tokens: 10,
        }),
      });

      eq(res.status, 200, 'status');
      const body = await res.json();
      ok(body.content, 'should have content');
      ok(body.usage, 'should have usage');
      ok(body.usage.inputTokens > 0, 'input tokens > 0');
      ok(body.usage.outputTokens > 0, 'output tokens > 0');
      ok(body.cost, 'should have cost');
      ok(body.cost.totalCost > 0, 'total cost > 0');
      eq(body.cost.currency, 'USD', 'currency');
      eq(body.provider, 'anthropic', 'provider');
      console.log(`       -> "${body.content}" | $${body.cost.totalCost} | ${body.usage.totalTokens} tokens`);
    });

    await test('anthropic streaming with unified SSE', async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer lk_test_12345678',
          'Content-Type': 'application/json',
          'x-llmkit-provider': 'anthropic',
          'x-llmkit-provider-key': ANTHROPIC_KEY,
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'respond with just the word "pong"' }],
          max_tokens: 10,
          stream: true,
        }),
      });

      eq(res.status, 200, 'status');

      const text = await res.text();
      ok(text.includes('event: delta'), 'should have delta events');
      ok(text.includes('event: done'), 'should have done event');

      // collect text from delta events
      let streamedText = '';
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.text !== undefined) streamedText += data.text;
        } catch { /* skip */ }
      }
      ok(streamedText.length > 0, 'should have streamed text');

      // parse done event
      const doneLines = text.split('\n');
      const doneIdx = doneLines.findIndex(l => l === 'event: done');
      ok(doneIdx >= 0, 'should find done event');
      const doneData = JSON.parse(doneLines[doneIdx + 1].slice(6));
      ok(doneData.usage, 'done should have usage');
      ok(doneData.cost, 'done should have cost');
      ok(doneData.cost.totalCost > 0, 'cost > 0');
      console.log(`       -> "${streamedText}" | $${doneData.cost.totalCost}`);
    });
  } else {
    console.log('\n  skip anthropic tests (set ANTHROPIC_API_KEY)\n');
  }

  if (OPENAI_KEY) {
    await test('openai chat completion with cost', async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer lk_test_12345678',
          'Content-Type': 'application/json',
          'x-llmkit-provider': 'openai',
          'x-llmkit-provider-key': OPENAI_KEY,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'respond with just the word "pong"' }],
          max_tokens: 10,
        }),
      });

      eq(res.status, 200, 'status');
      const body = await res.json();
      ok(body.content, 'should have content');
      ok(body.cost.totalCost > 0, 'cost > 0');
      eq(body.provider, 'openai', 'provider');
      console.log(`       -> "${body.content}" | $${body.cost.totalCost}`);
    });
  } else {
    console.log('  skip openai tests (set OPENAI_API_KEY)\n');
  }

  // --- summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
