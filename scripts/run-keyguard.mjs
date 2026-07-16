import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import './check-npmrc.mjs';
import { formatReport, runScan } from 'kguard/dist/scan.js';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { version } = require('kguard/package.json');

if (version !== '0.1.0') {
  throw new Error(`Revalidate the KeyGuard compatibility adapter for version ${version}.`);
}

function isApprovedNpmrcFinding(finding) {
  return finding.rule === 'banned-file'
    && finding.severity === 'high'
    && finding.file === '.npmrc'
    && finding.message === 'Sensitive file ".npmrc" exists in project root';
}

const approvedFixture = {
  rule: 'banned-file',
  severity: 'high',
  file: '.npmrc',
  message: 'Sensitive file ".npmrc" exists in project root',
};
if (
  !isApprovedNpmrcFinding(approvedFixture)
  || isApprovedNpmrcFinding({ ...approvedFixture, file: '.pypirc' })
  || isApprovedNpmrcFinding({ ...approvedFixture, severity: 'critical' })
) {
  throw new Error('KeyGuard allowlist self-test failed.');
}

const report = await runScan(root);
const results = report.results.map((result) => {
  if (result.name !== 'Secrets') return result;
  const findings = result.findings.filter((finding) => !isApprovedNpmrcFinding(finding));
  return {
    ...result,
    findings,
    status: findings.length === 0 ? 'pass' : result.status,
    summary: findings.length === 0
      ? 'No secrets detected; reviewed non-secret .npmrc policy passed'
      : result.summary,
  };
});
const scoreMap = { pass: 1, warn: 0.5, fail: 0, skip: 0 };
const nonSkipped = results.filter((result) => result.status !== 'skip');
const adjustedReport = {
  results,
  score: nonSkipped.reduce((sum, result) => sum + scoreMap[result.status], 0),
  maxScore: nonSkipped.length,
  passed: results.every((result) => result.status !== 'fail'),
};

console.log('\nKeyGuard v0.1.0 (LLMKit policy adapter)\n');
console.log(formatReport(adjustedReport));
if (!adjustedReport.passed) process.exit(1);
console.log('KEYGUARD_POLICY PASS (approved + adjacent violation fixtures)');
