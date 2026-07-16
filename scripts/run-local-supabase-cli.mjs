import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const supabaseLauncher = join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
const cliArgs = process.argv.slice(2);
const forbidden = new Set(['--linked', '--db-url', '--password', '-p']);

if (!cliArgs.length) {
  throw new Error('A local Supabase CLI command is required.');
}
if (cliArgs.some((arg) => forbidden.has(arg))) {
  throw new Error('This wrapper is local-only and refuses remote connection flags.');
}
if (!cliArgs.every((arg) => /^[A-Za-z0-9@._:/,=-]+$/.test(arg))) {
  throw new Error('Refusing to construct a CLI command from an unsafe argument.');
}
if (!existsSync(supabaseLauncher)) {
  throw new Error('Pinned Supabase CLI is missing. Run pnpm install --frozen-lockfile.');
}

const windowsDocker = join(
  process.env.ProgramFiles || 'C:\\Program Files',
  'Docker',
  'Docker',
  'resources',
  'bin',
  'docker.exe',
);
const dockerDirectory = process.platform === 'win32' && existsSync(windowsDocker)
  ? dirname(windowsDocker)
  : null;
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
const childEnvironment = { ...process.env };
if (dockerDirectory) {
  childEnvironment[pathKey] = `${dockerDirectory};${process.env[pathKey] || ''}`;
}

const result = spawnSync(process.execPath, [supabaseLauncher, ...cliArgs], {
  cwd: root,
  env: childEnvironment,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
