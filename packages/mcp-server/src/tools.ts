import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getBudgets, getCosts, getKeys, getSessions, getUsage, loadConfig } from './client.js';

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
