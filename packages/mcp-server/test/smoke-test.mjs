// smoke tests: verify the MCP server installs and shows help correctly
// catches the "npx hangs" class of bugs
// usage: node packages/mcp-server/test/smoke-test.mjs

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const entry = resolve('packages/mcp-server/dist/index.js');

test('--help exits 0 and shows server name', () => {
  const out = execSync(`node ${entry} --help 2>&1`, { encoding: 'utf8', timeout: 5000 });
  assert(out.includes('LLMKit MCP Server'), 'should contain "LLMKit MCP Server"');
});

test('--help lists all 3 tool groups', () => {
  const out = execSync(`node ${entry} --help 2>&1`, { encoding: 'utf8', timeout: 5000 });
  assert(out.includes('5 local tools'), 'should mention 5 local tools');
  assert(out.includes('6 proxy tools'), 'should mention 6 proxy tools');
  assert(out.includes('3 Notion tools'), 'should mention 3 Notion tools');
});

test('--help shows config JSON snippet', () => {
  const out = execSync(`node ${entry} --help 2>&1`, { encoding: 'utf8', timeout: 5000 });
  assert(out.includes('"mcpServers"'), 'should contain MCP config JSON');
  assert(out.includes('@f3d1/llmkit-mcp-server'), 'should contain package name in config');
});

// run
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}: ${e.message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
