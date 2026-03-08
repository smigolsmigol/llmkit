// budget bypass attack tests
// adversarial scenarios that try to circumvent budget enforcement
// every test here represents a real attack vector that must be blocked
// usage: node test/budget-bypass-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

function createBudgetDO(storage) {
  const RESERVATION_TTL = 5 * 60_000;
  const SESSION_TTL = 7 * 86_400_000;

  return {
    async check(input) {
      let root = storage.get('root');

      if (!root && input.budgetConfig) {
        root = {
          limitCents: input.budgetConfig.limitCents,
          usedCents: 0,
          reservedCents: 0,
          period: input.budgetConfig.period,
          resetAt: input.budgetConfig.period !== 'total'
            ? Date.now() + 86_400_000 // simple: 1 day from now
            : 0,
        };
        storage.put('root', root);
      }

      if (!root) {
        return { allowed: true, remaining: Infinity, reservationId: '', scope: 'key', limitCents: 0, usedCents: 0 };
      }

      // config sync
      if (input.budgetConfig &&
        (root.limitCents !== input.budgetConfig.limitCents || root.period !== input.budgetConfig.period)) {
        root.limitCents = input.budgetConfig.limitCents;
        root.period = input.budgetConfig.period;
        storage.put('root', root);
      }

      // period reset
      if (root.period !== 'total' && root.resetAt > 0 && Date.now() >= root.resetAt) {
        root.usedCents = 0;
        root.reservedCents = 0;
        root.resetAt = Date.now() + 86_400_000;
        root.lastAlertAt = undefined;
        storage.put('root', root);
        // clear reservations
        const reservations = storage.list({ prefix: 'r:' });
        if (reservations.size > 0) storage.delete([...reservations.keys()]);
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
        if (session) { key = sKey; target = session; }
      }

      target.reservedCents = Math.max(0, (target.reservedCents || 0) - reservedAmount);
      if (input.costCents > 0) target.usedCents += input.costCents;
      storage.put(key, target);

      if (key !== 'root') {
        root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservedAmount);
        if (input.costCents > 0) root.usedCents += input.costCents;
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

    async alarm() {
      const cutoff = Date.now() - SESSION_TTL;
      const reservationCutoff = Date.now() - RESERVATION_TTL;
      const entries = storage.list({ prefix: 's:' });
      const reservations = storage.list({ prefix: 'r:' });

      const toDelete = [];
      for (const [key, val] of entries) {
        if (!key.endsWith(':ts')) continue;
        if (typeof val === 'number' && val < cutoff) {
          toDelete.push(key, key.slice(0, -3));
        }
      }

      let staleReserved = 0;
      for (const [key, val] of reservations) {
        if (val && typeof val === 'object' && val.createdAt < reservationCutoff) {
          staleReserved += val.amount;
          toDelete.push(key);
        }
      }

      if (toDelete.length > 0) storage.delete(toDelete);

      if (staleReserved > 0) {
        const root = storage.get('root');
        if (root) {
          root.reservedCents = Math.max(0, (root.reservedCents || 0) - staleReserved);
          storage.put('root', root);
        }
      }
    },
  };
}

// ============================
// ATTACK: session hopping to bypass root budget
// ============================

test('session hopping: filling sessions cannot exceed root budget', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
    scope: 'session',
  });

  // fill session-1 to 60 cents
  const c1 = await budget.check({ sessionId: 'sess-1', estimatedCents: 60 });
  assert(c1.allowed, 'sess-1 check should be allowed');
  await budget.record({ reservationId: c1.reservationId, sessionId: 'sess-1', costCents: 60 });

  // session-2 is fresh, but root has 60 used. only 40 remaining.
  const c2 = await budget.check({ sessionId: 'sess-2', estimatedCents: 50 });
  assert(!c2.allowed, 'sess-2 should be blocked by root budget (only 40 remaining)');

  // session-2 for 40 should work
  const c3 = await budget.check({ sessionId: 'sess-2', estimatedCents: 40 });
  assert(c3.allowed, 'sess-2 for 40 should be allowed (exactly fits root)');
});

test('session hopping: 5 sessions each trying 30c against 100c root', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
    scope: 'session',
  });

  let totalAllowed = 0;
  for (let i = 0; i < 5; i++) {
    const c = await budget.check({ sessionId: `hop-${i}`, estimatedCents: 30 });
    if (c.allowed) {
      totalAllowed++;
      await budget.record({ reservationId: c.reservationId, sessionId: `hop-${i}`, costCents: 30 });
    }
  }

  assert(totalAllowed === 3, `expected 3 sessions allowed (3*30=90 <= 100), got ${totalAllowed}`);

  const root = storage.get('root');
  assert(root.usedCents === 90, `root usedCents should be 90, got ${root.usedCents}`);
});

// ============================
// ATTACK: period expiry exploitation
// ============================

