import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const marker = 'LLMKIT_GATE0_RECEIPT=';
const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, '..', '..');
const corepackEntry = process.platform === 'win32'
  ? resolve(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  : undefined;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || packageRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    env: options.env || process.env,
  });
}

const command = corepackEntry ? process.execPath : 'corepack';
const result = run(command, [
  ...(corepackEntry ? [corepackEntry] : []),
  'pnpm@9.15.4', 'exec', 'vitest', 'run',
  '--config', 'vitest.budget-falsifier.config.ts',
  '--testNamePattern', '^(?!.*local budget and replay coordination)',
  '--coverage', '--reporter=dot',
], {
  env: { ...process.env, GATE0_REPEAT_START: '0', GATE0_REPEAT_COUNT: '1' },
});
if (result.error) throw result.error;
process.stdout.write((result.stdout || '').split(/\r?\n/).filter((line) => !line.includes(marker)).join('\n'));
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);

const check = run(process.execPath, [resolve(repoRoot, 'scripts', 'check-budget-falsifier-coverage.mjs')]);
if (check.error) throw check.error;
process.stdout.write(`\n${check.stdout || ''}`);
process.stderr.write(check.stderr || '');
process.exit(check.status || 0);
