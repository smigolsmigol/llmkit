import { Hono } from 'hono';
import type { Env } from '../env';

const postgrest = (url: string, key: string, path: string) =>
  fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });

interface RequestRow {
  api_key_id: string;
  session_id: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_cents: number;
  latency_ms: number;
  status: string;
  tool_calls: { name: string }[] | null;
  created_at: string;
}

async function getUserRequests(
  url: string, key: string, userId: string, days: number, source = 'proxy',
): Promise<RequestRow[]> {
  const keysRes = await postgrest(url, key, `api_keys?user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (!keysRes.ok) return [];
  const keys = (await keysRes.json()) as { id: string }[];
  if (!keys.length) return [];

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const keyFilter = `api_key_id=in.(${keys.map(k => encodeURIComponent(k.id)).join(',')})&created_at=gte.${cutoff}&source=eq.${encodeURIComponent(source)}&order=created_at.desc`;

  // paginated fetch (Supabase caps at 1000 per page)
  const all: RequestRow[] = [];
  const batch: Promise<RequestRow[]>[] = [];
  // fire 100 parallel page requests, collect what comes back
  for (let off = 0; off < 100000; off += 1000) {
    batch.push(
      postgrest(url, key, `requests?${keyFilter}&select=*&offset=${off}&limit=1000`)
        .then(r => r.ok ? r.json() as Promise<RequestRow[]> : Promise.resolve([] as RequestRow[]))
        .catch(() => [] as RequestRow[])
    );
  }
  const pages = await Promise.all(batch);
  for (const page of pages) {
    if (page.length > 0) all.push(...page);
  }
  return all;
}

export const analyticsRouter = new Hono<Env>();

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
  if (!keys.length) return c.json({ period, requests: 0, totalCostCents: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, cacheHitRate: 0, topModels: [] });

  // aggregate via SQL function for each key
  const fetches = keys.map(k =>
    fetch(`${dbUrl}/rest/v1/rpc/usage_aggregate`, {
      method: 'POST',
      headers: { 'apikey': dbKey, 'Authorization': `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key_id: k.id, p_days: days, p_source: 'proxy' }),
    }).then(async r => {
      if (!r.ok) return null;
      try { return JSON.parse(await r.text()); } catch { return null; }
    }).catch(() => null)
  );
  const results = (await Promise.all(fetches)).filter(Boolean) as {
    requests: number; totalCostCents: number; totalInputTokens: number;
    totalOutputTokens: number; totalCacheReadTokens: number;
    topModels: { model: string; requests: number }[];
  }[];

  let totalCostCents = 0, totalInputTokens = 0, totalOutputTokens = 0, totalCacheReadTokens = 0, totalRequests = 0;
  const modelCounts = new Map<string, number>();
  for (const r of results) {
    totalRequests += r.requests;
    totalCostCents += Number(r.totalCostCents);
    totalInputTokens += r.totalInputTokens;
    totalOutputTokens += r.totalOutputTokens;
    totalCacheReadTokens += r.totalCacheReadTokens;
    for (const m of (r.topModels || [])) modelCounts.set(m.model, (modelCounts.get(m.model) || 0) + m.requests);
  }

  return c.json({
    period,
    requests: totalRequests,
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

  const groups = new Map<string, { count: number; costCents: number; inputTokens: number; outputTokens: number; toolCalls: number }>();

  for (const req of requests) {
    let key: string;
    switch (groupBy) {
      case 'model': key = req.model; break;
      case 'session': key = req.session_id || 'no-session'; break;
      case 'day': key = req.created_at.slice(0, 10); break;
      default: key = req.provider;
    }
    const g = groups.get(key) || { count: 0, costCents: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0 };
    g.count++;
    g.costCents += Number(req.cost_cents);
    g.inputTokens += req.input_tokens;
    g.outputTokens += req.output_tokens;
    g.toolCalls += req.tool_calls?.length ?? 0;
    groups.set(key, g);
  }

  const breakdown = [...groups.entries()]
    .sort((a, b) => b[1].costCents - a[1].costCents)
    .map(([key, g]) => ({ key, ...g }));

  return c.json({ groupBy, days, breakdown });
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
    count: number; costCents: number;
    providers: Set<string>; models: Set<string>;
    first: string; last: string;
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

  const result = [...sessions.entries()]
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .slice(0, sessionId ? 1 : limit)
    .map(([sid, s]) => ({
      sessionId: sid,
      requests: s.count,
      costCents: s.costCents,
      providers: [...s.providers],
      models: [...s.models],
      first: s.first,
      last: s.last,
    }));

  return c.json({ sessions: result });
});
