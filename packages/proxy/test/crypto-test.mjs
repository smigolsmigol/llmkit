// AES-256-GCM encrypt/decrypt roundtrip tests
// uses Node 20+ native WebCrypto (same API as CF Workers)
// usage: node test/crypto-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- re-implement crypto functions using Node WebCrypto ---

const webcrypto = globalThis.crypto;
const subtle = webcrypto.subtle;

async function importKey(keyBase64) {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function encrypt(plaintext, keyBase64, context) {
  const key = await importKey(keyBase64);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const algo = {
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(context),
  };
  const encrypted = await subtle.encrypt(algo, key, encoded);
  return { ciphertext: toBase64(encrypted), iv: toBase64(iv.buffer) };
}

async function decrypt(ciphertext, iv, keyBase64, context) {
  const key = await importKey(keyBase64);
  const ivBytes = fromBase64(iv);
  const algo = {
    name: 'AES-GCM',
    iv: ivBytes,
    additionalData: new TextEncoder().encode(context),
  };
  const decrypted = await subtle.decrypt(algo, key, fromBase64(ciphertext));
  return new TextDecoder().decode(decrypted);
}

// generate a random 256-bit key for testing
function generateKeyBase64() {
  const raw = webcrypto.getRandomValues(new Uint8Array(32));
  return toBase64(raw.buffer);
}

// ============================
// ROUNDTRIP TESTS
// ============================

test('encrypt -> decrypt roundtrip returns original plaintext', async () => {
  const key = generateKeyBase64();
  const plaintext = 'sk-proj-abc123xyz';
  const context = 'user_42:openai';

  const { ciphertext, iv } = await encrypt(plaintext, key, context);
  const result = await decrypt(ciphertext, iv, key, context);
  assert(result === plaintext, `expected "${plaintext}", got "${result}"`);
});

test('empty plaintext roundtrips correctly', async () => {
  const key = generateKeyBase64();
  const { ciphertext, iv } = await encrypt('', key, 'ctx');
  const result = await decrypt(ciphertext, iv, key, 'ctx');
  assert(result === '', `expected empty string, got "${result}"`);
});

test('long plaintext (10KB) roundtrips', async () => {
  const key = generateKeyBase64();
  const plaintext = 'a'.repeat(10_000);
  const { ciphertext, iv } = await encrypt(plaintext, key, 'big');
  const result = await decrypt(ciphertext, iv, key, 'big');
  assert(result === plaintext, `length mismatch: expected ${plaintext.length}, got ${result.length}`);
});

test('unicode plaintext roundtrips', async () => {
  const key = generateKeyBase64();
  const plaintext = 'api-key-with-unicode-\u{1F680}\u{1F4A1}';
  const { ciphertext, iv } = await encrypt(plaintext, key, 'unicode');
  const result = await decrypt(ciphertext, iv, key, 'unicode');
  assert(result === plaintext, `unicode mismatch`);
});

// ============================
// AAD CONTEXT BINDING
// ============================

test('wrong context -> decrypt throws (AAD mismatch)', async () => {
  const key = generateKeyBase64();
  const { ciphertext, iv } = await encrypt('secret', key, 'user_1:openai');
  try {
    await decrypt(ciphertext, iv, key, 'user_2:openai');
    assert(false, 'should have thrown on wrong context');
  } catch (err) {
    assert(err.message !== 'should have thrown on wrong context', err.message);
  }
});

test('empty vs non-empty context -> decrypt throws', async () => {
  const key = generateKeyBase64();
  const { ciphertext, iv } = await encrypt('secret', key, 'real-context');
  try {
    await decrypt(ciphertext, iv, key, '');
    assert(false, 'should have thrown on mismatched context');
  } catch (err) {
    assert(err.message !== 'should have thrown on mismatched context', err.message);
  }
});

// ============================
// TAMPER DETECTION
// ============================

test('tampered ciphertext -> decrypt throws', async () => {
  const key = generateKeyBase64();
  const { ciphertext, iv } = await encrypt('secret', key, 'ctx');

  // flip a byte in the ciphertext
  const bytes = fromBase64(ciphertext);
  bytes[0] ^= 0xff;
  const tampered = toBase64(bytes.buffer);

  try {
    await decrypt(tampered, iv, key, 'ctx');
    assert(false, 'should have thrown on tampered ciphertext');
  } catch (err) {
    assert(err.message !== 'should have thrown on tampered ciphertext', err.message);
  }
});

test('tampered IV -> decrypt throws', async () => {
  const key = generateKeyBase64();
  const { ciphertext, iv } = await encrypt('secret', key, 'ctx');

  const ivBytes = fromBase64(iv);
  ivBytes[0] ^= 0xff;
  const tamperedIv = toBase64(ivBytes.buffer);

  try {
    await decrypt(ciphertext, tamperedIv, key, 'ctx');
    assert(false, 'should have thrown on tampered IV');
  } catch (err) {
    assert(err.message !== 'should have thrown on tampered IV', err.message);
  }
});

test('wrong key -> decrypt throws', async () => {
  const key1 = generateKeyBase64();
  const key2 = generateKeyBase64();
  const { ciphertext, iv } = await encrypt('secret', key1, 'ctx');
  try {
    await decrypt(ciphertext, iv, key2, 'ctx');
    assert(false, 'should have thrown on wrong key');
  } catch (err) {
    assert(err.message !== 'should have thrown on wrong key', err.message);
  }
});

// ============================
// DETERMINISM
// ============================

test('same plaintext + key produces different ciphertext (random IV)', async () => {
  const key = generateKeyBase64();
  const r1 = await encrypt('same', key, 'ctx');
  const r2 = await encrypt('same', key, 'ctx');
  assert(r1.ciphertext !== r2.ciphertext, 'ciphertexts should differ due to random IV');
  assert(r1.iv !== r2.iv, 'IVs should differ');
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} crypto tests\n`);

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
