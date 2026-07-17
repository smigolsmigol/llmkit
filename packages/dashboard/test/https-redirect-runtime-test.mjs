import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const server = createTestHarness({
  root: packageRoot,
  workers: [
    {
      config: {
        name: 'llmkit-https-redirect-runtime',
        main: 'test/fixtures/https-redirect-worker.ts',
        compatibility_date: '2026-07-17',
        compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
      },
    },
  ],
});

try {
  await server.listen();
  const worker = server.getWorker();

  for (const [source, destination] of [
    ['http://llmkit.sh/', 'https://llmkit.sh/'],
    ['http://www.llmkit.sh/docs?provider=openai', 'https://www.llmkit.sh/docs?provider=openai'],
  ]) {
    const response = await worker.fetch(source, { redirect: 'manual' });
    assert.equal(response.status, 308, source);
    assert.equal(response.headers.get('location'), destination, source);
  }

  for (const source of [
    'https://llmkit.sh/',
    'http://api.llmkit.sh/health',
    'http://llmkit.sh.example.com/',
    'http://llmkit-web-staging.workers.dev/',
  ]) {
    const response = await worker.fetch(source, { redirect: 'manual' });
    assert.equal(response.status, 204, source);
    assert.equal(response.headers.get('location'), null, source);
  }
} finally {
  await server.close();
}

console.log('HTTPS_REDIRECT_RUNTIME PASS (workerd 308 plus exact-host non-capture)');
