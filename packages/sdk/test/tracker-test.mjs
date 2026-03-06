// SDK CostTracker tests
// usage: node test/tracker-test.mjs

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

const { CostTracker } = await import('../dist/tracker.js');

// ============================
// BASIC TRACKING
// ============================

test('track increments totalCents and requestCount', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o-mini', { inputTokens: 1000, outputTokens: 500 });
  assert(t.requestCount === 1, `requests: ${t.requestCount}`);
  assert(t.totalCents > 0, `totalCents should be > 0, got ${t.totalCents}`);
});

test('track returns a CostEntry', () => {
  const t = new CostTracker();
  const entry = t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50 });
  assert(entry.provider === 'openai', `provider: ${entry.provider}`);
  assert(entry.model === 'gpt-4o', `model: ${entry.model}`);
  assert(entry.inputTokens === 100, `input: ${entry.inputTokens}`);
  assert(entry.outputTokens === 50, `output: ${entry.outputTokens}`);
  assert(typeof entry.costCents === 'number', 'costCents should be a number');
  assert(entry.timestamp instanceof Date, 'timestamp should be Date');
});

test('multiple tracks accumulate', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o-mini', { inputTokens: 1000, outputTokens: 500 });
  t.track('openai', 'gpt-4o-mini', { inputTokens: 1000, outputTokens: 500 });
  assert(t.requestCount === 2, `requests: ${t.requestCount}`);
  // two identical calls -> double the cost
  const single = new CostTracker();
  single.track('openai', 'gpt-4o-mini', { inputTokens: 1000, outputTokens: 500 });
  assertClose(t.totalCents, single.totalCents * 2, 0.001, 'double cost');
});

// ============================
// SESSIONS
// ============================

test('track with sessionId -> bySession groups correctly', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50, sessionId: 'sess-a' });
  t.track('openai', 'gpt-4o', { inputTokens: 200, outputTokens: 100, sessionId: 'sess-b' });
  t.track('openai', 'gpt-4o', { inputTokens: 150, outputTokens: 75, sessionId: 'sess-a' });

  const sessions = t.bySession();
  assert(sessions['sess-a']?.requests === 2, `sess-a requests: ${sessions['sess-a']?.requests}`);
  assert(sessions['sess-b']?.requests === 1, `sess-b requests: ${sessions['sess-b']?.requests}`);
});

test('track without sessionId -> grouped as "default"', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50 });
  const sessions = t.bySession();
  assert(sessions['default']?.requests === 1, 'should be in "default" bucket');
});

// ============================
// AGGREGATION
// ============================

test('byProvider groups by provider', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50 });
  t.track('anthropic', 'claude-sonnet-4-20250514', { inputTokens: 100, outputTokens: 50 });
  t.track('openai', 'gpt-4o-mini', { inputTokens: 100, outputTokens: 50 });

  const providers = t.byProvider();
  assert(providers['openai']?.requests === 2, `openai: ${providers['openai']?.requests}`);
  assert(providers['anthropic']?.requests === 1, `anthropic: ${providers['anthropic']?.requests}`);
});

test('byModel groups by model', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50 });
  t.track('openai', 'gpt-4o', { inputTokens: 200, outputTokens: 100 });
  t.track('openai', 'gpt-4o-mini', { inputTokens: 100, outputTokens: 50 });

  const models = t.byModel();
  assert(models['gpt-4o']?.requests === 2, `gpt-4o: ${models['gpt-4o']?.requests}`);
  assert(models['gpt-4o-mini']?.requests === 1, `mini: ${models['gpt-4o-mini']?.requests}`);
});

test('byProvider includes token counts', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50 });
  t.track('openai', 'gpt-4o', { inputTokens: 200, outputTokens: 100 });

  const providers = t.byProvider();
  assert(providers['openai'].inputTokens === 300, `input: ${providers['openai'].inputTokens}`);
  assert(providers['openai'].outputTokens === 150, `output: ${providers['openai'].outputTokens}`);
});

// ============================
// trackResponse
// ============================

test('trackResponse: OpenAI format (prompt_tokens)', () => {
  const t = new CostTracker();
  const entry = t.trackResponse('openai', {
    model: 'gpt-4o',
    usage: { prompt_tokens: 500, completion_tokens: 200 },
  });
  assert(entry.inputTokens === 500, `input: ${entry.inputTokens}`);
  assert(entry.outputTokens === 200, `output: ${entry.outputTokens}`);
});

test('trackResponse: Anthropic format (input_tokens)', () => {
  const t = new CostTracker();
  const entry = t.trackResponse('anthropic', {
    model: 'claude-sonnet-4-20250514',
    usage: {
      input_tokens: 300,
      output_tokens: 150,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    },
  });
  assert(entry.inputTokens === 300, `input: ${entry.inputTokens}`);
  assert(entry.outputTokens === 150, `output: ${entry.outputTokens}`);
  assert(entry.cacheReadTokens === 100, `cacheRead: ${entry.cacheReadTokens}`);
  assert(entry.cacheWriteTokens === 50, `cacheWrite: ${entry.cacheWriteTokens}`);
});

// ============================
// LISTENERS
// ============================

test('on() listener fires on track', () => {
  const t = new CostTracker();
  let fired = false;
  t.on((entry) => { fired = true; });
  t.track('openai', 'gpt-4o', { inputTokens: 10, outputTokens: 5 });
  assert(fired, 'listener should have fired');
});

test('on() returns unsubscribe function', () => {
  const t = new CostTracker();
  let count = 0;
  const unsub = t.on(() => { count++; });
  t.track('openai', 'gpt-4o', { inputTokens: 10, outputTokens: 5 });
  assert(count === 1, `count before unsub: ${count}`);
  unsub();
  t.track('openai', 'gpt-4o', { inputTokens: 10, outputTokens: 5 });
  assert(count === 1, `count after unsub should still be 1, got ${count}`);
});

test('constructor onTrack listener fires', () => {
  let fired = false;
  const t = new CostTracker({ onTrack: () => { fired = true; } });
  t.track('openai', 'gpt-4o', { inputTokens: 10, outputTokens: 5 });
  assert(fired, 'onTrack should have fired');
});

// ============================
// RESET + TOTALS
// ============================

test('reset clears all entries', () => {
  const t = new CostTracker();
  t.track('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50 });
  assert(t.requestCount === 1, 'should have 1 entry');
  t.reset();
  assert(t.requestCount === 0, `after reset: ${t.requestCount}`);
  assert(t.totalCents === 0, `after reset totalCents: ${t.totalCents}`);
});

test('totalDollars formats correctly', () => {
  const t = new CostTracker();
  // track something known to produce a specific cost
  t.track('openai', 'gpt-4o', { inputTokens: 1_000_000, outputTokens: 0 });
  // 1M input tokens * $2.5/M = $2.50 = 250 cents
  assertClose(t.totalCents, 250, 1, 'totalCents');
  // totalDollars = "2.5000"
  assert(t.totalDollars === '2.5000', `totalDollars: ${t.totalDollars}`);
});

test('unknown model -> zero cost', () => {
  const t = new CostTracker();
  t.track('openai', 'nonexistent-model', { inputTokens: 1000, outputTokens: 500 });
  assert(t.totalCents === 0, `expected 0 for unknown model, got ${t.totalCents}`);
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} tracker tests\n`);

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
