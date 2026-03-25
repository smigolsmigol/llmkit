#!/usr/bin/env node

// Generates pricing data files for all packages from the single source of truth:
//   packages/shared/pricing.json
//
// Outputs:
//   packages/shared/src/pricing-data.ts
//   packages/python-sdk/src/llmkit/_pricing_data.py
//   packages/mcp-server/src/pricing-data.ts
//
// Usage:
//   node scripts/generate-pricing.mjs          # generate files
//   node scripts/generate-pricing.mjs --check  # verify files match (CI mode)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const check = process.argv.includes('--check');

const pricingPath = join(root, 'packages/shared/pricing.json');
const pricing = JSON.parse(readFileSync(pricingPath, 'utf8'));

const HEADER_TS = `// AUTO-GENERATED from packages/shared/pricing.json
// Do not edit manually. Run: node scripts/generate-pricing.mjs
`;

const HEADER_PY = `# AUTO-GENERATED from packages/shared/pricing.json
# Do not edit manually. Run: node scripts/generate-pricing.mjs
`;

function num(v) {
  if (v == null) return undefined;
  return typeof v === 'number' ? v : Number(v);
}

// --- TypeScript shared pricing data ---

function generateSharedTS() {
  const lines = [HEADER_TS];
  lines.push(`export const UPDATED_AT = '${pricing.updatedAt}';\n`);

  lines.push('export const PRICING_DATA: Record<string, Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>> = {');
  for (const [provider, models] of Object.entries(pricing.providers)) {
    lines.push(`  '${provider}': {`);
    for (const [model, p] of Object.entries(models)) {
      const parts = [`input: ${p.input}, output: ${p.output}`];
      if (num(p.cacheRead)) parts.push(`cacheRead: ${p.cacheRead}`);
      if (num(p.cacheWrite)) parts.push(`cacheWrite: ${p.cacheWrite}`);
      lines.push(`    '${model}': { ${parts.join(', ')} },`);
    }
    lines.push('  },');
  }
  lines.push('};\n');

  lines.push('export const PREFIXES: [string, string][] = [');
  for (const [prefix, provider] of pricing.prefixes) {
    lines.push(`  ['${prefix}', '${provider}'],`);
  }
  lines.push('];\n');

  return lines.join('\n');
}

// --- Python SDK pricing data ---

function generatePythonData() {
  const lines = [HEADER_PY];
  lines.push(`UPDATED_AT = "${pricing.updatedAt}"\n`);

  lines.push('PRICING: dict[str, dict[str, tuple[float, ...]]] = {');
  for (const [provider, models] of Object.entries(pricing.providers)) {
    if (Object.keys(models).length === 0) continue;
    lines.push(`    "${provider}": {`);
    for (const [model, p] of Object.entries(models)) {
      const vals = [p.input, p.output];
      if (num(p.cacheRead) || num(p.cacheWrite)) {
        vals.push(num(p.cacheRead) || 0);
      }
      if (num(p.cacheWrite)) {
        vals.push(p.cacheWrite);
      }
      lines.push(`        "${model}": (${vals.join(', ')}),`);
    }
    lines.push('    },');
  }
  lines.push('}\n');

  lines.push('PREFIXES: list[tuple[str, str]] = [');
  for (const [prefix, provider] of pricing.prefixes) {
    lines.push(`    ("${prefix}", "${provider}"),`);
  }
  lines.push(']\n');

  return lines.join('\n');
}

// --- MCP server pricing data (Claude models only) ---

function generateMcpTS() {
  const lines = [HEADER_TS];
  const claudeModels = pricing.providers.anthropic || {};

  lines.push('export const CLAUDE_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {');
  for (const [model, p] of Object.entries(claudeModels)) {
    lines.push(`  '${model}': { input: ${p.input}, output: ${p.output}, cacheRead: ${num(p.cacheRead) || 0}, cacheWrite: ${num(p.cacheWrite) || 0} },`);
  }
  lines.push('};\n');

  return lines.join('\n');
}

// --- Write or check ---

const outputs = [
  { path: join(root, 'packages/shared/src/pricing-data.ts'), content: generateSharedTS() },
  { path: join(root, 'packages/python-sdk/src/llmkit/_pricing_data.py'), content: generatePythonData() },
  { path: join(root, 'packages/mcp-server/src/pricing-data.ts'), content: generateMcpTS() },
];

let failures = 0;

for (const { path, content } of outputs) {
  const rel = path.replace(root + '/', '').replace(root + '\\', '');
  if (check) {
    if (!existsSync(path)) {
      console.error(`MISSING: ${rel}`);
      failures++;
      continue;
    }
    const existing = readFileSync(path, 'utf8');
    if (existing !== content) {
      console.error(`STALE: ${rel} (run: node scripts/generate-pricing.mjs)`);
      failures++;
    } else {
      console.log(`  OK  ${rel}`);
    }
  } else {
    writeFileSync(path, content);
    console.log(`  GEN  ${rel}`);
  }
}

if (check && failures > 0) {
  console.error(`\n${failures} file(s) out of sync with pricing.json`);
  process.exit(1);
} else if (check) {
  console.log('\nAll pricing files in sync.');
} else {
  console.log(`\nGenerated ${outputs.length} files from pricing.json.`);
}
