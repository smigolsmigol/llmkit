// tests for OpenAI adapter response parsing (parseUsage, parseProviderCost)
// these functions are module-private so we reimplement the logic inline
// usage: node test/openai-adapter-test.mjs

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

// reimplementations matching packages/proxy/src/providers/openai.ts exactly

function parseProviderCost(usage) {
  if (usage.cost_in_usd_ticks == null) return undefined;
  return usage.cost_in_usd_ticks / 10_000_000_000;
}

function parseUsage(usage) {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens || undefined,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || undefined,
  };
}

// ============================
// PROVIDER COST (cost_in_usd_ticks)
// ============================

test('cost_in_usd_ticks: valid value converts correctly', () => {
  const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost_in_usd_ticks: 15_000_000_000 };
  const cost = parseProviderCost(usage);
  assertClose(cost, 1.50, 0.0001, 'expected $1.50');
});

test('cost_in_usd_ticks: zero returns $0', () => {
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_in_usd_ticks: 0 };
  const cost = parseProviderCost(usage);
  assert(cost === 0, `expected 0, got ${cost}`);
});

test('cost_in_usd_ticks: undefined returns undefined', () => {
  const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
  const cost = parseProviderCost(usage);
  assert(cost === undefined, `expected undefined, got ${cost}`);
});

test('cost_in_usd_ticks: null returns undefined', () => {
  const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost_in_usd_ticks: null };
  const cost = parseProviderCost(usage);
  assert(cost === undefined, `expected undefined, got ${cost}`);
});

test('cost_in_usd_ticks: small value (42M ticks = $0.0042)', () => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost_in_usd_ticks: 42_000_000 };
  const cost = parseProviderCost(usage);
  assertClose(cost, 0.0042, 0.0000001, 'expected $0.0042');
});

// ============================
// USAGE PARSING (cached + reasoning tokens)
// ============================

test('parseUsage: cached_tokens maps to cacheReadTokens', () => {
  const usage = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1200,
    prompt_tokens_details: { cached_tokens: 500 },
  };
  const parsed = parseUsage(usage);
  assert(parsed.inputTokens === 1000, `inputTokens: expected 1000, got ${parsed.inputTokens}`);
  assert(parsed.outputTokens === 200, `outputTokens: expected 200, got ${parsed.outputTokens}`);
  assert(parsed.totalTokens === 1200, `totalTokens: expected 1200, got ${parsed.totalTokens}`);
  assert(parsed.cacheReadTokens === 500, `cacheReadTokens: expected 500, got ${parsed.cacheReadTokens}`);
});

test('parseUsage: reasoning_tokens maps to reasoningTokens', () => {
  const usage = {
    prompt_tokens: 800,
    completion_tokens: 400,
    total_tokens: 1200,
    completion_tokens_details: { reasoning_tokens: 200 },
  };
  const parsed = parseUsage(usage);
  assert(parsed.reasoningTokens === 200, `reasoningTokens: expected 200, got ${parsed.reasoningTokens}`);
});

test('parseUsage: missing prompt_tokens_details -> cacheReadTokens undefined', () => {
  const usage = {
    prompt_tokens: 500,
    completion_tokens: 100,
    total_tokens: 600,
  };
  const parsed = parseUsage(usage);
  assert(parsed.cacheReadTokens === undefined, `cacheReadTokens: expected undefined, got ${parsed.cacheReadTokens}`);
});

test('parseUsage: missing completion_tokens_details -> reasoningTokens undefined', () => {
  const usage = {
    prompt_tokens: 500,
    completion_tokens: 100,
    total_tokens: 600,
  };
  const parsed = parseUsage(usage);
  assert(parsed.reasoningTokens === undefined, `reasoningTokens: expected undefined, got ${parsed.reasoningTokens}`);
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} openai adapter tests\n`);

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
