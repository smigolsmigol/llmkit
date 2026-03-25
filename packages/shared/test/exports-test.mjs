// unit tests: verify shared package exports are correct and complete
// usage: node packages/shared/test/exports-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const shared = await import('../dist/providers.js');
const errors = await import('../dist/errors.js');

test('PRICING has 11 providers', () => {
  const count = Object.keys(shared.PRICING).length;
  assert(count === 11, `expected 11 providers, got ${count}`);
});

test('all providers have at least one model', () => {
  for (const [provider, models] of Object.entries(shared.PRICING)) {
    if (provider === 'ollama' || provider === 'openrouter') continue;
    assert(Object.keys(models).length > 0, `${provider} has no models`);
  }
});

test('all priced models have valid rates', () => {
  for (const [provider, models] of Object.entries(shared.PRICING)) {
    for (const [model, pricing] of Object.entries(models)) {
      assert(pricing.inputPerMillion >= 0, `${provider}/${model} inputPerMillion < 0`);
      assert(pricing.outputPerMillion >= 0, `${provider}/${model} outputPerMillion < 0`);
    }
  }
});

test('BudgetExceededError has status 402', () => {
  const e = new errors.BudgetExceededError('test', 1000, 1500);
  assert(e.statusCode === 402, `expected 402, got ${e.statusCode}`);
});

test('AuthError has default message', () => {
  const e = new errors.AuthError();
  assert(e.message.includes('Invalid or missing API key'), `unexpected message: ${e.message}`);
  assert(e.statusCode === 401, `expected 401`);
});

test('calculateCost returns positive for known model', () => {
  const cost = shared.calculateCost('openai', 'gpt-4o', 1000, 500);
  assert(typeof cost === 'number', 'should return number');
  assert(cost > 0, 'cost should be positive');
});

test('calculateCost returns 0 for unknown model', () => {
  const cost = shared.calculateCost('openai', 'totally-fake-model', 1000, 500);
  assert(cost === 0, `expected 0 for unknown model, got ${cost}`);
});

for (const t of tests) {
  try {
    await t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}: ${e.message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
