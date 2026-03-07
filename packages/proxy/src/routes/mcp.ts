import { Hono } from 'hono';
import type { Env } from '../env';

// MCP JSON-RPC over HTTP (Streamable HTTP transport)
// Handles initialize, tools/list, tools/call without importing the MCP SDK.
// Auth via the same API key middleware as /v1/* routes.

const mcp = new Hono<Env>();

const SERVER_INFO = {
  name: 'llmkit',
  version: '0.1.0',
};

const CAPABILITIES = {
  tools: {},
};

const TOOLS = [
  {
    name: 'llmkit_usage_stats',
    description: 'Get usage statistics (spend, requests, top models)',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], default: 'month' },
      },
    },
  },
  {
    name: 'llmkit_cost_query',
    description: 'Query cost breakdown by provider, model, session, or day',
    inputSchema: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', enum: ['provider', 'model', 'session', 'day'] },
        days: { type: 'number' },
        provider: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['groupBy'],
    },
  },
  {
    name: 'llmkit_list_keys',
    description: 'List all API keys for the account',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'llmkit_budget_status',
    description: 'Check budget usage and remaining balance',
    inputSchema: {
      type: 'object',
      properties: {
        budgetId: { type: 'string' },
      },
    },
  },
  {
    name: 'llmkit_health',
    description: 'Check LLMKit proxy health',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'llmkit_session_summary',
    description: 'Get summary of recent sessions or a specific session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
];

// PostgREST query helper scoped to the authenticated user
async function query<T>(supabaseUrl: string, supabaseKey: string, path: string): Promise<T[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) throw new Error(`query failed: ${res.status}`);
  return res.json() as Promise<T[]>;
}

interface RequestRow {
  api_key_id: string;
  session_id: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_cents: number;
  created_at: string;
}

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  budget_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface BudgetRow {
  id: string;
  name: string;
  limit_cents: number;
  period: string;
}

async function getUserKeyIds(url: string, key: string, userId: string): Promise<string[]> {
  const keys = await query<{ id: string }>(url, key, `api_keys?user_id=eq.${userId}&select=id`);
  return keys.map((k) => k.id);
}

async function getRequests(url: string, key: string, userId: string, days: number): Promise<RequestRow[]> {
  const keyIds = await getUserKeyIds(url, key, userId);
  if (!keyIds.length) return [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return query<RequestRow>(url, key, `requests?api_key_id=in.(${keyIds.join(',')})&created_at=gte.${cutoff}&order=created_at.desc&limit=5000&select=*`);
}

// tool handlers

function text(content: string) {
  return { content: [{ type: 'text', text: content }] };
}

async function handleUsageStats(url: string, key: string, userId: string, args: Record<string, unknown>) {
  const period = (args.period as string) || 'month';
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const requests = await getRequests(url, key, userId, days);

  let costCents = 0;
  let inTok = 0;
  let outTok = 0;
  let cacheTok = 0;
  const models = new Map<string, number>();

  for (const r of requests) {
    costCents += Number(r.cost_cents);
    inTok += r.input_tokens;
    outTok += r.output_tokens;
    cacheTok += r.cache_read_tokens;
    models.set(r.model, (models.get(r.model) || 0) + 1);
  }

  const top = [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([m, c]) => `  ${m}: ${c} requests`);

  const cacheRate = inTok > 0 ? ((cacheTok / (cacheTok + inTok)) * 100).toFixed(1) : '0.0';

  return text([
    `Usage (${period})`, `Requests: ${requests.length}`,
    `Spend: $${(costCents / 100).toFixed(2)}`,
    `Tokens: ${inTok.toLocaleString()} in / ${outTok.toLocaleString()} out`,
    `Cache hit rate: ${cacheRate}%`, '', 'Top models:', ...top,
  ].join('\n'));
}

async function handleCostQuery(url: string, key: string, userId: string, args: Record<string, unknown>) {
  const groupBy = (args.groupBy as string) || 'provider';
  const days = (args.days as number) || 30;
  let requests = await getRequests(url, key, userId, days);

  if (args.provider) requests = requests.filter((r) => r.provider === args.provider);
  if (args.model) requests = requests.filter((r) => r.model === args.model);

  const groups = new Map<string, { count: number; costCents: number }>();
  for (const r of requests) {
    const k = groupBy === 'provider' ? r.provider : groupBy === 'model' ? r.model
      : groupBy === 'session' ? (r.session_id || 'no-session') : r.created_at.slice(0, 10);
    const g = groups.get(k) || { count: 0, costCents: 0 };
    g.count++;
    g.costCents += Number(r.cost_cents);
    groups.set(k, g);
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].costCents - a[1].costCents);
  const lines = [`Cost by ${groupBy} (${days}d)`];
  for (const [k, g] of sorted) lines.push(`${k}: $${(g.costCents / 100).toFixed(2)} (${g.count} reqs)`);
  return text(lines.join('\n'));
}

