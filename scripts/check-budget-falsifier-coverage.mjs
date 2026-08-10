import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, '..', '..');
const threshold = 90;
const targets = [
  'packages/proxy/src/index.ts',
  'packages/proxy/src/do/budget-do.ts',
  'packages/proxy/src/do/idempotency-do.ts',
  'packages/proxy/src/middleware/budget.ts',
  'packages/proxy/src/middleware/idempotency.ts',
  'packages/proxy/src/middleware/logger.ts',
  'packages/proxy/src/providers/chain.ts',
  'packages/proxy/src/providers/request.ts',
  'packages/proxy/src/providers/sse-lines.ts',
  'packages/proxy/src/routes/chat.ts',
  'packages/proxy/src/routes/responses.ts',
  'packages/proxy/src/staging.ts',
];

function git(args, allowFailure = false) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.status === 0 ? result.stdout : '';
}

function changedLines(target) {
  const lines = new Set();
  const base = process.env.GATE0_COVERAGE_BASE || 'origin/main';
  const hasBase = git(['rev-parse', '--verify', base], true).trim() !== '';
  const isTracked = git(['ls-files', '--error-unmatch', '--', target], true).trim() !== '';
  if (!isTracked) {
    const lineCount = readFileSync(resolve(repoRoot, target), 'utf8').split(/\r?\n/).length;
    for (let current = 1; current <= lineCount; current += 1) lines.add(current);
    return { base: hasBase ? base : null, lines };
  }
  const diffs = [
    ...(hasBase ? [git(['diff', '--unified=0', '--no-color', `${base}...HEAD`, '--', target])] : []),
    git(['diff', '--unified=0', '--no-color', 'HEAD', '--', target]),
  ];
  for (const diff of diffs) {
    for (const line of diff.split(/\r?\n/)) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (let current = start; current < start + count; current += 1) lines.add(current);
    }
  }
  return { base: hasBase ? base : null, lines };
}

async function dirtyMaterialHash() {
  const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const hash = createHash('sha256').update(raw);
  for (const entry of raw.split('\0').filter(Boolean).sort()) {
    const relative = entry.slice(3).replace(/^.* -> /, '');
    const full = resolve(repoRoot, relative);
    try {
      if ((await stat(full)).isFile()) hash.update(relative).update(await readFile(full));
    } catch {
      hash.update(relative).update('<missing>');
    }
  }
  return hash.digest('hex');
}

function overlaps(location, lines) {
  for (let line = location.start.line; line <= location.end.line; line += 1) {
    if (lines.has(line)) return true;
  }
  return false;
}

function percent(hit, total) {
  return total === 0 ? 100 : Number(((hit / total) * 100).toFixed(2));
}

function coverageDecision(aggregateMetrics) {
  if (aggregateMetrics.statements.total === 0) {
    return {
      status: 'N/A',
      pass: true,
      reason: 'NO_CHANGED_EXECUTABLE_PRODUCTION_STATEMENTS',
    };
  }
  const pass = Object.values(aggregateMetrics).every((metric) => metric.pct >= threshold);
  return {
    status: pass ? 'PASS' : 'FAIL',
    pass,
    reason: null,
  };
}

if (process.argv.includes('--self-test')) {
  const empty = {
    statements: { hit: 0, total: 0, pct: 100 },
    branches: { hit: 0, total: 0, pct: 100 },
    functions: { hit: 0, total: 0, pct: 100 },
    lines: { hit: 0, total: 0, pct: 100 },
  };
  const passing = Object.fromEntries(
    Object.entries(empty).map(([name]) => [name, { hit: 9, total: 10, pct: 90 }]),
  );
  const failing = structuredClone(passing);
  failing.branches = { hit: 8, total: 10, pct: 80 };
  if (coverageDecision(empty).status !== 'N/A') throw new Error('empty diff must be N/A');
  if (coverageDecision(passing).status !== 'PASS') throw new Error('covered diff must pass');
  if (coverageDecision(failing).status !== 'FAIL') throw new Error('under-covered diff must fail');
  process.stdout.write('BUDGET_COVERAGE_SELF_TEST PASS\n');
  process.exit(0);
}

