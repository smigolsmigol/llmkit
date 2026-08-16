// contract tests: verify consistency across packages, READMEs, configs
// usage: node test/contract-test.mjs

import { readFileSync } from 'node:fs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// load pricing tables
const { PRICING } = await import('../packages/shared/dist/providers.js');
const { PROXY_TOOLS, LOCAL_TOOLS } = await import('../packages/mcp-server/dist/tools.js');

const serverJson = JSON.parse(readFileSync('packages/mcp-server/server.json', 'utf8'));
const mcpPkg = JSON.parse(readFileSync('packages/mcp-server/package.json', 'utf8'));
const mcpIndex = readFileSync('packages/mcp-server/src/index.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const budgetPathDiagram = readFileSync('.github/budget-path.svg', 'utf8');
const pyPricingData = readFileSync('packages/python-sdk/src/llmkit/_pricing_data.py', 'utf8');
const pricingJson = JSON.parse(readFileSync('packages/shared/pricing.json', 'utf8'));

// pricing sync: shared PRICING (from pricing.json) vs python generated data
// ruff may wrap long tuples across lines, so match with regex allowing whitespace
function pyHasModel(model, inputPrice) {
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}":\\s*\\(\\s*${inputPrice}`);
  return re.test(pyPricingData);
}

test('pricing sync: claude-opus-4-6 matches across shared and python', () => {
  const shared = PRICING.anthropic['claude-opus-4-6'];
  assert(shared, 'shared should have claude-opus-4-6');
  assert(pyHasModel('claude-opus-4-6', shared.inputPerMillion),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing sync: gpt-4o matches across shared and python', () => {
  const shared = PRICING.openai['gpt-4o'];
  assert(shared, 'shared should have gpt-4o');
  assert(pyHasModel('gpt-4o', shared.inputPerMillion),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing sync: grok-4 matches across shared and python', () => {
  const shared = PRICING.xai['grok-4'];
  assert(shared, 'shared should have grok-4');
  assert(pyHasModel('grok-4', shared.inputPerMillion),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing.json is the source of truth for shared PRICING', () => {
  const jsonProviders = Object.keys(pricingJson.providers).length;
  const sharedProviders = Object.keys(PRICING).length;
  assert(jsonProviders === sharedProviders,
    `pricing.json has ${jsonProviders} providers but shared has ${sharedProviders}`);
});

// version sync
test('server.json version matches package.json version', () => {
  assert(serverJson.version === mcpPkg.version,
    `server.json ${serverJson.version} != package.json ${mcpPkg.version}`);
  const pkgVersion = serverJson.packages?.[0]?.version;
  assert(pkgVersion === mcpPkg.version,
    `server.json package version ${pkgVersion} != package.json ${mcpPkg.version}`);
});

test('MCP CLI help uses a non-interactive npx install', () => {
  assert(
    /args.*-y.*@f3d1\/llmkit-mcp-server/.test(mcpIndex),
    'MCP CLI help must include npx -y for unattended client startup',
  );
});

// manifest.json version sync
const manifest = JSON.parse(readFileSync('packages/mcp-server/manifest.json', 'utf8'));
test('manifest.json version matches package.json version', () => {
  assert(manifest.version === mcpPkg.version,
    `manifest.json ${manifest.version} != package.json ${mcpPkg.version}`);
});

test('MCPB manifest is local-first and uses the current bundle contract', () => {
  assert(manifest.manifest_version === '0.3', 'MCPB manifest must use specification 0.3');
  assert(manifest.server?.type === 'node', 'MCPB server must use the bundled Node runtime');
  assert(manifest.server?.entry_point === 'server/index.js', 'MCPB entry point must use bundled output');
  assert(
    manifest.server?.mcp_config?.args?.[0] === ['$', '{__dirname}/server/index.js'].join(''),
    'MCPB command must resolve its bundled entry point',
  );
  assert(manifest.user_config?.llmkit_api_key?.required === false,
    'MCPB API key must remain optional for local-only use');
  assert(manifest.user_config?.llmkit_api_key?.sensitive === true,
    'MCPB API key must remain secret');
  assert(manifest.tools_generated === true, 'MCPB must discover the server tools at runtime');
  assert(mcpPkg.files?.includes('mcp-server.mcpb'), 'npm package must retain the exact MCPB artifact');
});

test('obsolete Smithery source deployment contract is absent', () => {
  assert(!existsSync('smithery.yaml'), 'obsolete Supabase-era smithery.yaml must not return');
});

// MCPB freshness check (skipped if mcpb not present - file is gitignored, built locally)
import { existsSync, statSync } from 'node:fs';

test('MCPB file exists and is not older than dist/', () => {
  const mcpbPath = 'packages/mcp-server/mcp-server.mcpb';
  if (!existsSync(mcpbPath)) { return; } // gitignored, skip in CI
  const mcpbTime = statSync(mcpbPath).mtimeMs;
  const distTime = statSync('packages/mcp-server/dist/index.js').mtimeMs;
  assert(mcpbTime >= distTime - 60000,
    'mcp-server.mcpb is older than dist/ - rebuild with the MCPB script');
});

// README claims
test('README claims 11 tools, actual is 11', () => {
  const total = PROXY_TOOLS.length + LOCAL_TOOLS.length;
  assert(total === 11, `actual tool count is ${total}`);
  assert(readme.includes('11 tools'), 'README should mention 11 tools');
});

test('README distinguishes the bundled snapshot from provider identifiers', () => {
  const providerIdentifiers = Object.keys(PRICING).length;
  const populatedProviders = Object.values(PRICING)
    .filter((models) => Object.keys(models).length > 0)
    .length;
  const populatedJsonProviders = Object.values(pricingJson.providers)
    .filter((models) => Object.keys(models).length > 0)
    .length;

  assert(providerIdentifiers === 11, `provider identifier count is ${providerIdentifiers}`);
  assert(populatedProviders === populatedJsonProviders,
    `shared has ${populatedProviders} populated providers but pricing.json has ${populatedJsonProviders}`);
  assert(readme.includes('bundled reference snapshot'),
    'README should describe pricing as a bundled reference snapshot');
  assert(!readme.includes('pricing has 11 providers'),
    'README must not turn empty provider identifiers into populated pricing coverage');
});

test('README budget path avoids GitHub Mermaid controls', () => {
  assert(readme.includes('src=".github/budget-path.svg"'),
    'README should render the static budget path diagram');
  assert(!readme.includes('```mermaid'),
    'README should not use GitHub Mermaid controls for the budget path');
  assert(budgetPathDiagram.includes('viewBox="0 0 1200 390"'),
    'budget path diagram should scale to the README width');
  assert(budgetPathDiagram.includes('<title id="title">'),
    'budget path diagram should include an accessible title');
  assert(budgetPathDiagram.includes('<desc id="description">'),
    'budget path diagram should include an accessible description');
});

// run
for (const t of tests) {
  try {
    await t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}: ${e.message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
