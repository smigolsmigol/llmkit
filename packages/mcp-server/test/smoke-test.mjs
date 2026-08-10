// Smoke tests: exercise the built MCP server through Node without invoking a shell.
// Usage: node packages/mcp-server/test/smoke-test.mjs

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const entry = resolve('packages/mcp-server/dist/index.js');

function run(args = []) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) throw result.error;
  return result;
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

test('--help exits 0 and shows server name', () => {
  const result = run(['--help']);
  const text = output(result);
  assert(result.status === 0, `expected exit code 0, got ${result.status}`);
  assert(text.includes('LLMKit MCP Server'), 'should contain "LLMKit MCP Server"');
});

test('--help lists both tool groups', () => {
  const result = run(['--help']);
  const text = output(result);
  assert(result.status === 0, `expected exit code 0, got ${result.status}`);
  assert(text.includes('5 local tools'), 'should mention 5 local tools');
  assert(text.includes('6 proxy tools'), 'should mention 6 proxy tools');
});

test('--help shows config JSON snippet', () => {
  const result = run(['--help']);
  const text = output(result);
  assert(result.status === 0, `expected exit code 0, got ${result.status}`);
  assert(text.includes('"mcpServers"'), 'should contain MCP config JSON');
  assert(text.includes('@f3d1/llmkit-mcp-server'), 'should contain package name in config');
});

for (const current of tests) {
  try {
    current.fn();
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m ${current.name}`);
  } catch (error) {
    failed += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m ${current.name}: ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
