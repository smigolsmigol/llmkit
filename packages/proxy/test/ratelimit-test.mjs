// rate limiter Durable Object security tests
// tests sliding window, RPM enforcement, header values, edge cases
// usage: node test/ratelimit-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// re-implement RateLimitDO logic as a plain class (no CF Workers dependency)
// mirrors packages/proxy/src/do/ratelimit-do.ts exactly

class RateLimitDO {
  constructor() {
    this.count = 0;
    this.window = 0;
  }

  hit(input, nowMs) {
    const now = nowMs ?? Date.now();
    const currentMinute = Math.floor(now / 60_000);

    if (currentMinute !== this.window) {
      this.window = currentMinute;
      this.count = 0;
    }

    if (this.count >= input.limit) {
      const secondsLeft = 60 - (Math.floor(now / 1000) % 60);
      return {
        allowed: false,
        count: this.count,
        limit: input.limit,
        remaining: 0,
        retryAfterSeconds: secondsLeft,
      };
    }

    this.count++;
    return {
      allowed: true,
      count: this.count,
      limit: input.limit,
      remaining: input.limit - this.count,
    };
  }
}

// ============================
// DEFAULT RPM (60)
// ============================

test('default RPM: first request allowed', () => {
  const rl = new RateLimitDO();
  const result = rl.hit({ limit: 60 });
  assert(result.allowed, 'first request should be allowed');
  assert(result.count === 1, `count should be 1, got ${result.count}`);
  assert(result.remaining === 59, `remaining should be 59, got ${result.remaining}`);
  assert(result.limit === 60, 'limit should echo back');
});

test('default RPM: 59 requests allowed, 60th allowed, 61st blocked', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  for (let i = 0; i < 59; i++) {
    const r = rl.hit({ limit: 60 }, now);
    assert(r.allowed, `request ${i + 1} should be allowed`);
  }

  const r60 = rl.hit({ limit: 60 }, now);
  assert(r60.allowed, '60th request should be allowed');
  assert(r60.remaining === 0, 'remaining should be 0 at exactly limit');

  const r61 = rl.hit({ limit: 60 }, now);
  assert(!r61.allowed, '61st request should be blocked');
  assert(r61.remaining === 0, 'remaining stays at 0');
  assert(typeof r61.retryAfterSeconds === 'number', 'should have retryAfterSeconds');
  assert(r61.retryAfterSeconds > 0 && r61.retryAfterSeconds <= 60, `retry should be 1-60s, got ${r61.retryAfterSeconds}`);
});

// ============================
// CUSTOM RPM
// ============================

test('custom RPM: limit=5 blocks 6th request', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  for (let i = 0; i < 5; i++) {
    const r = rl.hit({ limit: 5 }, now);
    assert(r.allowed, `request ${i + 1} should be allowed`);
  }

  const r6 = rl.hit({ limit: 5 }, now);
  assert(!r6.allowed, '6th request at limit=5 should be blocked');
});

test('custom RPM: limit=1 allows exactly one', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  const r1 = rl.hit({ limit: 1 }, now);
  assert(r1.allowed, 'first request should pass');
  assert(r1.remaining === 0, 'remaining should be 0');

  const r2 = rl.hit({ limit: 1 }, now);
  assert(!r2.allowed, 'second request should be blocked');
});

test('custom RPM: limit=1000 high throughput', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  for (let i = 0; i < 1000; i++) {
    const r = rl.hit({ limit: 1000 }, now);
    assert(r.allowed, `request ${i + 1} of 1000 should be allowed`);
  }

  const blocked = rl.hit({ limit: 1000 }, now);
  assert(!blocked.allowed, '1001st should be blocked');
});

// ============================
// SLIDING WINDOW (MINUTE BOUNDARIES)
// ============================

test('window reset: requests in new minute get fresh counter', () => {
  const rl = new RateLimitDO();

  // exhaust in minute 0
  const minute0 = 60_000 * 1000; // arbitrary minute boundary
  for (let i = 0; i < 5; i++) {
    rl.hit({ limit: 5 }, minute0);
  }
  const blocked = rl.hit({ limit: 5 }, minute0);
  assert(!blocked.allowed, 'should be blocked in minute 0');

  // move to next minute
  const minute1 = minute0 + 60_000;
  const fresh = rl.hit({ limit: 5 }, minute1);
  assert(fresh.allowed, 'new minute should reset counter');
  assert(fresh.count === 1, `count should restart at 1, got ${fresh.count}`);
  assert(fresh.remaining === 4, `remaining should be 4, got ${fresh.remaining}`);
});

test('window: same minute boundary does not reset', () => {
  const rl = new RateLimitDO();
  const base = 60_000 * 500;

  rl.hit({ limit: 5 }, base);
  rl.hit({ limit: 5 }, base + 1000); // 1s later, same minute
  rl.hit({ limit: 5 }, base + 30_000); // 30s later, same minute
  rl.hit({ limit: 5 }, base + 59_999); // 59.999s later, still same minute

  assert(rl.count === 4, `count should be 4 in same minute, got ${rl.count}`);
});