async function handleListKeys(url: string, key: string, userId: string) {
  const keys = await query<KeyRow>(url, key, `api_keys?user_id=eq.${userId}&order=created_at.desc&select=id,name,key_prefix,budget_id,created_at,revoked_at`);
  if (!keys.length) return text('No API keys found.');
  const lines = ['API Keys'];
  for (const k of keys) {
    lines.push(`${k.name} (${k.key_prefix}...) ${k.revoked_at ? 'REVOKED' : 'ACTIVE'} ${k.created_at.slice(0, 10)}`);
  }
  return text(lines.join('\n'));
}

async function handleBudgetStatus(url: string, key: string, userId: string, args: Record<string, unknown>) {
  const budgets = await query<BudgetRow>(url, key, `budgets?user_id=eq.${userId}&select=id,name,limit_cents,period`);
  if (!budgets.length) return text('No budgets configured.');
  const filtered = args.budgetId ? budgets.filter((b) => b.id === args.budgetId) : budgets;
  const requests = await getRequests(url, key, userId, 30);
  const totalSpend = requests.reduce((s, r) => s + Number(r.cost_cents), 0);

  const lines = ['Budget Status'];
  for (const b of filtered) {
    const pct = b.limit_cents > 0 ? Math.round((totalSpend / b.limit_cents) * 100) : 0;
    const rem = Math.max(0, b.limit_cents - totalSpend);
    lines.push(`${b.name}: $${(totalSpend / 100).toFixed(2)}/$${(b.limit_cents / 100).toFixed(2)} (${pct}%) $${(rem / 100).toFixed(2)} left [${b.period}]`);
  }
  return text(lines.join('\n'));
}

async function handleSessionSummary(url: string, key: string, userId: string, args: Record<string, unknown>) {
  const sessionId = args.sessionId as string | undefined;
  const limit = (args.limit as number) || 10;
  const requests = await getRequests(url, key, userId, 30);

  const sessions = new Map<string, { count: number; costCents: number; providers: Set<string>; last: string }>();
  for (const r of requests) {
    const sid = r.session_id || 'no-session';
    if (sessionId && sid !== sessionId) continue;
    const s = sessions.get(sid) || { count: 0, costCents: 0, providers: new Set<string>(), last: r.created_at };
    s.count++;
    s.costCents += Number(r.cost_cents);
    s.providers.add(r.provider);
    if (r.created_at > s.last) s.last = r.created_at;
    sessions.set(sid, s);
  }

  if (!sessions.size) return text(sessionId ? `Session ${sessionId} not found.` : 'No sessions found.');

  const sorted = [...sessions.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, sessionId ? 1 : limit);
  const lines = ['Sessions'];
  for (const [sid, s] of sorted) {
    lines.push(`${sid}: ${s.count} reqs, $${(s.costCents / 100).toFixed(2)}, ${[...s.providers].join('+')}`);
  }
  return text(lines.join('\n'));
}

// JSON-RPC dispatch

function jsonrpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleCall(method: string, params: Record<string, unknown>, id: unknown, url: string, key: string, userId: string) {
  switch (method) {
    case 'initialize':
      return jsonrpc(id, { protocolVersion: '2024-11-05', serverInfo: SERVER_INFO, capabilities: CAPABILITIES });

    case 'tools/list':
      return jsonrpc(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = params.name as string;
      const args = (params.arguments as Record<string, unknown>) || {};

      let result: { content: { type: string; text: string }[] };
      switch (toolName) {
        case 'llmkit_usage_stats': result = await handleUsageStats(url, key, userId, args); break;
        case 'llmkit_cost_query': result = await handleCostQuery(url, key, userId, args); break;
        case 'llmkit_list_keys': result = await handleListKeys(url, key, userId); break;
        case 'llmkit_budget_status': result = await handleBudgetStatus(url, key, userId, args); break;
        case 'llmkit_health': result = text('Proxy is running (you reached it via MCP)'); break;
        case 'llmkit_session_summary': result = await handleSessionSummary(url, key, userId, args); break;
        default: return jsonrpcError(id, -32601, `unknown tool: ${toolName}`);
      }
      return jsonrpc(id, result);
    }

    default:
      // notifications like initialized don't need a response
      if (!id) return null;
      return jsonrpcError(id, -32601, `unknown method: ${method}`);
  }
}

mcp.post('/', async (c) => {
  const userId = c.get('userId');
  const supabaseUrl = c.env.SUPABASE_URL;
  const supabaseKey = c.env.SUPABASE_KEY;

  if (!userId || !supabaseUrl || !supabaseKey) {
    return c.json(jsonrpcError(null, -32000, 'not authenticated'), 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json(jsonrpcError(null, -32700, 'invalid JSON'), 400);

  // handle batch requests
  if (Array.isArray(body)) {
    const results = await Promise.all(
      body.map((msg: { method: string; params?: Record<string, unknown>; id?: unknown }) =>
        handleCall(msg.method, msg.params || {}, msg.id, supabaseUrl, supabaseKey, userId)
      )
    );
    return c.json(results.filter(Boolean));
  }

  const result = await handleCall(body.method, body.params || {}, body.id, supabaseUrl, supabaseKey, userId);
  if (!result) return c.body(null, 204);
  return c.json(result);
});

export { mcp as mcpRouter };
