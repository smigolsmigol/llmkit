import { Hono } from 'hono';
import { supabaseServiceHeaders } from '../db';
import type { Env } from '../env';

const postgrest = (url: string, key: string, path: string, extra?: HeadersInit) =>
  fetch(`${url}/rest/v1/${path}`, {
    headers: { ...supabaseServiceHeaders(key), ...extra },
  });

interface RequestRow {
  id: string;
  user_id: string;
  api_key_id: string;
  customer_id: string | null;
  workflow_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  end_user_id: string | null;
  budget_id: string | null;
  budget_reservation_id: string | null;
  reserved_cost_cents: number | null;
  settlement_status: string;
  idempotency_key_hash: string | null;
  response_sha256: string | null;
  requested_provider: string | null;
  requested_model: string | null;
  last_dispatched_provider: string | null;
  last_dispatched_model: string | null;
  provider_response_id: string | null;
  dispatch_status: 'admitted' | 'dispatched' | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_cents: number | null;
  latency_ms: number;
  status: string;
  error_code: string | null;
  tool_calls: { name: string }[] | null;
  created_at: string;
}

const PAGE_SIZE = 1000;

async function getUserRequests(
  url: string, key: string, userId: string, days: number, source = 'proxy',
): Promise<RequestRow[]> {
  const keysRes = await postgrest(url, key, `api_keys?user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (!keysRes.ok) throw new Error(`failed to fetch analytics keys (${keysRes.status})`);
  const keys = (await keysRes.json()) as { id: string }[];
  if (!keys.length) return [];

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const snapshot = new Date().toISOString();
  const keyFilter = `api_key_id=in.(${keys.map(k => encodeURIComponent(k.id)).join(',')})&created_at=gte.${cutoff}&created_at=lte.${snapshot}&source=eq.${encodeURIComponent(source)}&order=created_at.desc,id.desc`;

  // get total count first, then fetch only the pages we need
  const countRes = await postgrest(
    url, key,
    `requests?${keyFilter}&select=id&limit=0`,
    { Prefer: 'count=exact' },
  );
  if (!countRes.ok) throw new Error(`failed to count analytics requests (${countRes.status})`);

  const rangeHeader = countRes.headers.get('content-range');
  const totalText = rangeHeader?.split('/')[1];
  if (!totalText || !/^\d+$/.test(totalText)) {
    throw new Error('analytics request count omitted an exact Content-Range total');
  }
  const total = Number(totalText);
  if (total === 0) return [];

  const pages = Math.ceil(total / PAGE_SIZE);
  const batch = Array.from({ length: pages }, (_, i) =>
    postgrest(url, key, `requests?${keyFilter}&select=*&offset=${i * PAGE_SIZE}&limit=${PAGE_SIZE}`)
      .then((response) => {
        if (!response.ok) throw new Error(`failed to fetch analytics page ${i} (${response.status})`);
        return response.json() as Promise<RequestRow[]>;
      }),
  );

  const results = await Promise.all(batch);
  const rows = results.flat();
  if (rows.length !== total) {
    throw new Error(`analytics pagination returned ${rows.length} of ${total} request receipts`);
  }
  return rows;
}

export const analyticsRouter = new Hono<Env>();

analyticsRouter.get('/analytics/receipts/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: 'not configured' }, 500);
  }
  const receiptId = c.req.param('id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) {
    return c.json({ error: 'invalid receipt id' }, 400);
  }
  const response = await postgrest(
    c.env.SUPABASE_URL,
    c.env.SUPABASE_KEY,
    `requests?id=eq.${encodeURIComponent(receiptId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
  );
  if (!response.ok) return c.json({ error: 'failed to fetch receipt' }, 502);
  const rows = await response.json<RequestRow[]>();
  const row = rows[0];
  if (!row) return c.json({ error: 'receipt not found' }, 404);
  return c.json({ receipt: row });
});

analyticsRouter.get('/analytics/usage', async (c) => {
  const userId = c.get('userId');
  if (!userId || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: 'not configured' }, 500);
  }

  const period = (c.req.query('period') || 'month') as string;
  const days = Math.min(period === 'today' ? 1 : period === 'week' ? 7 : 30, 365);

  const dbUrl = c.env.SUPABASE_URL;
  const dbKey = c.env.SUPABASE_KEY;

  const keysRes = await postgrest(dbUrl, dbKey,
    `api_keys?user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (!keysRes.ok) return c.json({ error: 'failed to fetch keys' }, 500);
  const keys = (await keysRes.json()) as { id: string }[];
  if (!keys.length) return c.json({
    period,
    requests: 0,
    pricedRequests: 0,
    unknownCostRequests: 0,
    costComplete: true,
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    cacheHitRate: 0,
    topModels: [],
  });

  // aggregate via SQL function for each key
  const fetches = keys.map(k =>
    fetch(`${dbUrl}/rest/v1/rpc/usage_aggregate`, {
      method: 'POST',
      headers: supabaseServiceHeaders(dbKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_key_id: k.id, p_days: days, p_source: 'proxy' }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`usage aggregate failed for key ${k.id} (${response.status})`);
      return JSON.parse(await response.text());
    })
  );
  const results = await Promise.all(fetches) as {
    requests: number; pricedRequests: number; unknownCostRequests: number;
    totalCostCents: number; totalInputTokens: number;
    totalOutputTokens: number; totalCacheReadTokens: number;
    topModels: { model: string; requests: number }[];
  }[];

  let totalCostCents = 0, totalInputTokens = 0, totalOutputTokens = 0, totalCacheReadTokens = 0;
  let totalRequests = 0, pricedRequests = 0, unknownCostRequests = 0;
  const modelCounts = new Map<string, number>();
  for (const r of results) {
    totalRequests += r.requests;
    pricedRequests += Number(r.pricedRequests);
    unknownCostRequests += Number(r.unknownCostRequests);
    totalCostCents += Number(r.totalCostCents);
    totalInputTokens += r.totalInputTokens;
    totalOutputTokens += r.totalOutputTokens;
    totalCacheReadTokens += r.totalCacheReadTokens;
    for (const m of (r.topModels || [])) modelCounts.set(m.model, (modelCounts.get(m.model) || 0) + m.requests);
  }

  return c.json({
    period,
    requests: totalRequests,
    pricedRequests,
    unknownCostRequests,
    costComplete: unknownCostRequests === 0,
    totalCostCents,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    cacheHitRate: totalInputTokens > 0
      ? +((totalCacheReadTokens / (totalCacheReadTokens + totalInputTokens)) * 100).toFixed(1)
      : 0,
    topModels: [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([model, count]) => ({ model, requests: count })),
  });
});

analyticsRouter.get('/analytics/costs', async (c) => {
  const userId = c.get('userId');
  if (!userId || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: 'not configured' }, 500);
  }

  const groupBy = c.req.query('groupBy') || 'provider';
  const days = Math.min(Number(c.req.query('days')) || 30, 365);
  const filterProvider = c.req.query('provider');
  const filterModel = c.req.query('model');

  let requests = await getUserRequests(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, userId, days);
  if (filterProvider) requests = requests.filter(r => r.provider === filterProvider);
  if (filterModel) requests = requests.filter(r => r.model === filterModel);

  const groups = new Map<string, {
    count: number; pricedRequests: number; unknownCostRequests: number;
    costCents: number; inputTokens: number; outputTokens: number; toolCalls: number;
  }>();

  for (const req of requests) {
    let key: string;
    switch (groupBy) {
      case 'model': key = req.model; break;
      case 'session': key = req.session_id || 'no-session'; break;
      case 'day': key = req.created_at.slice(0, 10); break;
      default: key = req.provider;
    }
    const g = groups.get(key) || {
      count: 0, pricedRequests: 0, unknownCostRequests: 0,
      costCents: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0,
    };
    g.count++;
    if (req.cost_cents === null) {
      g.unknownCostRequests++;
    } else {
      g.pricedRequests++;
      g.costCents += Number(req.cost_cents);
    }
    g.inputTokens += req.input_tokens;
    g.outputTokens += req.output_tokens;
    g.toolCalls += req.tool_calls?.length ?? 0;
    groups.set(key, g);
  }

  const breakdown = [...groups.entries()]
    .sort((a, b) => b[1].costCents - a[1].costCents)
    .map(([key, g]) => ({ key, ...g }));

  const pricedRequests = breakdown.reduce((sum, group) => sum + group.pricedRequests, 0);
  const unknownCostRequests = breakdown.reduce((sum, group) => sum + group.unknownCostRequests, 0);
  return c.json({
    groupBy,
    days,
    pricedRequests,
    unknownCostRequests,
    costComplete: unknownCostRequests === 0,
    breakdown,
  });
});

analyticsRouter.get('/analytics/keys', async (c) => {
  const userId = c.get('userId');
  if (!userId || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: 'not configured' }, 500);
  }

  const res = await postgrest(
    c.env.SUPABASE_URL, c.env.SUPABASE_KEY,
    `api_keys?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&select=id,name,key_prefix,budget_id,created_at,revoked_at`,
  );
  if (!res.ok) return c.json({ keys: [] });
  const keys = await res.json();
  return c.json({ keys });
});

analyticsRouter.get('/analytics/budgets', async (c) => {
  const userId = c.get('userId');
  if (!userId || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: 'not configured' }, 500);
  }

  const res = await postgrest(
    c.env.SUPABASE_URL, c.env.SUPABASE_KEY,
    `budgets?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&select=id,name,limit_cents,period,created_at`,
  );
  if (!res.ok) return c.json({ budgets: [] });
  const budgets = await res.json();
  return c.json({ budgets });
});

analyticsRouter.get('/analytics/sessions', async (c) => {
  const userId = c.get('userId');
  if (!userId || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: 'not configured' }, 500);
  }

  const sessionId = c.req.query('sessionId');
  const limit = Number(c.req.query('limit')) || 10;
  const requests = await getUserRequests(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, userId, 30);

  const sessions = new Map<string, {
    count: number; pricedRequests: number; unknownCostRequests: number; costCents: number;
    providers: Set<string>; models: Set<string>;
    first: string; last: string;
  }>();

  for (const req of requests) {
    const sid = req.session_id || 'no-session';
    if (sessionId && sid !== sessionId) continue;
    const s = sessions.get(sid) || {
      count: 0, pricedRequests: 0, unknownCostRequests: 0, costCents: 0,
      providers: new Set<string>(), models: new Set<string>(),
      first: req.created_at, last: req.created_at,
    };
    s.count++;
    if (req.cost_cents === null) {
      s.unknownCostRequests++;
    } else {
      s.pricedRequests++;
      s.costCents += Number(req.cost_cents);
    }
    s.providers.add(req.provider);
    s.models.add(req.model);
    if (req.created_at < s.first) s.first = req.created_at;
    if (req.created_at > s.last) s.last = req.created_at;
    sessions.set(sid, s);
  }

  const result = [...sessions.entries()]
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .slice(0, sessionId ? 1 : limit)
    .map(([sid, s]) => ({
      sessionId: sid,
      requests: s.count,
      pricedRequests: s.pricedRequests,
      unknownCostRequests: s.unknownCostRequests,
      costComplete: s.unknownCostRequests === 0,
      costCents: s.costCents,
      providers: [...s.providers],
      models: [...s.models],
      first: s.first,
      last: s.last,
    }));

  const pricedRequests = result.reduce((sum, session) => sum + session.pricedRequests, 0);
  const unknownCostRequests = result.reduce((sum, session) => sum + session.unknownCostRequests, 0);
  return c.json({
    pricedRequests,
    unknownCostRequests,
    costComplete: unknownCostRequests === 0,
    sessions: result,
  });
});
