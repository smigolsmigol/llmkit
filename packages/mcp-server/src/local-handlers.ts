// Unified local cost handlers. Auto-detect installed AI tools, aggregate data.
// Replaces cc-handlers.ts with universal adapter-based approach.

import { claudeCodeAdapter } from './adapters/claude-code.js';
import { clineAdapter } from './adapters/cline.js';
import type { LocalAdapter, LocalProjectSummary } from './adapters/types.js';
import { getAgentCosts, getLegacyUsage } from './claude-code.js';
import { fail, ok } from './proxy-handlers.js';

const ADAPTERS: LocalAdapter[] = [claudeCodeAdapter, clineAdapter];

async function detectAdapters(): Promise<LocalAdapter[]> {
  const results = await Promise.allSettled(
    ADAPTERS.map(async a => ({ adapter: a, available: await a.detect() })),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ adapter: LocalAdapter; available: boolean }> =>
      r.status === 'fulfilled' && r.value.available)
    .map(r => r.value.adapter);
}

export async function handleLocalSession() {
  const active = await detectAdapters();
  if (active.length === 0) return fail('No AI coding tool data found. Works with Claude Code and Cline.');

  const sessions = await Promise.allSettled(active.map(a => a.getCurrentSession()));
  const found = sessions
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(s => s !== null);

  if (found.length === 0) return fail('No active session data found.');

  const total = found.reduce((s, x) => s + x.cost, 0);
  const lines = [
    'Local Session Costs',
    '\u2500'.repeat(25),
    `${found.length} source(s), $${total.toFixed(4)} total`,
    '',
  ];

  for (const s of found) {
    const tokens = s.inputTokens + s.outputTokens;
    lines.push(`${s.source}: $${s.cost.toFixed(4)} (${s.messages} msgs, ${(tokens / 1000).toFixed(0)}k tokens, ${s.topModel})`);
  }

  return ok(lines.join('\n'), {
    sessions: found,
    totalCostUsd: total,
    sourceCount: found.length,
  });
}

export async function handleLocalProjects() {
  const active = await detectAdapters();
  if (active.length === 0) return fail('No AI coding tool data found. Works with Claude Code and Cline.');

  const allProjects: LocalProjectSummary[] = [];
  const results = await Promise.allSettled(active.map(a => a.getProjects()));
  for (const r of results) {
    if (r.status === 'fulfilled') allProjects.push(...r.value);
  }

  if (allProjects.length === 0) return fail('No project data found.');

  allProjects.sort((a, b) => b.totalCost - a.totalCost);
  const totalCost = allProjects.reduce((s, p) => s + p.totalCost, 0);

  const lines = [
    'Project Costs (cumulative, all tools)',
    '\u2500'.repeat(25),
    `${allProjects.length} projects, $${totalCost.toFixed(2)} total`,
    '',
  ];

  for (const p of allProjects) {
    const tokens = p.totalInputTokens + p.totalOutputTokens;
    lines.push(`${p.project}: $${p.totalCost.toFixed(2)} across ${p.sessionCount} sessions (${p.totalMessages} msgs, ${(tokens / 1000).toFixed(0)}k tokens) [${p.source}]`);
  }

  return ok(lines.join('\n'), { projects: allProjects, totalCostUsd: totalCost });
}

export async function handleLocalCache() {
  const active = await detectAdapters();
  if (active.length === 0) return fail('No AI coding tool data found. Works with Claude Code and Cline.');

  const results = await Promise.allSettled(active.map(a => a.getCacheSavings()));
  const savings = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(s => s !== null);

  if (savings.length === 0) return fail('No cache data found.');

  const totalSaved = savings.reduce((s, x) => s + x.totalSaved, 0);
  const lines = [
    'Cache Savings (all tools)',
    '\u2500'.repeat(25),
    `Total saved: $${totalSaved.toFixed(4)}`,
    '',
  ];

  for (const s of savings) {
    lines.push(`${s.source}: saved $${s.totalSaved.toFixed(4)}, ${s.readToWriteRatio.toFixed(1)}x read/write ratio`);
    for (const m of s.models) {
      lines.push(`  ${m.model}: saved $${m.saved.toFixed(4)}, ${m.ratio.toFixed(1)}x ratio (${(m.cacheRead / 1000).toFixed(0)}k reads, ${(m.cacheWrite / 1000).toFixed(0)}k writes)`);
    }
  }

  return ok(lines.join('\n'), { savings, totalSavedUsd: totalSaved });
}

