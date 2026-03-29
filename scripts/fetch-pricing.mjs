#!/usr/bin/env node

// Fetches latest pricing from genai-prices (primary) and LiteLLM (fallback),
// merges them, and updates packages/shared/pricing.json.
//
// Usage:
//   node scripts/fetch-pricing.mjs              # fetch + update + generate
//   node scripts/fetch-pricing.mjs --dry-run    # show what would change, don't write

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

const GENAI_URL = 'https://raw.githubusercontent.com/pydantic/genai-prices/main/prices/data_slim.json';
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const PROVIDER_MAP = {
  'openai': 'openai',
  'anthropic': 'anthropic',
  'google': 'gemini',
  'x-ai': 'xai',
  'deepseek': 'deepseek',
  'mistral': 'mistral',
  'groq': 'groq',
  'fireworks': 'fireworks',
  'together': 'together',
};

const LITELLM_PROVIDER_MAP = {
  'openai': 'openai',
  'anthropic': 'anthropic',
  'gemini': 'gemini',
  'xai': 'xai',
  'deepseek': 'deepseek',
  'mistral': 'mistral',
  'groq': 'groq',
  'fireworks_ai': 'fireworks',
  'together_ai': 'together',
};

async function fetchJSON(url, label) {
  console.log(`  fetching ${label}...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${label}: ${res.status} ${res.statusText}`);
  return res.json();
}

function extractRate(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'base' in v) return v.base;
  return undefined;
}

function parseGenAIPrices(data) {
  const result = {};
  for (const provider of data) {
    const mapped = PROVIDER_MAP[provider.id];
    if (!mapped) continue;

    if (!result[mapped]) result[mapped] = {};

    for (const model of provider.models) {
      const input = extractRate(model.prices?.input_mtok);
      const output = extractRate(model.prices?.output_mtok);
      if (!input || !output) continue;

      const entry = { input, output };
      const cacheRead = extractRate(model.prices?.cache_read_mtok);
      const cacheWrite = extractRate(model.prices?.cache_write_mtok);
      if (cacheRead) entry.cacheRead = cacheRead;
      if (cacheWrite) entry.cacheWrite = cacheWrite;

      result[mapped][model.id] = entry;
    }
  }
  return result;
}

function parseLiteLLM(data) {
  const result = {};
  for (const [key, entry] of Object.entries(data)) {
    if (key === 'sample_spec') continue;
    const litellmProvider = entry.litellm_provider;
    const mapped = LITELLM_PROVIDER_MAP[litellmProvider];
    if (!mapped) continue;

    const inputPerToken = entry.input_cost_per_token;
    const outputPerToken = entry.output_cost_per_token;
    if (!inputPerToken || !outputPerToken) continue;

    if (!result[mapped]) result[mapped] = {};

    const modelName = key.includes('/') ? key.split('/').pop() : key;
    const input = +(inputPerToken * 1_000_000).toFixed(4);
    const output = +(outputPerToken * 1_000_000).toFixed(4);
    const entry2 = { input, output };

    const cacheRead = entry.cache_read_input_token_cost;
    if (cacheRead) entry2.cacheRead = +(cacheRead * 1_000_000).toFixed(4);
    const cacheWrite = entry.cache_creation_input_token_cost;
    if (cacheWrite) entry2.cacheWrite = +(cacheWrite * 1_000_000).toFixed(4);

    if (!result[mapped][modelName]) {
      result[mapped][modelName] = entry2;
    }
  }
  return result;
}

function merge(genai, litellm, current) {
  const merged = JSON.parse(JSON.stringify(current));

  for (const [provider, models] of Object.entries(genai)) {
    if (!merged.providers[provider]) merged.providers[provider] = {};
    for (const [model, pricing] of Object.entries(models)) {
      merged.providers[provider][model] = pricing;
    }
  }

  for (const [provider, models] of Object.entries(litellm)) {
    if (!merged.providers[provider]) merged.providers[provider] = {};
    for (const [model, pricing] of Object.entries(models)) {
      if (!merged.providers[provider][model]) {
        merged.providers[provider][model] = pricing;
      }
    }
  }

  return merged;
}