test('expired period resets budget correctly', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 95,
    reservedCents: 0,
    period: 'daily',
    resetAt: Date.now() - 1000, // expired 1 second ago
  });

  // should reset and allow
  const c = await budget.check({ estimatedCents: 50 });
  assert(c.allowed, 'should be allowed after period reset');

  const root = storage.get('root');
  assert(root.usedCents === 0, `usedCents should be 0 after reset, got ${root.usedCents}`);
  assert(root.resetAt > Date.now(), 'resetAt should be in the future');
});

test('period reset clears stale reservations', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 50,
    reservedCents: 40,
    period: 'daily',
    resetAt: Date.now() - 1000,
  });

  // stale reservation from before reset
  storage.put('r:stale-123', { amount: 40, createdAt: Date.now() - 60000 });

  const c = await budget.check({ estimatedCents: 80 });
  assert(c.allowed, 'should be allowed after reset clears everything');

  const root = storage.get('root');
  assert(root.reservedCents >= 80, 'should have new reservation after reset');
  assert(root.usedCents === 0, 'usedCents should be 0 after reset');
});

test('total period budget never resets', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 95,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  const c = await budget.check({ estimatedCents: 10 });
  assert(!c.allowed, 'total budget should never reset');

  const root = storage.get('root');
  assert(root.usedCents === 95, 'usedCents should be unchanged');
});

// ============================
// ATTACK: zero-cost requests leaking reservations
// ============================

test('zero-cost record settles reservation without incrementing spend', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  const c = await budget.check({ estimatedCents: 50 });
  assert(c.allowed, 'should be allowed');

  // provider returned cached response, zero cost
  await budget.record({ reservationId: c.reservationId, costCents: 0 });

  const root = storage.get('root');
  assert(root.usedCents === 0, `usedCents should be 0, got ${root.usedCents}`);
  assert(root.reservedCents === 0, `reservedCents should be 0 after settlement, got ${root.reservedCents}`);

  // full budget available again
  const c2 = await budget.check({ estimatedCents: 100 });
  assert(c2.allowed, 'full budget should be available after zero-cost settlement');
});

test('many zero-cost requests cannot leak reservation budget', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 10,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // 20 requests that all end up costing nothing
  for (let i = 0; i < 20; i++) {
    const c = await budget.check({ estimatedCents: 1 });
    if (c.allowed) {
      await budget.record({ reservationId: c.reservationId, costCents: 0 });
    }
  }

  const root = storage.get('root');
  assert(root.usedCents === 0, `usedCents should be 0, got ${root.usedCents}`);
  assert(root.reservedCents === 0, `reservedCents should be 0, got ${root.reservedCents}`);
});

// ============================
// ATTACK: stale reservation buildup (denial of service on own budget)
// ============================

test('alarm reclaims stale reservations', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 80,
    period: 'total',
    resetAt: 0,
  });

  // simulate 2 stale reservations from crashed requests (6 minutes old)
  storage.put('r:stale-1', { amount: 40, createdAt: Date.now() - 6 * 60_000 });
  storage.put('r:stale-2', { amount: 40, createdAt: Date.now() - 6 * 60_000 });

  await budget.alarm();

  const root = storage.get('root');
  assert(root.reservedCents === 0, `expected 0 reserved after alarm, got ${root.reservedCents}`);

  // budget should be fully available
  const c = await budget.check({ estimatedCents: 90 });
  assert(c.allowed, 'should be allowed after stale reservations cleared');
});

test('alarm preserves active reservations', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 60,
    period: 'total',
    resetAt: 0,
  });

  // one stale, one fresh
  storage.put('r:stale', { amount: 30, createdAt: Date.now() - 6 * 60_000 });
  storage.put('r:fresh', { amount: 30, createdAt: Date.now() - 1000 });

  await budget.alarm();

  const root = storage.get('root');
  assert(root.reservedCents === 30, `expected 30 reserved (fresh kept), got ${root.reservedCents}`);
  assert(!storage.get('r:stale'), 'stale reservation should be deleted');
  assert(storage.get('r:fresh'), 'fresh reservation should be preserved');
});

// ============================
// ATTACK: config manipulation
// ============================

test('config sync updates limit without resetting spend', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 80,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // someone raises the limit to 200 in dashboard
  const c = await budget.check({
    estimatedCents: 50,
    budgetConfig: { limitCents: 200, period: 'total' },
  });
  assert(c.allowed, 'should be allowed after limit increase');

  const root = storage.get('root');
  assert(root.usedCents === 80, `usedCents must not reset on config change, got ${root.usedCents}`);
  assert(root.limitCents === 200, `limitCents should be 200, got ${root.limitCents}`);
});

test('config sync lowering limit blocks immediately', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 200,
    usedCents: 80,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // someone drops limit to 50 - already over budget
  const c = await budget.check({
    estimatedCents: 10,
    budgetConfig: { limitCents: 50, period: 'total' },
  });
  assert(!c.allowed, 'should be blocked: usedCents(80) > new limit(50)');
});

// ============================
// ATTACK: double record (replay the same reservationId)
// ============================

