import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coverageDirectory = resolve(root, 'coverage', 'package-libraries');
const coverageSummaryPath = resolve(coverageDirectory, 'coverage-summary.json');
const c8Launcher = resolve(root, 'node_modules', 'c8', 'bin', 'c8.js');
const includes = [
  'packages/ai-sdk-provider/dist/**/*.js',
  'packages/cli/dist/**/*.js',
  'packages/mcp-server/dist/**/*.js',
  'packages/sdk/dist/**/*.js',
  'packages/shared/dist/**/*.js',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function dirtyMaterialHash() {
  const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const hash = createHash('sha256').update(raw);
  for (const entry of raw.split('\0').filter(Boolean).sort()) {
    const relative = entry.slice(3).replace(/^.* -> /, '');
    const full = resolve(root, relative);
    if (existsSync(full) && statSync(full).isFile()) {
      hash.update(relative).update(readFileSync(full));
    } else {
      hash.update(relative).update('<missing>');
    }
  }
  return hash.digest('hex');
}

function coverageMeasurement(statements) {
  const percent = statements.total === 0
    ? 0
    : Number(((statements.covered / statements.total) * 100).toFixed(2));
  return {
    covered: statements.covered,
    total: statements.total,
    percent,
  };
}

if (process.argv.includes('--self-test')) {
  if (coverageMeasurement({ covered: 80, total: 100 }).percent !== 80) {
    throw new Error('The package coverage percentage was calculated incorrectly.');
  }
  if (coverageMeasurement({ covered: 0, total: 0 }).percent !== 0) {
    throw new Error('An empty package coverage fixture was not reported as zero.');
  }
  if (new Set(includes).size !== 5) {
    throw new Error('Published JavaScript package coverage must name all five package surfaces.');
  }
  console.log('PACKAGE_COVERAGE_SELF_TEST PASS');
  process.exit(0);
}

if (!existsSync(c8Launcher)) {
  throw new Error('c8 is not installed. Run the frozen workspace install first.');
}

const c8Args = [
  c8Launcher,
  '--all',
  '--clean',
  '--reporter=text',
  '--reporter=json-summary',
  `--reports-dir=${coverageDirectory}`,
  `--temp-directory=${resolve(coverageDirectory, 'tmp')}`,
  ...includes.flatMap((pattern) => ['--include', pattern]),
  process.execPath,
  'scripts/run-js-tests.mjs',
];
const testStatus = run(process.execPath, c8Args);
if (testStatus !== 0) {
  throw new Error(`Published package tests failed with exit code ${testStatus}.`);
}

const summaryBytes = readFileSync(coverageSummaryPath);
const summary = JSON.parse(summaryBytes);
const statements = coverageMeasurement(summary.total.statements);
const receipt = {
  schemaVersion: 1,
  measurement: 'Published JavaScript package statement coverage',
  result: 'MEASURED',
  evaluatedHead: git(['rev-parse', 'HEAD']).trim(),
  dirtyMaterialSha256: dirtyMaterialHash(),
  coverageSummarySha256: sha256(summaryBytes),
  includes,
  statements,
};
mkdirSync(resolve(root, 'audits'), { recursive: true });
writeFileSync(
  resolve(root, 'audits', 'llmkit-package-coverage.json'),
  `${JSON.stringify(receipt, null, 2)}\n`,
);

console.log(
  `PACKAGE_COVERAGE MEASURED `
  + `(${statements.covered}/${statements.total}, ${statements.percent}%)`,
);
