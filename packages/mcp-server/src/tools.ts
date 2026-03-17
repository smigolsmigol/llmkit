import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DASHBOARD_HTML, DASHBOARD_URL, RESOURCE_MIME, RESOURCE_URI } from './app.js';
import { getAgentCosts, getCacheSavings, getCostForecast, getProjectCosts, getSessionCost } from './claude-code.js';
import { getBudgets, getCosts, getKeys, getSessions, getUsage, loadConfig } from './client.js';

// all tools are read-only analytics queries
const HINTS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// --- Proxy tools (need LLMKIT_API_KEY) ---

const PROXY_TOOLS = [
  {
    name: 'llmkit_usage_stats',
    description: 'Get usage statistics (spend, requests, top models) for a time period',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Time period', default: 'month' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string' },
        requests: { type: 'number' },
        totalSpendUsd: { type: 'number' },
        inputTokens: { type: 'number' },
        outputTokens: { type: 'number' },
        cacheReadTokens: { type: 'number' },
        cacheHitRate: { type: 'number' },
        topModels: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, requests: { type: 'number' } } } },
      },
      required: ['period', 'requests', 'totalSpendUsd'],
    },
    annotations: { title: 'Usage Stats', ...HINTS },
  },
  {
    name: 'llmkit_cost_query',
    description: 'Query cost breakdown grouped by provider, model, session, or day',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupBy: { type: 'string', enum: ['provider', 'model', 'session', 'day'], description: 'How to group results' },
        days: { type: 'number', description: 'Days to look back (default 30)' },
        provider: { type: 'string', description: 'Filter by provider' },
        model: { type: 'string', description: 'Filter by model' },
      },
      required: ['groupBy'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        groupBy: { type: 'string' },
        days: { type: 'number' },
        breakdown: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, costUsd: { type: 'number' }, requests: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' } } } },
      },
      required: ['groupBy', 'days', 'breakdown'],
    },
    annotations: { title: 'Cost Breakdown', ...HINTS },
  },
  {
    name: 'llmkit_list_keys',
    description: 'List all API keys with status and creation date',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        keys: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, prefix: { type: 'string' }, status: { type: 'string' }, created: { type: 'string' } } } },
      },
      required: ['keys'],
    },
    annotations: { title: 'API Keys', ...HINTS },
  },
  {
    name: 'llmkit_budget_status',
    description: 'Check budget limits and remaining balance',
    inputSchema: {
      type: 'object' as const,
      properties: {
        budgetId: { type: 'string', description: 'Specific budget ID, or omit for all' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        budgets: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, limitUsd: { type: 'number' }, period: { type: 'string' } } } },
      },
      required: ['budgets'],
    },
    annotations: { title: 'Budget Status', ...HINTS },
  },
  {
    name: 'llmkit_health',
    description: 'Check proxy health and response time',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded', 'unreachable'] },
        responseTimeMs: { type: 'number' },
      },
      required: ['status'],
    },
    annotations: { title: 'Health Check', ...HINTS },
  },
  {
    name: 'llmkit_session_summary',
    description: 'Get recent proxy sessions with cost, duration, and models used',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Specific session ID' },
        limit: { type: 'number', description: 'Number of sessions (default 10)' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessions: { type: 'array', items: { type: 'object', properties: { sessionId: { type: 'string' }, requests: { type: 'number' }, costUsd: { type: 'number' }, durationMinutes: { type: 'number' }, providers: { type: 'array', items: { type: 'string' } }, models: { type: 'array', items: { type: 'string' } } } } },
      },
      required: ['sessions'],
    },
    annotations: { title: 'Session Summary', ...HINTS },
  },
];

// --- Claude Code tools (local, no API key) ---

