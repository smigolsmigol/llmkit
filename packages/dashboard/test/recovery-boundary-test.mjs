import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeClientReferenceManifest,
  canonicalizeManifest,
  derivePreviewKeys,
  normalizeOpenNextInit,
  resolveSourceDateEpoch,
} from '../scripts/build-cloudflare.mjs';
import { bucketByHour } from '../src/components/charts/types.ts';
import {
  classifyRecoveryPath,
  getHttpsRedirectUrl,
  getWorkerVersionHeaders,
  RECOVERY_BLOCKED_API_PREFIXES,
  RECOVERY_BLOCKED_UI_PREFIXES,
  RECOVERY_PUBLIC_CTA,
  RECOVERY_STATUS_HREF,
  RECOVERY_WEB_HOSTS,
} from '../src/lib/public-recovery.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

const violationFixtures = [
  ['/dashboard', 'blocked-ui'],
  ['/dashboard/requests/abc', 'blocked-ui'],
  ['/sign-in', 'blocked-ui'],
  ['/sign-up/continue', 'blocked-ui'],
  ['/api/analytics', 'blocked-api'],
  ['/api/export/csv', 'blocked-api'],
  ['/api/pricing', 'blocked-api'],
];

for (const [pathname, expected] of violationFixtures) {
  assert.equal(classifyRecoveryPath(pathname), expected, pathname);
}

for (const pathname of ['/', '/docs', '/pricing', '/compare', '/mcp', '/.well-known/security.txt']) {
  assert.equal(classifyRecoveryPath(pathname), 'public', pathname);
}

assert.equal(classifyRecoveryPath('/dashboardish'), 'public');
assert.equal(classifyRecoveryPath('/api/exported'), 'public');
assert.deepEqual(RECOVERY_BLOCKED_UI_PREFIXES, ['/dashboard', '/sign-in', '/sign-up']);
assert.deepEqual(RECOVERY_BLOCKED_API_PREFIXES, [
  '/api/analytics',
  '/api/export',
  '/api/pricing',
]);
assert.deepEqual(RECOVERY_WEB_HOSTS, ['llmkit.sh', 'www.llmkit.sh']);
assert.deepEqual(RECOVERY_PUBLIC_CTA, { href: '/docs#local-setup', label: 'Use locally' });
assert.equal(RECOVERY_STATUS_HREF, '/service-restoring');

assert.deepEqual(
  getWorkerVersionHeaders({ CF_VERSION_METADATA: { id: 'worker-version-123' } }),
  { 'X-LLMKit-Worker-Version': 'worker-version-123' },
);
assert.deepEqual(getWorkerVersionHeaders({ CF_VERSION_METADATA: { id: '' } }), {});
assert.deepEqual(getWorkerVersionHeaders({}), {});

for (const [source, destination] of [
  ['http://llmkit.sh/', 'https://llmkit.sh/'],
  ['http://www.llmkit.sh/docs?provider=openai', 'https://www.llmkit.sh/docs?provider=openai'],
  ['http://llmkit.sh:8080/pricing', 'https://llmkit.sh/pricing'],
]) {
  assert.equal(getHttpsRedirectUrl(new URL(source)), destination, source);
}

for (const source of [
  'https://llmkit.sh/',
  'https://www.llmkit.sh/docs',
  'http://api.llmkit.sh/health',
  'http://llmkit.sh.example.com/',
  'http://llmkit-web-staging.workers.dev/',
]) {
  assert.equal(getHttpsRedirectUrl(new URL(source)), null, source);
}

const wrangler = JSON.parse(readFileSync(`${packageRoot}/wrangler.jsonc`, 'utf8'));
assert.equal(wrangler.name, 'llmkit-web');
assert.equal(wrangler.main, 'cloudflare-worker.ts');
assert.equal(wrangler.workers_dev, false);
assert.equal(wrangler.preview_urls, false);
assert.deepEqual(
  wrangler.routes.map((route) => [route.pattern, route.custom_domain]),
  [
    ['llmkit.sh', true],
    ['www.llmkit.sh', true],
  ],
);
assert.equal(wrangler.env.staging.workers_dev, true);
assert.equal(wrangler.env.staging.preview_urls, true);
assert.deepEqual(wrangler.env.staging.routes, []);
assert.equal(wrangler.version_metadata.binding, 'CF_VERSION_METADATA');
assert.equal(wrangler.env.staging.version_metadata.binding, 'CF_VERSION_METADATA');

