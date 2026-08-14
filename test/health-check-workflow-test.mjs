import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/health-check.yml', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtimeTruthCalls = [
  {
    label: 'homepage',
    pattern: /check_http_contains "Homepage recovery disclosure"\s+\\\s+"https:\/\/llmkit\.sh\/" "Hosted accounts are temporarily unavailable"/,
    violation: '"Hosted accounts are temporarily unavailable"',
  },
  {
    label: 'docs',
    pattern: /check_http_contains "Docs recovery disclosure"\s+\\\s+"https:\/\/llmkit\.sh\/docs"\s+\\\s+"Hosted account creation and API-key management are temporarily unavailable"/,
    violation: '"Hosted account creation and API-key management are temporarily unavailable"',
  },
  {
    label: 'dashboard recovery',
    pattern: /check_http_contains "Dashboard recovery"\s+\\\s+"https:\/\/llmkit\.sh\/service-restoring" "Controlled restoration"/,
    violation: '"Controlled restoration"',
  },
];

function assertRuntimeTruthContract(contents) {
  const gate = contents.indexOf('if [ "$CHECK_RUNTIME" = "true" ]; then');
  const gateEnd = contents.indexOf('\n          else', gate);
  assert(gate >= 0, 'runtime checks need a manual-only gate');
  assert(gateEnd > gate, 'runtime checks need a bounded manual-only block');
  const runtimeBlock = contents.slice(gate, gateEnd);
  for (const call of runtimeTruthCalls) {
    assert(
      call.pattern.test(runtimeBlock),
      `manual runtime truth contract is missing or misbound: ${call.label}`,
    );
  }
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
const recoveryCheck = workflow.indexOf('check_http_contains "Dashboard recovery"');
const publicCheck = workflow.indexOf('check_npm "@f3d1/llmkit-sdk"');

assert(runtimeGate >= 0, 'runtime checks need a manual-only gate');
assert(publicCheck >= 0 && publicCheck < runtimeGate, 'published artifacts must remain scheduled');
assert(proxyCheck > runtimeGate, 'proxy health must be inside the runtime gate');
assert(
  workflow.includes('check_http "Proxy" "https://api.llmkit.sh/health"'),
  'health workflow proxy probe must target api.llmkit.sh',
);
assert(recoveryCheck > runtimeGate, 'dashboard recovery health must be inside the runtime gate');
assertRuntimeTruthContract(workflow);
for (const call of runtimeTruthCalls) {
  let violationBlocked = false;
  try {
    assertRuntimeTruthContract(workflow.replace(call.violation, ''));
  } catch {
    violationBlocked = true;
  }
  assert(violationBlocked, `runtime truth violation was accepted: ${call.label}`);
}
assert(
  workflow.includes('check_http_contains()') && workflow.includes('grep -Fq "$expected"'),
  'dashboard recovery must verify both a successful response and its recovery marker',
);
assert(
  !workflow.includes('llmkit-dashboard.vercel.app'),
  'the disabled legacy dashboard must not be used as a health surface',
);

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
