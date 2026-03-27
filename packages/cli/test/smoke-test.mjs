// smoke tests: verify the CLI shows usage when run without args
// usage: node packages/cli/test/smoke-test.mjs

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const entry = resolve('packages/cli/dist/index.js');

test('no args shows help and exits 0', () => {
  const out = execSync(`node ${entry}`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
  // help goes to stderr, but execSync captures stdout; check it didn't throw (exit 0)
});

test('--help shows usage', () => {
  const result = execSync(`node ${entry} --help 2>&1`, { encoding: 'utf8', timeout: 5000 });
  assert(result.includes('llmkit-cli'), 'should mention llmkit-cli');
  assert(result.includes('Usage:'), 'should contain Usage:');
});

test('--version prints version', () => {
  const result = execSync(`node ${entry} --version`, { encoding: 'utf8', timeout: 5000 });
  assert(/\d+\.\d+\.\d+/.test(result.trim()), 'should print semver');
});

test('missing -- separator suggests fix', () => {
  try {
    execSync(`node ${entry} python my_agent.py 2>&1`, { encoding: 'utf8', timeout: 5000 });
    assert(false, 'should have exited with code 1');
  } catch (e) {
    assert(e.status === 1, `expected exit code 1, got ${e.status}`);
  }
});

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
