// budget pure function tests
// tests estimateCost, affordableMaxTokens, nextReset, periodMs
// usage: node test/budget-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertClose(a, b, epsilon, msg) {
  if (Math.abs(a - b) > epsilon) throw new Error(`${msg}: ${a} not close to ${b}`);
}

// --- import shared pricing ---
const { getModelPricing } = await import('../../shared/dist/providers.js');

// --- re-implement pure functions from budget.ts + budget-do.ts ---
// (these can't be imported directly since they use CF Workers types)

// conservative fallback for unpriced models (mirrors pricing.ts UNPRICED_FALLBACK)
const UNPRICED_FALLBACK = { inputPerMillion: 10, outputPerMillion: 30 };

function resolvePricingSync(provider, model) {
  return getModelPricing(provider, model) || UNPRICED_FALLBACK;
}

function estimateCost(body, provider) {
  const model = body.model;
  if (!model) return 0;

  const pricing = resolvePricingSync(provider, model);

  const messages = body.messages;
  const inputChars = messages
    ? messages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
    : 0;
  const inputTokens = Math.ceil(inputChars / 4);
  const maxOutput = body.max_tokens || body.maxTokens || 1024;

  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (maxOutput / 1_000_000) * pricing.outputPerMillion;

  return Math.ceil(costUsd * 100);
}

function affordableMaxTokens(remainingCents, body, provider) {
  const model = body.model;
  if (!model) return undefined;

  const pricing = resolvePricingSync(provider, model);
  if (pricing.outputPerMillion === 0) return undefined;

  const messages = body.messages;
  const inputChars = messages
    ? messages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
    : 0;
  const inputTokens = Math.ceil(inputChars / 4);
  const inputCostCents = ((inputTokens / 1_000_000) * pricing.inputPerMillion) * 100;

  const centsForOutput = remainingCents - inputCostCents;
  if (centsForOutput <= 0) return 0;

  const affordable = Math.floor((centsForOutput / 100 / pricing.outputPerMillion) * 1_000_000);
  const userMax = body.max_tokens ?? body.maxTokens;

  if (userMax && affordable >= userMax) return undefined;

  return affordable;
}

const DAY_MS = 86_400_000;

function nextReset(period) {
  const now = new Date();

  if (period === 'daily') {
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next.getTime();
  }

  if (period === 'weekly') {
    const next = new Date(now);
    const daysUntilMonday = (8 - next.getUTCDay()) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    next.setUTCHours(0, 0, 0, 0);
    return next.getTime();
  }

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();
}

function periodMs(period) {
  if (period === 'daily') return DAY_MS;
  if (period === 'weekly') return 7 * DAY_MS;
  return 30 * DAY_MS;
}

// ============================
// estimateCost
// ============================

test('estimateCost: gpt-4o-mini short message', () => {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 100,
  };
  const cents = estimateCost(body, 'openai');
  // 5 chars -> ceil(5/4) = 2 tokens input
  // input: 2/1M * 0.15 = 0.0000003 USD
  // output: 100/1M * 0.6 = 0.00006 USD
  // total: 0.0000603 USD = 0.00603 cents -> ceil = 1
  assert(cents === 1, `expected 1 cent, got ${cents}`);
});

test('estimateCost: claude-opus-4 large context', () => {
  const body = {
    model: 'claude-opus-4-20250514',
    messages: [{ role: 'user', content: 'x'.repeat(40_000) }],
    max_tokens: 4096,
  };
  const cents = estimateCost(body, 'anthropic');
  // 40K chars -> 10K tokens
  // input: 10000/1M * 15 = 0.15 USD
  // output: 4096/1M * 75 = 0.3072 USD
  // total: 0.4572 USD = 45.72 cents -> ceil = 46
  assert(cents === 46, `expected 46 cents, got ${cents}`);
});

test('estimateCost: no model -> 0', () => {
  const cents = estimateCost({ messages: [] }, 'openai');
  assert(cents === 0, `expected 0, got ${cents}`);
});

test('estimateCost: unknown model uses fallback pricing', () => {
  const body = { model: 'gpt-99', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1024 };
  const cents = estimateCost(body, 'openai');
  // fallback: $10/$30 per 1M tokens
  // input: ceil(2/4)=1 token, 1/1M * 10 = tiny
  // output: 1024/1M * 30 = 0.03072 USD = 3.072 cents -> ceil = 4
  assert(cents > 0, `expected positive cost for unknown model (fallback pricing), got ${cents}`);
  assert(cents === 4, `expected 4 cents with fallback pricing, got ${cents}`);
});

