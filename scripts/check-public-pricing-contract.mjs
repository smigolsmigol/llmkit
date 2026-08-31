import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertPricingBoundary(response) {
  if (response.schemaVersion !== 2) {
    throw new Error(`schema version ${response.schemaVersion ?? 'missing'} != 2`);
  }
  const snapshot = requireRecord(response.snapshot, 'pricing snapshot');
  if (snapshot.liveQuote !== false || snapshot.rateUnit !== 'USD_PER_MILLION_TOKENS') {
    throw new Error('pricing snapshot boundary is invalid');
  }
  const selection = requireRecord(response.selection, 'pricing selection');
  if (
    selection.mode !== 'text-token'
    || selection.basis !== 'explicit-model-keys'
    || selection.recommendation !== false
  ) {
    throw new Error('pricing selection boundary is invalid');
  }
}

function assertPricingUsage(response, expectedUsage) {
  const usage = requireRecord(response.usage, 'pricing usage');
  const expected = requireRecord(expectedUsage, 'expected pricing usage');
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (usage[field] !== expected[field]) {
      throw new Error(`pricing usage ${field} ${usage[field] ?? 'missing'} != ${expected[field]}`);
    }
  }
}

function assertPricingModels(response, expectedModels) {
  if (!Array.isArray(expectedModels) || expectedModels.length === 0) {
    throw new Error('at least one expected model is required');
  }
  if (new Set(expectedModels).size !== expectedModels.length) {
    throw new Error('expected models must be unique');
  }

  if (!Array.isArray(response.models) || response.count !== expectedModels.length) {
    throw new Error(`pricing response count ${response.count ?? 'missing'} != ${expectedModels.length}`);
  }
  if (response.models.length !== response.count) {
    throw new Error('pricing response count does not match its model array');
  }

  const actualModels = response.models.map((entry, index) => {
    const model = requireRecord(entry, `pricing model ${index}`);
    const costs = requireRecord(model.costs, `pricing model ${index} costs`);
    if (typeof costs.total !== 'number' || !Number.isFinite(costs.total) || costs.total < 0) {
      throw new Error(`pricing model ${index} has an invalid total cost`);
    }
    return model.key;
  });
  const actual = [...actualModels].sort();
  const expected = [...expectedModels].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`pricing models ${actual.join(',')} != ${expected.join(',')}`);
  }

  return actual;
}

export function assertPricingComparison(payload, expectedModels, expectedUsage) {
  const response = requireRecord(payload, 'pricing response');
  assertPricingBoundary(response);
  assertPricingUsage(response, expectedUsage);
  const models = assertPricingModels(response, expectedModels);
  return { count: response.count, models };
}

export function assertPricingError(payload, expectedCode, expectedField) {
  const response = requireRecord(payload, 'pricing error response');
  const error = requireRecord(response.error, 'pricing error');
  if (error.code !== expectedCode || error.field !== expectedField) {
    throw new Error(
      `pricing error ${error.code ?? 'missing'}/${error.field ?? 'missing'} != ${expectedCode}/${expectedField}`,
    );
  }
  return { code: error.code, field: error.field };
}

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    throw new Error('response was not valid JSON');
  }
}

function parseUsage(values) {
  if (values.length !== 4 || values.some((value) => !/^(0|[1-9]\d*)$/.test(value))) {
    throw new Error('comparison requires four non-negative integer usage values');
  }
  const [input, output, cacheRead, cacheWrite] = values.map(Number);
  return { input, output, cacheRead, cacheWrite };
}

function main() {
  const [contract, ...args] = process.argv.slice(2);
  const payload = readPayload();
  if (contract === 'comparison') {
    const [models, ...usageValues] = args;
    const result = assertPricingComparison(payload, models?.split(',') ?? [], parseUsage(usageValues));
    process.stdout.write(`Pricing comparison returned exactly ${result.count} requested models\n`);
    return;
  }
  if (contract === 'error') {
    const [code, field] = args;
    const result = assertPricingError(payload, code, field);
    process.stdout.write(`Pricing rejection returned ${result.code}/${result.field}\n`);
    return;
  }
  throw new Error('contract must be comparison or error');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
