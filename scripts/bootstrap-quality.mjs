import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] || 'python';
const venv = join(root, '.venv');
const venvPython = process.platform === 'win32'
  ? join(venv, 'Scripts', 'python.exe')
  : join(venv, 'bin', 'python');
const systemPython = process.platform === 'win32' ? 'python' : 'python3';
const semgrepImage = 'semgrep/semgrep:1.156.0@sha256:a3d49dc967b8534a6a76628e50c51cbfe33eb7195dc2feab1fdc0f100852c8ef';
const docker = process.platform === 'win32'
  ? join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Docker',
      'Docker',
      'resources',
      'bin',
      'docker.exe',
    )
  : 'docker';
const dockerEnvironment = {
  ...process.env,
  PATH: `${dirname(docker)}${delimiter}${process.env.PATH || ''}`,
};

if (!['python', 'hooks', 'semgrep', 'all'].includes(mode)) {
  throw new Error('Usage: node scripts/bootstrap-quality.mjs <python|hooks|semgrep|all>');
}

function run(label, command, args, options = {}) {
  console.log(`\nQUALITY_BOOTSTRAP ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 600_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    throw new Error(`${label} failed with ${outcome}.`);
  }
}

function bootstrapPython() {
  if (!existsSync(venvPython)) {
    run('create-python-environment', systemPython, ['-m', 'venv', venv]);
  }

  run('install-quality-tools', venvPython, [
    '-m',
    'pip',
    'install',
    '--require-hashes',
    '--only-binary=:all:',
    '--requirement',
    'requirements-ci.txt',
  ]);
  run('install-python-sdk', venvPython, [
    '-m',
    'pip',
    'install',
    '--no-build-isolation',
    '--no-deps',
    '--editable',
    'packages/python-sdk',
  ]);
  run('verify-python-environment', venvPython, ['-m', 'pip', 'check']);
  run('install-versioned-git-hooks', process.execPath, ['scripts/install-git-hooks.mjs']);
}

function bootstrapHooks() {
  if (!existsSync(venvPython)) {
    throw new Error('Pinned Python environment missing. Run quality:bootstrap first.');
  }

  const preCommitEnvironment = {
    ...process.env,
    PRE_COMMIT_HOME: join(root, '.cache', 'pre-commit'),
  };
  run(
    'hydrate-pre-commit-environments',
    venvPython,
    ['-m', 'pre_commit', 'install-hooks'],
    { env: preCommitEnvironment, timeout: 300_000 },
  );
}

function bootstrapSemgrep() {
  if (!existsSync(docker) && process.platform === 'win32') {
    throw new Error(`Docker CLI not found at ${docker}.`);
  }
  const imageCheck = spawnSync(docker, ['image', 'inspect', semgrepImage], {
    cwd: root,
    env: dockerEnvironment,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (imageCheck.error && imageCheck.error.code !== 'ENOENT') throw imageCheck.error;
  if (imageCheck.status !== 0) {
    run('pull-pinned-semgrep', docker, ['pull', semgrepImage], { env: dockerEnvironment });
  }
}

if (mode === 'python' || mode === 'all') bootstrapPython();
if (mode === 'hooks' || mode === 'all') bootstrapHooks();
if (mode === 'semgrep' || mode === 'all') bootstrapSemgrep();
console.log(`\nQUALITY_BOOTSTRAP PASS (${mode})`);
