import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const readDashboard = (relativePath) => readFileSync(`${packageRoot}/${relativePath}`, 'utf8');
const readRepo = (relativePath) => readFileSync(`${repoRoot}/${relativePath}`, 'utf8');

const securityTxt = readDashboard('public/.well-known/security.txt');
const securityTxtFields = new Map();
for (const line of securityTxt.trim().split(/\r?\n/)) {
  const separator = line.indexOf(':');
  assert.ok(separator > 0, `invalid security.txt line: ${line}`);
  const name = line.slice(0, separator);
  const value = line.slice(separator + 1).trim();
  const values = securityTxtFields.get(name) ?? [];
  values.push(value);
  securityTxtFields.set(name, values);
}

assert.deepEqual(securityTxtFields.get('Contact'), [
  'https://github.com/smigolsmigol/llmkit/security/advisories/new',
  'mailto:security@llmkit.sh',
]);
assert.deepEqual(securityTxtFields.get('Canonical'), [
  'https://llmkit.sh/.well-known/security.txt',
]);
assert.deepEqual(securityTxtFields.get('Policy'), [
  'https://github.com/smigolsmigol/llmkit/security/policy',
]);
assert.deepEqual(securityTxtFields.get('Preferred-Languages'), ['en']);

const [securityTxtExpiry] = securityTxtFields.get('Expires') ?? [];
const expiryTime = Date.parse(securityTxtExpiry);
const remainingLifetime = expiryTime - Date.now();
assert.ok(Number.isFinite(expiryTime), 'security.txt Expires must be an RFC 3339 timestamp');
assert.ok(remainingLifetime > 0, 'security.txt must not be expired');
assert.ok(
  remainingLifetime < 366 * 24 * 60 * 60 * 1000,
  'security.txt Expires must remain less than one year away',
);

const securityInsights = readRepo('security-insights.yml');
assert.match(securityInsights, /schema-version: 2\.2\.0/);
assert.match(securityInsights, /last-reviewed: '2026-08-13'/);
assert.match(
  securityInsights,
  /https:\/\/raw\.githubusercontent\.com\/smigolsmigol\/llmkit\/main\/security-insights\.yml/,
);
assert.match(securityInsights, /bug-bounty-available: false/);
assert.match(securityInsights, /https:\/\/www\.bestpractices\.dev\/projects\/12288/);
assert.doesNotMatch(securityInsights, /example\.com|11849/);

const readme = readRepo('README.md');
assert.match(readme, /bestpractices\.dev\/projects\/12288/);
assert.doesNotMatch(readme, /bestpractices\.dev\/projects\/11849/);
assert.match(readme, /\[Security Insights snapshot\]\(security-insights\.yml\)/);
assert.match(readme, /security\/advisories\/new/);

const pricing = JSON.parse(readFileSync(`${repoRoot}/packages/shared/pricing.json`, 'utf8'));
const populatedProviders = Object.entries(pricing.providers)
  .filter(([, models]) => Object.keys(models).length > 0)
  .map(([provider]) => provider)
  .sort();
const modelCount = Object.values(pricing.providers)
  .reduce((total, models) => total + Object.keys(models).length, 0);