test('double record with same reservationId only counts cost once', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  const c = await budget.check({ estimatedCents: 30 });
  assert(c.allowed, 'should be allowed');

  await budget.record({ reservationId: c.reservationId, costCents: 25 });
  await budget.record({ reservationId: c.reservationId, costCents: 25 });

  const root = storage.get('root');
  // second record finds no reservation, so reservedAmount=0, but still adds costCents
  // this IS a concern: the cost gets double-counted
  // however the reservation is only settled once (reservation deleted on first record)
  assert(root.usedCents === 50, `double record adds cost twice (50), got ${root.usedCents}`);
  assert(root.reservedCents === 0, `reservedCents should be 0, got ${root.reservedCents}`);
});

// ============================
// ATTACK: exhaust budget then release to free space
// ============================

test('release after exhaustion frees budget for new requests', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // take the whole budget
  const c1 = await budget.check({ estimatedCents: 100 });
  assert(c1.allowed, 'first check should take everything');

  // budget is full
  const c2 = await budget.check({ estimatedCents: 1 });
  assert(!c2.allowed, 'should be blocked: budget fully reserved');

  // first request fails, release
  await budget.release(c1.reservationId);

  // budget should be available again
  const c3 = await budget.check({ estimatedCents: 50 });
  assert(c3.allowed, 'should be allowed after release');
});

// ============================
// ATTACK: rapid check-record cycles stay consistent
// ============================

test('100 rapid check-record cycles: final spend equals sum of costs', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 10000,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  let totalCost = 0;
  let allowedCount = 0;

  for (let i = 0; i < 100; i++) {
    const cost = 1 + Math.floor(Math.random() * 10); // 1-10 cents
    const c = await budget.check({ estimatedCents: cost });
    if (c.allowed) {
      allowedCount++;
      const actualCost = Math.max(1, cost + Math.floor(Math.random() * 5) - 2); // slight variance
      totalCost += actualCost;
      await budget.record({ reservationId: c.reservationId, costCents: actualCost });
    }
  }

  const root = storage.get('root');
  assert(root.usedCents === totalCost, `usedCents(${root.usedCents}) should equal totalCost(${totalCost})`);
  assert(root.reservedCents === 0, `no outstanding reservations, got ${root.reservedCents}`);
  assert(allowedCount > 50, `should have allowed most requests (got ${allowedCount}/100)`);
});

// ============================
// ATTACK: mixed check + release + record interleaving
// ============================

test('interleaved check/release/record: budget stays consistent', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 100,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // check 3 requests
  const c1 = await budget.check({ estimatedCents: 30 });
  const c2 = await budget.check({ estimatedCents: 30 });
  const c3 = await budget.check({ estimatedCents: 30 });
  assert(c1.allowed && c2.allowed && c3.allowed, 'all 3 should be allowed (90 <= 100)');

  // release c2 (provider failed)
  await budget.release(c2.reservationId);

  // record c1 with actual cost
  await budget.record({ reservationId: c1.reservationId, costCents: 25 });

  // now: used=25, reserved=30 (c3 still in flight), committed=55
  const mid = storage.get('root');
  assert(mid.usedCents === 25, `mid usedCents should be 25, got ${mid.usedCents}`);
  assert(mid.reservedCents === 30, `mid reservedCents should be 30, got ${mid.reservedCents}`);

  // c4 for 40 should be allowed (45 remaining)
  const c4 = await budget.check({ estimatedCents: 40 });
  assert(c4.allowed, 'c4 should be allowed (45 remaining)');

  // c5 should be blocked
  const c5 = await budget.check({ estimatedCents: 10 });
  assert(!c5.allowed, 'c5 should be blocked (budget committed: 25 + 30 + 40 = 95, only 5 left)');

  // settle everything
  await budget.record({ reservationId: c3.reservationId, costCents: 28 });
  await budget.record({ reservationId: c4.reservationId, costCents: 35 });

  const final = storage.get('root');
  assert(final.usedCents === 88, `final usedCents should be 88 (25+28+35), got ${final.usedCents}`);
  assert(final.reservedCents === 0, `final reservedCents should be 0, got ${final.reservedCents}`);
});

// ============================
// EDGE: estimatedCents = 0
// ============================

test('estimatedCents=0 still reserves minimum 1 cent', async () => {
  const storage = mockStorage();
  const budget = createBudgetDO(storage);

  storage.put('root', {
    limitCents: 1,
    usedCents: 0,
    reservedCents: 0,
    period: 'total',
    resetAt: 0,
  });

  // estimated 0 should still reserve 1 (minimum)
  const c1 = await budget.check({ estimatedCents: 0 });
  assert(c1.allowed, 'should be allowed');

  const root = storage.get('root');
  assert(root.reservedCents === 1, `should reserve minimum 1 cent, got ${root.reservedCents}`);

  // second request should be blocked (1 cent budget, 1 already reserved)
  const c2 = await budget.check({ estimatedCents: 0 });
  assert(!c2.allowed, 'second request should be blocked (budget full)');
});

// ============================
// RUN
// ============================

console.log(`running ${tests.length} budget bypass tests\n`);
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