const coveragePath = resolve(packageRoot, 'coverage', 'budget-falsifier', 'coverage-final.json');
const coverageBytes = await readFile(coveragePath);
const coverage = JSON.parse(coverageBytes);
const aggregate = {
  statements: { hit: 0, total: 0 },
  branches: { hit: 0, total: 0 },
  functions: { hit: 0, total: 0 },
  lines: { hit: 0, total: 0 },
};
const files = [];
let selectedBase = null;

for (const target of targets) {
  const change = changedLines(target);
  selectedBase ||= change.base;
  const normalized = target.replaceAll('\\', '/');
  const key = Object.keys(coverage).find((candidate) => candidate.replaceAll('\\', '/').endsWith(normalized));
  if (!key) throw new Error(`coverage entry missing for ${target}`);
  const entry = coverage[key];
  const metrics = {
    statements: { hit: 0, total: 0 },
    branches: { hit: 0, total: 0 },
    functions: { hit: 0, total: 0 },
    lines: { hit: 0, total: 0 },
  };
  const lineCounts = new Map();

  for (const [id, location] of Object.entries(entry.statementMap)) {
    if (!overlaps(location, change.lines)) continue;
    metrics.statements.total += 1;
    if (entry.s[id] > 0) metrics.statements.hit += 1;
    const line = location.start.line;
    if (change.lines.has(line)) lineCounts.set(line, Math.max(lineCounts.get(line) || 0, entry.s[id]));
  }
  for (const [id, fn] of Object.entries(entry.fnMap)) {
    if (!overlaps(fn.loc, change.lines)) continue;
    metrics.functions.total += 1;
    if (entry.f[id] > 0) metrics.functions.hit += 1;
  }
  for (const [id, branch] of Object.entries(entry.branchMap)) {
    branch.locations.forEach((location, index) => {
      if (!overlaps(location, change.lines)) return;
      metrics.branches.total += 1;
      if (entry.b[id][index] > 0) metrics.branches.hit += 1;
    });
  }
  metrics.lines.total = lineCounts.size;
  metrics.lines.hit = [...lineCounts.values()].filter((count) => count > 0).length;

  for (const name of Object.keys(metrics)) {
    aggregate[name].hit += metrics[name].hit;
    aggregate[name].total += metrics[name].total;
    metrics[name].pct = percent(metrics[name].hit, metrics[name].total);
  }
  files.push({ path: target, addedLines: change.lines.size, metrics });
}

for (const metric of Object.values(aggregate)) metric.pct = percent(metric.hit, metric.total);
const decision = coverageDecision(aggregate);
const receipt = {
  schemaVersion: 1,
  gate: 'LLMKit changed money-path coverage',
  threshold,
  status: decision.status,
  pass: decision.pass,
  reason: decision.reason,
  base: selectedBase,
  sourceCommit: git(['rev-parse', 'HEAD']).trim(),
  dirtyMaterialSha256: await dirtyMaterialHash(),
  coverageFinalSha256: createHash('sha256').update(coverageBytes).digest('hex'),
  aggregate,
  files,
  boundary: 'Only executable production code changed relative to origin/main/HEAD is gated. The broad legacy-file report is retained separately and is not represented as 90%.',
};
const output = resolve(repoRoot, 'audits', 'llmkit-gate0-budget-coverage.json');
await mkdir(resolve(repoRoot, 'audits'), { recursive: true });
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
const receiptSha = createHash('sha256').update(await readFile(output)).digest('hex');

process.stdout.write(`BUDGET_COVERAGE ${JSON.stringify(aggregate)}\n`);
process.stdout.write(`BUDGET_COVERAGE_DECISION ${decision.status}${decision.reason ? ` ${decision.reason}` : ''}\n`);
process.stdout.write(`BUDGET_COVERAGE_RECEIPT ${output}\n`);
process.stdout.write(`BUDGET_COVERAGE_SHA256 ${receiptSha}\n`);
if (!decision.pass) process.exit(1);
