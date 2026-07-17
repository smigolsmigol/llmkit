import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sdk = join(root, 'packages', 'python-sdk');
const python = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const mode = process.argv[2];
const prefix = 'packages/python-sdk/';

if (!['check', 'format'].includes(mode)) {
  throw new Error('Usage: node scripts/run-python-files.mjs <check|format> [files...]');
}
if (!existsSync(python)) {
  throw new Error('Pinned quality environment missing. Run quality:bootstrap first.');
}

const files = process.argv.slice(3).map((file) => {
  const normalized = file.replaceAll('\\', '/');
  if (
    !normalized.startsWith(prefix)
    || !/\.(?:py|pyi)$/.test(normalized)
    || !/^(?:src|tests|fuzz)\//.test(normalized.slice(prefix.length))
  ) {
    throw new Error(`Refusing unexpected Ruff hook path: ${file}`);
  }
  return normalized.slice(prefix.length);
});

if (files.length === 0) {
  process.exit(0);
}

const args = mode === 'check'
  ? ['-m', 'ruff', 'check', ...files]
  : ['-m', 'ruff', 'format', ...files];
const result = spawnSync(python, args, {
  cwd: sdk,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
