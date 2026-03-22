import { getBudgets, getCosts, getKeys, getSessions, getUsage, loadConfig } from './client.js';

const DASHBOARD_URL = process.env.LLMKIT_DASHBOARD_URL || 'https://llmkit-dashboard.vercel.app';

export function ok(text: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text, annotations: { audience: ['user'], priority: 0.7 } }],
    structuredContent: structured,
  };
}

export function fail(msg: string) {
  return {
    content: [{ type: 'text', text: msg, annotations: { audience: ['user'], priority: 1.0 } }],
    isError: true,
  };
}

export function cents(c: number): number { return c / 100; }

export async function handleUsageStats(args: Record<string, unknown> | undefined) {
  const period = (args?.period as string) || 'month';
  const usage = await getUsage(period);
  const spend = cents(usage.totalCostCents);

  return ok([
    `LLMKit Usage (${period})`,
    '\u2500'.repeat(25),
    `Requests: ${usage.requests}`,
    `Total spend: $${spend.toFixed(2)}`,
    `Input tokens: ${usage.totalInputTokens.toLocaleString()}`,
    `Output tokens: ${usage.totalOutputTokens.toLocaleString()}`,
    `Cache read tokens: ${usage.totalCacheReadTokens.toLocaleString()}`,
    `Cache hit rate: ${usage.cacheHitRate}%`,
    '',
    'Top models:',
    ...usage.topModels.map(m => `  ${m.model}: ${m.requests} requests`),
  ].join('\n'), {
    period,
    requests: usage.requests,
    totalSpendUsd: spend,
    inputTokens: usage.totalInputTokens,
    outputTokens: usage.totalOutputTokens,
    cacheReadTokens: usage.totalCacheReadTokens,
    cacheHitRate: usage.cacheHitRate,
    topModels: usage.topModels,
  });
}

export async function handleCostQuery(args: Record<string, unknown> | undefined) {
  const groupBy = (args?.groupBy as string) || 'provider';
  const days = (args?.days as number) || 30;
  const costs = await getCosts(groupBy, days, args?.provider as string, args?.model as string);

  const breakdown = costs.breakdown.map(g => ({
    key: g.key, costUsd: cents(g.costCents), requests: g.count, inputTokens: g.inputTokens, outputTokens: g.outputTokens,
  }));

  return ok([
    `Cost breakdown by ${groupBy} (${days}d)`,
    '\u2500'.repeat(25),
    ...breakdown.map(g => `${g.key}: $${g.costUsd.toFixed(2)} (${g.requests} reqs, ${g.inputTokens.toLocaleString()} in / ${g.outputTokens.toLocaleString()} out)`),
  ].join('\n'), { groupBy, days, breakdown });
}

export async function handleListKeys() {
  const keyData = await getKeys();
  const keys = keyData.keys.map(k => ({
    name: k.name, prefix: k.key_prefix, status: k.revoked_at ? 'revoked' : 'active', created: k.created_at.slice(0, 10),
  }));

  if (!keys.length) return ok('No API keys found.', { keys });

  return ok([
    'API Keys',
    '\u2500'.repeat(25),
    ...keys.map(k => `${k.name} (${k.prefix}...) - ${k.status.toUpperCase()} - created ${k.created}`),
  ].join('\n'), { keys });
}

export async function handleBudgetStatus(args: Record<string, unknown> | undefined) {
  const budgetId = args?.budgetId as string | undefined;
  const budgetData = await getBudgets();
  if (!budgetData.budgets.length) return ok('No budgets configured.', { budgets: [] });

  const filtered = budgetId ? budgetData.budgets.filter(b => b.id === budgetId) : budgetData.budgets;
  if (!filtered.length) return fail(`Budget ${budgetId} not found.`);

  const budgets = filtered.map(b => ({ id: b.id, name: b.name, limitUsd: cents(b.limit_cents), period: b.period }));

  return ok([
    'Budget Status',
    '\u2500'.repeat(25),
    ...budgets.map(b => `${b.name}: $${b.limitUsd.toFixed(2)} limit - ${b.period}`),
  ].join('\n'), { budgets });
}

export async function handleHealth() {
  const config = loadConfig();
  if (!config) {
    return fail(`LLMKIT_API_KEY required. The llmkit_local_* tools work without a key.\nGet one at ${DASHBOARD_URL}`);
  }
  const start = Date.now();
  try {
    const res = await fetch(`${config.proxyUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const elapsed = Date.now() - start;
    const status = res.status === 200 ? 'ok' : 'degraded';
    return ok(`Proxy: ${status.toUpperCase()} (${elapsed}ms)`, { status, responseTimeMs: elapsed });
  } catch (err) {
    const elapsed = Date.now() - start;
    return ok(`Proxy: UNREACHABLE (${elapsed}ms)\n${err instanceof Error ? err.message : err}`, { status: 'unreachable', responseTimeMs: elapsed });
  }
}

export async function handleSessionSummary(args: Record<string, unknown> | undefined) {
  const sessionId = args?.sessionId as string | undefined;
  const limit = (args?.limit as number) || 10;
  const sessData = await getSessions(sessionId, limit);

  const sessions = sessData.sessions.map(s => {
    const dur = new Date(s.last).getTime() - new Date(s.first).getTime();
    return { sessionId: s.sessionId, requests: s.requests, costUsd: cents(s.costCents), durationMinutes: Math.round(dur / 60000), providers: s.providers, models: s.models };
  });

  if (!sessions.length) {
    return ok(sessionId ? `Session ${sessionId} not found.` : 'No sessions found.', { sessions });
  }

  return ok([
    'Sessions',
    '\u2500'.repeat(25),
    ...sessions.map(s => {
      const dur = s.durationMinutes < 1 ? '<1m' : `${s.durationMinutes}m`;
      return `${s.sessionId}: ${s.requests} reqs, $${s.costUsd.toFixed(2)}, ${dur}, ${s.providers.join('+')} / ${s.models.join(', ')}`;
    }),
  ].join('\n'), { sessions });
}
