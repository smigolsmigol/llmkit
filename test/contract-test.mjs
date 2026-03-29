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
const readme = readFileSync('README.md', 'utf8');
const pyPricingData = readFileSync('packages/python-sdk/src/llmkit/_pricing_data.py', 'utf8');
const pricingJson = JSON.parse(readFileSync('packages/shared/pricing.json', 'utf8'));

// pricing sync: shared PRICING (from pricing.json) vs python generated data
test('pricing sync: claude-opus-4-6 matches across shared and python', () => {
  const shared = PRICING.anthropic['claude-opus-4-6'];
  assert(shared, 'shared should have claude-opus-4-6');
  assert(pyPricingData.includes(`"claude-opus-4-6": (${shared.inputPerMillion}`),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing sync: gpt-4o matches across shared and python', () => {
  const shared = PRICING.openai['gpt-4o'];
  assert(shared, 'shared should have gpt-4o');
  assert(pyPricingData.includes(`"gpt-4o": (${shared.inputPerMillion}`),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing sync: grok-4 matches across shared and python', () => {
  const shared = PRICING.xai['grok-4'];
  assert(shared, 'shared should have grok-4');
  assert(pyPricingData.includes(`"grok-4": (${shared.inputPerMillion}`),
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

// manifest.json version sync
const manifest = JSON.parse(readFileSync('packages/mcp-server/manifest.json', 'utf8'));
test('manifest.json version matches package.json version', () => {
  assert(manifest.version === mcpPkg.version,
    `manifest.json ${manifest.version} != package.json ${mcpPkg.version}`);
});

// MCPB freshness check
import { statSync, existsSync } from 'node:fs';
test('MCPB file exists and is not older than dist/', () => {
  const mcpbPath = 'packages/mcp-server/mcp-server.mcpb';
  assert(existsSync(mcpbPath), 'mcp-server.mcpb does not exist');
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

test('README claims 11 providers, pricing has 11', () => {
  const providerCount = Object.keys(PRICING).length;
  assert(providerCount === 11, `actual provider count is ${providerCount}`);
  assert(readme.includes('11 providers'), 'README should mention 11 providers');
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
