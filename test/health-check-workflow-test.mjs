import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/health-check.yml', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  workflow.includes("cron: '17 6 * * *'"),
  'published artifact checks must run once daily',
);
assert(!workflow.includes("cron: '0 * * * *'"), 'the hourly schedule must stay retired');
assert(
  workflow.includes('check_runtime:') && workflow.includes('type: boolean'),
  'manual runtime checks need an explicit boolean input',
);

const runtimeGate = workflow.indexOf('if [ "$CHECK_RUNTIME" = "true" ]; then');
const proxyCheck = workflow.indexOf('check_http "Proxy"');
const dashboardCheck = workflow.indexOf('check_http "Dashboard"');
const publicCheck = workflow.indexOf('check_npm "@f3d1/llmkit-sdk"');

assert(runtimeGate >= 0, 'runtime checks need a manual-only gate');
assert(publicCheck >= 0 && publicCheck < runtimeGate, 'published artifacts must remain scheduled');
assert(proxyCheck > runtimeGate, 'proxy health must be inside the runtime gate');
assert(dashboardCheck > runtimeGate, 'dashboard health must be inside the runtime gate');

assert(workflow.includes('concurrency:'), 'overlapping health runs must be collapsed');
assert(workflow.includes('timeout-minutes: 10'), 'the health job needs a bounded runtime');
assert(
  workflow.includes('if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then'),
  'Telegram delivery must require both configured secrets',
);
assert(
  workflow.includes('--retry 2 --retry-all-errors'),
  'scheduled HTTP checks need bounded transient retries',
);
assert(
  workflow.includes('|| true)'),
  'transport failures must be collected instead of aborting before the summary',
);

console.log('health-check workflow contract passed');
