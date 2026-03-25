// xAI pricing correctness tests
// usage: node test/xai-cost-test.mjs

import { strict as assert } from 'node:assert';
import { getModelPricing, calculateCostFromPricing, PRICING } from '../../shared/dist/index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

// ============================
// xAI MODEL COVERAGE
// ============================

test('all 9 xAI models have valid pricing', () => {
  const models = Object.keys(PRICING.xai);
  assert.equal(models.length, 9, `expected 9 xAI models, got ${models.length}`);
  for (const model of models) {
    const p = PRICING.xai[model];
    assert.ok(p.inputPerMillion > 0, `${model} inputPerMillion should be > 0`);
    assert.ok(p.outputPerMillion > 0, `${model} outputPerMillion should be > 0`);
  }
});

test('no xAI model has extraRates', () => {
  for (const [model, pricing] of Object.entries(PRICING.xai)) {
    assert.equal(pricing.extraRates, undefined, `${model} should not have extraRates (regression guard)`);
  }
});

// ============================
// SPECIFIC MODEL PRICES
// ============================

test('grok-4.20-0309-reasoning pricing correct', () => {
  const p = PRICING.xai['grok-4.20-0309-reasoning'];
  assert.ok(p, 'should exist');
  assert.equal(p.inputPerMillion, 2.0);
  assert.equal(p.outputPerMillion, 6.0);
  assert.equal(p.cacheReadPerMillion, 0.2);
});

test('grok-4-1-fast-reasoning pricing correct', () => {
  const p = PRICING.xai['grok-4-1-fast-reasoning'];
  assert.ok(p, 'should exist');
  assert.equal(p.inputPerMillion, 0.2);
  assert.equal(p.outputPerMillion, 0.5);
  assert.equal(p.cacheReadPerMillion, 0.05);
});

test('grok-4 pricing correct', () => {
  const p = PRICING.xai['grok-4'];
  assert.ok(p, 'should exist');
  assert.equal(p.inputPerMillion, 3.0);
  assert.equal(p.outputPerMillion, 15.0);
  assert.equal(p.cacheReadPerMillion, undefined, 'grok-4 has no cache pricing');
});

// ============================
// COST CALCULATIONS
// ============================

test('xAI function calls are free (no extraRates)', () => {
  const pricing = getModelPricing('xai', 'grok-4');
  assert.ok(pricing, 'should resolve grok-4');

  const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
  const base = calculateCostFromPricing(pricing, usage);
  const withTools = calculateCostFromPricing(pricing, usage, [
    { dimension: 'web_search', quantity: 5 },
  ]);

  assert.equal(base.totalCost, withTools.totalCost, 'cost should be identical since no extraRates');
  assert.equal(withTools.extraCosts, undefined, 'extraCosts should be undefined');
});

test('cache cost works for xAI', () => {
  const pricing = getModelPricing('xai', 'grok-4.20-0309-reasoning');
  assert.ok(pricing, 'should resolve');

  const usage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 500,
    totalTokens: 2000,
  };
  const result = calculateCostFromPricing(pricing, usage);

  // input: 1000/1M * 2.0 = 0.002
  // output: 500/1M * 6.0 = 0.003
  // cacheRead: 500/1M * 0.2 = 0.0001
  const expectedInput = 0.002;
  const expectedOutput = 0.003;
  const expectedCache = 0.0001;
  const expectedTotal = +(expectedInput + expectedOutput + expectedCache).toFixed(8);

  assert.ok(result.cacheReadCost > 0, 'cacheReadCost should be > 0');
  assert.equal(result.cacheReadCost, +expectedCache.toFixed(8));
  assert.equal(result.inputCost, +expectedInput.toFixed(8));
  assert.equal(result.outputCost, +expectedOutput.toFixed(8));
  assert.equal(result.totalCost, expectedTotal);
});

// ============================
// getModelPricing RESOLUTION
// ============================

test('getModelPricing resolves xAI models', () => {
  const p = getModelPricing('xai', 'grok-4');
  assert.ok(p, 'should resolve grok-4');
  assert.equal(p.inputPerMillion, 3.0);
  assert.equal(p.outputPerMillion, 15.0);
});

test('getModelPricing resolves xAI dated models', () => {
  const p = getModelPricing('xai', 'grok-4.20-0309-reasoning');
  assert.ok(p, 'should resolve grok-4.20-0309-reasoning');
  assert.equal(p.inputPerMillion, 2.0);
  assert.equal(p.outputPerMillion, 6.0);
  assert.equal(p.cacheReadPerMillion, 0.2);
});

// --- summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
