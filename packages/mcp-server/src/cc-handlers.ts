import { getAgentCosts, getCacheSavings, getCostForecast, getProjectCosts, getSessionCost } from './claude-code.js';
import { fail, ok } from './proxy-handlers.js';

export async function handleCCSessionCost() {
  const session = await getSessionCost();
  if (!session) return fail('No Claude Code session data found. Make sure this runs inside a Claude Code project.');

  const models = Object.entries(session.models).map(([model, d]) => ({
    model, costUsd: d.cost, inputTokens: d.input, outputTokens: d.output,
  }));

  return ok([
    'Claude Code Session Cost (API rates)',
    '\u2500'.repeat(25),
    `Session: ${session.sessionId.slice(0, 12)}...`,
    `Messages: ${session.messages}`,
    `Estimated cost: $${session.totalCost.toFixed(4)}`,
    '',
    `Tokens: ${session.totalInput.toLocaleString()} in, ${session.totalOutput.toLocaleString()} out`,
    `Cache: ${session.totalCacheRead.toLocaleString()} read, ${session.totalCacheWrite.toLocaleString()} write`,
    '',
    ...models.map(m => `${m.model}: $${m.costUsd.toFixed(4)} (${m.inputTokens.toLocaleString()} in, ${m.outputTokens.toLocaleString()} out)`),
    '',
    'Costs up to the previous message. Max subscribers pay a flat rate.',
  ].join('\n'), {
    sessionId: session.sessionId,
    messages: session.messages,
    totalCostUsd: session.totalCost,
    inputTokens: session.totalInput,
    outputTokens: session.totalOutput,
    cacheReadTokens: session.totalCacheRead,
    cacheWriteTokens: session.totalCacheWrite,
    models,
  });
}

export async function handleCCAgentCosts() {
  const agentData = await getAgentCosts();
  if (!agentData) return fail('No Claude Code session data found. Make sure this runs inside a Claude Code project.');

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
    'Claude Code Agent Cost Attribution',
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

export async function handleCCCacheSavings() {
  const savings = await getCacheSavings();
  if (!savings) return fail('No Claude Code session data found. Make sure this runs inside a Claude Code project.');

  const models = Object.entries(savings.models).map(([model, d]) => ({
    model, savedUsd: d.savedUsd, readToWriteRatio: d.readToWriteRatio, cacheReadTokens: d.cacheRead, cacheWriteTokens: d.cacheWrite,
  }));

  return ok([
    'Claude Code Cache Savings',
    '\u2500'.repeat(25),
    `Total saved: $${savings.totalSaved.toFixed(4)}`,
    `Cache efficiency: ${savings.overallReadToWrite.toFixed(1)}x reads per write`,
    '',
    ...models.map(m => `${m.model}: saved $${m.savedUsd.toFixed(4)}, ${m.readToWriteRatio.toFixed(1)}x ratio (${(m.cacheReadTokens / 1000).toFixed(0)}k reads, ${(m.cacheWriteTokens / 1000).toFixed(0)}k writes)`),
  ].join('\n'), {
    totalSavedUsd: savings.totalSaved,
    cacheEfficiency: savings.overallReadToWrite,
    models,
  });
}

export async function handleCCCostForecast() {
  const forecast = await getCostForecast();
  if (!forecast) return fail('No recent Claude Code session data found for forecasting.');

  const topModels = forecast.topModels.map(m => ({ model: m.model, monthlyCostUsd: m.monthlyCost }));

  const lines = [
    'Claude Code Cost Forecast',
    '\u2500'.repeat(25),
    `Monthly projection: $${forecast.projectedMonthly.toFixed(2)} (API rates)`,
    `Daily average: $${forecast.dailyAverage.toFixed(2)} (${forecast.daysAnalyzed} days)`,
    `Trend: ${forecast.trend}`,
    '',
    `Max ($200/mo) saves: $${forecast.savingsVsApi.toFixed(2)}/mo`,
  ];

  if (topModels.length > 0) {
    lines.push('', 'Top models:');
    for (const m of topModels) lines.push(`  ${m.model}: $${m.monthlyCostUsd.toFixed(2)}/mo`);
  }

  lines.push('', `Data freshness: ${forecast.dataFreshness}`);

  return ok(lines.join('\n'), {
    projectedMonthlyUsd: forecast.projectedMonthly,
    dailyAverageUsd: forecast.dailyAverage,
    daysAnalyzed: forecast.daysAnalyzed,
    trend: forecast.trend,
    maxSubscriptionSavingsUsd: forecast.savingsVsApi,
    topModels,
    dataFreshness: forecast.dataFreshness,
  });
}

export async function handleCCProjectCosts() {
  const projects = await getProjectCosts();
  const projectData = projects.map(proj => ({
    name: proj.project, sessionCount: proj.sessionCount, latestCostUsd: proj.latestSession.cost,
    latestMessages: proj.latestSession.messages, topModel: proj.latestSession.topModel, date: proj.latestSession.date,
  }));

  if (!projectData.length) return ok('No Claude Code projects found with session data.', { projects: projectData });

  return ok([
    'Claude Code Project Costs',
    '\u2500'.repeat(25),
    `${projectData.length} projects found`,
    '',
    ...projectData.map(p => `${p.name}: $${p.latestCostUsd.toFixed(4)} (${p.latestMessages} msgs, ${p.topModel}, ${p.date})`),
  ].join('\n'), { projects: projectData });
}
