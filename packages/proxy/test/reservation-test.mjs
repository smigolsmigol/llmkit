// reservation pattern concurrency tests
// proves that budget reservations prevent the check-then-act race condition
// usage: node test/reservation-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// minimal DO storage mock (in-memory Map, mimics DurableObjectStorage)
function mockStorage() {
  const store = new Map();
  return {
    get(key) { return store.get(key); },
    put(key, val) { store.set(key, structuredClone(val)); },
    delete(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
    },
    list(opts) {
      const prefix = opts?.prefix || '';
      const filtered = new Map();
      for (const [k, v] of store) {
        if (k.startsWith(prefix)) filtered.set(k, v);
      }
      return filtered;
    },
    getAlarm() { return null; },
    setAlarm() {},
  };
}

// import DO logic (compiled TypeScript -> ESM)
// we can't instantiate real DOs in Node, so we replicate the logic
// using the same storage interface. This tests the algorithm, not the runtime.
const { nextReset, periodMs } = await import('../../shared/dist/providers.js')
  .catch(() => null) || {};

// inline the budget logic since BudgetDO extends DurableObject (CF-only)
function createBudgetDO(storage, budgetId = 'test-budget') {
  const ctx = {
    storage,
    id: { name: budgetId, toString() { return budgetId; } },
  };

  return {
    async check(input) {
      let root = storage.get('root');

      // lazy-init from budgetConfig (mirrors real DO behavior)
      if (!root && input.budgetConfig) {
        root = {
          limitCents: input.budgetConfig.limitCents,
          usedCents: 0,
          reservedCents: 0,
          period: input.budgetConfig.period,
          resetAt: 0,
        };
        storage.put('root', root);
      }

      if (!root) {
        return { allowed: true, remaining: Infinity, reservationId: '', scope: 'key', limitCents: 0, usedCents: 0 };
      }

      let active = root;

      if (root.scope === 'session' && input.sessionId) {
        const sKey = `s:${input.sessionId}`;
        let session = storage.get(sKey);
        if (!session) {
          session = {
            limitCents: root.limitCents,
            usedCents: 0,
            reservedCents: 0,
            period: root.period,
            resetAt: root.resetAt,
          };
        }
        storage.put(sKey, session);
        storage.put(`${sKey}:ts`, Date.now());
        active = session;
      }

      const sessionCommitted = active.usedCents + (active.reservedCents || 0);
      const rootCommitted = root.usedCents + (root.reservedCents || 0);
      const sessionRemaining = active.limitCents - sessionCommitted;
      const rootRemaining = root.limitCents - rootCommitted;
      const remaining = Math.min(sessionRemaining, rootRemaining);

      if (remaining <= 0 || (input.estimatedCents > 0 && remaining < input.estimatedCents)) {
        return { allowed: false, remaining: Math.max(0, remaining), reservationId: '', scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
      }

      const reservationId = `r-${Math.random().toString(36).slice(2, 10)}`;
      const reserveAmount = Math.max(input.estimatedCents, 1);

      root.reservedCents = (root.reservedCents || 0) + reserveAmount;
      storage.put('root', root);

      if (active !== root) {
        active.reservedCents = (active.reservedCents || 0) + reserveAmount;
        storage.put(`s:${input.sessionId}`, active);
      }

      storage.put(`r:${reservationId}`, {
        amount: reserveAmount,
        sessionId: input.sessionId,
        createdAt: Date.now(),
      });

      return { allowed: true, remaining: remaining - reserveAmount, reservationId, scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
    },

    async record(input) {
      const root = storage.get('root');
      if (!root) return { usedCents: 0, limitCents: 0 };

      let reservedAmount = 0;
      if (input.reservationId) {
        const reservation = storage.get(`r:${input.reservationId}`);
        if (reservation) {
          reservedAmount = reservation.amount;
          storage.delete(`r:${input.reservationId}`);
        }
      }

      let key = 'root';
      let target = root;

      if (root.scope === 'session' && input.sessionId) {
        const sKey = `s:${input.sessionId}`;
        const session = storage.get(sKey);
        if (session) {
          key = sKey;
          target = session;
        }
      }

      target.reservedCents = Math.max(0, (target.reservedCents || 0) - reservedAmount);
      if (input.costCents > 0) {
        target.usedCents += input.costCents;
      }
      storage.put(key, target);

      if (key !== 'root') {
        root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservedAmount);
        if (input.costCents > 0) {
          root.usedCents += input.costCents;
        }
        storage.put('root', root);
      }

      return { usedCents: target.usedCents, limitCents: target.limitCents };
    },

    async release(reservationId) {
      if (!reservationId) return;
      const reservation = storage.get(`r:${reservationId}`);
      if (!reservation) return;

      storage.delete(`r:${reservationId}`);

      const root = storage.get('root');
      if (!root) return;

      root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservation.amount);
      storage.put('root', root);

      if (root.scope === 'session' && reservation.sessionId) {
        const sKey = `s:${reservation.sessionId}`;
        const session = storage.get(sKey);
        if (session) {
          session.reservedCents = Math.max(0, (session.reservedCents || 0) - reservation.amount);
          storage.put(sKey, session);
        }
      }
    },
  };
}

