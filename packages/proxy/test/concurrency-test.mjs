// live budget concurrency test
// proves that Durable Objects enforce atomic budget enforcement under concurrent load
//
// prerequisites:
//   1. API key with a budget in Supabase (budget linked via budget_id FK)
//   2. Budget should be fresh (usedCents = 0) or you know the remaining amount
//
// usage:
//   API_KEY=lk_xxx node test/concurrency-test.mjs
//   API_KEY=lk_xxx BASE_URL=http://localhost:8787 node test/concurrency-test.mjs
//
// the test fires N concurrent requests and counts how many pass budget check vs get rejected.
// requests will fail at the provider stage (no provider key needed), but that's fine:
// we're testing the budget gate, not the LLM call.

const BASE = process.env.BASE_URL || 'https://llmkit-proxy.smigolsmigol.workers.dev';
const API_KEY = process.env.API_KEY;
const CONCURRENCY = Number(process.env.N) || 20;

if (!API_KEY) {
  console.error('API_KEY env var required');
  console.error('usage: API_KEY=lk_xxx node test/concurrency-test.mjs');
  process.exit(1);
}

async function chatRequest(id) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
    });
    const json = await res.json().catch(() => null);
    const ms = Date.now() - start;
    return { id, status: res.status, code: json?.error?.code, ms };
  } catch (err) {
    return { id, status: 0, code: 'NETWORK_ERROR', ms: Date.now() - start, err: err.message };
  }
}

console.log(`target: ${BASE}`);
console.log(`firing ${CONCURRENCY} concurrent requests\n`);

const results = await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, i) => chatRequest(i)),
);

const budgetBlocked = results.filter(r => r.code === 'BUDGET_EXCEEDED');
const rateLimited = results.filter(r => r.code === 'RATE_LIMITED');
const authFailed = results.filter(r => r.code === 'AUTH_ERROR');
const providerFailed = results.filter(r => r.code === 'PROVIDER_ERROR' || r.code === 'ALL_PROVIDERS_FAILED');
const succeeded = results.filter(r => r.status === 200);
const other = results.filter(r =>
  !['BUDGET_EXCEEDED', 'RATE_LIMITED', 'AUTH_ERROR', 'PROVIDER_ERROR', 'ALL_PROVIDERS_FAILED'].includes(r.code)
  && r.status !== 200,
);

console.log('results:');
for (const r of results.sort((a, b) => a.id - b.id)) {
  const label = r.code === 'BUDGET_EXCEEDED' ? 'BUDGET'
    : r.code === 'RATE_LIMITED' ? 'RATELIMIT'
    : r.status === 200 ? 'OK'
    : r.code || `HTTP ${r.status}`;
  console.log(`  #${String(r.id).padStart(2)}  ${label.padEnd(25)} ${r.ms}ms`);
}

console.log(`\nsummary:`);
console.log(`  ${succeeded.length} succeeded (200)`);
console.log(`  ${providerFailed.length} passed budget, failed at provider`);
console.log(`  ${budgetBlocked.length} budget-rejected`);
console.log(`  ${rateLimited.length} rate-limited`);
if (authFailed.length) console.log(`  ${authFailed.length} auth failures`);
if (other.length) console.log(`  ${other.length} other errors`);

const passedBudget = succeeded.length + providerFailed.length;
console.log(`\n${passedBudget} requests got past the budget gate`);

if (budgetBlocked.length === 0 && CONCURRENCY > 5) {
  console.log('\nWARNING: zero budget rejections. either:');
  console.log('  - this API key has no budget configured');
  console.log('  - the budget limit is high enough for all requests');
  console.log('  - the budget DO was never initialized (BUG - check configure/lazy-init)');
}

if (authFailed.length === CONCURRENCY) {
  console.log('\nERROR: all requests failed auth. check your API_KEY.');
}

// the real assertion: total cost of allowed requests should not exceed the budget
// we can't know the exact budget here, but we report the numbers for manual verification
console.log('\nto verify: check the budget in Supabase and confirm passedBudget * estimated_cost <= limit_cents');
