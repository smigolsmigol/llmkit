import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const biomeLauncher = require.resolve('@biomejs/biome/bin/biome');
const complexityCategory = 'lint/complexity/noExcessiveCognitiveComplexity';
const defaultTargets = [
  'packages/proxy/src',
  'packages/proxy/test',
  'packages/sdk/src',
  'packages/sdk/test',
  'packages/cli/src',
  'packages/cli/test',
  'packages/shared/src',
  'packages/shared/test',
  'packages/ai-sdk-provider/src',
  'packages/ai-sdk-provider/test',
  'packages/mcp-server/src',
  'packages/mcp-server/test',
  'packages/dashboard/src',
  'scripts',
  'test',
];

// Existing complexity debt remains visible, but it cannot grow by file. All other warnings fail.
const complexityCaps = new Map([
  ['packages/ai-sdk-provider/src/index.ts', 4],
  ['packages/cli/src/index.ts', 1],
  ['packages/cli/src/parsers.ts', 2],
  ['packages/cli/src/summary.ts', 1],
  ['packages/dashboard/src/app/(auth)/dashboard/admin/admin-tabs.tsx', 1],
  ['packages/dashboard/src/app/(auth)/dashboard/page.tsx', 1],
  ['packages/dashboard/src/app/(auth)/dashboard/requests/[id]/page.tsx', 1],
  ['packages/dashboard/src/app/api/export/route.ts', 1],
  ['packages/dashboard/src/components/charts/package-downloads.tsx', 1],
  ['packages/dashboard/src/components/request-feed.tsx', 1],
  ['packages/dashboard/src/lib/queries.ts', 5],
  ['packages/mcp-server/src/adapters/cline.ts', 2],
  ['packages/mcp-server/src/claude-code.ts', 4],
  ['packages/proxy/src/do/budget-do.ts', 3],
  ['packages/proxy/src/do/idempotency-do.ts', 1],
  ['packages/proxy/src/middleware/auth.ts', 1],
  ['packages/proxy/src/middleware/idempotency.ts', 1],
  ['packages/proxy/src/middleware/logger.ts', 1],
  ['packages/proxy/src/providers/anthropic.ts', 5],
  ['packages/proxy/src/providers/gemini.ts', 2],
  ['packages/proxy/src/providers/openai.ts', 1],
  ['packages/proxy/src/routes/chat.ts', 3],
  ['packages/proxy/src/routes/pricing.ts', 1],
  ['packages/proxy/src/routes/responses.ts', 1],
  ['packages/proxy/test/budget-falsifier/gate0.test.ts', 1],
  ['packages/proxy/test/live-test.mjs', 1],
  ['packages/proxy/test/validation-test.mjs', 2],
  ['packages/sdk/src/client.ts', 1],
  ['packages/shared/src/providers.ts', 1],
  ['scripts/check-budget-falsifier-coverage.mjs', 1],
  ['scripts/fetch-pricing.mjs', 4],
  ['scripts/staging-deploy-contract.mjs', 1],
]);

function normalizePath(path) {
  return String(path || '').replaceAll('\\', '/');
}

function classifyDiagnostic(diagnostic, violations, complexityCounts) {
  const path = normalizePath(diagnostic.location?.path);
  if (diagnostic.severity === 'error') {
    violations.push(`${path}: ${diagnostic.category}: ${diagnostic.message}`);
    return;
  }
  if (diagnostic.severity !== 'warning') return;
  if (diagnostic.category !== complexityCategory) {
    violations.push(`${path}: unexpected warning ${diagnostic.category}: ${diagnostic.message}`);
    return;
  }
  complexityCounts.set(path, (complexityCounts.get(path) || 0) + 1);
}

function validateComplexityCounts(complexityCounts, requireExactBaseline) {
  const violations = [];
  for (const [path, count] of complexityCounts) {
    const cap = complexityCaps.get(path);
    if (cap === undefined) {
      violations.push(`${path}: new cognitive-complexity warning is not baselined.`);
    } else if (count > cap) {
      violations.push(`${path}: cognitive-complexity warnings grew from ${cap} to ${count}.`);
    }
  }

  if (requireExactBaseline) {
    for (const [path, cap] of complexityCaps) {
      const count = complexityCounts.get(path) || 0;
      if (count < cap) {
        violations.push(`${path}: cognitive-complexity baseline is stale (${count} present, cap ${cap}).`);
      }
    }
  }

  return violations;
}

function policyViolations(diagnostics, diagnosticsNotPrinted = 0, requireExactBaseline = false) {
  const violations = diagnosticsNotPrinted > 0
    ? [`${diagnosticsNotPrinted} Biome diagnostics were truncated.`]
    : [];
  const complexityCounts = new Map();
  for (const diagnostic of diagnostics) {
    classifyDiagnostic(diagnostic, violations, complexityCounts);
  }
  violations.push(...validateComplexityCounts(complexityCounts, requireExactBaseline));

  return { violations, complexityCount: [...complexityCounts.values()].reduce((sum, count) => sum + count, 0) };
}

function fixture(severity, category, path) {
  return { severity, category, message: 'fixture', location: { path } };
}

if (process.argv[2] === '--self-test') {
  const allowed = policyViolations([
    fixture('warning', complexityCategory, 'packages/cli/src/index.ts'),
  ]);
  if (allowed.violations.length !== 0) throw new Error('Allowed complexity fixture was rejected.');

  const violationFixtures = [
    [fixture('warning', 'lint/style/useConst', 'packages/cli/src/index.ts')],
    [fixture('warning', complexityCategory, 'packages/new/src/index.ts')],
    Array.from({ length: 2 }, () => fixture('warning', complexityCategory, 'packages/cli/src/index.ts')),
    [fixture('error', 'lint/correctness/noUnusedVariables', 'packages/cli/src/index.ts')],
  ];
  for (const diagnostics of violationFixtures) {
    if (policyViolations(diagnostics).violations.length === 0) {
      throw new Error(`Biome policy violation fixture was accepted: ${diagnostics[0].category}.`);
    }
  }
  if (policyViolations([], 1).violations.length === 0) {
    throw new Error('Truncated Biome diagnostics fixture was accepted.');
  }
  if (policyViolations([], 0, true).violations.length === 0) {
    throw new Error('Stale Biome complexity baseline fixture was accepted.');
  }
  console.log('BIOME_POLICY_SELF_TEST PASS');
  process.exit(0);
}

const requestedTargets = process.argv.slice(2);
if (requestedTargets.some((target) => target.startsWith('-'))) {
  throw new Error('Biome policy targets must be repository paths, not command options.');
}
const targets = requestedTargets.length > 0 ? requestedTargets : defaultTargets;
const result = spawnSync(
  process.execPath,
  [
    biomeLauncher,
    'check',
    ...targets,
    '--diagnostic-level=warn',
    '--max-diagnostics=500',
    '--reporter=json',
  ],
  {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  },
);
if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch (error) {
  throw new Error(`Biome JSON report could not be parsed: ${error.message}\n${result.stderr || ''}`);
}

const decision = policyViolations(
  report.diagnostics || [],
  report.summary?.diagnosticsNotPrinted || 0,
  requestedTargets.length === 0,
);
if (decision.violations.length > 0) {
  throw new Error(`Biome warning policy failed:\n${decision.violations.join('\n')}`);
}
if (result.status !== 0) {
  throw new Error(`Biome exited ${result.status} without a classified diagnostic.\n${result.stderr || ''}`);
}

console.log(
  `BIOME_POLICY PASS (${decision.complexityCount} capped cognitive-complexity advisories; `
  + '0 other warnings)',
);
