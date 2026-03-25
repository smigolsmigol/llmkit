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
const { PROXY_TOOLS, LOCAL_TOOLS, NOTION_TOOLS } = await import('../packages/mcp-server/dist/tools.js');

const serverJson = JSON.parse(readFileSync('packages/mcp-server/server.json', 'utf8'));
const mcpPkg = JSON.parse(readFileSync('packages/mcp-server/package.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');
const pyPricing = readFileSync('packages/python-sdk/src/llmkit/_pricing.py', 'utf8');

// pricing sync: shared vs python for key models
test('pricing sync: claude-opus-4-6 matches across shared and python', () => {
  const shared = PRICING.anthropic['claude-opus-4-6'];
  assert(shared, 'shared should have claude-opus-4-6');
  assert(pyPricing.includes(`"claude-opus-4-6": TokenRates(${shared.inputPerMillion}`),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing sync: gpt-4o matches across shared and python', () => {
  const shared = PRICING.openai['gpt-4o'];
  assert(shared, 'shared should have gpt-4o');
  assert(pyPricing.includes(`"gpt-4o": TokenRates(${shared.inputPerMillion}`),
    `python should have matching input price ${shared.inputPerMillion}`);
});

test('pricing sync: grok-4 matches across shared and python', () => {
  const shared = PRICING.xai['grok-4'];
  assert(shared, 'shared should have grok-4');
  assert(pyPricing.includes(`"grok-4": TokenRates(${shared.inputPerMillion}`),
    `python should have matching input price ${shared.inputPerMillion}`);
});

// version sync
test('server.json version matches package.json version', () => {
  assert(serverJson.version === mcpPkg.version,
    `server.json ${serverJson.version} != package.json ${mcpPkg.version}`);
  const pkgVersion = serverJson.packages?.[0]?.version;
  assert(pkgVersion === mcpPkg.version,
    `server.json package version ${pkgVersion} != package.json ${mcpPkg.version}`);
});

// README claims
test('README claims 14 tools, actual is 14', () => {
  const total = PROXY_TOOLS.length + LOCAL_TOOLS.length + NOTION_TOOLS.length;
  assert(total === 14, `actual tool count is ${total}`);
  assert(readme.includes('14'), 'README should mention 14');
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
