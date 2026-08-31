import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertRegistryMatches } from '../scripts/check-mcp-registry-version.mjs';
import {
  assertPricingComparison,
  assertPricingError,
} from '../scripts/check-public-pricing-contract.mjs';

const workflow = readFileSync('.github/workflows/health-check.yml', 'utf8');
const pricingCatalog = JSON.parse(readFileSync('packages/shared/pricing.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRetryBodyCapture(contents) {
  const helperStart = contents.indexOf('request_with_retries()');
  const helperEnd = contents.indexOf('\n          }', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'HTTP retries need one bounded body-capture helper');
  const helper = contents.slice(helperStart, helperEnd);
  assert(
    helper.includes('for (( attempt = 1; attempt <= 3; attempt++ )); do'),
    'HTTP body retries must remain bounded',
  );
  assert(helper.includes(': > "$RESPONSE_BODY"'), 'each HTTP attempt must clear the prior body');
  assert(helper.includes('-o "$RESPONSE_BODY"'), 'HTTP bodies must be captured outside command substitution');
  assert(!contents.includes('response=$(curl'), 'retrying curl output must not concatenate response bodies');

  for (const name of [
    'check_http_contains',
    'check_mcp_registry_version',
    'check_pypi',
    'check_pricing_contract',
  ]) {
    const start = contents.indexOf(`${name}()`);
    const end = contents.indexOf('\n          }', start);
    const block = contents.slice(start, end);
    assert(start >= 0 && end > start, `${name} must remain defined`);
    assert(block.includes('status=$(request_with_retries'), `${name} must use isolated retry capture`);
    assert(block.includes('body=$(<"$RESPONSE_BODY")'), `${name} must parse only the final response body`);
  }
}

const runtimeTruthCalls = [
  {
    label: 'pricing comparison',
    pattern: /check_pricing_contract "Proxy pricing comparison"[\s\S]+"200" comparison "anthropic\/claude-sonnet-4-6,openai\/gpt-4o" 1000 500 0 0/,
    violation: '"200" comparison "anthropic/claude-sonnet-4-6,openai/gpt-4o" 1000 500 0 0',
  },
  {
    label: 'pricing rejection',
    pattern: /check_pricing_contract "Proxy pricing rejection"[\s\S]+"400" error "INVALID_PRICING_QUERY" "mode"/,
    violation: '"400" error "INVALID_PRICING_QUERY" "mode"',
  },
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
assert(workflow.includes('timeout-minutes: 20'), 'the health job needs enough bounded time to report retries');
assertRetryBodyCapture(workflow);
for (const mutation of [
  workflow.replace(': > "$RESPONSE_BODY"', ''),
  workflow.replace('-o "$RESPONSE_BODY"', ''),
]) {
  let rejected = false;
  try {
    assertRetryBodyCapture(mutation);
  } catch {
    rejected = true;
  }
  assert(rejected, 'health workflow accepted a retry path that can concatenate bodies');
}
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
  workflow.includes('node scripts/check-public-pricing-contract.mjs "$@"'),
  'proxy runtime health must validate the pricing response semantics',
);
for (const fragment of [
  'npm $' + '{pkg}: registry $' + '{ver} != repo $' + '{expected}',
  'PyPI $' + '{pkg}: registry $' + '{actual} != repo $' + '{expected}',
  'check_npm "@f3d1/llmkit-ai-sdk-provider" "packages/ai-sdk-provider/package.json"',
  'check_pypi "llmkit-sdk" "packages/python-sdk/pyproject.toml"',
]) {
  assert(workflow.includes(fragment), `published version parity is missing: ${fragment}`);
}
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

const expectedPricingModels = ['anthropic/claude-sonnet-4-6', 'openai/gpt-4o'];
const expectedPricingUsage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
function pricingModelFixture(key) {
  const separator = key.indexOf('/');
  const provider = key.slice(0, separator);
  const model = key.slice(separator + 1);
  const pricing = pricingCatalog.providers[provider][model];
  const rawInput = (expectedPricingUsage.input / 1_000_000) * pricing.input;
  const rawOutput = (expectedPricingUsage.output / 1_000_000) * pricing.output;
  const rawCacheRead = (expectedPricingUsage.cacheRead / 1_000_000) * (pricing.cacheRead ?? 0);
  const rawCacheWrite = (expectedPricingUsage.cacheWrite / 1_000_000) * (pricing.cacheWrite ?? 0);
  return {
    key,
    provider,
    model,
    rates: {
      inputPerMillion: pricing.input,
      outputPerMillion: pricing.output,
      cacheReadPerMillion: pricing.cacheRead ?? null,
      cacheWritePerMillion: pricing.cacheWrite ?? null,
    },
    costs: {
      input: +rawInput.toFixed(8),
      output: +rawOutput.toFixed(8),
      cacheRead: +rawCacheRead.toFixed(8),
      cacheWrite: +rawCacheWrite.toFixed(8),
      total: +(rawInput + rawOutput + rawCacheRead + rawCacheWrite).toFixed(8),
      currency: 'USD',
    },
  };
}

function pricingMutation(mutator) {
  const fixture = structuredClone(pricingFixture);
  mutator(fixture);
  return fixture;
}

const pricingFixture = {
  schemaVersion: 2,
  snapshot: {
    date: pricingCatalog.updatedAt,
    liveQuote: false,
    sourceModalityEncoded: false,
    rateUnit: 'USD_PER_MILLION_TOKENS',
  },
  selection: {
    mode: 'text-token',
    basis: 'explicit-model-keys',
    recommendation: false,
  },
  usage: expectedPricingUsage,
  count: 2,
  models: expectedPricingModels.map(pricingModelFixture),
};

assertPricingComparison(pricingFixture, expectedPricingModels, expectedPricingUsage);
for (const [label, fixture] of [
  ['stale bulk response', { ...pricingFixture, count: 731 }],
  ['unexpected model', {
    ...pricingFixture,
    models: [pricingFixture.models[0], { ...pricingFixture.models[1], key: 'openai/unrequested' }],
  }],
  ['recommendation drift', {
    ...pricingFixture,
    selection: { ...pricingFixture.selection, recommendation: true },
  }],
  ['usage drift', { ...pricingFixture, usage: { ...expectedPricingUsage, input: 999 } }],
  ['snapshot date drift', pricingMutation((fixture) => { fixture.snapshot.date = '2000-01-01'; })],
  ['rate drift', pricingMutation((fixture) => { fixture.models[0].rates.inputPerMillion += 1; })],
  ['component cost drift', pricingMutation((fixture) => { fixture.models[0].costs.input += 1; })],
  ['total cost drift', pricingMutation((fixture) => { fixture.models[0].costs.total += 1; })],
]) {
  let rejected = false;
  try {
    assertPricingComparison(fixture, expectedPricingModels, expectedPricingUsage);
  } catch {
    rejected = true;
  }
  assert(rejected, `pricing comparison contract accepted ${label}`);
}

const comparisonCli = spawnSync(
  process.execPath,
  [
    'scripts/check-public-pricing-contract.mjs',
    'comparison',
    expectedPricingModels.join(','),
    '1000',
    '500',
    '0',
    '0',
  ],
  { input: JSON.stringify(pricingFixture), encoding: 'utf8' },
);
assert(comparisonCli.status === 0, `pricing comparison CLI failed: ${comparisonCli.stderr}`);
const staleComparisonCli = spawnSync(
  process.execPath,
  [
    'scripts/check-public-pricing-contract.mjs',
    'comparison',
    expectedPricingModels.join(','),
    '1000',
    '500',
    '0',
    '0',
  ],
  { input: JSON.stringify({ ...pricingFixture, count: 731 }), encoding: 'utf8' },
);
assert(staleComparisonCli.status !== 0, 'pricing comparison CLI accepted a stale bulk response');

assertPricingError(
  { error: { code: 'INVALID_PRICING_QUERY', field: 'mode' } },
  'INVALID_PRICING_QUERY',
  'mode',
);
for (const fixture of [
  { error: { code: 'UNKNOWN_PRICING_MODEL', field: 'mode' } },
  { error: { code: 'INVALID_PRICING_QUERY', field: 'input' } },
  { count: 731, models: [] },
]) {
  let rejected = false;
  try {
    assertPricingError(fixture, 'INVALID_PRICING_QUERY', 'mode');
  } catch {
    rejected = true;
  }
  assert(rejected, 'pricing rejection contract accepted an invalid response');
}

const rejectionCli = spawnSync(
  process.execPath,
  ['scripts/check-public-pricing-contract.mjs', 'error', 'INVALID_PRICING_QUERY', 'mode'],
  {
    input: JSON.stringify({ error: { code: 'INVALID_PRICING_QUERY', field: 'mode' } }),
    encoding: 'utf8',
  },
);
assert(rejectionCli.status === 0, `pricing rejection CLI failed: ${rejectionCli.stderr}`);
for (const args of [
  ['scripts/check-public-pricing-contract.mjs', 'error'],
  ['scripts/check-public-pricing-contract.mjs', 'error', 'INVALID_PRICING_QUERY'],
]) {
  const missingExpectationCli = spawnSync(process.execPath, args, {
    input: JSON.stringify({ error: {} }),
    encoding: 'utf8',
  });
  assert(
    missingExpectationCli.status !== 0,
    'pricing rejection CLI accepted a missing expected code or field',
  );
}

console.log('health-check workflow contract passed');
