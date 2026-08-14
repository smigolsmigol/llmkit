import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pnpmVersion = '9.15.4';
const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const buildPackages = [
  '@f3d1/llmkit-shared',
  '@f3d1/llmkit-sdk',
  '@f3d1/llmkit-cli',
  '@f3d1/llmkit-ai-sdk-provider',
  '@f3d1/llmkit-mcp-server',
];
const typecheckPackages = [
  ...buildPackages,
  '@f3d1/llmkit-proxy',
  '@f3d1/llmkit-dashboard',
];
const dormantLintDirectories = ['packages/plugin-eliza/src'];
const publishableDirectories = [
  'packages/shared',
  'packages/sdk',
  'packages/cli',
  'packages/ai-sdk-provider',
  'packages/mcp-server',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      LLMKIT_QUALITY_PYTHON: venvPython,
    },
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function pnpm(args) {
  const allArgs = [`pnpm@${pnpmVersion}`, ...args];
  if (process.platform === 'win32') {
    if (!allArgs.every((arg) => /^[A-Za-z0-9@._:/=,-]+$/.test(arg))) {
      throw new Error('Refusing to construct a Windows package command from an unsafe argument.');
    }
    run(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `corepack ${allArgs.join(' ')}`],
    );
    return;
  }
  run('corepack', allArgs);
}

function git(args) {
  const safeRoot = root.replaceAll('\\', '/');
  const result = spawnSync('git', ['-c', `safe.directory=${safeRoot}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function assertDormantPackageBoundary(testChangedPaths) {
  const path = 'packages/plugin-eliza';
  const changed = testChangedPaths || [
      git(['diff', '--name-only', '--', path]),
      git(['diff', '--cached', '--name-only', '--', path]),
      git(['ls-files', '--others', '--exclude-standard', '--', path]),
      git(['diff', '--name-only', 'origin/main...HEAD', '--', path]),
    ].filter(Boolean);
  if (changed.length > 0) {
    throw new Error(
      `${path} is excluded by pnpm-workspace.yaml and cannot be changed under a false `
      + 'quality signal. Reactivate its real dependencies and gates first.',
    );
  }
  console.log(`\nDORMANT_PACKAGE_BOUNDARY PASS (${path} frozen and unchanged)`);
}

if (process.argv[2] === '--self-test') {
  assertDormantPackageBoundary([]);
  let violationBlocked = false;
  try {
    assertDormantPackageBoundary(['packages/plugin-eliza/src/index.ts']);
  } catch {
    violationBlocked = true;
  }
  if (!violationBlocked) {
    throw new Error('Dormant-package violation fixture was not blocked.');
  }
  console.log('TS_QUALITY_SELF_TEST PASS (legitimate + violation fixtures)');
  process.exit(0);
}

if (process.argv[2] === '--dormant-boundary') {
  assertDormantPackageBoundary();
  console.log('DORMANT_PACKAGE_BOUNDARY_ONLY PASS');
  process.exit(0);
}

if (!existsSync(venvPython)) {
  throw new Error('Pinned quality environment missing. Run quality:bootstrap first.');
}

for (const packageName of buildPackages) {
  console.log(`\nTS_BUILD ${packageName}`);
  pnpm(['--filter', packageName, 'build']);
}

for (const packageName of typecheckPackages) {
  console.log(`\nTS_TYPECHECK ${packageName}`);
  pnpm(['--filter', packageName, 'typecheck']);
}

assertDormantPackageBoundary();

console.log('\nBIOME all first-party TypeScript source');
run(process.execPath, ['scripts/run-biome-policy.mjs']);

console.log('\nBIOME lint-only dormant source');
pnpm([
  'exec',
  'biome',
  'lint',
  ...dormantLintDirectories,
  '--diagnostic-level=error',
  '--max-diagnostics=200',
]);

console.log('\nKNIP workspace dead-code contract');
pnpm(['exec', 'knip', '--exclude', 'types,exports']);

for (const directory of publishableDirectories) {
  console.log(`\nPUBLINT ${directory}`);
  // publint's auto mode shells out to a bare `pnpm`, which is not guaranteed
  // when this gate intentionally runs pnpm through a pinned Corepack version.
  pnpm(['exec', 'publint', directory, '--pack=npm']);
}

console.log('\nGENERATED pricing contract');
run(process.execPath, ['scripts/generate-pricing.mjs', '--check']);

console.log('\nTS_QUALITY PASS');
