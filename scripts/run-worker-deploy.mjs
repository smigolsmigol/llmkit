import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  isStagingWorkerMissing,
  parseStagingSecrets,
  STAGING_SECRET_NAMES,
  STAGING_WORKER_NAME,
  stagingDeployApproval,
  validateStagingDatabaseBinding,
} from './staging-deploy-contract.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const proxyRoot = resolve(repoRoot, 'packages', 'proxy');
const wranglerBin = resolve(proxyRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerConfig = resolve(proxyRoot, 'wrangler.toml');
const stagingWranglerConfig = resolve(proxyRoot, 'wrangler.staging.toml');
const rawArgs = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}

function option(name) {
  const index = rawArgs.indexOf(name);
  if (index === -1) return undefined;
  const value = rawArgs[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

const target = option('--target');
const confirmation = option('--confirm');
const rawSecretsFile = option('--secrets-file');
const accountId = option('--account-id');
const stagingProjectRef = option('--database-project-ref');
const productionProjectRef = option('--production-database-project-ref');
const dryRun = rawArgs.includes('--dry-run');
const bootstrap = rawArgs.includes('--bootstrap');
const knownArguments = new Set([
  '--target', '--confirm', '--secrets-file', '--account-id', '--database-project-ref',
  '--production-database-project-ref', '--dry-run', '--bootstrap',
]);
const flagArguments = new Set(['--dry-run', '--bootstrap']);
for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (!knownArguments.has(argument)) fail(`Unknown deploy argument: ${argument}`);
  if (!flagArguments.has(argument)) index += 1;
}

const targets = {
  staging: {
    config: stagingWranglerConfig,
    wrangler: ['deploy', '--config', stagingWranglerConfig],
  },
  production: {
    approval: 'production:api.llmkit.sh',
    config: wranglerConfig,
    wrangler: ['deploy', '--config', wranglerConfig],
  },
};

if (!target || !(target in targets)) {
  fail('Explicit --target staging or --target production is required. Generic deploy is disabled.');
}
if (!existsSync(wranglerBin)) {
  fail('Wrangler is not installed. Run the frozen workspace install first.');
}

const selected = targets[target];
if (rawSecretsFile && target !== 'staging') fail('--secrets-file is supported only for the isolated staging deploy.');
if (rawSecretsFile && dryRun) fail('--secrets-file is accepted only for an explicitly approved live staging deploy.');
if (accountId && target !== 'staging') fail('--account-id is supported only for the isolated staging deploy.');
if ((stagingProjectRef || productionProjectRef) && target !== 'staging') {
  fail('Database project refs are supported only for the isolated staging deploy.');
}
if (bootstrap && (target !== 'staging' || dryRun)) {
  fail('--bootstrap is supported only for an explicitly approved live staging deploy.');
}
if (bootstrap && !rawSecretsFile) fail('--bootstrap requires --secrets-file.');

function stagingSecretFile() {
  if (!rawSecretsFile) return undefined;
  const path = resolve(rawSecretsFile);
  if (!existsSync(path)) fail(`Staging secrets file does not exist: ${path}`);
  const fromRepo = relative(repoRoot, path);
  if (fromRepo === '' || (!fromRepo.startsWith('..') && !isAbsolute(fromRepo))) {
    fail('Staging secrets file must be outside the repository.');
  }
  const source = readFileSync(path, 'utf8');
  let secrets;
  try {
    secrets = parseStagingSecrets(source);
  } catch (error) {
    fail(`Staging secrets file is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path, secrets, names: new Set(secrets.keys()) };
}

function git(...args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

if (target === 'staging') {
  selected.wrangler.push('--var', `STAGING_SOURCE_COMMIT:${git('rev-parse', 'HEAD')}`);
}

let wranglerEnv = process.env;
let secretFile;
let requiredApproval = selected.approval;

if (!dryRun && target === 'staging') {
  if (!accountId || !/^[0-9a-f]{32}$/i.test(accountId)) {
    fail('Live staging deploy requires an exact 32-character --account-id.');
  }
  if (!rawSecretsFile) fail('Every live staging deploy requires --secrets-file so database isolation can be verified.');
  secretFile = stagingSecretFile();
  try {
    validateStagingDatabaseBinding(secretFile.secrets, stagingProjectRef, productionProjectRef);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  requiredApproval = stagingDeployApproval(accountId, stagingProjectRef);
}

if (!dryRun) {
  if (confirmation !== requiredApproval
      || process.env.LLMKIT_DEPLOY_APPROVED !== requiredApproval) {
    fail(
      `Live ${target} deploy requires both --confirm ${requiredApproval} `
      + `and LLMKIT_DEPLOY_APPROVED=${requiredApproval}.`,
    );
  }

  const dirty = git('status', '--porcelain');
  if (dirty) fail('Live deploy requires a clean worktree.');

  if (target === 'production') {
    const branch = git('branch', '--show-current');
    if (branch !== 'main') fail(`Production deploy requires branch main; current branch is ${branch || 'detached'}.`);
    const head = git('rev-parse', 'HEAD');
    const remoteMain = git('rev-parse', 'origin/main');
    if (head !== remoteMain) fail('Production deploy requires HEAD to equal origin/main.');
    selected.wrangler.push('--message', `llmkit ${head}`);
  }
  if (target === 'staging') {
    wranglerEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
    const identity = spawnSync(process.execPath, [
      wranglerBin,
      'whoami',
      '--account',
      accountId,
      '--json',
    ], {
      cwd: proxyRoot,
      env: wranglerEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (identity.error) throw identity.error;
    if (identity.status !== 0) {
      fail(`Cloudflare account verification failed: ${(identity.stderr || identity.stdout).trim()}`);
    }

    const secretList = spawnSync(process.execPath, [
      wranglerBin,
      'secret',
      'list',
      '--config',
      selected.config,
      '--format',
      'json',
    ], {
      cwd: proxyRoot,
      env: wranglerEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (secretList.error) throw secretList.error;
    const secretListOutput = `${secretList.stdout}\n${secretList.stderr}`;
    const workerMissing = isStagingWorkerMissing(secretListOutput);
    if (secretList.status !== 0 && (!bootstrap || !workerMissing)) {
      fail(`Existing secret names could not be read: ${secretListOutput.trim()}`);
    }
    if (secretList.status === 0 && bootstrap) {
      fail('Staging Worker already exists; remove --bootstrap and verify its configured secrets.');
    }
    let configured = new Set();
    if (secretList.status === 0) {
      try {
        const parsed = JSON.parse(secretList.stdout);
        if (!Array.isArray(parsed)) fail('Staging secret readback was not a JSON array.');
        configured = new Set(parsed.map((entry) => entry.name));
      } catch (error) {
        fail(`Staging secret readback was invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const requiredSecrets = STAGING_SECRET_NAMES;
    const available = new Set([...configured, ...(secretFile?.names ?? [])]);
    const missing = requiredSecrets.filter((name) => !available.has(name));
    const unexpected = [...available].filter((name) => !requiredSecrets.includes(name));
    if (missing.length > 0) {
      fail(`Staging is missing required secrets: ${missing.join(', ')}.`);
    }
    if (unexpected.length > 0) {
      fail(`Staging contains unexpected secrets: ${unexpected.sort().join(', ')}.`);
    }
    if (secretFile) selected.wrangler.push('--secrets-file', secretFile.path);
  }
}

if (dryRun) selected.wrangler.push('--dry-run');

console.log(
  `WORKER_DEPLOY_PLAN target=${target} mode=${dryRun ? 'dry-run' : 'live'} `
  + `worker=${target === 'staging' ? STAGING_WORKER_NAME : 'llmkit-proxy'}`,
);

const result = spawnSync(process.execPath, [wranglerBin, ...selected.wrangler], {
  cwd: proxyRoot,
  env: wranglerEnv,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