for (const relativePath of [
  'src/components/public-nav-static.tsx',
  'src/app/(public)/page.tsx',
  'src/app/(public)/docs/page.tsx',
  'src/app/(public)/compare/page.tsx',
  'src/app/(public)/pricing/page.tsx',
  'src/app/(public)/providers/[name]/page.tsx',
]) {
  const source = readFileSync(`${packageRoot}/${relativePath}`, 'utf8');
  assert.doesNotMatch(source, /\/sign-(?:in|up)/, relativePath);
}

const docsSource = readFileSync(`${packageRoot}/src/app/(public)/docs/page.tsx`, 'utf8');
assert.ok(
  docsSource.indexOf('id="local-setup"') < docsSource.indexOf('Hosted API gateway'),
  'the local setup anchor must precede the hosted recovery notice',
);

const [costBucket] = bucketByHour([
  {
    t: '2026-08-04T03:01:00.000Z',
    costCents: 7,
    inputTokens: 10,
    outputTokens: 2,
  },
  {
    t: '2026-08-04T03:20:00.000Z',
    costCents: null,
    inputTokens: 100,
    outputTokens: 20,
  },
]);
assert.equal(costBucket.costCents, 7);
assert.equal(costBucket.pricedRequests, 1);
assert.equal(costBucket.unknownCostRequests, 1);
assert.equal(costBucket.pricedInputTokens, 10);
assert.equal(costBucket.pricedOutputTokens, 2);
assert.equal(costBucket.inputTokens, 110);
assert.equal(costBucket.outputTokens, 22);

const budgetActions = readFileSync(
  `${packageRoot}/src/app/(auth)/dashboard/settings/actions.ts`,
  'utf8',
);
assert.match(budgetActions, /\.from\('requests'\)[\s\S]*\.eq\('budget_id', budgetId\)/);
assert.match(budgetActions, /error\.code === '23503'/);
assert.match(budgetActions, /reason: 'receipt_history'/);
assert.match(budgetActions, /reason: 'active_keys'/);

const analyticsQueries = readFileSync(`${packageRoot}/src/lib/queries.ts`, 'utf8');
assert.match(analyticsQueries, /select\('\*', \{ count: 'exact' \}\)/);
assert.match(analyticsQueries, /rows\.length !== expectedTotal/);
assert.match(analyticsQueries, /const bid = r\.budget_id/);
assert.doesNotMatch(analyticsQueries, /keyToBudget/);
assert.doesNotMatch(analyticsQueries, /\.limit\(50000\)/);

const deploymentContract = readFileSync(`${packageRoot}/wrangler.jsonc`, 'utf8');
assert.doesNotMatch(deploymentContract, /SUPABASE_SERVICE_KEY|CLERK_SECRET_KEY|ANALYTICS_API_KEY/);

const nextConfig = readFileSync(`${packageRoot}/next.config.ts`, 'utf8');
assert.match(nextConfig, /outputFileTracingRoot: resolve\(import\.meta\.dirname, '\.\.\/\.\.'\)/);
assert.match(nextConfig, /process\.env\.LLMKIT_BUILD_ID \|\| process\.env\.GITHUB_SHA/);
assert.match(nextConfig, /generateBuildId: async \(\) => sourceRevision\(\)/);
assert.match(nextConfig, /chunkIds: 'named'/);
assert.match(nextConfig, /moduleIds: 'named'/);

