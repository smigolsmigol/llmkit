import http from 'node:http';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const { startProxy } = await import('../dist/proxy.js');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('upstream server did not expose a TCP address'));
        return;
      }
      resolve({
        port: address.port,
        stop: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function request(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('custom OpenAI base URL preserves HTTP, port, path, query, and usage tracking', async () => {
  let observed;
  const upstream = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      observed = {
        url: req.url,
        host: req.headers.host,
        body: Buffer.concat(chunks).toString(),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }));
    });
  });
  const original = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${upstream.port}/gateway/v1/`;
  const proxy = await startProxy({ port: 0, verbose: false });

  try {
    const body = JSON.stringify({ stream: false, messages: [] });
    const result = await request(proxy.port, '/v1/chat/completions?beta=1', body, {
      authorization: 'Bearer test-key',
    });
    assert(result.status === 200, `unexpected proxy status ${result.status}`);
    assert(observed?.url === '/gateway/v1/chat/completions?beta=1', `wrong upstream path ${observed?.url}`);
    assert(observed?.host === `127.0.0.1:${upstream.port}`, `wrong upstream host ${observed?.host}`);
    assert(observed?.body === body, 'request body changed in transit');
    assert(proxy.records.length === 1, `expected one tracked request, got ${proxy.records.length}`);
    assert(proxy.records[0]?.model === 'gpt-4o-mini', 'usage response was not parsed');
  } finally {
    await proxy.stop();
    await upstream.stop();
    if (original === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = original;
  }
});

test('custom Anthropic base URL preserves its path prefix', async () => {
  let observedPath = '';
  const upstream = await listen((req, res) => {
    observedPath = req.url ?? '';
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 2 },
      }));
    });
  });
  const original = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstream.port}/anthropic`;
  const proxy = await startProxy({ port: 0, verbose: false });

  try {
    const result = await request(proxy.port, '/v1/messages', '{}', { 'x-api-key': 'sk-ant-test' });
    assert(result.status === 200, `unexpected proxy status ${result.status}`);
    assert(observedPath === '/anthropic/v1/messages', `wrong upstream path ${observedPath}`);
    assert(proxy.records[0]?.provider === 'anthropic', 'Anthropic usage was not tracked');
  } finally {
    await proxy.stop();
    await upstream.stop();
    if (original === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = original;
  }
});

test('oversized request bodies fail locally without contacting an upstream', async () => {
  const proxy = await startProxy({ port: 0, verbose: false, maxBodyBytes: 8 });
  try {
    const result = await request(proxy.port, '/v1/chat/completions', '123456789');
    assert(result.status === 413, `expected 413, got ${result.status}`);
    assert(result.body.includes('request body too large'), `unexpected rejection ${result.body}`);
  } finally {
    await proxy.stop();
  }
});

test('stalled upstreams fail within the configured timeout', async () => {
  const upstream = await listen((req) => req.resume());
  const original = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${upstream.port}/v1`;
  const proxy = await startProxy({ port: 0, verbose: false, upstreamTimeoutMs: 25 });

  try {
    const result = await request(proxy.port, '/v1/chat/completions', '{}');
    assert(result.status === 502, `expected 502, got ${result.status}`);
    assert(result.body.includes('upstream request timed out'), `unexpected timeout response ${result.body}`);
  } finally {
    await proxy.stop();
    await upstream.stop();
    if (original === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = original;
  }
});

for (const entry of tests) {
  try {
    await entry.fn();
    passed++;
    console.log(`  PASS  ${entry.name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${entry.name}: ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