const CC_TOOLS = [
  {
    name: 'llmkit_cc_session_cost',
    description: 'Estimated cost of the current Claude Code session at API rates. Reads local token data.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        messages: { type: 'number' },
        totalCostUsd: { type: 'number' },
        inputTokens: { type: 'number' },
        outputTokens: { type: 'number' },
        cacheReadTokens: { type: 'number' },
        cacheWriteTokens: { type: 'number' },
        models: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, costUsd: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' } } } },
      },
      required: ['sessionId', 'messages', 'totalCostUsd'],
    },
    annotations: { title: 'Session Cost', ...HINTS },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  {
    name: 'llmkit_cc_agent_costs',
    description: 'Cost attribution for subagents in the current session. Shows which agents cost the most.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        totalCostUsd: { type: 'number' },
        mainConversationCostUsd: { type: 'number' },
        subagentsTotalCostUsd: { type: 'number' },
        agentCount: { type: 'number' },
        byType: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, count: { type: 'number' }, costUsd: { type: 'number' }, tokens: { type: 'number' } } } },
        topAgents: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, id: { type: 'string' }, costUsd: { type: 'number' }, messages: { type: 'number' }, models: { type: 'array', items: { type: 'string' } } } } },
      },
      required: ['sessionId', 'totalCostUsd', 'agentCount'],
    },
    annotations: { title: 'Agent Costs', ...HINTS },
  },
  {
    name: 'llmkit_cc_cache_savings',
    description: 'How much prompt caching saved in the current session vs full-price tokens.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        totalSavedUsd: { type: 'number' },
        cacheEfficiency: { type: 'number' },
        models: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, savedUsd: { type: 'number' }, readToWriteRatio: { type: 'number' }, cacheReadTokens: { type: 'number' }, cacheWriteTokens: { type: 'number' } } } },
      },
      required: ['totalSavedUsd', 'cacheEfficiency'],
    },
    annotations: { title: 'Cache Savings', ...HINTS },
  },
  {
    name: 'llmkit_cc_cost_forecast',
    description: 'Monthly cost projection based on recent sessions. Compares to Max subscription.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        projectedMonthlyUsd: { type: 'number' },
        dailyAverageUsd: { type: 'number' },
        daysAnalyzed: { type: 'number' },
        trend: { type: 'string', enum: ['increasing', 'decreasing', 'stable'] },
        maxSubscriptionSavingsUsd: { type: 'number' },
        topModels: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, monthlyCostUsd: { type: 'number' } } } },
        dataFreshness: { type: 'string' },
      },
      required: ['projectedMonthlyUsd', 'dailyAverageUsd', 'daysAnalyzed', 'trend'],
    },
    annotations: { title: 'Cost Forecast', ...HINTS },
  },
  {
    name: 'llmkit_cc_project_costs',
    description: 'Cost breakdown across all Claude Code projects, ranked by spend.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        projects: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sessionCount: { type: 'number' }, latestCostUsd: { type: 'number' }, latestMessages: { type: 'number' }, topModel: { type: 'string' }, date: { type: 'string' } } } },
      },
      required: ['projects'],
    },
    annotations: { title: 'Project Costs', ...HINTS },
  },
];

// --- Response helpers ---

function ok(text: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text, annotations: { audience: ['user' as const], priority: 0.7 } }],
    structuredContent: structured,
  };
}

function fail(msg: string) {
  return {
    content: [{ type: 'text' as const, text: msg, annotations: { audience: ['user' as const], priority: 1.0 } }],
    isError: true,
  };
}

// --- Registration ---

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const clientInfo = server.getClientVersion();
    const name = clientInfo?.name?.toLowerCase() ?? '';
    // cc_ tools need local ~/.claude/ data - hide from desktop-only clients
    const isDesktop = name.includes('desktop') && !name.includes('code');
    const showCc = !isDesktop;
    return { tools: showCc ? [...PROXY_TOOLS, ...CC_TOOLS] : PROXY_TOOLS };
  });

  // MCP App resource: serve the dashboard HTML
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: RESOURCE_URI, name: 'Session Cost Dashboard', mimeType: RESOURCE_MIME }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === RESOURCE_URI) {
      const html = DASHBOARD_HTML.replace('__DASHBOARD_URL__', DASHBOARD_URL);
      return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME, text: html }] };
    }
    throw new Error(`Unknown resource: ${request.params.uri}`);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'llmkit_usage_stats': return await handleUsageStats(args);
        case 'llmkit_cost_query': return await handleCostQuery(args);
        case 'llmkit_list_keys': return await handleListKeys();
        case 'llmkit_budget_status': return await handleBudgetStatus(args);
        case 'llmkit_health': return await handleHealth();
        case 'llmkit_session_summary': return await handleSessionSummary(args);
        case 'llmkit_cc_session_cost': return await handleCCSessionCost();
        case 'llmkit_cc_agent_costs': return await handleCCAgentCosts();
        case 'llmkit_cc_cache_savings': return await handleCCCacheSavings();
        case 'llmkit_cc_cost_forecast': return await handleCCCostForecast();
        case 'llmkit_cc_project_costs': return await handleCCProjectCosts();
        default: return fail(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}

