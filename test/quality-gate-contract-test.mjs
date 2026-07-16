import { spawnSync } from 'node:child_process';

const scripts = [
  'scripts/run-ts-quality.mjs',
  'scripts/run-quality-gate.mjs',
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

console.log('QUALITY_GATE_CONTRACT PASS');
