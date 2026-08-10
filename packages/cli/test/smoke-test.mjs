// Smoke tests: exercise the built CLI through Node without invoking a shell.
// Usage: node packages/cli/test/smoke-test.mjs

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const entry = resolve('packages/cli/dist/index.js');

function run(args = []) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error) throw result.error;
  return result;
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

test('no args shows help and exits 0', () => {
  const result = run();
  assert(result.status === 0, `expected exit code 0, got ${result.status}`);
  assert(output(result).includes('Usage:'), 'should contain Usage:');
});

test('--help shows usage', () => {
  const result = run(['--help']);
  const text = output(result);
  assert(result.status === 0, `expected exit code 0, got ${result.status}`);
  assert(text.includes('llmkit-cli'), 'should mention llmkit-cli');
  assert(text.includes('Usage:'), 'should contain Usage:');
});

test('--version prints version', () => {
  const result = run(['--version']);
  assert(result.status === 0, `expected exit code 0, got ${result.status}`);
  assert(/\d+\.\d+\.\d+/.test(output(result).trim()), 'should print semver');
});

test('missing -- separator suggests fix', () => {
  const result = run(['python', 'my_agent.py']);
  assert(result.status === 1, `expected exit code 1, got ${result.status}`);
  assert(output(result).includes('--'), 'should suggest the command separator');
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
