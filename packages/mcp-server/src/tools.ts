import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getRequests, getApiKeys, getBudgets, loadConfig } from './client.js';

// tool definitions - this is what Claude Code sees when it inspects available tools
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
  // when Claude Code asks "what tools do you have?", return the list above
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  // when Claude Code calls a tool, route to the right handler
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

// ---- Tool handlers ----

async function handleUsageStats(args: Record<string, unknown> | undefined) {
  const period = (args?.period as string) || 'month';
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;

  const requests = await getRequests(days);

  let totalCostCents = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  const modelCounts = new Map<string, number>();

  for (const req of requests) {
    totalCostCents += Number(req.cost_cents);
    totalInputTokens += req.input_tokens;
    totalOutputTokens += req.output_tokens;
    totalCacheReadTokens += req.cache_read_tokens;
    modelCounts.set(req.model, (modelCounts.get(req.model) || 0) + 1);
  }

  const topModels = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([model, count]) => `  ${model}: ${count} requests`);

  const cacheHitRate = totalInputTokens > 0
    ? ((totalCacheReadTokens / (totalCacheReadTokens + totalInputTokens)) * 100).toFixed(1)
    : '0.0';

  return text([
    `LLMKit Usage (${period})`,
    `─────────────────────────`,
    `Requests: ${requests.length}`,
    `Total spend: $${(totalCostCents / 100).toFixed(2)}`,
    `Input tokens: ${totalInputTokens.toLocaleString()}`,
    `Output tokens: ${totalOutputTokens.toLocaleString()}`,
    `Cache read tokens: ${totalCacheReadTokens.toLocaleString()}`,
    `Cache hit rate: ${cacheHitRate}%`,
    ``,
    `Top models:`,
    ...topModels,
  ].join('\n'));
}

async function handleCostQuery(args: Record<string, unknown> | undefined) {
  const groupBy = (args?.groupBy as string) || 'provider';
  const days = (args?.days as number) || 30;
  const filterProvider = args?.provider as string | undefined;
  const filterModel = args?.model as string | undefined;

  let requests = await getRequests(days);

  if (filterProvider) requests = requests.filter((r) => r.provider === filterProvider);
  if (filterModel) requests = requests.filter((r) => r.model === filterModel);

  const groups = new Map<string, { count: number; costCents: number; inputTokens: number; outputTokens: number }>();

  for (const req of requests) {
    let key: string;
    switch (groupBy) {
      case 'provider': key = req.provider; break;
      case 'model': key = req.model; break;
      case 'session': key = req.session_id || 'no-session'; break;
      case 'day': key = req.created_at.slice(0, 10); break;
      default: key = req.provider;
    }

    const g = groups.get(key) || { count: 0, costCents: 0, inputTokens: 0, outputTokens: 0 };
    g.count++;
    g.costCents += Number(req.cost_cents);
    g.inputTokens += req.input_tokens;
    g.outputTokens += req.output_tokens;
    groups.set(key, g);
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].costCents - a[1].costCents);

  const lines = [`Cost breakdown by ${groupBy} (${days}d)`, `─────────────────────────`];
  for (const [key, g] of sorted) {
    lines.push(`${key}: $${(g.costCents / 100).toFixed(2)} (${g.count} reqs, ${g.inputTokens.toLocaleString()} in / ${g.outputTokens.toLocaleString()} out)`);
  }

  return text(lines.join('\n'));
}

async function handleListKeys() {
  const keys = await getApiKeys();

  if (!keys.length) return text('No API keys found.');

  const lines = ['API Keys', '─────────────────────────'];
  for (const k of keys) {
    const status = k.revoked_at ? 'REVOKED' : 'ACTIVE';
    const created = k.created_at.slice(0, 10);
    lines.push(`${k.name} (${k.key_prefix}...) - ${status} - created ${created}`);
  }

  return text(lines.join('\n'));
}

async function handleBudgetStatus(args: Record<string, unknown> | undefined) {
  const budgetId = args?.budgetId as string | undefined;
  const budgets = await getBudgets();

  if (!budgets.length) return text('No budgets configured.');

  const filtered = budgetId ? budgets.filter((b) => b.id === budgetId) : budgets;
  if (!filtered.length) return text(`Budget ${budgetId} not found.`);

  // compute used amounts from requests
  const requests = await getRequests(30);
  const spendByKey = new Map<string, number>();
  for (const req of requests) {
    spendByKey.set(req.api_key_id, (spendByKey.get(req.api_key_id) || 0) + Number(req.cost_cents));
  }

  const lines = ['Budget Status', '─────────────────────────'];
  for (const b of filtered) {
    // rough: total spend as a proxy for budget usage (real usage tracked in KV)
    const totalSpend = [...spendByKey.values()].reduce((a, c) => a + c, 0);
    const pct = b.limit_cents > 0 ? Math.round((totalSpend / b.limit_cents) * 100) : 0;
    const remaining = Math.max(0, b.limit_cents - totalSpend);

    lines.push(`${b.name}: $${(totalSpend / 100).toFixed(2)} / $${(b.limit_cents / 100).toFixed(2)} (${pct}%) - $${(remaining / 100).toFixed(2)} remaining - ${b.period}`);
  }

  return text(lines.join('\n'));
}

async function handleHealth() {
  const config = loadConfig();
  const proxyUrl = config.proxyUrl;

  if (!proxyUrl) {
    return text('LLMKIT_PROXY_URL not configured. Cannot check proxy health.');
  }

  try {
    const res = await fetch(`${proxyUrl}/health`, { signal: AbortSignal.timeout(5000) });
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

  const requests = await getRequests(30);

  const sessions = new Map<string, {
    count: number;
    costCents: number;
    providers: Set<string>;
    models: Set<string>;
    first: string;
    last: string;
  }>();

  for (const req of requests) {
    const sid = req.session_id || 'no-session';
    if (sessionId && sid !== sessionId) continue;

    const s = sessions.get(sid) || {
      count: 0, costCents: 0,
      providers: new Set<string>(), models: new Set<string>(),
      first: req.created_at, last: req.created_at,
    };
    s.count++;
    s.costCents += Number(req.cost_cents);
    s.providers.add(req.provider);
    s.models.add(req.model);
    if (req.created_at < s.first) s.first = req.created_at;
    if (req.created_at > s.last) s.last = req.created_at;
    sessions.set(sid, s);
  }

  if (!sessions.size) {
    return text(sessionId ? `Session ${sessionId} not found.` : 'No sessions found.');
  }

  const sorted = [...sessions.entries()]
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .slice(0, sessionId ? 1 : limit);

  const lines = ['Sessions', '─────────────────────────'];
  for (const [sid, s] of sorted) {
    const duration = new Date(s.last).getTime() - new Date(s.first).getTime();
    const durStr = duration < 60000 ? `${Math.round(duration / 1000)}s` : `${Math.round(duration / 60000)}m`;
    lines.push(`${sid}: ${s.count} reqs, $${(s.costCents / 100).toFixed(2)}, ${durStr}, ${[...s.providers].join('+')} / ${[...s.models].join(', ')}`);
  }

  return text(lines.join('\n'));
}
