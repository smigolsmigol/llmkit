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

test('no args exits 1 with usage text', () => {
  try {
    execSync(`node ${entry}`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    assert(false, 'should have exited with code 1');
  } catch (e) {
    assert(e.status === 1, `expected exit code 1, got ${e.status}`);
    assert(e.stderr.includes('Usage:'), 'stderr should contain Usage:');
  }
});

test('usage text mentions the package name', () => {
  try {
    execSync(`node ${entry}`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
  } catch (e) {
    assert(e.stderr.includes('llmkit-cli'), 'stderr should mention llmkit-cli');
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
