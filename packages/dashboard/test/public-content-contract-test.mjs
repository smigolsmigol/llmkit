import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const readDashboard = (relativePath) => readFileSync(`${packageRoot}/${relativePath}`, 'utf8');
const readRepo = (relativePath) => readFileSync(`${repoRoot}/${relativePath}`, 'utf8');

function readPngSize(relativePath) {
  const png = readFileSync(`${repoRoot}/${relativePath}`);
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    `${relativePath} must be a PNG`,
  );
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

for (const [canonical, served] of [
  ['.github/logo-wordmark.svg', 'packages/dashboard/public/logo-wordmark.svg'],
  ['.github/logo-wordmark-animated.svg', 'packages/dashboard/public/logo-animated.svg'],
]) {
  assert.deepEqual(
    readFileSync(`${repoRoot}/${served}`),
    readFileSync(`${repoRoot}/${canonical}`),
    `${served} must remain byte-identical to ${canonical}`,
  );
}

assert.deepEqual(readPngSize('.github/social/github-social-preview.png'), {
  width: 1280,
  height: 640,
});
assert.deepEqual(readPngSize('packages/dashboard/src/app/opengraph-image.png'), {
  width: 1200,
  height: 630,
});
assert.deepEqual(
  readFileSync(`${repoRoot}/packages/dashboard/src/app/twitter-image.png`),
  readFileSync(`${repoRoot}/packages/dashboard/src/app/opengraph-image.png`),
  'Open Graph and Twitter previews must use the same reviewed export',
);
assert.equal(
  readDashboard('src/app/opengraph-image.alt.txt').trim(),
  'LLMKit logo',
);
assert.equal(readDashboard('src/app/twitter-image.alt.txt').trim(), 'LLMKit logo');
assert.ok(
  !existsSync(`${repoRoot}/packages/dashboard/src/app/opengraph-image.tsx`),
  'the website preview must use the reviewed static brand export',
);

const evidenceFiles = [
  'GOVERNANCE.md',
  'ROADMAP.md',
  'ARCHITECTURE.md',
  'SECURITY.md',
  'SECURITY-ASSURANCE.md',
  'ACCESSIBILITY.md',
  'CONTRIBUTING.md',
];

for (const relativePath of evidenceFiles) {
  assert.ok(existsSync(`${repoRoot}/${relativePath}`), `${relativePath} must exist`);
  const markdown = readRepo(relativePath);
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
    const fileTarget = rawTarget.split('#', 1)[0];
    if (!fileTarget) continue;
    const absoluteTarget = resolve(repoRoot, dirname(relativePath), fileTarget);
    assert.ok(
      existsSync(absoluteTarget),
      `${relativePath} links to missing repository path ${rawTarget}`,
    );
  }
}

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
for (const evidenceFile of evidenceFiles) {
  assert.match(readme, new RegExp(`\\(${evidenceFile.replace('.', '\\.')}\\)`));
}

const governance = readRepo('GOVERNANCE.md');
assert.match(governance, /single-maintainer governance model/);
assert.match(governance, /Federico Benini/);
assert.match(governance, /does not yet meet its target for access continuity/);

const roadmap = readRepo('ROADMAP.md');
assert.match(roadmap, /August 2026 through August 2027/);
assert.match(roadmap, /Not planned in this window/);
assert.match(roadmap, /does not invent cross-modality rankings|automatic "cheapest model" ranking/);

const architecture = readRepo('ARCHITECTURE.md');
assert.match(architecture, /Local tracking path/);
assert.match(architecture, /Hosted request path/);
assert.match(architecture, /public-recovery/);
assert.match(architecture, /service role is not a\s+tenant boundary by itself/);

const securityPolicy = readRepo('SECURITY.md');
assert.match(securityPolicy, /Security Requirements and Limits/);
assert.match(securityPolicy, /\[SECURITY-ASSURANCE\.md\]\(SECURITY-ASSURANCE\.md\)/);
assert.match(securityPolicy, /731-entry snapshot dated 2026-03-25/);
assert.match(securityPolicy, /does not invent cross-modality rankings/);

