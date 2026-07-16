import { readFileSync } from 'node:fs';

const requiredScores = new Map([
  ['Pinned-Dependencies', 10],
  ['Vulnerabilities', 10],
]);

function assertSupplyChain(result) {
  if (!result || !Array.isArray(result.checks)) {
    throw new Error('Scorecard result must contain a checks array.');
  }

  const scores = new Map(result.checks.map((check) => [check.name, check.score]));
  for (const [name, expected] of requiredScores) {
    if (!scores.has(name)) {
      throw new Error(`Scorecard result is missing ${name}.`);
    }
    const actual = scores.get(name);
    if (actual !== expected) {
      throw new Error(`${name} requires ${expected}/10, got ${actual}/10.`);
    }
  }
}

if (process.argv[2] === '--self-test') {
  assertSupplyChain({
    checks: [
      { name: 'Pinned-Dependencies', score: 10 },
      { name: 'Vulnerabilities', score: 10 },
    ],
  });

  for (const violation of [
    { checks: [{ name: 'Pinned-Dependencies', score: 10 }] },
    {
      checks: [
        { name: 'Pinned-Dependencies', score: 9 },
        { name: 'Vulnerabilities', score: 10 },
      ],
    },
  ]) {
    let blocked = false;
    try {
      assertSupplyChain(violation);
    } catch {
      blocked = true;
    }
    if (!blocked) throw new Error('Scorecard supply-chain violation fixture was accepted.');
  }

  console.log('SCORECARD_SUPPLY_CHAIN_SELF_TEST PASS');
  process.exit(0);
}

const resultsPath = process.argv[2];
if (!resultsPath) {
  throw new Error('Usage: node scripts/assert-scorecard-supply-chain.mjs <results.json>');
}

assertSupplyChain(JSON.parse(readFileSync(resultsPath, 'utf8')));
console.log('SCORECARD_SUPPLY_CHAIN PASS');
