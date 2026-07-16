import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmrc = join(root, '.npmrc');
const expected = [
  'engine-strict=true',
  'auto-install-peers=true',
  'shamefully-hoist=false',
  '',
].join('\n');
const actual = readFileSync(npmrc, 'utf8').replaceAll('\r\n', '\n');

if (actual !== expected) {
  throw new Error(
    '.npmrc must contain only the reviewed non-secret package-manager settings. '
    + 'Credentials belong in user or CI auth configuration.',
  );
}

console.log('NPMRC_POLICY PASS');
