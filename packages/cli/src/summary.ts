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
    `    ${m('██╗     ██╗     ███╗   ███╗██╗  ██╗██╗████████╗')}`,
    `    ${m('██║     ██║     ████╗ ████║██║ ██╔╝██║╚══██╔══╝')}`,
    `    ${m('██║     ██║     ██╔████╔██║█████╔╝ ██║   ██║')}`,
    `    ${m('██║     ██║     ██║╚██╔╝██║██╔═██╗ ██║   ██║')}`,
    `    ${m('███████╗███████╗██║ ╚═╝ ██║██║  ██╗██║   ██║')}`,
    `    ${m('╚══════╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝')}`,
  ].join('\n');
}

function bar(ratio: number, width = 16): string {
  const filled = Math.round(ratio * width);
  return cyan('\u2588'.repeat(filled)) + dim('\u2591'.repeat(width - filled));
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
      byModel.set(rec.model, { requests: 1, cost: rec.costUsd });
    }
  }

  if (json) {
    const modelObj: Record<string, ModelStats> = {};
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
    `    ${bold(`$${totalCost.toFixed(4)}`)} ${dim('total')}  ${records.length} request${records.length === 1 ? '' : 's'}  ${dim(elapsed + 's')}`,
    '',
  ];

  for (const [model, stats] of sorted) {
    const name = model.padEnd(maxName + 2);
    const reqs = `${stats.requests} req${stats.requests === 1 ? '' : 's'}`.padEnd(8);
    const cost = `$${stats.cost.toFixed(4)}`.padStart(8);
    const ratio = maxCost > 0 ? stats.cost / maxCost : 0;
    lines.push(`    ${dim(name)}${reqs} ${cost}  ${bar(ratio)}`);
  }

  lines.push('');
  process.stderr.write(lines.join('\n'));
}

export function printVerbose(rec: RequestRecord): void {
  const cost = rec.costUsd > 0 ? cyan(`$${rec.costUsd.toFixed(4)}`) : dim('free');
  process.stderr.write(`  ${dim('[llmkit]')} ${rec.provider}/${rec.model} ${cost} ${dim(`(${rec.latencyMs}ms)`)}\n`);
}