const buildSecret = Buffer.alloc(32, 7).toString('base64');
const firstPreviewKeys = derivePreviewKeys(buildSecret);
const secondPreviewKeys = derivePreviewKeys(buildSecret);
assert.deepEqual(firstPreviewKeys, secondPreviewKeys);
assert.equal(firstPreviewKeys.previewModeId.length, 32);
assert.equal(firstPreviewKeys.previewModeSigningKey.length, 64);
assert.equal(firstPreviewKeys.previewModeEncryptionKey.length, 64);
assert.notEqual(firstPreviewKeys.previewModeSigningKey, firstPreviewKeys.previewModeEncryptionKey);
assert.throws(() => derivePreviewKeys('not-canonical-base64'));

const canonicalPrerender = canonicalizeManifest(
  'prerender-manifest.json',
  {
    version: 4,
    routes: { '/pricing': { z: 1, a: 2 }, '/': { z: 3, a: 4 } },
    dynamicRoutes: { '/providers/[name]': { z: 5, a: 6 } },
    preview: { previewModeId: 'random-build-value' },
    notFoundRoutes: [],
  },
  firstPreviewKeys,
);
assert.deepEqual(Object.keys(canonicalPrerender.routes), ['/', '/pricing']);
assert.deepEqual(Object.keys(canonicalPrerender.routes['/']), ['a', 'z']);
assert.deepEqual(canonicalPrerender.preview, firstPreviewKeys);

const canonicalPages = canonicalizeManifest(
  'server/pages-manifest.json',
  {
    '/_error': 'pages/_error.js',
    '/_app': 'pages/_app.js',
    '/_document': 'pages/_document.js',
  },
  firstPreviewKeys,
);
assert.deepEqual(Object.keys(canonicalPages), ['/_app', '/_document', '/_error']);

const clientManifestPrefix =
  'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/page"]=';
assert.equal(
  canonicalizeClientReferenceManifest(`${clientManifestPrefix}{"z":1,"a":{"z":2,"a":3}}`),
  `${clientManifestPrefix}{"a":{"a":3,"z":2},"z":1}`,
);
assert.equal(resolveSourceDateEpoch('1786579200'), 1786579200);
assert.throws(() => resolveSourceDateEpoch('2026-08-13'));
assert.equal(
  normalizeOpenNextInit(
    'Object.assign(globalThis, { __BUILD_TIMESTAMP_MS__: 1786579200123 });',
    1786579200,
  ),
  'Object.assign(globalThis, { __BUILD_TIMESTAMP_MS__: 1786579200000 });',
);

const cloudflareDockerfile = readFileSync(`${packageRoot}/Dockerfile.cloudflare`, 'utf8');
assert.match(
  cloudflareDockerfile,
  /--mount=type=secret,id=next_server_actions_encryption_key,required=true/,
);
assert.match(cloudflareDockerfile, /\[16, 24, 32\]\.includes\(bytes\.length\)/);
assert.doesNotMatch(cloudflareDockerfile, /ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/);
assert.match(cloudflareDockerfile, /ARG LLMKIT_BUILD_ID/);
assert.match(cloudflareDockerfile, /ARG SOURCE_DATE_EPOCH/);
assert.match(cloudflareDockerfile, /COPY patches patches/);

const packageJson = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8'));
for (const scriptName of [
  'cloudflare:build',
  'cloudflare:preview',
  'cloudflare:dry-run',
  'cloudflare:deploy:staging',
  'cloudflare:deploy:production',
]) {
  assert.match(packageJson.scripts[scriptName], /node scripts\/build-cloudflare\.mjs/);
}

const worker = readFileSync(`${packageRoot}/cloudflare-worker.ts`, 'utf8');
assert.doesNotMatch(worker, /@clerk\/nextjs|SUPABASE_SERVICE_KEY/);
assert.match(worker, /createHttpsRedirectResponse\(requestUrl\)/);
assert.match(worker, /withHeaders\(httpsRedirectResponse, versionHeaders\)/);
assert.match(worker, /status:\s*503/);
assert.match(worker, /Retry-After/);
assert.match(worker, /Content-Security-Policy/);
assert.match(worker, /getWorkerVersionHeaders\(env\)/);

console.log(
  'RECOVERY_BOUNDARY PASS (HTTPS redirect, blocked tenant surfaces, public routes, isolated staging)',
);
