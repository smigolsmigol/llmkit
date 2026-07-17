import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const proxyRoot = resolve(repoRoot, 'packages', 'proxy');
const wranglerBin = resolve(proxyRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerConfig = resolve(proxyRoot, 'wrangler.toml');
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
const dryRun = rawArgs.includes('--dry-run');
const knownArguments = new Set(['--target', '--confirm', '--dry-run']);
for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (!knownArguments.has(argument)) fail(`Unknown deploy argument: ${argument}`);
  if (argument !== '--dry-run') index += 1;
}

const targets = {
  staging: {
    approval: 'staging:llmkit-proxy-staging',
    wrangler: ['deploy', '--config', wranglerConfig, '--env', 'staging'],
  },
  production: {
    approval: 'production:api.llmkit.sh',
    wrangler: ['deploy', '--config', wranglerConfig, '--env='],
  },
};

if (!target || !(target in targets)) {
  fail('Explicit --target staging or --target production is required. Generic deploy is disabled.');
}
if (!existsSync(wranglerBin)) {
  fail('Wrangler is not installed. Run the frozen workspace install first.');
}

const selected = targets[target];

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

if (!dryRun) {
  if (confirmation !== selected.approval
      || process.env.LLMKIT_DEPLOY_APPROVED !== selected.approval) {
    fail(
      `Live ${target} deploy requires both --confirm ${selected.approval} `
      + `and LLMKIT_DEPLOY_APPROVED=${selected.approval}.`,
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
  selected.wrangler.push('--yes');
}

if (dryRun) selected.wrangler.push('--dry-run');

console.log(
  `WORKER_DEPLOY_PLAN target=${target} mode=${dryRun ? 'dry-run' : 'live'} `
  + `worker=${target === 'staging' ? 'llmkit-proxy-staging' : 'llmkit-proxy'}`,
);

const result = spawnSync(process.execPath, [wranglerBin, ...selected.wrangler], {
  cwd: proxyRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
