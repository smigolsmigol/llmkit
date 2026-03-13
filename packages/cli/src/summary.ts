export interface RequestRecord {
  provider: 'openai' | 'anthropic';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
}

interface ModelStats {
  requests: number;
  cost: number;
  provider: string;
}

const tty = process.stderr.isTTY ?? false;
const esc = (code: string, s: string) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = (s: string) => esc('2', s);
const bold = (s: string) => esc('1', s);
const cyan = (s: string) => esc('36', s);
const magenta = (s: string) => esc('35', s);

function logo(): string {
  const m = magenta;
  return [
    `    ${m('\u2588\u2588\u2557     \u2588\u2588\u2557     \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557')}`,
    `    ${m('\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551 \u2588\u2588\u2554\u255d\u2588\u2588\u2551\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d')}`,
    `    ${m('\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2551   \u2588\u2588\u2551')}`,
    `    ${m('\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2551\u255a\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2588\u2588\u2557 \u2588\u2588\u2551   \u2588\u2588\u2551')}`,
    `    ${m('\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u255a\u2550\u255d \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551')}`,
    `    ${m('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d     \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d   \u255a\u2550\u255d')}`,
  ].join('\n');
}

function providerColor(provider: string): (s: string) => string {
  return provider === 'anthropic' ? magenta : cyan;
}

function bar(ratio: number, width = 20, color: (s: string) => string = cyan): string {
  const filled = Math.round(ratio * width);
  if (filled === 0) return dim('\u2591'.repeat(width));
  const body = Math.max(0, filled - 2);
  const tail = filled - body;
  let result = color('\u2588'.repeat(body));
  if (tail >= 1) result += color('\u2593');
  if (tail >= 2) result += color('\u2592');
  result += dim('\u2591'.repeat(width - filled));
  return result;
}

export function printSummary(records: RequestRecord[], json: boolean, elapsedMs: number): void {
  if (records.length === 0) {
    if (json) {
      process.stdout.write(`${JSON.stringify({ totalCost: 0, totalRequests: 0, byModel: {} })}\n`);
    } else {
      process.stderr.write('\nNo AI API calls detected. Make sure your code uses the default OpenAI/Anthropic base URL.\n');
    }
    return;
  }

  const byModel = new Map<string, ModelStats>();
  let totalCost = 0;

  for (const rec of records) {
    totalCost += rec.costUsd;
    const existing = byModel.get(rec.model);
    if (existing) {
      existing.requests++;
      existing.cost += rec.costUsd;
    } else {
      byModel.set(rec.model, { requests: 1, cost: rec.costUsd, provider: rec.provider });
    }
  }

  if (json) {
    const modelObj: Record<string, { requests: number; cost: number }> = {};
    for (const [model, stats] of byModel) {
      modelObj[model] = { requests: stats.requests, cost: +stats.cost.toFixed(6) };
    }
    process.stdout.write(`${JSON.stringify({
      totalCost: +totalCost.toFixed(6),
      totalRequests: records.length,
      elapsedMs,
      byModel: modelObj,
    })}\n`);
    return;
  }

  const elapsed = (elapsedMs / 1000).toFixed(1);
  const sorted = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const maxCost = sorted[0]?.[1].cost ?? 1;
  const maxName = Math.max(...sorted.map(([m]) => m.length));

  const lines = [
    '',
    logo(),
    '',
    `    ${bold(`$${totalCost.toFixed(4)}`)} ${dim('total')}  ${records.length} request${records.length === 1 ? '' : 's'}  ${dim(elapsed + 's')}  ${dim(`~$${(totalCost / (elapsedMs / 3600000)).toFixed(2)}/hr`)}`,
    '',
  ];

  for (const [model, stats] of sorted) {
    const name = model.padEnd(maxName + 2);
    const reqs = `${stats.requests} req${stats.requests === 1 ? '' : 's'}`.padEnd(8);
    const cost = `$${stats.cost.toFixed(4)}`.padStart(8);
    const ratio = maxCost > 0 ? stats.cost / maxCost : 0;
    const color = providerColor(stats.provider);
    lines.push(`    ${dim(name)}${reqs} ${cost}  ${bar(ratio, 20, color)}`);
  }

  lines.push('');
  process.stderr.write(lines.join('\n'));
}

let _runningCost = 0;
let _reqCount = 0;

export function printVerbose(rec: RequestRecord): void {
  _runningCost += rec.costUsd;
  _reqCount++;
  const cost = rec.costUsd > 0 ? providerColor(rec.provider)(`$${rec.costUsd.toFixed(4)}`) : dim('free');
  const running = dim(`[$${_runningCost.toFixed(4)} / ${_reqCount} req${_reqCount === 1 ? '' : 's'}]`);
  process.stderr.write(`  ${dim('[llmkit]')} ${rec.provider}/${rec.model} ${cost} ${dim(`(${rec.latencyMs}ms)`)} ${running}\n`);
}
