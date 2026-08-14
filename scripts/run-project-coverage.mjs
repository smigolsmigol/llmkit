import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coverageFloor = 80;
const inputs = [
  {
    surface: 'published-packages',
    path: 'coverage/package-libraries/coverage-summary.json',
  },
  {
    surface: 'dashboard',
    path: 'packages/dashboard/coverage/dashboard/coverage-summary.json',
  },
  {
    surface: 'proxy',
    path: 'packages/proxy/coverage/budget-falsifier/coverage-summary.json',
  },
];

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

function aggregateStatements(surfaces) {
  const total = surfaces.reduce((sum, surface) => sum + surface.statements.total, 0);
  const covered = surfaces.reduce((sum, surface) => sum + surface.statements.covered, 0);
  const percent = total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2));
  return {
    covered,
    total,
    percent,
    passed: total > 0 && percent >= coverageFloor,
  };
}

if (process.argv.includes('--self-test')) {
  const passing = aggregateStatements([
    { statements: { covered: 40, total: 50 } },
    { statements: { covered: 40, total: 50 } },
  ]);
  const failing = aggregateStatements([
    { statements: { covered: 79, total: 100 } },
  ]);
  if (!passing.passed || passing.percent !== 80) {
    throw new Error('The exact 80% project coverage boundary was rejected.');
  }
  if (failing.passed) throw new Error('An under-covered project fixture was accepted.');
  if (aggregateStatements([]).passed) throw new Error('An empty project fixture was accepted.');
  console.log('PROJECT_COVERAGE_SELF_TEST PASS');
  process.exit(0);
}

const surfaces = inputs.map((input) => {
  const full = resolve(root, input.path);
  if (!existsSync(full)) {
    throw new Error(`Coverage input is missing for ${input.surface}: ${input.path}`);
  }
  const bytes = readFileSync(full);
  const summary = JSON.parse(bytes);
  return {
    surface: input.surface,
    path: input.path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    statements: summary.total.statements,
  };
});
const statements = aggregateStatements(surfaces);
const receipt = {
  schemaVersion: 1,
  gate: 'OpenSSF Silver project JavaScript statement coverage',
  result: statements.passed ? 'PASS' : 'FAIL',
  thresholdPercent: coverageFloor,
  evaluatedHead: git(['rev-parse', 'HEAD']).trim(),
  dirtyMaterialSha256: dirtyMaterialHash(),
  surfaces,
  statements,
};
mkdirSync(resolve(root, 'audits'), { recursive: true });
writeFileSync(
  resolve(root, 'audits', 'llmkit-project-coverage.json'),
  `${JSON.stringify(receipt, null, 2)}\n`,
);

console.log(
  `PROJECT_COVERAGE ${receipt.result} `
  + `(${statements.covered}/${statements.total}, ${statements.percent}%; floor ${coverageFloor}%)`,
);
if (!statements.passed) process.exitCode = 1;
