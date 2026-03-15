import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getBudgets, getCosts, getKeys, getSessions, getUsage, loadConfig } from './client.js';
import { getSessionCost, getAgentCosts } from './claude-code.js';

const TOOLS = [
  {
    name: 'llmkit_usage_stats',
    description: 'Get usage statistics for your LLMKit account (spend, requests, top models)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: 'Time period to query',
          default: 'month',
        },
      },
    },
  },
  {
    name: 'llmkit_cost_query',
    description: 'Query cost breakdown by provider, model, session, or day',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupBy: {
          type: 'string',
          enum: ['provider', 'model', 'session', 'day'],
          description: 'How to group the results',
        },
        days: { type: 'number', description: 'Number of days to look back (default 30)' },
        provider: { type: 'string', description: 'Filter by provider name' },
        model: { type: 'string', description: 'Filter by model name' },
      },
      required: ['groupBy'],
    },
  },
  {
    name: 'llmkit_list_keys',
    description: 'List all API keys for the account',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'llmkit_budget_status',
    description: 'Check budget usage and remaining balance',
    inputSchema: {
      type: 'object' as const,
      properties: {
        budgetId: { type: 'string', description: 'Specific budget ID, or omit for all budgets' },
      },
    },
  },
  {
    name: 'llmkit_health',
    description: 'Check LLMKit proxy health',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'llmkit_session_summary',
    description: 'Get summary of recent sessions or a specific session',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Specific session ID to query' },
        limit: { type: 'number', description: 'Number of recent sessions (default 10)' },
      },
    },
  },
  {
    name: 'llmkit_cc_session_cost',
    description: 'Estimated cost of the current Claude Code session. Reads local token usage data and applies API pricing. Works for both Max subscribers (shows equivalent API cost) and API key users.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'llmkit_cc_agent_costs',
    description: 'Cost attribution for subagents and agent teams in the current Claude Code session. Shows which agents (Explore, Plan, general-purpose) consumed the most tokens and their estimated costs.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

async function handleUsageStats(args: Record<string, unknown> | undefined) {
  const period = (args?.period as string) || 'month';
  const data = await getUsage(period);

  const topModels = data.topModels.map(m => `  ${m.model}: ${m.requests} requests`);

  return text([
    `LLMKit Usage (${period})`,
    `─────────────────────────`,
    `Requests: ${data.requests}`,
    `Total spend: $${(data.totalCostCents / 100).toFixed(2)}`,
    `Input tokens: ${data.totalInputTokens.toLocaleString()}`,
    `Output tokens: ${data.totalOutputTokens.toLocaleString()}`,
    `Cache read tokens: ${data.totalCacheReadTokens.toLocaleString()}`,
    `Cache hit rate: ${data.cacheHitRate}%`,
    ``,
    `Top models:`,
    ...topModels,
  ].join('\n'));
}

async function handleCostQuery(args: Record<string, unknown> | undefined) {
  const groupBy = (args?.groupBy as string) || 'provider';
  const days = (args?.days as number) || 30;
  const data = await getCosts(groupBy, days, args?.provider as string, args?.model as string);

  const lines = [`Cost breakdown by ${groupBy} (${days}d)`, `─────────────────────────`];
  for (const g of data.breakdown) {
    lines.push(`${g.key}: $${(g.costCents / 100).toFixed(2)} (${g.count} reqs, ${g.inputTokens.toLocaleString()} in / ${g.outputTokens.toLocaleString()} out)`);
  }

  return text(lines.join('\n'));
}

async function handleListKeys() {
  const data = await getKeys();
  if (!data.keys.length) return text('No API keys found.');

  const lines = ['API Keys', '─────────────────────────'];
  for (const k of data.keys) {
    const status = k.revoked_at ? 'REVOKED' : 'ACTIVE';
    const created = k.created_at.slice(0, 10);
    lines.push(`${k.name} (${k.key_prefix}...) - ${status} - created ${created}`);
  }
  return text(lines.join('\n'));
}

async function handleBudgetStatus(args: Record<string, unknown> | undefined) {
  const budgetId = args?.budgetId as string | undefined;
  const data = await getBudgets();
  if (!data.budgets.length) return text('No budgets configured.');

  const filtered = budgetId ? data.budgets.filter(b => b.id === budgetId) : data.budgets;
  if (!filtered.length) return text(`Budget ${budgetId} not found.`);

  const lines = ['Budget Status', '─────────────────────────'];
  for (const b of filtered) {
    lines.push(`${b.name}: $${(b.limit_cents / 100).toFixed(2)} limit - ${b.period}`);
  }
  return text(lines.join('\n'));
}

async function handleHealth() {
  const config = loadConfig();
  try {
    const res = await fetch(`${config.proxyUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    return text(`Proxy health: ${res.status === 200 ? 'OK' : 'DEGRADED'}\nResponse: ${body}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return text(`Proxy health: UNREACHABLE\nError: ${msg}`);
  }
}

async function handleSessionSummary(args: Record<string, unknown> | undefined) {
  const sessionId = args?.sessionId as string | undefined;
  const limit = (args?.limit as number) || 10;
  const data = await getSessions(sessionId, limit);

  if (!data.sessions.length) {
    return text(sessionId ? `Session ${sessionId} not found.` : 'No sessions found.');
  }

  const lines = ['Sessions', '─────────────────────────'];
  for (const s of data.sessions) {
    const duration = new Date(s.last).getTime() - new Date(s.first).getTime();
    const durStr = duration < 60000 ? `${Math.round(duration / 1000)}s` : `${Math.round(duration / 60000)}m`;
    lines.push(`${s.sessionId}: ${s.requests} reqs, $${(s.costCents / 100).toFixed(2)}, ${durStr}, ${s.providers.join('+')} / ${s.models.join(', ')}`);
  }
  return text(lines.join('\n'));
}

async function handleCCSessionCost() {
  const session = await getSessionCost();
  if (!session) {
    return text('Could not find Claude Code session data. Make sure this is running inside a Claude Code project.');
  }

  const lines = [
    'Claude Code Session Cost (estimated at API rates)',
    '─────────────────────────',
    `Session: ${session.sessionId.slice(0, 12)}...`,
    `Messages: ${session.messages}`,
    `Estimated cost: $${session.totalCost.toFixed(4)}`,
    '',
    `Tokens: ${session.totalInput.toLocaleString()} in, ${session.totalOutput.toLocaleString()} out`,
    `Cache: ${session.totalCacheRead.toLocaleString()} read, ${session.totalCacheWrite.toLocaleString()} write`,
    '',
  ];

  for (const [model, data] of Object.entries(session.models)) {
    lines.push(`${model}: $${data.cost.toFixed(4)} (${data.input.toLocaleString()} in, ${data.output.toLocaleString()} out)`);
  }

  lines.push('', 'Note: cost shown is up to the previous message. Max subscribers pay a flat rate, this shows equivalent API pricing.');
  return text(lines.join('\n'));
}

async function handleCCAgentCosts() {
  const result = await getAgentCosts();
  if (!result) {
    return text('Could not find Claude Code session data. Make sure this is running inside a Claude Code project.');
  }

  const { session, agents, mainConversationCost } = result;
  const agentTotal = agents.reduce((s, a) => s + a.totalCost, 0);

  const lines = [
    'Claude Code Agent Cost Attribution',
    '─────────────────────────',
    `Session: ${session.sessionId.slice(0, 12)}...`,
    `Total session cost: $${session.totalCost.toFixed(4)}`,
    '',
    `Main conversation: $${mainConversationCost.toFixed(4)}`,
    `Subagents total: $${agentTotal.toFixed(4)} (${agents.length} agents)`,
    '',
  ];

  if (agents.length === 0) {
    lines.push('No subagents in this session.');
  } else {
    // group by agent type
    const byType = new Map<string, { count: number; cost: number; tokens: number }>();
    for (const a of agents) {
      const existing = byType.get(a.agentType) ?? { count: 0, cost: 0, tokens: 0 };
      existing.count++;
      existing.cost += a.totalCost;
      existing.tokens += a.totalInput + a.totalOutput;
      byType.set(a.agentType, existing);
    }

    lines.push('By agent type:');
    for (const [type, data] of byType) {
      lines.push(`  ${type}: ${data.count} agents, $${data.cost.toFixed(4)}, ${data.tokens.toLocaleString()} tokens`);
    }

    lines.push('', 'Top 5 most expensive agents:');
    for (const a of agents.slice(0, 5)) {
      lines.push(`  ${a.agentType} (${a.agentId}): $${a.totalCost.toFixed(4)}, ${a.messages} msgs, ${a.models.join('+')}`);
    }
  }

  lines.push('', 'Note: estimated at API rates. Max subscribers pay a flat rate.');
  return text(lines.join('\n'));
}
