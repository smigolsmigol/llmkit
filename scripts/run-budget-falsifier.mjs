import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const marker = 'LLMKIT_GATE0_RECEIPT=';
const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, '..', '..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || packageRoot,
    encoding: options.encoding || 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    env: options.env || process.env,
  });
}

function requiredRaw(command, args, options) {
  const result = run(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function required(command, args, options) {
  return requiredRaw(command, args, options).trim();
}

async function dirtyMaterialHash() {
  const raw = requiredRaw(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: repoRoot },
  );
  const hash = createHash('sha256').update(raw);
  for (const entry of raw.split('\0').filter(Boolean).sort()) {
    const relative = entry.slice(3).replace(/^.* -> /, '');
    const full = resolve(repoRoot, relative);
    try {
      if ((await stat(full)).isFile()) hash.update(relative).update(await readFile(full));
    } catch {
      hash.update(relative).update('<missing>');
    }
  }
  return hash.digest('hex');
}

const corepackEntry = process.platform === 'win32'
  ? resolve(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  : undefined;
const command = corepackEntry ? process.execPath : 'corepack';
const baseArgs = [
  ...(corepackEntry ? [corepackEntry] : []),
  'pnpm@9.15.4', 'exec', 'vitest', 'run',
  '--config', 'vitest.budget-falsifier.config.ts',
  '--reporter=verbose',
];
const shards = [
  ...Array.from({ length: 5 }, (_, index) => ({
    label: `hard-${index}`,
    pattern: index === 0 ? 'exact-fit control|hard-boundary requests' : 'hard-boundary requests',
    start: index * 4,
    count: 4,
  })),
  ...Array.from({ length: 5 }, (_, index) => ({
    label: `soft-${index}`,
    pattern: 'post-response reference',
    start: index * 4,
    count: 4,
  })),
  {
    label: 'local-latency',
    pattern: 'local budget and replay coordination',
    start: 0,
    count: 1,
  },
  {
    label: 'integration-boundaries',
    pattern: 'BudgetDO production ledger behavior|IdempotencyDO production retry behavior|Supabase secret keys|full supported request body|hard-budget request|client request idempotency|idempotent Responses|streaming idempotency|failed idempotent|pre-dispatch rejection|non-inference control|Responses API money|fallback|provider-reported cost|provider-managed tools|provider timeout|crash cleanup|actual-cost settlement fails',
    start: 0,
    count: 1,
  },
  {
    label: 'edge-cases',
    pattern: 'captured-provider unknown outcome|refunds an under-bound settlement|detects a provider',
    start: 0,
    count: 1,
  },
];

let receipt;
let exitCode = 0;
const shardEvidence = [];
for (const shard of shards) {
  const result = run(command, [
    ...baseArgs,
    '--testNamePattern', shard.pattern,
  ], {
    env: {
      ...process.env,
      GATE0_REPEAT_START: String(shard.start),
      GATE0_REPEAT_COUNT: String(shard.count),
    },
  });
  if (result.error) {
    process.stderr.write(`BUDGET_FALSIFIER ${shard.label} LAUNCH ERROR: ${result.error.message}\n`);
  }
  const lines = (result.stdout || '').split(/\r?\n/);
  const receiptLine = lines.findLast((line) => line.includes(marker));
  process.stdout.write(`${lines.filter((line) => !line.includes(marker)).join('\n')}\n`);
  process.stderr.write(result.stderr || '');
  const status = result.status ?? 1;
  exitCode = Math.max(exitCode, status);
  if (!receiptLine) {
    process.stderr.write(`BUDGET_FALSIFIER ERROR: ${shard.label} emitted no machine receipt.\n`);
    exitCode = 1;
    shardEvidence.push({ ...shard, exitCode: status, receipt: false });
    continue;
  }
  const shardReceipt = JSON.parse(receiptLine.slice(receiptLine.indexOf(marker) + marker.length));
  if (!receipt) receipt = { ...shardReceipt, runs: [], integrationChecks: [], computedVerdict: undefined };
  receipt.runs.push(...shardReceipt.runs);
  receipt.integrationChecks.push(...(shardReceipt.integrationChecks || []));
  shardEvidence.push({
    ...shard,
    exitCode: status,
    receipt: true,
    runCount: shardReceipt.runs.length,
    integrationCheckCount: shardReceipt.integrationChecks?.length || 0,
  });
}

if (!receipt) process.exit(exitCode || 1);

const hardBursts = receipt.runs.filter((run) => run.scenario === 'hard-burst');
const softBursts = receipt.runs.filter((run) => run.scenario === 'soft-burst');
const exact = receipt.runs.find((run) => run.scenario === 'exact-fit');
const replay = receipt.runs.find((run) => run.scenario === 'duplicate-settlement-replay');
const controlPlane = receipt.integrationChecks.find((check) => check.scenario === 'control-plane-budget-isolation');
const responsesApi = receipt.integrationChecks.find((check) => check.scenario === 'responses-api-money-path');
const fallbackPricing = receipt.integrationChecks.find((check) => check.scenario === 'fallback-chain-pricing');
const fallbackCredentials = receipt.integrationChecks.find((check) => check.scenario === 'fallback-provider-credential-isolation');
const streamingFallbackCredentials = receipt.integrationChecks.find((check) => check.scenario === 'streaming-fallback-provider-credential-isolation');
const providerReportedCost = receipt.integrationChecks.find((check) => check.scenario === 'provider-reported-cost-settlement');
const managedTools = receipt.integrationChecks.find((check) => check.scenario === 'provider-managed-tool-fail-closed');
const hardBudgetShapes = receipt.integrationChecks.find((check) => check.scenario === 'hard-budget-shape-fail-closed');
const supabaseHeaders = receipt.integrationChecks.find((check) => check.scenario === 'supabase-service-key-header-contract');
const providerTimeout = receipt.integrationChecks.find((check) => check.scenario === 'provider-timeout-boundary');
const crashCleanup = receipt.integrationChecks.find((check) => check.scenario === 'crash-cleanup-deadline');
const clientIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'client-request-idempotency');
const responsesIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'responses-request-idempotency');
const streamingIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'streaming-idempotency-fail-closed');
const unknownIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'idempotency-unknown-outcome');
const predispatchIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'idempotency-predispatch-release');
const settlementFailure = receipt.integrationChecks.find((check) => check.scenario === 'settlement-failure-conservative-commit');
const failureAttribution = receipt.integrationChecks.find((check) => check.scenario === 'post-dispatch-failure-attribution');
const durableReceiptOutbox = receipt.integrationChecks.find((check) => check.scenario === 'durable-request-receipt-outbox');
const localCoordinationLatency = receipt.integrationChecks.find((check) => check.scenario === 'local-coordination-latency');
const countStatus = (run, status) => run.decisions.filter((decision) => decision.status === status).length;
receipt.computedVerdict = {
  exactFit: exact?.providerCrossings.length === 10 && countStatus(exact, 200) === 10,
  hardBurst: hardBursts.length === 20 && hardBursts.every((run) => (
    run.providerCrossings.length === 10
      && countStatus(run, 200) === 10
      && countStatus(run, 402) === 90
      && run.invariantBeforeProviderCompletion
      && run.invariantAtFinalLedger
      && run.ledgerMatchesCapturedCost
  )),
  softReference: softBursts.length === 20 && softBursts.every((run) => (
    run.providerCrossings.length > 10
      && run.invariantBeforeProviderCompletion
      && !run.invariantAtFinalLedger
      && run.ledgerMatchesCapturedCost
  )),
  duplicateSettlement: replay && 'root' in replay.finalLedger
    ? replay.finalLedger.root?.usedCents === 5
    : false,
  controlPlaneIsolation: controlPlane?.passed === true,
  responsesApiBoundary: responsesApi?.passed === true,
  fallbackPricingBoundary: fallbackPricing?.passed === true,
  fallbackCredentialIsolation: fallbackCredentials?.passed === true,
  streamingFallbackCredentialIsolation: streamingFallbackCredentials?.passed === true,
  providerReportedCostSettlement: providerReportedCost?.passed === true,
  providerManagedToolsFailClosed: managedTools?.passed === true,
  hardBudgetShapesFailClosed: hardBudgetShapes?.passed === true,
  supabaseServiceKeyHeaders: supabaseHeaders?.passed === true,
  providerTimeoutBoundary: providerTimeout?.passed === true,
  crashCleanupDeadline: crashCleanup?.passed === true,
  clientRequestIdempotency: clientIdempotency?.passed === true,
  responsesRequestIdempotency: responsesIdempotency?.passed === true,
  streamingIdempotencyFailClosed: streamingIdempotency?.passed === true,
  idempotencyUnknownOutcome: unknownIdempotency?.passed === true,
  idempotencyPredispatchRelease: predispatchIdempotency?.passed === true,
  settlementFailureConservativeCommit: settlementFailure?.passed === true,
  postDispatchFailureAttribution: failureAttribution?.passed === true,
  durableRequestReceiptOutbox: durableReceiptOutbox?.passed === true,
  localCoordinationLatency: localCoordinationLatency?.passed === true,
};
receipt.shards = shardEvidence;
if (!Object.values(receipt.computedVerdict).every(Boolean)) exitCode = 1;
const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
receipt.generatedAtUtc = new Date().toISOString();
receipt.sourceCommit = required('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
receipt.dirtyMaterialSha256 = await dirtyMaterialHash();
receipt.runtime = {
  node: process.version,
  vitest: packageJson.devDependencies.vitest,
  workersPool: packageJson.devDependencies['@cloudflare/vitest-pool-workers'],
  workersTypes: packageJson.devDependencies['@cloudflare/workers-types'],
  wrangler: packageJson.devDependencies.wrangler,
};
receipt.testExitCode = exitCode;

const output = resolve(repoRoot, 'audits', 'llmkit-gate0-budget-falsifier.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
const receiptSha256 = createHash('sha256').update(await readFile(output)).digest('hex');
process.stdout.write(`\nBUDGET_FALSIFIER_RECEIPT ${output}\nBUDGET_FALSIFIER_SHA256 ${receiptSha256}\n`);
process.exit(exitCode);