// --- Proxy tool handlers ---

function cents(c: number): number { return c / 100; }

async function handleUsageStats(args: Record<string, unknown> | undefined) {
  const period = (args?.period as string) || 'month';
  const data = await getUsage(period);
  const spend = cents(data.totalCostCents);

  return ok([
    `LLMKit Usage (${period})`,
    '─────────────────────────',
    `Requests: ${data.requests}`,
    `Total spend: $${spend.toFixed(2)}`,
    `Input tokens: ${data.totalInputTokens.toLocaleString()}`,
    `Output tokens: ${data.totalOutputTokens.toLocaleString()}`,
    `Cache read tokens: ${data.totalCacheReadTokens.toLocaleString()}`,
    `Cache hit rate: ${data.cacheHitRate}%`,
    '',
    'Top models:',
    ...data.topModels.map(m => `  ${m.model}: ${m.requests} requests`),
  ].join('\n'), {
    period,
    requests: data.requests,
    totalSpendUsd: spend,
    inputTokens: data.totalInputTokens,
    outputTokens: data.totalOutputTokens,
    cacheReadTokens: data.totalCacheReadTokens,
    cacheHitRate: data.cacheHitRate,
    topModels: data.topModels,
  });
}

async function handleCostQuery(args: Record<string, unknown> | undefined) {
  const groupBy = (args?.groupBy as string) || 'provider';
  const days = (args?.days as number) || 30;
  const data = await getCosts(groupBy, days, args?.provider as string, args?.model as string);

  const breakdown = data.breakdown.map(g => ({
    key: g.key, costUsd: cents(g.costCents), requests: g.count, inputTokens: g.inputTokens, outputTokens: g.outputTokens,
  }));

  return ok([
    `Cost breakdown by ${groupBy} (${days}d)`,
    '─────────────────────────',
    ...breakdown.map(g => `${g.key}: $${g.costUsd.toFixed(2)} (${g.requests} reqs, ${g.inputTokens.toLocaleString()} in / ${g.outputTokens.toLocaleString()} out)`),
  ].join('\n'), { groupBy, days, breakdown });
}

async function handleListKeys() {
  const data = await getKeys();
  const keys = data.keys.map(k => ({
    name: k.name, prefix: k.key_prefix, status: k.revoked_at ? 'revoked' : 'active', created: k.created_at.slice(0, 10),
  }));

  if (!keys.length) return ok('No API keys found.', { keys });

  return ok([
    'API Keys',
    '─────────────────────────',
    ...keys.map(k => `${k.name} (${k.prefix}...) - ${k.status.toUpperCase()} - created ${k.created}`),
  ].join('\n'), { keys });
}

async function handleBudgetStatus(args: Record<string, unknown> | undefined) {
  const budgetId = args?.budgetId as string | undefined;
  const data = await getBudgets();
  if (!data.budgets.length) return ok('No budgets configured.', { budgets: [] });

  const filtered = budgetId ? data.budgets.filter(b => b.id === budgetId) : data.budgets;
  if (!filtered.length) return fail(`Budget ${budgetId} not found.`);

  const budgets = filtered.map(b => ({ id: b.id, name: b.name, limitUsd: cents(b.limit_cents), period: b.period }));

  return ok([
    'Budget Status',
    '─────────────────────────',
    ...budgets.map(b => `${b.name}: $${b.limitUsd.toFixed(2)} limit - ${b.period}`),
  ].join('\n'), { budgets });
}

