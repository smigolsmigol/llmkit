import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function git(args) {
  const result = spawnSync(
    'git',
    ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

git(['config', '--local', 'core.hooksPath', '.github/hooks']);
const configured = git(['config', '--local', '--get', 'core.hooksPath']);
if (configured !== '.github/hooks') {
  throw new Error(`Expected core.hooksPath=.github/hooks, got ${configured || '<empty>'}.`);
}

console.log('GIT_HOOKS PASS (.github/hooks)');
