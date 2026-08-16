import { readFileSync } from 'node:fs';
import { assertRegistryMatches } from '../scripts/check-mcp-registry-version.mjs';

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

assert(
  workflow.includes('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'),
  'registry semantic checks need the pinned repository script',
);
assert(
  workflow.includes('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38'),
  'registry semantic checks need the pinned Node runtime',
);
assert(
  workflow.includes('node scripts/check-mcp-registry-version.mjs'),
  'MCP Registry health must validate semantic version equality',
);
assert(
  workflow.includes(
    'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.smigolsmigol%2Fllmkit/versions/latest',
  ),
  'MCP Registry health must use the stable exact-latest endpoint',
);
assert(
  !workflow.includes('/v0/servers/io.github.smigolsmigol%2Fllmkit/versions'),
  'the legacy status-only MCP Registry probe must stay retired',
);

const serverName = 'io.github.smigolsmigol/llmkit';
const packageName = '@f3d1/llmkit-mcp-server';
const packageVersion = JSON.parse(
  readFileSync('packages/mcp-server/package.json', 'utf8'),
).version;
const registryFixture = ({
  serverVersion = packageVersion,
  registryPackageVersion = packageVersion,
  registryType = 'npm',
  transportType = 'stdio',
  status = 'active',
  duplicate = false,
} = {}) => {
  const packageRecord = {
    identifier: packageName,
    registryType,
    version: registryPackageVersion,
    transport: { type: transportType },
  };
  return {
    server: {
      name: serverName,
      version: serverVersion,
      packages: duplicate ? [packageRecord, { ...packageRecord }] : [packageRecord],
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': { isLatest: true, status },
    },
  };
};

assertRegistryMatches(registryFixture(), packageVersion, serverName, packageName);
for (const [label, fixture] of [
  ['server version drift', registryFixture({ serverVersion: '0.0.0-stale' })],
  ['package version drift', registryFixture({ registryPackageVersion: '0.0.0-stale' })],
  ['inactive record', registryFixture({ status: 'deprecated' })],
  ['wrong registry type', registryFixture({ registryType: 'pypi' })],
  ['wrong transport', registryFixture({ transportType: 'streamable-http' })],
  ['duplicate package', registryFixture({ duplicate: true })],
  ['missing latest record', {}],
]) {
  let rejected = false;
  try {
    assertRegistryMatches(fixture, packageVersion, serverName, packageName);
  } catch {
    rejected = true;
  }
  assert(rejected, `registry contract accepted ${label}`);
}

console.log('health-check workflow contract passed');
