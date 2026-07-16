import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const deployScript = resolve(repoRoot, 'scripts', 'run-worker-deploy.mjs');
const wranglerConfig = readFileSync(
  resolve(repoRoot, 'packages', 'proxy', 'wrangler.toml'),
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

const stagingMatch = wranglerConfig.match(
  /\[env\.staging\]([\s\S]*?)(?=\n\[\[env\.staging\.durable_objects\.bindings\]\])/,
);
const stagingSection = stagingMatch?.[1] ?? '';
assert(/workers_dev\s*=\s*true/.test(stagingSection), 'Staging does not explicitly use workers.dev.');
assert(/routes\s*=\s*\[\s*\]/.test(stagingSection), 'Staging does not explicitly clear production routes.');
assert(
  (wranglerConfig.match(/\[\[env\.staging\.durable_objects\.bindings\]\]/g) ?? []).length === 2,
  'Staging does not define both isolated Durable Object bindings.',
);

const generic = run([]);
assert(generic.status !== 0, 'Generic deploy unexpectedly succeeded.');
assert(
  `${generic.stdout}${generic.stderr}`.includes('Explicit --target'),
  'Generic deploy failed for the wrong reason.',
);

const unapproved = run(['--target', 'staging']);
assert(unapproved.status !== 0, 'Unapproved staging deploy unexpectedly succeeded.');
assert(
  `${unapproved.stdout}${unapproved.stderr}`.includes('requires both --confirm'),
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

const dryRun = run(['--target', 'staging', '--dry-run']);
assert(dryRun.status === 0, `Staging dry-run failed:\n${dryRun.stdout}\n${dryRun.stderr}`);
assert(
  dryRun.stdout.includes('target=staging mode=dry-run worker=llmkit-proxy-staging'),
  'Staging dry-run did not identify the isolated Worker target.',
);
assert(!dryRun.stdout.includes('api.llmkit.sh'), 'Staging dry-run output referenced the production route.');

console.log('WORKER_DEPLOY_GUARD PASS (3 violations + isolated staging dry-run)');
