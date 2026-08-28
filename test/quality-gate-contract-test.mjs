import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scripts = [
  'scripts/run-biome-policy.mjs',
  'scripts/run-artifact-reproducibility.mjs',
  'scripts/run-dashboard-reproducibility.mjs',
  'scripts/run-package-coverage.mjs',
  'scripts/run-project-coverage.mjs',
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
  'name: dashboard-reproducibility',
  'run: node scripts/run-dashboard-reproducibility.mjs',
  'needs: [quality, dashboard-reproducibility, python-floor, scorecard-supply-chain, osv]',
  'needs: [quality, dashboard-reproducibility, python-floor, scorecard-supply-chain, osv, deploy, post-deploy-verify]',
  'name: start local database proof stack',
  'run: corepack pnpm@9.15.4 db:start',
  'name: stop local database proof stack',
  'run: corepack pnpm@9.15.4 db:stop',
  'name: retain coverage reports for isolated upload',
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  'codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f',
  'files: coverage-reports/.cache/python-coverage.xml',
  'files: coverage-reports/coverage/package-libraries/lcov.info',
  'files: coverage-reports/packages/dashboard/coverage/dashboard/lcov.info',
  'files: coverage-reports/packages/proxy/coverage/budget-falsifier/lcov.info',
  'version: v11.3.1',
];

const databaseStopContract = `- name: stop local database proof stack
        if: always()
        run: corepack pnpm@9.15.4 db:stop`;

const codecovUploadContracts = [
  [
    'upload package coverage',
    'files: coverage-reports/coverage/package-libraries/lcov.info',
    'flags: packages',
    'root_dir: .',
  ],
  [
    'upload dashboard coverage',
    'files: coverage-reports/packages/dashboard/coverage/dashboard/lcov.info',
    'flags: dashboard',
    'root_dir: packages/dashboard',
  ],
  [
    'upload proxy coverage',
    'files: coverage-reports/packages/proxy/coverage/budget-falsifier/lcov.info',
    'flags: proxy',
    'root_dir: packages/proxy',
  ],
  [
    'upload Python SDK coverage',
    'files: coverage-reports/.cache/python-coverage.xml',
    'flags: python-sdk',
    'root_dir: packages/python-sdk',
  ],
];

function assertCodecovUploadStep(coverageJob, [name, ...fragments]) {
  const start = coverageJob.indexOf(`- name: ${name}`);
  const end = coverageJob.indexOf('\n      - name:', start + 1);
  const step = coverageJob.slice(start, end === -1 ? undefined : end);
  if (start === -1 || fragments.some((fragment) => !step.includes(fragment))) {
    throw new Error(`Codecov upload contract is incomplete for: ${name}`);
  }
}

function assertCoverageWorkflowContract(workflow) {
  const qualityStart = workflow.indexOf('  quality:');
  const coverageStart = workflow.indexOf('  coverage-observability:');
  const dashboardStart = workflow.indexOf('  dashboard-reproducibility:');
  if (!(qualityStart < coverageStart && coverageStart < dashboardStart)) {
    throw new Error('Codecov upload must remain a separate job after the quality job.');
  }

  const qualityJob = workflow.slice(qualityStart, coverageStart);
  const coverageJob = workflow.slice(coverageStart, dashboardStart);
  if (qualityJob.includes('id-token: write')) {
    throw new Error('The job that executes pull-request code must not receive OIDC permission.');
  }
  if ((workflow.match(/id-token: write/g) ?? []).length !== 1) {
    throw new Error('Only the isolated Codecov job may receive OIDC permission.');
  }
  for (const fragment of ['needs: quality', 'id-token: write']) {
    if (!coverageJob.includes(fragment)) {
      throw new Error(`The isolated Codecov job is missing: ${fragment}`);
    }
  }
  if ((coverageJob.match(/codecov\/codecov-action@/g) ?? []).length !== 4) {
    throw new Error('Codecov must receive exactly one report for each measured surface.');
  }
  for (const fragment of ['use_oidc: true', 'disable_search: true', 'fail_ci_if_error: false']) {
    if (coverageJob.split(fragment).length - 1 !== 4) {
      throw new Error(`Every Codecov upload must include: ${fragment}`);
    }
  }
  for (const upload of codecovUploadContracts) {
    assertCodecovUploadStep(coverageJob, upload);
  }
}

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
  assertCoverageWorkflowContract(workflow);
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
assertWorkflowContract(workflow);
if (!workflow.includes('--max-time 30 "https://api.llmkit.sh/health"')) {
  throw new Error('CI production health must target api.llmkit.sh');
}

const qualityGate = readFileSync('scripts/run-quality-gate.mjs', 'utf8');
const coverageExportContracts = new Map([
  [
    'scripts/run-quality-gate.mjs',
    [
      "const pythonCoverageXmlPath = join(root, '.cache', 'python-coverage.xml');",
      "python(['-m', 'coverage', 'xml', '-o', pythonCoverageXmlPath], sdk);",
    ],
  ],
  ['scripts/run-package-coverage.mjs', ["'--reporter=lcovonly'"]],
  [
    'packages/dashboard/vitest.config.ts',
    ["reporter: ['text', 'json', 'json-summary', 'lcovonly']"],
  ],
  [
    'packages/proxy/vitest.budget-falsifier.config.ts',
    ["reporter: ['text', 'json', 'json-summary', 'lcovonly']"],
  ],
]);

function assertCoverageExportContracts(contentsByPath) {
  for (const [path, fragments] of coverageExportContracts) {
    const contents = contentsByPath.get(path);
    if (contents === undefined) {
      throw new Error(`Codecov report generation input is missing: ${path}`);
    }
    for (const fragment of fragments) {
      if (!contents.includes(fragment)) {
        throw new Error(`${path} is missing Codecov report generation: ${fragment}`);
      }
    }
  }
}

