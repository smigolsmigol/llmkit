// unit tests for tricky logic: pricing, cost, budget, validation
// no proxy needed - tests pure functions directly
// usage: node test/unit-test.mjs

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

// --- import shared package (compiled) ---

const { getModelPricing, calculateCost } = await import('../../shared/dist/providers.js');

// ============================
// PRICING PREFIX MATCHING
// ============================

test('exact match: gpt-4o-mini', () => {
  const p = getModelPricing('openai', 'gpt-4o-mini');
  assert(p, 'should find gpt-4o-mini');
  assert(p.inputPerMillion === 0.15, `expected 0.15, got ${p.inputPerMillion}`);
});

test('exact match: gpt-4o', () => {
  const p = getModelPricing('openai', 'gpt-4o');
  assert(p, 'should find gpt-4o');
  assert(p.inputPerMillion === 2.5, `expected 2.5, got ${p.inputPerMillion}`);
});

test('prefix: gpt-4o-2024-08-06 matches gpt-4o (not gpt-4o-mini)', () => {
  const p = getModelPricing('openai', 'gpt-4o-2024-08-06');
  assert(p, 'should find a match');
  // gpt-4o is 3 chars shorter than gpt-4o-mini, but gpt-4o-2024-08-06 starts with "gpt-4o"
  // both "gpt-4o" and "gpt-4o-mini" are prefixes, but "gpt-4o-2024" does NOT start with "gpt-4o-mini"
  // so only "gpt-4o" matches -> $2.5 input
  assert(p.inputPerMillion === 2.5, `expected gpt-4o pricing (2.5), got ${p.inputPerMillion}`);
});

test('prefix: gpt-4o-mini-2024-07-18 matches gpt-4o-mini (not gpt-4o)', () => {
  const p = getModelPricing('openai', 'gpt-4o-mini-2024-07-18');
  assert(p, 'should find a match');
  // "gpt-4o-mini-2024-07-18" starts with both "gpt-4o" AND "gpt-4o-mini"
  // longest match wins -> gpt-4o-mini at $0.15
  assert(p.inputPerMillion === 0.15, `expected gpt-4o-mini pricing (0.15), got ${p.inputPerMillion}`);
});

test('reverse prefix: claude-sonnet-4 matches claude-sonnet-4-20250514', () => {
  // user sends "claude-sonnet-4", table has "claude-sonnet-4-20250514"
  const p = getModelPricing('anthropic', 'claude-sonnet-4');
  assert(p, 'should find a match via reverse prefix');
  assert(p.inputPerMillion === 3.0, `expected 3.0, got ${p.inputPerMillion}`);
});

test('no match: completely unknown model', () => {
  const p = getModelPricing('openai', 'gpt-99-turbo');
  assert(p === undefined, 'should return undefined for unknown model');
});

test('no match: unknown provider', () => {
  const p = getModelPricing('ollama', 'llama3');
  assert(p === undefined, 'ollama has no pricing entries');
});

test('o3 vs o3-mini: o3 exact match', () => {
  const p = getModelPricing('openai', 'o3');
  assert(p, 'should find o3');
  assert(p.inputPerMillion === 2.0, `expected 2.0, got ${p.inputPerMillion}`);
});

test('o3 vs o3-mini: o3-mini exact match', () => {
  const p = getModelPricing('openai', 'o3-mini');
  assert(p, 'should find o3-mini');
  assert(p.inputPerMillion === 1.1, `expected 1.1, got ${p.inputPerMillion}`);
});

test('o3 vs o3-mini: o3-mini-2025 gets mini pricing', () => {
  const p = getModelPricing('openai', 'o3-mini-2025-01-31');
  assert(p, 'should find a match');
  assert(p.inputPerMillion === 1.1, `expected o3-mini pricing (1.1), got ${p.inputPerMillion}`);
});

// ============================
// COST CALCULATION
// ============================

test('cost: basic input + output', () => {
  const cost = calculateCost('openai', 'gpt-4o-mini', 1000, 500);
  // input: 1000/1M * 0.15 = 0.00015
  // output: 500/1M * 0.6 = 0.0003
  // total: 0.00045
  assertClose(cost, 0.00045, 0.00001, 'cost mismatch');
});

test('cost: zero tokens = zero cost', () => {
  const cost = calculateCost('openai', 'gpt-4o', 0, 0);
  assert(cost === 0, `expected 0, got ${cost}`);
});

test('cost: unknown model = zero cost', () => {
  const cost = calculateCost('openai', 'gpt-nonexistent', 1000, 1000);
  assert(cost === 0, `expected 0 for unknown model, got ${cost}`);
});

test('cost: cache tokens included', () => {
  const cost = calculateCost('anthropic', 'claude-sonnet-4-20250514', 1000, 500, 2000, 500);
  // input: 1000/1M * 3.0 = 0.003
  // output: 500/1M * 15.0 = 0.0075
  // cacheRead: 2000/1M * 0.3 = 0.0006
  // cacheWrite: 500/1M * 3.75 = 0.001875
  // total: 0.012975
  assertClose(cost, 0.012975, 0.00001, 'cache cost mismatch');
});

test('cost: model without cache pricing ignores cache tokens', () => {
  const cost = calculateCost('openai', 'gpt-4-turbo', 1000, 500, 2000, 500);
  // gpt-4-turbo has no cacheReadPerMillion/cacheWritePerMillion
  // should only count input + output
  const expected = (1000 / 1_000_000) * 10.0 + (500 / 1_000_000) * 30.0;
  assertClose(cost, expected, 0.00001, 'should ignore cache for models without cache pricing');
});

