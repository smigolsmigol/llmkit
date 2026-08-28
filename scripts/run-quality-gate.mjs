import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pnpmVersion = '9.15.4';
const auditPnpmVersion = '11.13.1';
const mode = process.argv[2];
const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const childEnvironment = {
  ...process.env,
  LLMKIT_QUALITY_PYTHON: venvPython,
  PRE_COMMIT_HOME: join(root, '.cache', 'pre-commit'),
};
const pythonCoveragePath = join(root, '.cache', 'python-coverage.json');
const pythonCoverageXmlPath = join(root, '.cache', 'python-coverage.xml');
const coverageFloor = 90;

if (!['fast', 'static', 'pr', '--self-test'].includes(mode)) {
  throw new Error('Usage: node scripts/run-quality-gate.mjs <fast|static|pr|--self-test>');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: childEnvironment,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function percentage(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

function assertPythonCoverage(totals) {
  const statements = percentage(totals.covered_lines, totals.num_statements);
  const branches = percentage(totals.covered_branches, totals.num_branches);
  console.log(
    `PYTHON_COVERAGE statements=${statements.toFixed(2)}% branches=${branches.toFixed(2)}%`,
  );
  if (statements < coverageFloor || branches < coverageFloor) {
    throw new Error(
      `Python coverage requires statements and branches >= ${coverageFloor}% `
      + `(actual ${statements.toFixed(2)}% / ${branches.toFixed(2)}%).`,
    );
  }
}

if (mode === '--self-test') {
  run(process.execPath, ['-e', 'process.exit(0)']);
  let violationBlocked = false;
  try {
    run(process.execPath, ['-e', 'process.exit(7)']);
  } catch {
    violationBlocked = true;
  }
  if (!violationBlocked) {
    throw new Error('Subprocess failure fixture was not propagated.');
  }
  assertPythonCoverage({
    covered_lines: 90,
    num_statements: 100,
    covered_branches: 9,
    num_branches: 10,
  });
  let coverageViolationBlocked = false;
  try {
    assertPythonCoverage({
      covered_lines: 899,
      num_statements: 1000,
      covered_branches: 90,
      num_branches: 100,
    });
  } catch {
    coverageViolationBlocked = true;
  }
  if (!coverageViolationBlocked) {
    throw new Error('Python coverage violation fixture was not blocked.');
  }
  console.log('QUALITY_GATE_SELF_TEST PASS (subprocess + coverage fixtures)');
  process.exit(0);
}

if (!existsSync(venvPython)) {
  throw new Error('Quality environment missing. Run pnpm quality:bootstrap first.');
}

function pnpmWithVersion(version, args) {
  const allArgs = [`pnpm@${version}`, ...args];
  if (process.platform === 'win32') {
    if (!allArgs.every((arg) => /^[A-Za-z0-9@._:/=-]+$/.test(arg))) {
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

function pnpm(args) {
  pnpmWithVersion(pnpmVersion, args);
}

function python(args, cwd = root) {
  run(venvPython, args, { cwd });
}

function runPreCommit() {
  python(
    ['-m', 'pre_commit', 'run', '--all-files'],
    root,
  );
}

function runPythonStatic() {
  const sdk = join(root, 'packages', 'python-sdk');
  python(['-m', 'ruff', 'check', 'src', 'tests', 'fuzz'], sdk);
  python(['-m', 'ruff', 'format', '--check', 'src', 'tests', 'fuzz'], sdk);
  python(['-m', 'mypy'], sdk);
  python(['-m', 'bandit', '-c', 'pyproject.toml', '-r', 'src', 'fuzz', '-ll'], sdk);
}

function runPythonProof() {
  const sdk = join(root, 'packages', 'python-sdk');
  python(['-m', 'build', '--wheel', '--no-isolation'], sdk);
  python(['-m', 'coverage', 'erase'], sdk);
  python(['-m', 'coverage', 'run', '--branch', '-m', 'pytest', 'tests'], sdk);
  python(['-m', 'coverage', 'run', '--branch', '--append', 'fuzz/run_local.py'], sdk);
  python(['-m', 'coverage', 'report'], sdk);
  python(['-m', 'coverage', 'xml', '-o', pythonCoverageXmlPath], sdk);
  python(['-m', 'coverage', 'json', '-o', pythonCoveragePath], sdk);
  const coverage = JSON.parse(readFileSync(pythonCoveragePath, 'utf8'));
  assertPythonCoverage(coverage.totals);
  python(['-m', 'pip_audit', '--strict', '.', '--progress-spinner', 'off'], sdk);
  python(
    [
      '-m',
      'pip_audit',
      '--strict',
      '--requirement',
      join(root, 'requirements-ci.txt'),
      '--progress-spinner',
      'off',
    ],
    root,
  );
}

runPreCommit();
if (mode === 'fast') {
  console.log('QUALITY_FAST PASS');
  process.exit(0);
}

run(process.execPath, ['scripts/run-ts-quality.mjs']);
runPythonStatic();
run(process.execPath, ['scripts/run-semgrep.mjs', 'test']);
run(process.execPath, ['scripts/run-semgrep.mjs', 'scan']);
run(process.execPath, ['scripts/run-keyguard.mjs']);

if (mode === 'static') {
  console.log('QUALITY_STATIC PASS');
  process.exit(0);
}

pnpm(['test']);
run(process.execPath, ['scripts/run-package-coverage.mjs']);
pnpm(['--filter', '@f3d1/llmkit-dashboard', 'test:coverage']);
pnpm(['--filter', '@f3d1/llmkit-proxy', 'test:budget-falsifier']);
pnpm(['--filter', '@f3d1/llmkit-proxy', 'test:budget-falsifier:coverage']);
run(process.execPath, ['scripts/run-project-coverage.mjs']);
runPythonProof();
run(process.execPath, ['scripts/run-artifact-reproducibility.mjs']);
pnpmWithVersion(auditPnpmVersion, ['--pm-on-fail=ignore', 'audit']);
pnpm(['db:verify']);
run(process.execPath, ['packages/proxy/test/database-compatibility-runtime-proof.mjs']);

console.log('QUALITY_PR PASS');
