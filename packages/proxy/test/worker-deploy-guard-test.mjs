import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isStagingWorkerMissing,
  parseStagingSecrets,
  STAGING_SECRET_NAMES,
  STAGING_WORKER_NAME,
  stagingDeployApproval,
  validateStagingDatabaseBinding,
} from '../../../scripts/staging-deploy-contract.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const deployScript = resolve(repoRoot, 'scripts', 'run-worker-deploy.mjs');
const hostedProofScript = resolve(repoRoot, 'scripts', 'run-hosted-budget-proof.mjs');
const wranglerConfig = readFileSync(
  resolve(repoRoot, 'packages', 'proxy', 'wrangler.toml'),
  'utf8',
);
const stagingWranglerConfig = readFileSync(
  resolve(repoRoot, 'packages', 'proxy', 'wrangler.staging.toml'),
  'utf8',
);
const falsifierWranglerConfig = readFileSync(
  resolve(repoRoot, 'packages', 'proxy', 'wrangler.budget-falsifier.toml'),
  'utf8',
);

function run(args, env = process.env) {
  return spawnSync(process.execPath, [deployScript, ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(operation, expected, message) {
  try {
    operation();
  } catch (error) {
    assert(String(error.message).includes(expected), `${message}: ${error.message}`);
    return;
  }
  throw new Error(message);
}

function compatibilityDate(config, label) {
  const match = /^compatibility_date\s*=\s*"([^"]+)"/m.exec(config);
  assert(match, `${label} is missing compatibility_date.`);
  return match[1];
}

assert(
  compatibilityDate(falsifierWranglerConfig, 'Budget falsifier Wrangler config')
    === compatibilityDate(wranglerConfig, 'Production Wrangler config'),
  'Budget falsifier compatibility_date does not match production.',
);
assert(
  compatibilityDate(stagingWranglerConfig, 'Staging Wrangler config')
    === compatibilityDate(wranglerConfig, 'Production Wrangler config'),
  'Staging compatibility_date does not match production.',
);

assert(!/\[env\.staging\]/.test(wranglerConfig), 'Production config still contains a staging environment.');
assert(/api\.llmkit\.sh\/\*/.test(wranglerConfig), 'Production config lost its API route.');
assert(/^name\s*=\s*"llmkit-proxy-staging"/m.test(stagingWranglerConfig), 'Staging Worker name is not exact.');
assert(/^main\s*=\s*"src\/staging\.ts"/m.test(stagingWranglerConfig), 'Staging does not use the proof wrapper.');
assert(/^workers_dev\s*=\s*true/m.test(stagingWranglerConfig), 'Staging does not explicitly use workers.dev.');
assert(/^routes\s*=\s*\[\s*\]/m.test(stagingWranglerConfig), 'Staging does not explicitly clear production routes.');
assert(/^STAGING_PROOF_ENABLED\s*=\s*"true"/m.test(stagingWranglerConfig), 'Staging proof surface is not explicitly enabled.');
const stagingBindings = [...stagingWranglerConfig.matchAll(
  /\[\[durable_objects\.bindings\]\]\s*name\s*=\s*"([^"]+)"\s*class_name\s*=\s*"([^"]+)"/g,
)].map((match) => `${match[1]}:${match[2]}`).sort();
assert(
  JSON.stringify(stagingBindings) === JSON.stringify([
    'BUDGET_DO:BudgetDO',
    'IDEMPOTENCY_DO:IdempotencyDO',
    'RATE_LIMIT_DO:RateLimitDO',
  ]),
  `Staging Durable Object bindings are not exact: ${stagingBindings.join(', ')}`,
);
assert(
  deployScript && readFileSync(deployScript, 'utf8').includes('wrangler.staging.toml'),
  'Deploy guard does not target the separate staging Wrangler config.',
);
assert(
  readFileSync(deployScript, 'utf8').includes('STAGING_SOURCE_COMMIT:'),
  'Deploy guard does not bind staging to the source commit.',
);
assert(
  !readFileSync(deployScript, 'utf8').includes("'--yes'"),
  'Deploy guard passes the removed --yes option to Wrangler.',
);
assert(
  readFileSync(deployScript, 'utf8').includes("'--format',\n      'json'")
    && readFileSync(deployScript, 'utf8').includes("'--secrets-file'")
    && readFileSync(deployScript, 'utf8').includes("'--account-id'")
    && readFileSync(deployScript, 'utf8').includes("'--bootstrap'")
    && readFileSync(deployScript, 'utf8').includes('CLOUDFLARE_ACCOUNT_ID')
    && readFileSync(deployScript, 'utf8').includes("'whoami'")
    && readFileSync(deployScript, 'utf8').includes('isStagingWorkerMissing')
    && readFileSync(deployScript, 'utf8').includes('Staging contains unexpected secrets'),
  'Deploy guard lacks pinned account verification or fail-closed secret bootstrap.',
);

const stagingRef = 'abcdefghijklmnopqrst';
const productionRef = 'zyxwvutsrqponmlkjihg';
const parsedSecrets = parseStagingSecrets([
  'ENCRYPTION_KEY=not-printed',
  'STAGING_PROOF_TOKEN=not-printed',
  `STAGING_SUPABASE_PROJECT_REF=${stagingRef}`,
  'SUPABASE_KEY=not-printed',
  `SUPABASE_URL="https://${stagingRef}.supabase.co"`,
].join('\n'));
validateStagingDatabaseBinding(parsedSecrets, stagingRef, productionRef);
assert(
  stagingDeployApproval('0'.repeat(32), stagingRef)
    === `staging:${STAGING_WORKER_NAME}:account:${'0'.repeat(32)}:db:${stagingRef}`,
  'Staging approval is not bound to the account and database.',
);
assertThrows(
  () => validateStagingDatabaseBinding(parsedSecrets, stagingRef, stagingRef),
  'must differ from production',
  'Production database ref was accepted as staging.',
);
const wrongUrl = new Map(parsedSecrets);
wrongUrl.set('SUPABASE_URL', `https://${productionRef}.supabase.co`);
assertThrows(
  () => validateStagingDatabaseBinding(wrongUrl, stagingRef, productionRef),
  'does not match',
  'Mismatched staging database URL was accepted.',
);

for (const missingWorkerFixture of [
  '[code: 10007]',
  '{"code":10090}',
  `Worker "${STAGING_WORKER_NAME}" not found.\n\nIf this is a new Worker, run wrangler deploy first.`,
]) {
  assert(isStagingWorkerMissing(missingWorkerFixture), `Worker-not-found fixture was rejected: ${missingWorkerFixture}`);
}
for (const unrelatedFailure of [
  '[code: 10092]',
  'Authentication failed',
  'Worker "some-other-worker" not found.',
  'Network timeout while reading secrets',
]) {
  assert(!isStagingWorkerMissing(unrelatedFailure), `Unrelated failure was accepted: ${unrelatedFailure}`);
}
for (const secret of STAGING_SECRET_NAMES) {
  assert(parsedSecrets.has(secret), `Staging preflight is missing ${secret}.`);
}

const hostedProofSource = readFileSync(hostedProofScript, 'utf8');
const hostedProofSyntax = spawnSync(process.execPath, ['--check', hostedProofScript], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
});
assert(
  hostedProofSyntax.status === 0,
  `Hosted proof runner has invalid syntax:\n${hostedProofSyntax.stdout}\n${hostedProofSyntax.stderr}`,
);
for (const contract of [
  'LLMKIT_HOSTED_PROOF_APPROVED',
  "git('status', '--porcelain')",
  'llmkit-proxy-staging',
  'STAGING_SUPABASE_PROJECT_REF',
  'LLMKIT_PRODUCTION_SUPABASE_PROJECT_REF',
  "method: 'DELETE'",
  'llmkit-hosted-staging-budget-proof.json',
  'llmkit-hosted-staging-recovery.json',
  "rawArgs.includes('--recover')",
  '/ratelimit/',
  'x-llmkit-workflow-id',
  'response_sha256',
  '/crash-timeout',
  'HOSTED_COORDINATION_THRESHOLDS_MS',
]) {
  assert(hostedProofSource.includes(contract), `Hosted proof guard is missing ${contract}.`);
}