function validate(merged, current) {
  const errors = [];
  const warnings = [];
  const MAX_INPUT = 200;
  const MAX_OUTPUT = 800;
  const CHANGE_THRESHOLD = 0.5;

  for (const [provider, models] of Object.entries(merged.providers)) {
    for (const [model, pricing] of Object.entries(models)) {
      const key = `${provider}/${model}`;

      if (pricing.input > MAX_INPUT) {
        errors.push(`${key}: input $${pricing.input}/M exceeds $${MAX_INPUT}/M cap`);
      }
      if (pricing.output > MAX_OUTPUT) {
        errors.push(`${key}: output $${pricing.output}/M exceeds $${MAX_OUTPUT}/M cap`);
      }

      const old = current.providers[provider]?.[model];
      if (old) {
        if (old.input > 0 && Math.abs(pricing.input - old.input) / old.input > CHANGE_THRESHOLD) {
          warnings.push(`${key}: input $${old.input} -> $${pricing.input} (${((pricing.input - old.input) / old.input * 100).toFixed(0)}%)`);
        }
        if (old.output > 0 && Math.abs(pricing.output - old.output) / old.output > CHANGE_THRESHOLD) {
          warnings.push(`${key}: output $${old.output} -> $${pricing.output} (${((pricing.output - old.output) / old.output * 100).toFixed(0)}%)`);
        }
      }
    }
  }

  if (warnings.length) {
    console.log(`\nwarning: ${warnings.length} price(s) changed by >50%:`);
    for (const w of warnings) console.log(`  ${w}`);
  }

  if (errors.length) {
    console.error(`\nerror: ${errors.length} price(s) exceed sanity caps:`);
    for (const e of errors) console.error(`  ${e}`);
    throw new Error('pricing validation failed: data corruption likely');
  }
}

function diffPricing(before, after) {
  const changes = { added: [], updated: [], removed: [] };

  for (const [provider, models] of Object.entries(after.providers)) {
    for (const [model, pricing] of Object.entries(models)) {
      const old = before.providers[provider]?.[model];
      if (!old) {
        changes.added.push(`${provider}/${model}: $${pricing.input}/$${pricing.output}`);
      } else if (old.input !== pricing.input || old.output !== pricing.output) {
        changes.updated.push(`${provider}/${model}: $${old.input}/$${old.output} -> $${pricing.input}/$${pricing.output}`);
      }
    }
  }

  for (const [provider, models] of Object.entries(before.providers)) {
    for (const model of Object.keys(models)) {
      if (!after.providers[provider]?.[model]) {
        changes.removed.push(`${provider}/${model}`);
      }
    }
  }

  return changes;
}

async function main() {
  const pricingPath = join(root, 'packages/shared/pricing.json');
  const current = JSON.parse(readFileSync(pricingPath, 'utf8'));

  const beforeCount = Object.values(current.providers).reduce((s, m) => s + Object.keys(m).length, 0);
  console.log(`current: ${beforeCount} models\n`);

  let genai = {};
  let litellm = {};

  try {
    const genaiData = await fetchJSON(GENAI_URL, 'genai-prices');
    genai = parseGenAIPrices(genaiData);
    const genaiCount = Object.values(genai).reduce((s, m) => s + Object.keys(m).length, 0);
    console.log(`  genai-prices: ${genaiCount} models across ${Object.keys(genai).length} providers`);
  } catch (err) {
    console.error(`  genai-prices failed: ${err.message}`);
  }

  try {
    const litellmData = await fetchJSON(LITELLM_URL, 'LiteLLM');
    litellm = parseLiteLLM(litellmData);
    const litellmCount = Object.values(litellm).reduce((s, m) => s + Object.keys(m).length, 0);
    console.log(`  LiteLLM: ${litellmCount} models across ${Object.keys(litellm).length} providers`);
  } catch (err) {
    console.error(`  LiteLLM failed: ${err.message}`);
  }

  const merged = merge(genai, litellm, current);
  merged.updatedAt = new Date().toISOString().slice(0, 10);

  validate(merged, current);

  const afterCount = Object.values(merged.providers).reduce((s, m) => s + Object.keys(m).length, 0);
  const diff = diffPricing(current, merged);

  console.log(`\nresult: ${afterCount} models (was ${beforeCount})`);
  if (diff.added.length) console.log(`  +${diff.added.length} new models`);
  if (diff.updated.length) console.log(`  ~${diff.updated.length} price changes`);
  if (diff.removed.length) console.log(`  -${diff.removed.length} removed`);

  if (diff.added.length + diff.updated.length === 0) {
    console.log('\nno changes.');
    return;
  }

  if (diff.updated.length) {
    console.log('\nprice changes:');
    for (const u of diff.updated.slice(0, 20)) console.log(`  ${u}`);
    if (diff.updated.length > 20) console.log(`  ... and ${diff.updated.length - 20} more`);
  }

  if (diff.added.length <= 30) {
    console.log('\nnew models:');
    for (const a of diff.added) console.log(`  ${a}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: not writing files.');
    return;
  }

  writeFileSync(pricingPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nwrote pricing.json (${afterCount} models)`);

  console.log('running generator...');
  execSync('node scripts/generate-pricing.mjs', { cwd: root, stdio: 'inherit' });
  console.log('\ndone. run tests to verify: pnpm turbo build && node test/contract-test.mjs');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
