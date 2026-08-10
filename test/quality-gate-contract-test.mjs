import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scripts = [
  'scripts/run-ts-quality.mjs',
  'scripts/run-quality-gate.mjs',
  'scripts/check-budget-falsifier-coverage.mjs',
  'scripts/assert-scorecard-supply-chain.mjs',
  'packages/proxy/test/database-compatibility-runtime-proof.mjs',
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [script, '--self-test'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} self-test failed with exit code ${result.status}.`);
  }
}

const requiredWorkflowFragments = [
  'name: scorecard-supply-chain',
  'node scripts/assert-scorecard-supply-chain.mjs results.json',
  'name: osv-zero-vulnerabilities',
  'google/osv-scanner-action/osv-scanner-action@8dc09193bb540e09b23da07ad7e30bd33bf87018',
  'google/osv-scanner-action/osv-reporter-action@8dc09193bb540e09b23da07ad7e30bd33bf87018',
  '--fail-on-vuln=true',
  'python -m pip install --require-hashes --only-binary=:all:',
  'python -m build --no-isolation',
  'needs: [quality, python-floor, scorecard-supply-chain, osv]',
  'name: start local database proof stack',
  'run: corepack pnpm@9.15.4 db:start',
  'name: stop local database proof stack',
  'run: corepack pnpm@9.15.4 db:stop',
];

const databaseStopContract = `- name: stop local database proof stack
        if: always()
        run: corepack pnpm@9.15.4 db:stop`;

function assertWorkflowContract(workflow) {
  for (const fragment of requiredWorkflowFragments) {
    if (!workflow.includes(fragment)) {
      throw new Error(`CI workflow contract is missing: ${fragment}`);
    }
  }

  const databaseStart = workflow.indexOf('name: start local database proof stack');
  const qualityRun = workflow.indexOf('name: run the local pre-PR contract');
  const databaseStop = workflow.indexOf('name: stop local database proof stack');
  if (!(databaseStart < qualityRun && qualityRun < databaseStop)) {
    throw new Error('CI database lifecycle must wrap the local pre-PR contract.');
  }
  if (!workflow.includes(databaseStopContract)) {
    throw new Error('CI database cleanup must run after every quality outcome.');
  }
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
assertWorkflowContract(workflow);

const qualityGate = readFileSync('scripts/run-quality-gate.mjs', 'utf8');
const moneyPathGateFragments = [
  "pnpm(['--filter', '@f3d1/llmkit-proxy', 'test:budget-falsifier']);",
  "pnpm(['--filter', '@f3d1/llmkit-proxy', 'test:budget-falsifier:coverage']);",
];

function assertMoneyPathGate(contents) {
  for (const fragment of moneyPathGateFragments) {
    if (!contents.includes(fragment)) {
      throw new Error(`Pre-PR quality contract is missing the money-path gate: ${fragment}`);
    }
  }
}

assertMoneyPathGate(qualityGate);
for (const fragment of moneyPathGateFragments) {
  let moneyPathViolationBlocked = false;
  try {
    assertMoneyPathGate(qualityGate.replace(fragment, ''));
  } catch {
    moneyPathViolationBlocked = true;
  }
  if (!moneyPathViolationBlocked) {
    throw new Error(`Money-path quality-gate violation fixture was accepted: ${fragment}`);
  }
}

const budgetCoverageGate = readFileSync('scripts/check-budget-falsifier-coverage.mjs', 'utf8');
if (!budgetCoverageGate.includes('dirtyMaterialSha256: await dirtyMaterialHash()')) {
  throw new Error('Changed money-path coverage receipt is not bound to the dirty worktree bytes.');
}
const budgetFalsifierGate = readFileSync('scripts/run-budget-falsifier.mjs', 'utf8');
if (!budgetFalsifierGate.includes("['status', '--porcelain=v1', '-z', '--untracked-files=all']")) {
  throw new Error('Gate 0 dirty-byte hashing must preserve raw porcelain and expand untracked files.');
}
if (!budgetCoverageGate.includes("git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])")) {
  throw new Error('Coverage dirty-byte hashing must preserve raw porcelain and expand untracked files.');
}

const workflowViolation = workflow.replace('name: scorecard-supply-chain', 'name: scorecard-advisory');
let blocked = false;
try {
  assertWorkflowContract(workflowViolation);
} catch {
  blocked = true;
}
if (!blocked) {
  throw new Error('CI workflow violation fixture was accepted.');
}

const databaseLifecycleViolation = workflow.replace(databaseStopContract, databaseStopContract.replace(
  'if: always()',
  'if: success()',
));
blocked = false;
try {
  assertWorkflowContract(databaseLifecycleViolation);
} catch {
  blocked = true;
}
if (!blocked) {
  throw new Error('CI database cleanup violation fixture was accepted.');
}

const reproducibilityContracts = new Map([
  [
    'scripts/bootstrap-quality.mjs',
    ["'--require-hashes'", "'--no-build-isolation'", "'--no-deps'"],
  ],
  [
    '.github/workflows/publish-pypi.yml',
    ['--require-hashes --only-binary=:all:', 'python -m build --no-isolation'],
  ],
  [
    '.github/workflows/slsa-provenance.yml',
    [
      'slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@f7dd8c54c2067bafc12ca7a55595d5ee9b75204a',
    ],
  ],
  ['requirements-ci.txt', ['--generate-hashes', 'idna==3.18', 'pip==26.1.2']],
  ['packages/python-sdk/pyproject.toml', ['hatchling==1.31.0']],
]);

function assertReproducibilityContracts(contentsByPath) {
  for (const [path, fragments] of reproducibilityContracts) {
    const contents = contentsByPath.get(path);
    for (const fragment of fragments) {
      if (!contents?.includes(fragment)) {
        throw new Error(`${path} is missing reproducibility contract: ${fragment}`);
      }
    }
  }
}

const reproducibilityContents = new Map(
  [...reproducibilityContracts.keys()].map((path) => [path, readFileSync(path, 'utf8')]),
);
assertReproducibilityContracts(reproducibilityContents);

const reproducibilityViolation = new Map(reproducibilityContents);
reproducibilityViolation.set(
  '.github/workflows/slsa-provenance.yml',
  reproducibilityContents
    .get('.github/workflows/slsa-provenance.yml')
    .replace('f7dd8c54c2067bafc12ca7a55595d5ee9b75204a', 'v2.1.0'),
);
blocked = false;
try {
  assertReproducibilityContracts(reproducibilityViolation);
} catch {
  blocked = true;
}
if (!blocked) {
  throw new Error('Build reproducibility violation fixture was accepted.');
}

console.log('QUALITY_GATE_CONTRACT PASS');