// ============================
// CONCURRENCY: reservation prevents overspend
// ============================

test('10 concurrent checks against $1 budget, $0.50 each: only 2 allowed', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // simulate 10 "concurrent" check() calls
  // in a real DO, these are serialized (single-threaded), which is exactly what we test:
  // each check() sees the reservations from previous calls
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(await budget.check({ estimatedCents: 50 }));
  }

  const allowed = results.filter(r => r.allowed);
  const denied = results.filter(r => !r.allowed);

  assert(allowed.length === 2, `expected 2 allowed, got ${allowed.length}`);
  assert(denied.length === 8, `expected 8 denied, got ${denied.length}`);

  // verify each allowed result has a reservation ID
  for (const r of allowed) {
    assert(r.reservationId, 'allowed result must have reservationId');
  }
  for (const r of denied) {
    assert(!r.reservationId, 'denied result must not have reservationId');
  }
});

test('reservations block budget even before record() is called', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // first check reserves 80 cents
  const r1 = await budget.check({ estimatedCents: 80 });
  assert(r1.allowed, 'first check should be allowed');

  // second check for 30 should be denied (80 reserved, only 20 remaining)
  const r2 = await budget.check({ estimatedCents: 30 });
  assert(!r2.allowed, 'second check should be denied: only 20 remaining after 80 reserved');

  // third check for 20 should be allowed (exactly 20 remaining)
  const r3 = await budget.check({ estimatedCents: 20 });
  assert(r3.allowed, 'third check should be allowed: exactly 20 remaining');
});

test('record() settles reservation: actual < estimated refunds the difference', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // reserve 80 cents
  const check = await budget.check({ estimatedCents: 80 });
  assert(check.allowed, 'check should be allowed');

  // actual cost was only 30 cents
  await budget.record({ reservationId: check.reservationId, costCents: 30 });

  const root = storage.get('root');
  assert(root.usedCents === 30, `expected usedCents=30, got ${root.usedCents}`);
  assert(root.reservedCents === 0, `expected reservedCents=0 after settlement, got ${root.reservedCents}`);

  // 70 cents should now be available
  const check2 = await budget.check({ estimatedCents: 70 });
  assert(check2.allowed, 'should have 70 cents available after settlement');
});

test('record() settles reservation: actual > estimated still works', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // reserve 20 cents (underestimate)
  const check = await budget.check({ estimatedCents: 20 });
  assert(check.allowed, 'check should be allowed');

  // actual cost was 50 cents (chars/4 underestimated)
  await budget.record({ reservationId: check.reservationId, costCents: 50 });

  const root = storage.get('root');
  assert(root.usedCents === 50, `expected usedCents=50, got ${root.usedCents}`);
  assert(root.reservedCents === 0, `expected reservedCents=0, got ${root.reservedCents}`);
});

