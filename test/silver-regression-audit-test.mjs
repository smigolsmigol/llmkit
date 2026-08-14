import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'scripts/silver-regression-audit.json';
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);

const read = (path) => readFileSync(path, 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function decision(defects) {
  const covered = defects.filter((defect) => defect.regression.status === 'covered').length;
  const total = defects.length;
  return {
    covered,
    gaps: total - covered,
    total,
    percent: total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2)),
    passed: total > 0 && covered / total >= 0.5,
  };
}

assert.equal(decision([]).passed, false);
assert.equal(decision([
  { regression: { status: 'covered' } },
  { regression: { status: 'gap' } },
]).passed, true);
assert.equal(decision([
  { regression: { status: 'covered' } },
  { regression: { status: 'gap' } },
  { regression: { status: 'gap' } },
]).passed, false);

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.source.auditBaseCommit.length, 40);
assert.equal(manifest.source.reviewedThroughPullRequest, 165);
assert.equal(manifest.source.mergedPullRequestsReviewed, 68);
assert.ok(manifest.methodology.unit.includes('distinct root failure'));

const ids = new Set();
const inputPaths = new Set([manifestPath, 'test/silver-regression-audit-test.mjs']);
for (const defect of manifest.defects) {
  assert.ok(!ids.has(defect.id), `duplicate defect id: ${defect.id}`);
  ids.add(defect.id);
  assert.ok(Number.isInteger(defect.pullRequest) && defect.pullRequest > 0, defect.id);
  assert.ok(
    defect.fixedAt >= manifest.window.startInclusive
      && defect.fixedAt <= manifest.window.endInclusive,
    `${defect.id} falls outside the audit window`,
  );
  assert.ok(['covered', 'gap'].includes(defect.regression.status), defect.id);
  if (defect.regression.status === 'gap') {
    assert.ok(defect.regression.reason, `${defect.id} needs a gap reason`);
    continue;
  }

  assert.ok(defect.regression.evidence?.length > 0, `${defect.id} needs evidence`);
  for (const evidence of defect.regression.evidence) {
    const testSource = read(evidence.testFile);
    const suiteSource = read(evidence.suiteFile);
    assert.ok(
      testSource.includes(evidence.marker),
      `${defect.id} lost regression marker ${evidence.marker} in ${evidence.testFile}`,
    );
    assert.ok(
      suiteSource.includes(evidence.suiteMarker),
      `${defect.id} regression is not registered in ${evidence.suiteFile}`,
    );
    inputPaths.add(evidence.testFile);
    inputPaths.add(evidence.suiteFile);
  }
}

const result = decision(manifest.defects);
assert.equal(result.total, 41);
assert.equal(result.covered, 28);
assert.equal(result.gaps, 13);
assert.equal(result.percent, 68.29);
assert.equal(result.passed, true, 'Silver regression coverage must remain at or above 50%');

const inputHashes = [...inputPaths]
  .sort()
  .map((path) => ({ path, sha256: sha256(readFileSync(path)) }));
const auditInputSha256 = sha256(inputHashes.map(({ path, sha256: hash }) => `${path}\0${hash}`).join('\n'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const receipt = {
  schemaVersion: 1,
  gate: 'OpenSSF Silver six-month regression audit',
  result: 'PASS',
  criterion: manifest.criterion,
  window: manifest.window,
  auditBaseCommit: manifest.source.auditBaseCommit,
  evaluatedHead: head,
  node: process.version,
  manifestSha256: sha256(manifestBytes),
  auditInputSha256,
  inputHashes,
  ...result,
};

mkdirSync('audits', { recursive: true });
writeFileSync('audits/llmkit-silver-regression.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `SILVER_REGRESSION_AUDIT PASS (${result.covered}/${result.total}, ${result.percent}%; ${result.gaps} explicit gaps)`,
);
