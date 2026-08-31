import { strict as assert } from 'node:assert';
import { merge } from '../scripts/fetch-pricing.mjs';

const corrections = [
  {
    model: 'gpt-5.6-luna',
    stale: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
    verified: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  },
  {
    model: 'gpt-5.6-terra',
    stale: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
    verified: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  {
    model: 'gpt-5.6-sol',
    stale: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    verified: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  },
];

function mergeModel(model, current, upstream) {
  return merge(
    { openai: { [model]: upstream } },
    {},
    { providers: { openai: { [model]: current } } },
  ).providers.openai[model];
}

for (const { model, stale, verified } of corrections) {
  assert.deepEqual(
    mergeModel(model, stale, stale),
    verified,
    `${model}: the known stale upstream rate must be replaced by the official rate`,
  );
  assert.deepEqual(
    mergeModel(model, stale, verified),
    verified,
    `${model}: an upstream snapshot that catches up must retain the official rate`,
  );
  assert.throws(
    () => mergeModel(model, stale, { ...verified, input: verified.input + 0.01 }),
    /upstream rates changed outside the verified override/,
    `${model}: a third upstream value must stop refresh until it is verified`,
  );
}

console.log('pricing source contract passed');
