import { getProjectCosts } from './claude-code.js';
import { getBudgets, getCosts, getSessions, getUsage } from './client.js';
import { syncBudgetStatus, syncCostSnapshot, syncSessionReport } from './notion.js';
import { cents, fail, ok } from './proxy-handlers.js';

export async function handleNotionCostSnapshot(args: Record<string, unknown> | undefined) {
  const period = (args?.period as string) || 'month';
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const [usage, costs] = await Promise.all([getUsage(period), getCosts('model', days)]);

  const page = await syncCostSnapshot({
    period,
    requests: usage.requests,
    spendUsd: cents(usage.totalCostCents),
    inputTokens: usage.totalInputTokens,
    outputTokens: usage.totalOutputTokens,
    cacheReadTokens: usage.totalCacheReadTokens,
    cacheHitRate: usage.cacheHitRate,
    models: costs.breakdown.map(g => ({
      model: g.key, requests: g.count, costUsd: cents(g.costCents),
    })),
  });

  const spend = cents(usage.totalCostCents);
  return ok([
    `Cost snapshot synced to Notion`,
    `Period: ${period}, Spend: $${spend.toFixed(2)}, Requests: ${usage.requests}`,
    page.url,
  ].join('\n'), { notionUrl: page.url, period, spendUsd: spend, requests: usage.requests });
}

export async function handleNotionBudgetCheck(args: Record<string, unknown> | undefined) {
  const budgetId = args?.budgetId as string | undefined;
  const [budgetData, usage] = await Promise.all([getBudgets(), getUsage('month')]);

  if (!budgetData.budgets.length) return fail('No budgets configured.');
  const filtered = budgetId ? budgetData.budgets.filter(b => b.id === budgetId) : budgetData.budgets;
  if (!filtered.length) return fail(`Budget ${budgetId} not found.`);

  // per-budget spend requires a proxy API change (requests -> api_keys -> budgets JOIN).
  // single budget gets full spend. multiple budgets get equal share (conservative estimate).
  const totalSpend = cents(usage.totalCostCents);
  const share = filtered.length > 0 ? totalSpend / filtered.length : 0;

  const entries = filtered.map(b => ({
    name: b.name, limitUsd: cents(b.limit_cents), spentUsd: share, period: b.period,
  }));

  const page = await syncBudgetStatus(entries);
  const warnings = entries.filter(b => b.limitUsd > 0 && b.spentUsd / b.limitUsd >= 0.8).length;

  return ok([
    `Budget status synced to Notion`,
    `${entries.length} budget(s), ${warnings} warning(s)`,
    page.url,
  ].join('\n'), { notionUrl: page.url, budgetCount: entries.length, warnings });
}

export async function handleNotionSessionReport(args: Record<string, unknown> | undefined) {
  const source = (args?.source as string) || 'proxy';

  if (source === 'local') {
    const projects = await getProjectCosts();
    const entries = projects.map(proj => ({
      id: proj.project,
      requests: proj.latestSession.messages,
      costUsd: proj.latestSession.cost,
      durationMin: 0,
      models: [proj.latestSession.topModel],
    }));

    const page = await syncSessionReport('Claude Code (local)', entries);
    const total = entries.reduce((acc, s) => acc + s.costUsd, 0);

    return ok([
      `Session report synced to Notion (local Claude Code data)`,
      `${entries.length} project(s), total: $${total.toFixed(4)}`,
      page.url,
    ].join('\n'), { notionUrl: page.url, source: 'local', sessionCount: entries.length, totalCostUsd: total });
  }

  const sessionId = args?.sessionId as string | undefined;
  const limit = (args?.limit as number) || 10;
  const sessData = await getSessions(sessionId, limit);

  const entries = sessData.sessions.map(s => {
    const dur = new Date(s.last).getTime() - new Date(s.first).getTime();
    return {
      id: s.sessionId,
      requests: s.requests,
      costUsd: cents(s.costCents),
      durationMin: Math.round(dur / 60000),
      models: s.models,
    };
  });

  const page = await syncSessionReport('LLMKit Proxy', entries);
  const total = entries.reduce((acc, s) => acc + s.costUsd, 0);

  return ok([
    `Session report synced to Notion`,
    `${entries.length} session(s), total: $${total.toFixed(4)}`,
    page.url,
  ].join('\n'), { notionUrl: page.url, source: 'proxy', sessionCount: entries.length, totalCostUsd: total });
}