const securityAssurance = readRepo('SECURITY-ASSURANCE.md');
for (const requiredSection of [
  'Threat model',
  'Entry points and trust boundaries',
  'Secure design argument',
  'Common weakness countermeasures',
  'Cryptography, credentials, and network posture',
  'Runtime evidence register',
  'Residual risks and current HOLDs',
  'Recheck and decision procedure',
]) {
  assert.match(securityAssurance, new RegExp(`## ${requiredSection}`));
}
for (const requiredEvidence of [
  'packages/proxy/src/middleware/auth.ts',
  'packages/proxy/src/crypto.ts',
  'packages/proxy/src/middleware/budget.ts',
  'packages/proxy/src/middleware/idempotency.ts',
  'supabase/tests/database/tenant_isolation.test.sql',
  '.github/workflows/ci.yml',
]) {
  assert.match(securityAssurance, new RegExp(requiredEvidence.replaceAll('/', '\\/').replaceAll('.', '\\.')));
}
assert.match(securityAssurance, /maintainer self-assessment/i);
assert.match(securityAssurance, /TLS 1\.1[\s\S]*HOLD|HOLD[\s\S]*TLS 1\.1/);
assert.match(securityAssurance, /current production receipt absent/i);
assert.doesNotMatch(
  securityAssurance,
  /bestpractices\.dev[^\n]+(?:proves|evidence for|justifies)/i,
  'the assurance case must not use the BadgeApp answer as circular evidence',
);

const accessibility = readRepo('ACCESSIBILITY.md');
assert.match(accessibility, /target, not a[\s\S]*certification/);
assert.match(accessibility, /No manual NVDA, VoiceOver, Narrator/);
assert.match(accessibility, /English-only/);

const contributing = readRepo('CONTRIBUTING.md');
assert.match(contributing, /Developer Certificate of Origin 1\.1/);
assert.match(contributing, /git commit -s/);

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
].map(readDashboard);
const publicDocumentPaths = [
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
];
const publicDocs = publicDocumentPaths.map(readRepo);
for (const relativePath of [
  'README.md',
  'QUICKSTART.md',
  'API.md',
  'SECURITY.md',
  'packages/mcp-server/README.md',
]) {
  assert.doesNotMatch(
    readRepo(relativePath),
    /https?:\/\/[^\s)"']+\.vercel\.app/i,
    `${relativePath}: canonical public documents must not reference disabled Vercel hosts`,
  );
}
const rootLayout = readDashboard('src/app/layout.tsx');
assert.match(
  rootLayout,
  /openGraph:[\s\S]*images:\s*\[[\s\S]*url: '\/opengraph-image\.png'/,
  'root metadata must retain explicit Open Graph and Twitter images',
);
assert.match(rootLayout, /twitter:[\s\S]*images:\s*\['\/twitter-image\.png'\]/);
const authenticatedSurface = readDashboard('src/app/(auth)/dashboard/settings/page.tsx');
const publicSource = [...publicFiles, ...publicDocs, authenticatedSurface].join('\n');

const publicShell = readDashboard('src/components/public/public-shell.tsx');
assert.match(publicShell, /href="#main-content"/);
assert.match(publicShell, /id="main-content"/);

const globalStyles = readDashboard('src/app/globals.css');
assert.match(globalStyles, /\.public-shell :is\(a, button, input, select, textarea\):focus-visible/);
assert.match(globalStyles, /@media \(prefers-reduced-motion: reduce\)/);

const animatedLogo = readDashboard('src/components/animated-logo.tsx');
assert.match(animatedLogo, /@media \(prefers-reduced-motion: reduce\)/);

const publicNavigation = readDashboard('src/components/public-nav-static.tsx');
assert.match(publicNavigation, /aria-expanded=\{menuOpen\}/);
assert.match(publicNavigation, /aria-controls="public-mobile-navigation"/);

const developerQuickstart = readDashboard('src/components/public/developer-quickstart.tsx');
assert.match(developerQuickstart, /aria-pressed=\{activeId === option\.id\}/);
assert.match(developerQuickstart, /<fieldset/);
assert.match(developerQuickstart, /<legend className="sr-only">Installation method<\/legend>/);
assert.doesNotMatch(developerQuickstart, /role="tab"/);

const budgetPathDiagram = readRepo('.github/budget-path.svg');
assert.match(budgetPathDiagram, /role="img"/);
assert.match(budgetPathDiagram, /aria-labelledby="title description"/);

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

const pricingApiReferences = [
  readRepo('README.md'),
  readRepo('API.md'),
  readDashboard('src/app/(public)/pricing/page.tsx'),
  readDashboard('src/app/(public)/providers/[name]/page.tsx'),
  readDashboard('src/app/(public)/compare/calculator.tsx'),
].join('\n');
assert.doesNotMatch(
  pricingApiReferences,
  /pricing\/compare\?input=/,
  'public pricing API links must not trigger an implicit all-model ranking',
);
assert.match(pricingApiReferences, /mode=text-token/);
assert.match(pricingApiReferences, /models=anthropic%2Fclaude-sonnet-4-6%2Copenai%2Fgpt-4o/);
assert.match(pricingApiReferences, /cacheRead=0&cacheWrite=0/);

console.log(
  `PUBLIC_CONTENT_CONTRACT PASS (${modelCount} model entries, ${populatedProviders.length} populated providers, snapshot ${pricing.updatedAt})`,
);