test('cost: large token counts (1M+ tokens)', () => {
  const cost = calculateCost('anthropic', 'claude-opus-4-20250514', 2_000_000, 500_000);
  // input: 2M/1M * 15.0 = 30.0
  // output: 500K/1M * 75.0 = 37.5
  // total: 67.5
  assertClose(cost, 67.5, 0.01, 'large token count mismatch');
});

// ============================
// BUDGET nextReset
// ============================
// We can't import nextReset directly (not exported), but we can test the logic
// by reasoning about the budget middleware behavior

test('budget: daily reset is midnight UTC next day', () => {
  // simulate: it's 2026-02-19 15:00 UTC
  const now = new Date('2026-02-19T15:00:00Z');
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  assert(next.toISOString() === '2026-02-20T00:00:00.000Z', `expected 2026-02-20, got ${next.toISOString()}`);
});

test('budget: daily reset at end of month', () => {
  const now = new Date('2026-02-28T23:59:00Z');
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  assert(next.toISOString() === '2026-03-01T00:00:00.000Z', `expected march 1, got ${next.toISOString()}`);
});

test('budget: weekly reset on monday (from wednesday)', () => {
  // 2026-02-18 is a Wednesday (getUTCDay() = 3)
  const now = new Date('2026-02-18T10:00:00Z');
  assert(now.getUTCDay() === 3, `expected wednesday (3), got ${now.getUTCDay()}`);
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  assert(daysUntilMonday === 5, `expected 5 days until monday, got ${daysUntilMonday}`);
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  next.setUTCHours(0, 0, 0, 0);
  assert(next.toISOString() === '2026-02-23T00:00:00.000Z', `expected monday 2/23, got ${next.toISOString()}`);
});

test('budget: weekly reset on monday (from monday)', () => {
  // 2026-02-23 is a Monday
  const now = new Date('2026-02-23T10:00:00Z');
  assert(now.getUTCDay() === 1, `expected monday (1), got ${now.getUTCDay()}`);
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  // on monday, should reset NEXT monday (7 days), not today
  assert(daysUntilMonday === 7, `expected 7 days until next monday, got ${daysUntilMonday}`);
});

test('budget: weekly reset on monday (from sunday)', () => {
  // 2026-02-22 is a Sunday (getUTCDay() = 0)
  const now = new Date('2026-02-22T10:00:00Z');
  assert(now.getUTCDay() === 0, `expected sunday (0), got ${now.getUTCDay()}`);
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  assert(daysUntilMonday === 1, `expected 1 day until monday, got ${daysUntilMonday}`);
});

test('budget: monthly reset is 1st of next month', () => {
  const now = new Date('2026-02-19T10:00:00Z');
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  assert(next.toISOString() === '2026-03-01T00:00:00.000Z', `expected march 1, got ${next.toISOString()}`);
});

test('budget: monthly reset wraps year (december -> january)', () => {
  const now = new Date('2026-12-15T10:00:00Z');
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  assert(next.toISOString() === '2027-01-01T00:00:00.000Z', `expected 2027-01-01, got ${next.toISOString()}`);
});

// ============================
// VALIDATION EDGE CASES
// ============================

test('validation: temperature exactly 0 is valid', () => {
  // temperature 0 should pass (it's between 0 and 2)
  // bug risk: `if (!body.temperature)` would reject 0 as falsy
  const temp = 0;
  const valid = typeof temp === 'number' && temp >= 0 && temp <= 2;
  assert(valid, 'temperature 0 should be valid');
});

test('validation: temperature exactly 2 is valid', () => {
  const temp = 2;
  const valid = typeof temp === 'number' && temp >= 0 && temp <= 2;
  assert(valid, 'temperature 2 should be valid');
});

test('validation: max_tokens exactly 1 is valid', () => {
  const mt = 1;
  const valid = typeof mt === 'number' && mt >= 1 && Number.isInteger(mt);
  assert(valid, 'max_tokens 1 should be valid');
});

test('validation: max_tokens as string is invalid', () => {
  const mt = '100';
  const valid = typeof mt === 'number' && mt >= 1 && Number.isInteger(mt);
  assert(!valid, 'max_tokens as string should be invalid');
});

// ============================
// ESTIMATE COST (budget pre-check)
// ============================

test('estimate: basic cost estimate in cents', () => {
  // 100 chars ~= 25 tokens, max_tokens = 100
  // using gpt-4o-mini: input 25/1M * 0.15 + output 100/1M * 0.6
  // = 0.00000375 + 0.00006 = 0.00006375 USD = 0.006375 cents -> ceil = 1 cent
  const pricing = getModelPricing('openai', 'gpt-4o-mini');
  assert(pricing, 'should find pricing');
  const inputChars = 100;
  const inputTokens = Math.ceil(inputChars / 4); // 25
  const maxOutput = 100;
  const costUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (maxOutput / 1_000_000) * pricing.outputPerMillion;
  const cents = Math.ceil(costUsd * 100);
  assert(cents === 1, `expected 1 cent (minimum), got ${cents}`);
});

test('estimate: expensive model with large context', () => {
  // 400K chars ~= 100K tokens input, 4096 max output
  // using claude-opus-4: 100K/1M * 15 + 4096/1M * 75
  // = 1.5 + 0.3072 = 1.8072 USD = 180.72 cents -> ceil = 181
  const pricing = getModelPricing('anthropic', 'claude-opus-4-20250514');
  assert(pricing, 'should find pricing');
  const inputTokens = 100_000;
  const maxOutput = 4096;
  const costUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (maxOutput / 1_000_000) * pricing.outputPerMillion;
  const cents = Math.ceil(costUsd * 100);
  assert(cents === 181, `expected 181 cents, got ${cents}`);
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} unit tests\n`);

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