test('release() frees reservation on failed request', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  const check = await budget.check({ estimatedCents: 60 });
  assert(check.allowed, 'check should be allowed');

  // verify budget is held
  const rootBefore = storage.get('root');
  assert(rootBefore.reservedCents === 60, `expected 60 reserved, got ${rootBefore.reservedCents}`);

  // provider fails, release the reservation
  await budget.release(check.reservationId);

  const rootAfter = storage.get('root');
  assert(rootAfter.reservedCents === 0, `expected 0 reserved after release, got ${rootAfter.reservedCents}`);
  assert(rootAfter.usedCents === 0, `expected 0 used after release, got ${rootAfter.usedCents}`);

  // full budget should be available again
  const check2 = await budget.check({ estimatedCents: 100 });
  assert(check2.allowed, 'full budget should be available after release');
});

test('session budgets: reservation tracks both session and root', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 200,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
    scope: 'session',
  });

  const check = await budget.check({ sessionId: 'sess-1', estimatedCents: 50 });
  assert(check.allowed, 'session check should be allowed');

  const root = storage.get('root');
  const session = storage.get('s:sess-1');

  assert(root.reservedCents === 50, `root should have 50 reserved, got ${root.reservedCents}`);
  assert(session.reservedCents === 50, `session should have 50 reserved, got ${session.reservedCents}`);

  // settle
  await budget.record({ reservationId: check.reservationId, sessionId: 'sess-1', costCents: 30 });

  const rootAfter = storage.get('root');
  const sessionAfter = storage.get('s:sess-1');

  assert(rootAfter.usedCents === 30, `root usedCents should be 30, got ${rootAfter.usedCents}`);
  assert(rootAfter.reservedCents === 0, `root reserved should be 0, got ${rootAfter.reservedCents}`);
  assert(sessionAfter.usedCents === 30, `session usedCents should be 30, got ${sessionAfter.usedCents}`);
  assert(sessionAfter.reservedCents === 0, `session reserved should be 0, got ${sessionAfter.reservedCents}`);
});

test('record() without reservation still works (backwards compat)', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // record without a reservation (e.g. old code path)
  await budget.record({ reservationId: '', costCents: 25 });

  const root = storage.get('root');
  assert(root.usedCents === 25, `expected usedCents=25, got ${root.usedCents}`);
  assert(root.reservedCents === 0, `expected reservedCents=0, got ${root.reservedCents}`);
});

test('double release is idempotent (no negative reservedCents)', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  const check = await budget.check({ estimatedCents: 50 });
  await budget.release(check.reservationId);
  await budget.release(check.reservationId); // second release should be no-op

  const root = storage.get('root');
  assert(root.reservedCents === 0, `expected 0, got ${root.reservedCents}`);
});

// ============================
// LAZY INIT: DO initializes from budgetConfig
// ============================

test('check() with budgetConfig initializes DO from empty storage', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  // no storage.put('root', ...) - DO storage is empty
  const result = await budget.check({
    estimatedCents: 5,
    budgetConfig: { limitCents: 100, period: 'total' },
  });

  assert(result.allowed, 'should be allowed after lazy init');
  assert(result.reservationId, 'should have reservationId');

  const root = storage.get('root');
  assert(root, 'root should exist after lazy init');
  assert(root.limitCents === 100, `expected limitCents=100, got ${root.limitCents}`);
  assert(root.period === 'total', `expected period=total, got ${root.period}`);
  assert(root.reservedCents === 5, `expected 5 reserved, got ${root.reservedCents}`);
});

test('check() without budgetConfig and empty storage allows (no budget)', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  const result = await budget.check({ estimatedCents: 50 });
  assert(result.allowed, 'should be allowed when no budget configured');
  assert(result.remaining === Infinity, 'remaining should be Infinity');
  assert(!result.reservationId, 'no reservationId when no budget');
});

// ============================
// RUN
// ============================

console.log(`running ${tests.length} reservation tests\n`);
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
console.log(`\n${passed} passed, ${failed} failed out of ${tests.length}`);
process.exit(failed > 0 ? 1 : 0);