export async function handleLocalForecast() {
  const active = await detectAdapters();
  if (active.length === 0) return fail('No AI coding tool data found. Works with Claude Code and Cline.');

  const allProjects: LocalProjectSummary[] = [];
  const results = await Promise.allSettled(active.map(a => a.getProjects()));
  for (const r of results) {
    if (r.status === 'fulfilled') allProjects.push(...r.value);
  }

  if (allProjects.length === 0) return fail('No project data for forecasting.');

  const totalCost = allProjects.reduce((s, p) => s + p.totalCost, 0);
  const totalSessions = allProjects.reduce((s, p) => s + p.sessionCount, 0);

  // rough projection: assume data spans ~30 days, project to monthly
  const dailyAvg = totalCost / 30;
  const monthlyProjection = dailyAvg * 30;
  const maxSavings = monthlyProjection - 200; // vs $200/mo Max subscription

  // legacy usage from old Claude Code versions
  const legacy = await getLegacyUsage();

  const lines = [
    'Cost Forecast (all tools)',
    '\u2500'.repeat(25),
    `Monthly projection: $${monthlyProjection.toFixed(2)} (API rates)`,
    `Daily average: $${dailyAvg.toFixed(2)}`,
    `Current period: $${totalCost.toFixed(2)} across ${totalSessions} sessions`,
    '',
    `Max ($200/mo) ${maxSavings > 0 ? `saves: $${maxSavings.toFixed(2)}/mo` : 'costs more than API rates'}`,
  ];

  if (legacy.totalCost > 0) {
    lines.push('', 'Historical usage (old Claude Code, no per-project breakdown):');
    for (const m of legacy.months) lines.push(`  ${m.month}: $${m.cost.toFixed(2)}`);
    lines.push(`  Total: $${legacy.totalCost.toFixed(2)}`);
  }

  const allTimeCost = totalCost + legacy.totalCost;

  return ok(lines.join('\n'), {
    projectedMonthlyUsd: monthlyProjection,
    dailyAverageUsd: dailyAvg,
    totalTrackedUsd: totalCost,
    totalSessions,
    legacyUsageUsd: legacy.totalCost,
    allTimeCostUsd: allTimeCost,
    maxSubscriptionSavingsUsd: maxSavings > 0 ? maxSavings : 0,
  });
}

export async function handleLocalAgents() {
  // Agent attribution is Claude Code specific (subagent JSONL files).
  // Other tools don't have subagent concepts (yet).
  const agentData = await getAgentCosts();
  if (!agentData) return fail('No agent data found. Agent attribution requires Claude Code with subagents.');

  const { session, agents, mainConversationCost } = agentData;
  const agentTotal = agents.reduce((s, a) => s + a.totalCost, 0);

  const byType: { type: string; count: number; costUsd: number; tokens: number }[] = [];
  if (agents.length > 0) {
    const typeMap = new Map<string, { count: number; cost: number; tokens: number }>();
    for (const a of agents) {
      const e = typeMap.get(a.agentType) ?? { count: 0, cost: 0, tokens: 0 };
      e.count++;
      e.cost += a.totalCost;
      e.tokens += a.totalInput + a.totalOutput;
      typeMap.set(a.agentType, e);
    }
    for (const [type, d] of typeMap) {
      byType.push({ type, count: d.count, costUsd: d.cost, tokens: d.tokens });
    }
  }

  const topAgents = agents.slice(0, 5).map(a => ({
    type: a.agentType, id: a.agentId, costUsd: a.totalCost, messages: a.messages, models: a.models,
  }));

  const lines = [
    'Agent Cost Attribution',
    '\u2500'.repeat(25),
    `Session: ${session.sessionId.slice(0, 12)}...`,
    `Total: $${session.totalCost.toFixed(4)}`,
    '',
    `Main conversation: $${mainConversationCost.toFixed(4)}`,
    `Subagents: $${agentTotal.toFixed(4)} (${agents.length} agents)`,
  ];

  if (byType.length > 0) {
    lines.push('', 'By type:');
    for (const t of byType) lines.push(`  ${t.type}: ${t.count}x, $${t.costUsd.toFixed(4)}, ${t.tokens.toLocaleString()} tokens`);
    lines.push('', 'Top agents:');
    for (const a of topAgents) lines.push(`  ${a.type} (${a.id}): $${a.costUsd.toFixed(4)}, ${a.messages} msgs`);
  }

  return ok(lines.join('\n'), {
    sessionId: session.sessionId,
    totalCostUsd: session.totalCost,
    mainConversationCostUsd: mainConversationCost,
    subagentsTotalCostUsd: agentTotal,
    agentCount: agents.length,
    byType,
    topAgents,
  });
}
