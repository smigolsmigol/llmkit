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
  const lines = [
    '',
    'LLMKit Cost Summary',
    '---',
    `Total: $${totalCost.toFixed(4)} (${records.length} request${records.length === 1 ? '' : 's'}, ${elapsed}s)`,
    '',
  ];

  if (byModel.size > 1) {
    lines.push('By model:');
    const sorted = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const maxName = Math.max(...sorted.map(([m]) => m.length));
    for (const [model, stats] of sorted) {
      const name = model.padEnd(maxName + 2);
      const reqs = `${stats.requests} req${stats.requests === 1 ? '' : 's'}`.padEnd(8);
      lines.push(`  ${name}${reqs} $${stats.cost.toFixed(4)}`);
    }
    lines.push('');
  }

  process.stderr.write(lines.join('\n'));
}

export function printVerbose(rec: RequestRecord): void {
  const cost = rec.costUsd > 0 ? `$${rec.costUsd.toFixed(4)}` : 'free';
  process.stderr.write(`  [llmkit] ${rec.provider}/${rec.model} ${cost} (${rec.latencyMs}ms)\n`);
}
