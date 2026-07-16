import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scripts = [
  'scripts/run-ts-quality.mjs',
  'scripts/run-quality-gate.mjs',
  'scripts/assert-scorecard-supply-chain.mjs',
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
  'needs: [quality, python-floor, scorecard-supply-chain, osv]',
];

function assertWorkflowContract(workflow) {
  for (const fragment of requiredWorkflowFragments) {
    if (!workflow.includes(fragment)) {
      throw new Error(`CI supply-chain contract is missing: ${fragment}`);
    }
  }
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
assertWorkflowContract(workflow);

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

console.log('QUALITY_GATE_CONTRACT PASS');
