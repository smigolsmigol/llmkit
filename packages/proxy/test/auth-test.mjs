// auth middleware security tests
// tests SHA-256 hashing, DEV_MODE bypass, budget config extraction, RPM
// usage: node test/auth-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// re-implement sha256 using Node WebCrypto (same API as CF Workers)
async function sha256(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================
// SHA-256 HASHING
// ============================

test('sha256: known test vector (empty string)', async () => {
  const hash = await sha256('');
  assert(hash === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', `bad empty hash: ${hash}`);
});

test('sha256: known test vector (abc)', async () => {
  const hash = await sha256('abc');
  assert(hash === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', `bad abc hash: ${hash}`);
});

test('sha256: typical API key format', async () => {
  const hash = await sha256('lk_live_abc123def456');
  assert(hash.length === 64, `hash should be 64 hex chars, got ${hash.length}`);
  assert(/^[0-9a-f]{64}$/.test(hash), 'hash should be lowercase hex');
});

test('sha256: different inputs produce different hashes', async () => {
  const h1 = await sha256('key_a');
  const h2 = await sha256('key_b');
  assert(h1 !== h2, 'different inputs should not collide');
});

test('sha256: same input is deterministic', async () => {
  const h1 = await sha256('lk_test_deterministic');
  const h2 = await sha256('lk_test_deterministic');
  assert(h1 === h2, 'same input should produce same hash');
});

test('sha256: unicode input', async () => {
  const hash = await sha256('\u{1F680}rocket-key');
  assert(hash.length === 64, 'unicode key should produce valid hash');
  assert(/^[0-9a-f]{64}$/.test(hash), 'should be lowercase hex');
});

test('sha256: very long key (10KB)', async () => {
  const hash = await sha256('k'.repeat(10_000));
  assert(hash.length === 64, 'long key should produce valid hash');
});

// ============================
// BEARER TOKEN EXTRACTION
// ============================

// re-implement the extraction logic from auth.ts
function extractBearerToken(authHeader) {
  const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return raw;
}

test('bearer: standard format', () => {
  const token = extractBearerToken('Bearer lk_live_abc123');
  assert(token === 'lk_live_abc123', `got: ${token}`);
});

test('bearer: extra whitespace trimmed', () => {
  const token = extractBearerToken('Bearer   lk_live_abc123  ');
  assert(token === 'lk_live_abc123', `whitespace not trimmed: ${token}`);
});

test('bearer: missing Bearer prefix -> empty', () => {
  const token = extractBearerToken('lk_live_abc123');
  assert(token === '', 'should reject missing Bearer prefix');
});

test('bearer: lowercase bearer -> empty', () => {
  const token = extractBearerToken('bearer lk_live_abc123');
  assert(token === '', 'Bearer is case-sensitive per RFC 6750');
});

test('bearer: empty header -> empty', () => {
  const token = extractBearerToken('');
  assert(token === '', 'empty header should yield empty token');
});

test('bearer: Bearer with no token -> empty', () => {
  const token = extractBearerToken('Bearer ');
  assert(token === '', 'Bearer with only whitespace should yield empty');
});

test('bearer: Bearer with just spaces -> empty', () => {
  const token = extractBearerToken('Bearer    ');
  assert(token === '', 'Bearer with only spaces should yield empty');
});

test('bearer: injection attempt in header', () => {
  const token = extractBearerToken('Bearer valid_key\r\nX-Admin: true');
  // the raw token includes the injection - that's fine, it'll fail hash lookup
  assert(token.includes('\r\n'), 'should preserve raw value (hash check catches it)');
});

// ============================
// DEV_MODE BYPASS LOGIC
// ============================

// re-implement the DEV_MODE decision logic from auth.ts
function shouldBypassAuth(devMode, supabaseUrl, supabaseKey) {
  if (!supabaseUrl || !supabaseKey) {
    return devMode;
  }
  return false;
}

function devModeApiKey(rawKey) {
  return `${rawKey.slice(0, 8)}...`;
}

test('DEV_MODE: bypass when no Supabase config', () => {
  assert(shouldBypassAuth(true, undefined, undefined), 'should bypass');
});

test('DEV_MODE: no bypass when Supabase is configured (production)', () => {
  assert(!shouldBypassAuth(true, 'https://x.supabase.co', 'key'), 'should NOT bypass when Supabase exists');
});

test('DEV_MODE: no bypass when DEV_MODE=false even without Supabase', () => {
  assert(!shouldBypassAuth(false, undefined, undefined), 'should NOT bypass when DEV_MODE is off');
});

test('DEV_MODE: apiKey truncation for safety', () => {
  const truncated = devModeApiKey('lk_live_supersecretkey123');
  assert(truncated === 'lk_live_...', `expected 'lk_live_...', got '${truncated}'`);
  assert(!truncated.includes('supersecret'), 'should not leak full key');
});

test('DEV_MODE: short key truncation', () => {
  const truncated = devModeApiKey('abc');
  assert(truncated === 'abc...', `got: ${truncated}`);
});

// ============================
// BUDGET CONFIG EXTRACTION
// ============================

// re-implement the budget config extraction from auth.ts
function extractBudgetConfig(keyRecord) {
  const result = {};
  if (keyRecord.budget_id) {
    result.budgetId = keyRecord.budget_id;
    if (keyRecord.budgets) {
      result.budgetConfig = {
        limitCents: keyRecord.budgets.limit_cents,
        period: keyRecord.budgets.period,
        scope: keyRecord.budgets.scope,
        alertWebhookUrl: keyRecord.budgets.alert_webhook_url,
      };
    }
  }
  if (keyRecord.rpm_limit) {
    result.rpmLimit = keyRecord.rpm_limit;
  }
  return result;
}

test('budget config: full FK join record', () => {
  const record = {
    budget_id: 'budget-uuid-123',
    budgets: {
      limit_cents: 5000,
      period: 'monthly',
      scope: 'per_key',
      alert_webhook_url: 'https://hooks.slack.com/xxx',
    },
    rpm_limit: 120,
  };
  const config = extractBudgetConfig(record);
  assert(config.budgetId === 'budget-uuid-123', 'budgetId');
  assert(config.budgetConfig.limitCents === 5000, 'limitCents');
  assert(config.budgetConfig.period === 'monthly', 'period');
  assert(config.budgetConfig.scope === 'per_key', 'scope');
  assert(config.budgetConfig.alertWebhookUrl === 'https://hooks.slack.com/xxx', 'webhook');
  assert(config.rpmLimit === 120, 'rpmLimit');
});

test('budget config: no budget -> no config', () => {
  const config = extractBudgetConfig({ budget_id: null, budgets: null, rpm_limit: null });
  assert(!config.budgetId, 'should have no budgetId');
  assert(!config.budgetConfig, 'should have no budgetConfig');
  assert(!config.rpmLimit, 'should have no rpmLimit');
});

test('budget config: budget_id without budgets FK (broken join)', () => {
  const config = extractBudgetConfig({ budget_id: 'budget-123', budgets: null, rpm_limit: null });
  assert(config.budgetId === 'budget-123', 'should still set budgetId');
  assert(!config.budgetConfig, 'no config without FK data');
});

test('budget config: RPM without budget', () => {
  const config = extractBudgetConfig({ budget_id: null, budgets: null, rpm_limit: 30 });
  assert(!config.budgetId, 'no budget');
  assert(config.rpmLimit === 30, 'should still extract RPM');
});

test('budget config: RPM=0 treated as falsy (uses default)', () => {
  // in auth.ts: if (keyRecord.rpm_limit) - this means 0 is ignored, default RPM applies
  const config = extractBudgetConfig({ budget_id: null, budgets: null, rpm_limit: 0 });
  assert(!config.rpmLimit, 'RPM 0 should be treated as unset');
});

// ============================
// DEFAULT RPM FALLBACK
// ============================

const DEFAULT_RPM = 60;

function resolveRpm(rpmLimit) {
  return rpmLimit || DEFAULT_RPM;
}

test('RPM: explicit limit used', () => {
  assert(resolveRpm(120) === 120, 'should use explicit RPM');
});

test('RPM: undefined falls back to 60', () => {
  assert(resolveRpm(undefined) === DEFAULT_RPM, 'should fall back to 60');
});

test('RPM: null falls back to 60', () => {
  assert(resolveRpm(null) === DEFAULT_RPM, 'should fall back to 60');
});

test('RPM: 0 falls back to 60 (same as auth.ts behavior)', () => {
  assert(resolveRpm(0) === DEFAULT_RPM, 'RPM 0 should trigger default');
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} auth tests\n`);

  for (const t of tests) {
    try {
      await t.fn();
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