test('estimateCost: defaults to 1024 max_tokens if not specified', () => {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    // no max_tokens
  };
  const cents = estimateCost(body, 'openai');
  // 2 chars -> 1 token input, 1024 default output
  // output: 1024/1M * 0.6 = 0.0006144
  // ceil(0.0006144 * 100) = ceil(0.06144) = 1
  assert(cents === 1, `expected 1 cent with default max_tokens, got ${cents}`);
});

test('estimateCost: accepts camelCase maxTokens', () => {
  const body = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 500,
  };
  const cents = estimateCost(body, 'openai');
  // input: ceil(2/4)=1 token, 1/1M * 2.5 = tiny
  // output: 500/1M * 10.0 = 0.005 USD = 0.5 cents -> ceil = 1
  assert(cents >= 1, `expected at least 1 cent, got ${cents}`);
});

// ============================
// affordableMaxTokens
// ============================

test('affordableMaxTokens: plenty of budget -> undefined (no clamping)', () => {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
  };
  const result = affordableMaxTokens(1000, body, 'openai');
  // remaining: 1000 cents = $10. Can afford way more than 100 tokens.
  assert(result === undefined, `expected undefined (no clamp), got ${result}`);
});

test('affordableMaxTokens: tight budget -> returns clamped value', () => {
  const body = {
    model: 'claude-opus-4-20250514',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 10000,
  };
  // remaining: 10 cents = $0.10
  // input: ceil(2/4)=1 token, cost ~= 0
  // cents for output: ~10 cents = $0.10
  // affordable: floor(0.10 / 75 * 1M) = floor(1333.3) = 1333
  const result = affordableMaxTokens(10, body, 'anthropic');
  assert(typeof result === 'number', `expected number, got ${typeof result}`);
  assert(result > 0 && result < 10000, `expected clamped value, got ${result}`);
  assertClose(result, 1333, 5, 'affordable tokens');
});

test('affordableMaxTokens: no budget left -> returns 0', () => {
  const body = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'x'.repeat(4000) }], // 1000 input tokens
    max_tokens: 1000,
  };
  // remaining: 0 cents
  const result = affordableMaxTokens(0, body, 'openai');
  assert(result === 0, `expected 0, got ${result}`);
});

test('affordableMaxTokens: no model -> undefined', () => {
  const result = affordableMaxTokens(100, { messages: [] }, 'openai');
  assert(result === undefined, `expected undefined for no model, got ${result}`);
});

test('affordableMaxTokens: unknown model uses fallback pricing', () => {
  const body = { model: 'gpt-99', messages: [], max_tokens: 100000 };
  const result = affordableMaxTokens(100, body, 'openai');
  // fallback output: $30/1M. 100 cents = $1. affordable = floor(1/30 * 1M) = 33333
  // 33333 < 100000 so it should clamp
  assert(typeof result === 'number', `expected number for unknown model (fallback), got ${typeof result}`);
  assert(result > 0, `expected positive affordable tokens, got ${result}`);
  assertClose(result, 33333, 5, 'affordable tokens with fallback');
});

// ============================
// nextReset
// ============================

test('nextReset daily: returns a future timestamp', () => {
  const ts = nextReset('daily');
  assert(ts > Date.now(), 'daily reset should be in the future');
  const d = new Date(ts);
  assert(d.getUTCHours() === 0 && d.getUTCMinutes() === 0, 'should be midnight UTC');
});

test('nextReset weekly: returns a future Monday', () => {
  const ts = nextReset('weekly');
  assert(ts > Date.now(), 'weekly reset should be in the future');
  const d = new Date(ts);
  assert(d.getUTCDay() === 1, `should be Monday (1), got ${d.getUTCDay()}`);
  assert(d.getUTCHours() === 0, 'should be midnight UTC');
});

test('nextReset monthly: returns 1st of next month', () => {
  const ts = nextReset('monthly');
  assert(ts > Date.now(), 'monthly reset should be in the future');
  const d = new Date(ts);
  assert(d.getUTCDate() === 1, `should be 1st, got ${d.getUTCDate()}`);
  assert(d.getUTCHours() === 0, 'should be midnight UTC');
});

// ============================
// periodMs
// ============================

test('periodMs: daily = 86400000', () => {
  assert(periodMs('daily') === 86_400_000, `got ${periodMs('daily')}`);
});

test('periodMs: weekly = 604800000', () => {
  assert(periodMs('weekly') === 7 * 86_400_000, `got ${periodMs('weekly')}`);
});

test('periodMs: monthly = 2592000000', () => {
  assert(periodMs('monthly') === 30 * 86_400_000, `got ${periodMs('monthly')}`);
});

test('periodMs: unknown defaults to 30 days', () => {
  assert(periodMs('total') === 30 * 86_400_000, `got ${periodMs('total')}`);
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} budget pure function tests\n`);

  for (const t of tests) {
    try {
      t.fn();
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