assert.match(pricing.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(modelCount > 0, 'the public pricing snapshot must contain at least one model');
assert.ok(populatedProviders.length > 0, 'the public pricing snapshot must contain a populated provider');

const pricingHelper = readDashboard('src/lib/public-pricing.ts');
assert.match(pricingHelper, /pricingSource\.updatedAt/);
assert.match(pricingHelper, /new Set\(models\.map\(\(model\) => model\.provider\)\)/);

const publicFiles = [
  'src/app/(public)/page.tsx',
  'src/app/(public)/docs/page.tsx',
  'src/app/(public)/mcp/page.tsx',
  'src/app/(public)/pricing/page.tsx',
  'src/app/(public)/compare/page.tsx',
  'src/app/(public)/compare/calculator.tsx',
  'src/app/(public)/providers/[name]/page.tsx',
  'src/app/(public)/service-restoring/page.tsx',
  'src/components/public/developer-quickstart.tsx',
  'src/app/layout.tsx',
  'src/app/opengraph-image.tsx',
].map(readDashboard);
const publicDocs = [
  'README.md',
  'QUICKSTART.md',
  'API.md',
  'examples/sdk-basic.ts',
  'examples/streaming.ts',
  'examples/vercel-ai-sdk.ts',
  'packages/shared/README.md',
  'packages/sdk/README.md',
  'packages/cli/README.md',
  'packages/mcp-server/README.md',
  'packages/python-sdk/README.md',
  'packages/python-sdk/src/llmkit/_transport.py',
  'packages/ai-sdk-provider/README.md',
].map(readRepo);
const authenticatedSurface = readDashboard('src/app/(auth)/dashboard/settings/page.tsx');
const publicSource = [...publicFiles, ...publicDocs, authenticatedSurface].join('\n');

for (const staleClaim of [
  /730\+/i,
  /updated weekly/i,
  /from official pricing pages/i,
  /any SDK that accepts/i,
  /Reads Claude Code, Cursor, and Cline session data/i,
  /auto-detect Claude Code, Cline, and Cursor data/i,
  /zero-code cost tracking for any language/i,
  /process\.env\.LLMKIT_KEY/i,
  /free during beta/i,
  /moving onto (?:a )?new production stack/i,
]) {
  assert.doesNotMatch(publicSource, staleClaim);
}

const docs = readDashboard('src/app/(public)/docs/page.tsx');
assert.match(docs, /existing LLMKit API key/);
assert.match(docs, /LLMKIT_API_KEY!/);
assert.match(docs, /Calls that bypass OPENAI_BASE_URL or ANTHROPIC_BASE_URL are not observed/);

for (const example of [
  'examples/sdk-basic.ts',
  'examples/streaming.ts',
  'examples/vercel-ai-sdk.ts',
]) {
  assert.match(readRepo(example), /process\.env\.LLMKIT_API_KEY!/);
}

assert.match(authenticatedSurface, /Hosted access paused/);
assert.match(authenticatedSurface, /tenant-isolation verification is completed/);

const mcp = readDashboard('src/app/(public)/mcp/page.tsx');
assert.match(mcp, /supported Claude Code sessions and Cline task data/i);
assert.match(mcp, /"args": \["-y", "@f3d1\/llmkit-mcp-server"\]/);

const serviceStatus = readDashboard('src/app/(public)/service-restoring/page.tsx');
assert.match(serviceStatus, /\['Dashboard and auth', 'CLOSED'/);

const sitemap = readDashboard('src/app/sitemap.ts');
assert.match(sitemap, /getPublicPricingProviders/);
assert.match(sitemap, /lastModified: PRICING_SNAPSHOT_DATE/);
assert.doesNotMatch(sitemap, /ollama|openrouter|changeFrequency: 'weekly'/);

for (const relativePath of [
  'src/app/(public)/pricing/page.tsx',
  'src/app/(public)/compare/page.tsx',
  'src/app/(public)/compare/calculator.tsx',
  'src/app/(public)/providers/[name]/page.tsx',
]) {
  const source = readDashboard(relativePath);
  assert.match(source, /PRICING_SNAPSHOT_DATE|pricingSnapshotDate/);
  assert.match(source, /modality|token-billed/i);
}

assert.doesNotMatch(
  readDashboard('src/app/(public)/compare/calculator.tsx'),
  /bg-emerald-500/,
  'the calculator must not visually label cross-modality rows as the cheapest choices',
);
assert.match(
  readDashboard('src/app/(public)/compare/calculator.tsx'),
  /if \(!modelSearch\) return \[\]/,
  'the calculator must stay empty until a specific model search is provided',
);

console.log(
  `PUBLIC_CONTENT_CONTRACT PASS (${modelCount} model entries, ${populatedProviders.length} populated providers, snapshot ${pricing.updatedAt})`,
);