function assertCodecovConfig(contents) {
  for (const fragment of ['after_n_builds: 4', 'informational: true', 'comment: false']) {
    if (!contents.includes(fragment)) {
      throw new Error(`Codecov must remain non-blocking and quiet: ${fragment}`);
    }
  }
}

function replaceFixture(contents, original, replacement) {
  if (!contents.includes(original)) {
    throw new Error(`Codecov violation fixture is stale: ${original}`);
  }
  return contents.replace(original, replacement);
}

function assertViolationBlocked(label, assertion) {
  let blocked = false;
  try {
    assertion();
  } catch {
    blocked = true;
  }
  if (!blocked) {
    throw new Error(`${label} violation fixture was accepted.`);
  }
}

const coverageExportContents = new Map(
  [...coverageExportContracts.keys()].map((path) => [path, readFileSync(path, 'utf8')]),
);
assertCoverageExportContracts(coverageExportContents);

const codecovConfig = readFileSync('codecov.yml', 'utf8');
assertCodecovConfig(codecovConfig);

const oidcViolation = replaceFixture(
  workflow,
  '          use_oidc: true',
  '          use_oidc: false',
);
assertViolationBlocked('Codecov OIDC', () => assertCoverageWorkflowContract(oidcViolation));

const packageUploadRoot = `          flags: packages
          root_dir: .
          use_oidc: true`;
const dashboardUploadRoot = `          flags: dashboard
          root_dir: packages/dashboard
          use_oidc: true`;
const misplacedRootDirViolation = replaceFixture(
  replaceFixture(
    workflow,
    packageUploadRoot,
    packageUploadRoot.replace('root_dir: .', 'root_dir: packages/dashboard'),
  ),
  dashboardUploadRoot,
  dashboardUploadRoot.replace(
    'root_dir: packages/dashboard',
    `root_dir: packages/dashboard
          root_dir: .`,
  ),
);
assertViolationBlocked('Codecov upload step boundary', () =>
  assertCoverageWorkflowContract(misplacedRootDirViolation),
);

const coverageExportViolation = new Map(coverageExportContents);
coverageExportViolation.set(
  'scripts/run-package-coverage.mjs',
  replaceFixture(
    coverageExportContents.get('scripts/run-package-coverage.mjs'),
    "'--reporter=lcovonly'",
    "'--reporter=json'",
  ),
);
assertViolationBlocked('Codecov report generation', () =>
  assertCoverageExportContracts(coverageExportViolation),
);

const codecovConfigViolation = replaceFixture(codecovConfig, 'comment: false', 'comment: true');
assertViolationBlocked('Codecov configuration', () => assertCodecovConfig(codecovConfigViolation));

const moneyPathGateFragments = [
  "pnpm(['--filter', '@f3d1/llmkit-proxy', 'test:budget-falsifier']);",
  "pnpm(['--filter', '@f3d1/llmkit-proxy', 'test:budget-falsifier:coverage']);",
];
const dashboardCoverageGateFragment =
  "pnpm(['--filter', '@f3d1/llmkit-dashboard', 'test:coverage']);";
const packageCoverageGateFragment =
  "run(process.execPath, ['scripts/run-package-coverage.mjs']);";
const projectCoverageGateFragment =
  "run(process.execPath, ['scripts/run-project-coverage.mjs']);";
const artifactReproducibilityGateFragment =
  "run(process.execPath, ['scripts/run-artifact-reproducibility.mjs']);";

function assertMoneyPathGate(contents) {
  for (const fragment of moneyPathGateFragments) {
    if (!contents.includes(fragment)) {
      throw new Error(`Pre-PR quality contract is missing the money-path gate: ${fragment}`);
    }
  }
}

assertMoneyPathGate(qualityGate);
for (const fragment of [
  packageCoverageGateFragment,
  dashboardCoverageGateFragment,
  projectCoverageGateFragment,
  artifactReproducibilityGateFragment,
]) {
  if (!qualityGate.includes(fragment)) {
    throw new Error(`Pre-PR quality contract is missing coverage gate: ${fragment}`);
  }
}
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

for (const fragment of [
  packageCoverageGateFragment,
  dashboardCoverageGateFragment,
  projectCoverageGateFragment,
  artifactReproducibilityGateFragment,
]) {
  let coverageViolationBlocked = false;
  try {
    const violatedGate = qualityGate.replace(fragment, '');
    if (!violatedGate.includes(fragment)) {
      throw new Error('coverage gate missing');
    }
  } catch {
    coverageViolationBlocked = true;
  }
  if (!coverageViolationBlocked) {
    throw new Error(`Coverage quality-gate violation fixture was accepted: ${fragment}`);
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
    'package.json',
    [
      '"patchedDependencies"',
      '"@opennextjs/cloudflare@1.20.2": "patches/@opennextjs__cloudflare@1.20.2.patch"',
      '"quality:dashboard-reproducibility": "node scripts/run-dashboard-reproducibility.mjs"',
    ],
  ],
  [
    'patches/@opennextjs__cloudflare@1.20.2.patch',
    [
      'const manifests = (await glob',
      'const manifestPaths = (await glob',
    ],
  ],
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
  ['requirements-ci.txt', ['--generate-hashes', 'idna==3.18', 'pip==26.2.1']],
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

  const openNextPatch = contentsByPath.get(
    'patches/@opennextjs__cloudflare@1.20.2.patch',
  );
  if ((openNextPatch?.match(/\)\)\.sort\(\);/g) ?? []).length !== 2) {
    throw new Error('OpenNext manifest generation must sort both glob result sets.');
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
