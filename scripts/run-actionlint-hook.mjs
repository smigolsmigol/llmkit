import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function buildActionlintArgs(platform, filenames) {
  return platform === 'win32' ? ['-shellcheck=', ...filenames] : [...filenames];
}

function selfTest() {
  const files = ['.github/workflows/ci.yml'];
  const windows = buildActionlintArgs('win32', files);
  const linux = buildActionlintArgs('linux', files);
  if (windows[0] !== '-shellcheck=' || windows[1] !== files[0]) {
    throw new Error('Windows actionlint arguments must disable the deadlocking stdin integration.');
  }
  if (linux.length !== 1 || linux[0] !== files[0]) {
    throw new Error('Non-Windows actionlint arguments must preserve full ShellCheck integration.');
  }
  console.log('ACTIONLINT_HOOK_SELF_TEST PASS');
}

function main() {
  const filenames = process.argv.slice(2);
  if (filenames.length === 1 && filenames[0] === '--self-test') {
    selfTest();
    return;
  }

  const result = spawnSync('actionlint', buildActionlintArgs(process.platform, filenames), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`actionlint failed with exit code ${result.status}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