async function handleHealth() {
  const config = loadConfig();
  if (!config) {
    return fail('LLMKIT_API_KEY required. The llmkit_cc_* tools work without a key.\nGet one at https://dashboard-two-zeta-54.vercel.app');
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

async function handleSessionSummary(args: Record<string, unknown> | undefined) {
  const sessionId = args?.sessionId as string | undefined;
  const limit = (args?.limit as number) || 10;
  const data = await getSessions(sessionId, limit);

  const sessions = data.sessions.map(s => {
    const dur = new Date(s.last).getTime() - new Date(s.first).getTime();
    return { sessionId: s.sessionId, requests: s.requests, costUsd: cents(s.costCents), durationMinutes: Math.round(dur / 60000), providers: s.providers, models: s.models };
  });

  if (!sessions.length) {
    return ok(sessionId ? `Session ${sessionId} not found.` : 'No sessions found.', { sessions });
  }

  return ok([
    'Sessions',
    '─────────────────────────',
    ...sessions.map(s => {
      const dur = s.durationMinutes < 1 ? '<1m' : `${s.durationMinutes}m`;
      return `${s.sessionId}: ${s.requests} reqs, $${s.costUsd.toFixed(2)}, ${dur}, ${s.providers.join('+')} / ${s.models.join(', ')}`;
    }),
  ].join('\n'), { sessions });
}

// --- Claude Code tool handlers ---

async function handleCCSessionCost() {
  const session = await getSessionCost();
  if (!session) return fail('No Claude Code session data found. Make sure this runs inside a Claude Code project.');

  const models = Object.entries(session.models).map(([model, d]) => ({
    model, costUsd: d.cost, inputTokens: d.input, outputTokens: d.output,
  }));

  return ok([
    'Claude Code Session Cost (API rates)',
    '─────────────────────────',
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

async function handleCCAgentCosts() {
  const data = await getAgentCosts();
  if (!data) return fail('No Claude Code session data found. Make sure this runs inside a Claude Code project.');

  const { session, agents, mainConversationCost } = data;
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
    '─────────────────────────',
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

async function handleCCCacheSavings() {
  const data = await getCacheSavings();
  if (!data) return fail('No Claude Code session data found. Make sure this runs inside a Claude Code project.');

  const models = Object.entries(data.models).map(([model, d]) => ({
    model, savedUsd: d.savedUsd, readToWriteRatio: d.readToWriteRatio, cacheReadTokens: d.cacheRead, cacheWriteTokens: d.cacheWrite,
  }));

  return ok([
    'Claude Code Cache Savings',
    '─────────────────────────',
    `Total saved: $${data.totalSaved.toFixed(4)}`,
    `Cache efficiency: ${data.overallReadToWrite.toFixed(1)}x reads per write`,
    '',
    ...models.map(m => `${m.model}: saved $${m.savedUsd.toFixed(4)}, ${m.readToWriteRatio.toFixed(1)}x ratio (${(m.cacheReadTokens / 1000).toFixed(0)}k reads, ${(m.cacheWriteTokens / 1000).toFixed(0)}k writes)`),
  ].join('\n'), {
    totalSavedUsd: data.totalSaved,
    cacheEfficiency: data.overallReadToWrite,
    models,
  });
}

async function handleCCCostForecast() {
  const data = await getCostForecast();
  if (!data) return fail('No recent Claude Code session data found for forecasting.');

  const topModels = data.topModels.map(m => ({ model: m.model, monthlyCostUsd: m.monthlyCost }));

  const lines = [
    'Claude Code Cost Forecast',
    '─────────────────────────',
    `Monthly projection: $${data.projectedMonthly.toFixed(2)} (API rates)`,
    `Daily average: $${data.dailyAverage.toFixed(2)} (${data.daysAnalyzed} days)`,
    `Trend: ${data.trend}`,
    '',
    `Max ($200/mo) saves: $${data.savingsVsApi.toFixed(2)}/mo`,
  ];

  if (topModels.length > 0) {
    lines.push('', 'Top models:');
    for (const m of topModels) lines.push(`  ${m.model}: $${m.monthlyCostUsd.toFixed(2)}/mo`);
  }

  lines.push('', `Data freshness: ${data.dataFreshness}`);

  return ok(lines.join('\n'), {
    projectedMonthlyUsd: data.projectedMonthly,
    dailyAverageUsd: data.dailyAverage,
    daysAnalyzed: data.daysAnalyzed,
    trend: data.trend,
    maxSubscriptionSavingsUsd: data.savingsVsApi,
    topModels,
    dataFreshness: data.dataFreshness,
  });
}

async function handleCCProjectCosts() {
  const projects = await getProjectCosts();
  const projectData = projects.map(p => ({
    name: p.project, sessionCount: p.sessionCount, latestCostUsd: p.latestSession.cost,
    latestMessages: p.latestSession.messages, topModel: p.latestSession.topModel, date: p.latestSession.date,
  }));

  if (!projectData.length) return ok('No Claude Code projects found with session data.', { projects: projectData });

  return ok([
    'Claude Code Project Costs',
    '─────────────────────────',
    `${projectData.length} projects found`,
    '',
    ...projectData.map(p => `${p.name}: $${p.latestCostUsd.toFixed(4)} (${p.latestMessages} msgs, ${p.topModel}, ${p.date})`),
  ].join('\n'), { projects: projectData });
}
