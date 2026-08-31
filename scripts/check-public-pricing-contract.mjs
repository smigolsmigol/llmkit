import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pricingCatalog = JSON.parse(
  readFileSync(new URL('../packages/shared/pricing.json', import.meta.url), 'utf8'),
);

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
  if (
    snapshot.date !== pricingCatalog.updatedAt
    || snapshot.liveQuote !== false
    || snapshot.sourceModalityEncoded !== false
    || snapshot.rateUnit !== 'USD_PER_MILLION_TOKENS'
  ) {
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

function expectedModel(key, usage) {
  const separator = key.indexOf('/');
  if (separator <= 0 || separator === key.length - 1) {
    throw new Error(`expected model key is invalid: ${key}`);
  }
  const provider = key.slice(0, separator);
  const model = key.slice(separator + 1);
  const pricing = pricingCatalog.providers?.[provider]?.[model];
  if (!pricing) {
    throw new Error(`expected model is absent from pricing.json: ${key}`);
  }

  const rawInput = (usage.input / 1_000_000) * pricing.input;
  const rawOutput = (usage.output / 1_000_000) * pricing.output;
  const rawCacheRead = (usage.cacheRead / 1_000_000) * (pricing.cacheRead ?? 0);
  const rawCacheWrite = (usage.cacheWrite / 1_000_000) * (pricing.cacheWrite ?? 0);
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

function assertExactRecord(actualValue, expected, label) {
  const actual = requireRecord(actualValue, label);
  for (const [field, value] of Object.entries(expected)) {
    if (actual[field] !== value) {
      throw new Error(`${label} ${field} ${actual[field] ?? 'missing'} != ${value}`);
    }
  }
}

function assertPricingModels(response, expectedModels, expectedUsage) {
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

  const expectedByKey = new Map(
    expectedModels.map((key) => [key, expectedModel(key, expectedUsage)]),
  );
  const actualModels = response.models.map((entry, index) => {
    const model = requireRecord(entry, `pricing model ${index}`);
    const expected = expectedByKey.get(model.key);
    if (!expected) {
      throw new Error(`pricing model ${model.key ?? 'missing'} was not requested`);
    }
    assertExactRecord(model, {
      key: expected.key,
      provider: expected.provider,
      model: expected.model,
    }, `pricing model ${index}`);
    assertExactRecord(model.rates, expected.rates, `pricing model ${index} rates`);
    assertExactRecord(model.costs, expected.costs, `pricing model ${index} costs`);
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
  const models = assertPricingModels(response, expectedModels, expectedUsage);
  return { count: response.count, models };
}

export function assertPricingError(payload, expectedCode, expectedField) {
  if (typeof expectedCode !== 'string' || expectedCode.trim() === '') {
    throw new Error('expected pricing error code is required');
  }
  if (typeof expectedField !== 'string' || expectedField.trim() === '') {
    throw new Error('expected pricing error field is required');
  }
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