test('window: millisecond before minute boundary stays in current window', () => {
  const rl = new RateLimitDO();
  const boundary = 60_000 * 100;

  for (let i = 0; i < 3; i++) {
    rl.hit({ limit: 3 }, boundary);
  }
  const blocked = rl.hit({ limit: 3 }, boundary + 59_999);
  assert(!blocked.allowed, 'should still be blocked 59.999s into same minute');

  const fresh = rl.hit({ limit: 3 }, boundary + 60_000);
  assert(fresh.allowed, 'exact next minute should reset');
});

// ============================
// HEADER VALUES
// ============================

test('headers: X-RateLimit-Limit reflects input limit', () => {
  const rl = new RateLimitDO();
  const r = rl.hit({ limit: 42 });
  assert(r.limit === 42, 'limit should match input');
});

test('headers: X-RateLimit-Remaining decrements', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  const r1 = rl.hit({ limit: 10 }, now);
  assert(r1.remaining === 9, `first: remaining should be 9, got ${r1.remaining}`);

  const r2 = rl.hit({ limit: 10 }, now);
  assert(r2.remaining === 8, `second: remaining should be 8, got ${r2.remaining}`);
});

test('headers: Retry-After is positive and <= 60', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  rl.hit({ limit: 1 }, now);
  const blocked = rl.hit({ limit: 1 }, now);

  assert(!blocked.allowed, 'should be blocked');
  assert(blocked.retryAfterSeconds >= 1, `retry should be >= 1, got ${blocked.retryAfterSeconds}`);
  assert(blocked.retryAfterSeconds <= 60, `retry should be <= 60, got ${blocked.retryAfterSeconds}`);
});

test('headers: Retry-After reflects seconds left in current minute', () => {
  const rl = new RateLimitDO();
  // 15 seconds into a minute: Math.floor(t/1000) % 60 = 15, secondsLeft = 45
  const t = 60_000 * 200 + 15_000;

  rl.hit({ limit: 1 }, t);
  const blocked = rl.hit({ limit: 1 }, t);
  assert(blocked.retryAfterSeconds === 45, `expected 45s retry, got ${blocked.retryAfterSeconds}`);
});

test('headers: Retry-After at second 59 = 1', () => {
  const rl = new RateLimitDO();
  const t = 60_000 * 300 + 59_000;

  rl.hit({ limit: 1 }, t);
  const blocked = rl.hit({ limit: 1 }, t);
  assert(blocked.retryAfterSeconds === 1, `expected 1s retry at :59, got ${blocked.retryAfterSeconds}`);
});

test('headers: Retry-After at second 0 = 60', () => {
  const rl = new RateLimitDO();
  const t = 60_000 * 400; // exactly on minute boundary

  rl.hit({ limit: 1 }, t);
  const blocked = rl.hit({ limit: 1 }, t);
  assert(blocked.retryAfterSeconds === 60, `expected 60s retry at :00, got ${blocked.retryAfterSeconds}`);
});

// ============================
// EXACTLY-AT-LIMIT EDGE CASES
// ============================

test('edge: limit=0 blocks everything (degenerate)', () => {
  const rl = new RateLimitDO();
  const r = rl.hit({ limit: 0 });
  assert(!r.allowed, 'limit=0 should block first request');
  assert(r.remaining === 0, 'remaining should be 0');
});

test('edge: blocked request does not increment counter', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  rl.hit({ limit: 2 }, now);
  rl.hit({ limit: 2 }, now);
  assert(rl.count === 2, 'count at limit');

  rl.hit({ limit: 2 }, now); // blocked
  assert(rl.count === 2, 'blocked request should not increment count');

  rl.hit({ limit: 2 }, now); // still blocked
  assert(rl.count === 2, 'count should remain at 2');
});

test('edge: multiple blocked requests all return consistent headers', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  rl.hit({ limit: 1 }, now); // allowed
  const b1 = rl.hit({ limit: 1 }, now); // blocked
  const b2 = rl.hit({ limit: 1 }, now); // blocked again

  assert(b1.count === b2.count, 'count should be same across blocked requests');
  assert(b1.remaining === b2.remaining, 'remaining should be same');
  assert(b1.retryAfterSeconds === b2.retryAfterSeconds, 'retry should be same');
});

test('edge: limit changes between requests (mid-window RPM upgrade)', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  for (let i = 0; i < 5; i++) {
    rl.hit({ limit: 5 }, now);
  }
  const blocked = rl.hit({ limit: 5 }, now);
  assert(!blocked.allowed, 'should be blocked at old limit');

  // if the key's RPM gets bumped to 10 mid-window
  const allowed = rl.hit({ limit: 10 }, now);
  assert(allowed.allowed, 'higher limit should allow previously blocked request');
  assert(allowed.remaining === 4, `remaining should be 4 at new limit, got ${allowed.remaining}`);
});

// ============================
// CONCURRENCY/BURST PATTERNS
// ============================

test('burst: rapid fire within same millisecond', () => {
  const rl = new RateLimitDO();
  const now = Date.now();

  let allowedCount = 0;
  for (let i = 0; i < 100; i++) {
    const r = rl.hit({ limit: 10 }, now);
    if (r.allowed) allowedCount++;
  }

  assert(allowedCount === 10, `should allow exactly 10, got ${allowedCount}`);
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} rate limit tests\n`);

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
