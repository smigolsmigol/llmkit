import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bucketByHour } from '../src/components/charts/types.ts';
import {
  classifyRecoveryPath,
  getHttpsRedirectUrl,
  RECOVERY_BLOCKED_API_PREFIXES,
  RECOVERY_BLOCKED_UI_PREFIXES,
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

for (const pathname of ['/', '/docs', '/pricing', '/compare', '/mcp']) {
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

const worker = readFileSync(`${packageRoot}/cloudflare-worker.ts`, 'utf8');
assert.doesNotMatch(worker, /@clerk\/nextjs|SUPABASE_SERVICE_KEY/);
assert.match(worker, /createHttpsRedirectResponse\(requestUrl\)/);
assert.match(worker, /withHeaders\(httpsRedirectResponse\)/);
assert.match(worker, /status:\s*503/);
assert.match(worker, /Retry-After/);
assert.match(worker, /Content-Security-Policy/);

console.log(
  'RECOVERY_BOUNDARY PASS (HTTPS redirect, blocked tenant surfaces, public routes, isolated staging)',
);