const generic = run([]);
assert(generic.status !== 0, 'Generic deploy unexpectedly succeeded.');
assert(
  `${generic.stdout}${generic.stderr}`.includes('Explicit --target'),
  'Generic deploy failed for the wrong reason.',
);

const unapproved = run(['--target', 'staging']);
assert(unapproved.status !== 0, 'Unapproved staging deploy unexpectedly succeeded.');
assert(
  `${unapproved.stdout}${unapproved.stderr}`.includes('--account-id'),
  'Unapproved staging deploy failed for the wrong reason.',
);

const oneSidedApproval = run([
  '--target',
  'production',
  '--confirm',
  'production:api.llmkit.sh',
], { ...process.env, LLMKIT_DEPLOY_APPROVED: '' });
assert(oneSidedApproval.status !== 0, 'One-sided production approval unexpectedly succeeded.');
assert(
  `${oneSidedApproval.stdout}${oneSidedApproval.stderr}`.includes('requires both --confirm'),
  'One-sided production approval failed for the wrong reason.',
);

const productionAccountPin = run([
  '--target',
  'production',
  '--account-id',
  '0123456789abcdef0123456789abcdef',
  '--dry-run',
]);
assert(productionAccountPin.status !== 0, 'Production unexpectedly accepted a staging account pin.');
assert(
  `${productionAccountPin.stdout}${productionAccountPin.stderr}`.includes('--account-id is supported only'),
  'Production account-pin rejection failed for the wrong reason.',
);

const productionDatabasePin = run([
  '--target',
  'production',
  '--database-project-ref',
  stagingRef,
  '--dry-run',
]);
assert(productionDatabasePin.status !== 0, 'Production unexpectedly accepted a staging database ref.');
assert(
  `${productionDatabasePin.stdout}${productionDatabasePin.stderr}`.includes('supported only for the isolated staging deploy'),
  'Production database-ref rejection failed for the wrong reason.',
);

const dryRunBootstrap = run(['--target', 'staging', '--dry-run', '--bootstrap']);
assert(dryRunBootstrap.status !== 0, 'Dry-run staging unexpectedly accepted bootstrap mode.');
assert(
  `${dryRunBootstrap.stdout}${dryRunBootstrap.stderr}`.includes('--bootstrap is supported only'),
  'Dry-run bootstrap rejection failed for the wrong reason.',
);

const dryRun = run(['--target', 'staging', '--dry-run']);
assert(dryRun.status === 0, `Staging dry-run failed:\n${dryRun.stdout}\n${dryRun.stderr}`);
assert(
  dryRun.stdout.includes('target=staging mode=dry-run worker=llmkit-proxy-staging'),
  'Staging dry-run did not identify the isolated Worker target.',
);
assert(!dryRun.stdout.includes('api.llmkit.sh'), 'Staging dry-run output referenced the production route.');

console.log('WORKER_DEPLOY_GUARD PASS (5 violations + isolated staging dry-run)');
