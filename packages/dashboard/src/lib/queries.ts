import { createServerClient } from './supabase';

export async function getAccountPlan(userId: string): Promise<string | null> {
  const db = createServerClient();
  const { data } = await db.from('accounts').select('plan').eq('user_id', userId).single();
  return data?.plan ?? null;
}

export interface RequestRow {
  id: string;
  api_key_id: string;
  session_id: string | null;
  end_user_id: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_cents: number;
  latency_ms: number;
  status: string;
  error_code: string | null;
  created_at: string;
}

export interface BudgetRow {
  id: string;
  user_id: string;
  name: string;
  limit_cents: number;
  period: string;
  scope: string;
  alert_webhook_url: string | null;
  reset_at: string | null;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_prefix: string;
  name: string;
  budget_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface ProviderStats {
  provider: string;
  count: number;
  totalCostCents: number;
}

interface DailySpend {
  date: string;
  costCents: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export async function getRecentRequests(userId: string, limit = 20): Promise<RequestRow[]> {
  const db = createServerClient();
  const { data: keys } = await db
    .from('api_keys')
    .select('id')
    .eq('user_id', userId);

  if (!keys?.length) return [];

  const keyIds = keys.map((k) => k.id);
  const { data } = await db
    .from('requests')
    .select('*')
    .in('api_key_id', keyIds)
    .eq('source', 'proxy')
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data as RequestRow[]) || [];
}

export async function getSpendByProvider(userId: string, days = 30): Promise<ProviderStats[]> {
  const requests = filterByDays(await getRecentRequests(userId, 1000), days);

  const byProvider = new Map<string, { count: number; totalCostCents: number }>();
  for (const req of requests) {
    const existing = byProvider.get(req.provider) || { count: 0, totalCostCents: 0 };
    existing.count++;
    existing.totalCostCents += Number(req.cost_cents);
    byProvider.set(req.provider, existing);
  }

  return Array.from(byProvider.entries()).map(([provider, stats]) => ({
    provider,
    ...stats,
  }));
}

export async function getDailySpend(userId: string, days = 30): Promise<DailySpend[]> {
  const requests = await getRecentRequests(userId, 10000);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const byDay = new Map<string, { costCents: number; requests: number; inputTokens: number; outputTokens: number }>();
  for (const req of requests) {
    const date = req.created_at.slice(0, 10);
    if (new Date(date) < cutoff) continue;
    const d = byDay.get(date) || { costCents: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
    d.costCents += Number(req.cost_cents);
    d.requests++;
    d.inputTokens += req.input_tokens;
    d.outputTokens += req.output_tokens;
    byDay.set(date, d);
  }

  return Array.from(byDay.entries())
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getTotalSpend(userId: string): Promise<{ today: number; week: number; month: number }> {
  const requests = await getRecentRequests(userId, 10000);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  let today = 0;
  let week = 0;
  let month = 0;

  for (const req of requests) {
    const cost = Number(req.cost_cents);
    const date = new Date(req.created_at);
    if (req.created_at.startsWith(todayStr)) today += cost;
    if (date >= weekAgo) week += cost;
    if (date >= monthAgo) month += cost;
  }

  return { today, week, month };
}

export interface PaginatedResult {
  data: RequestRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequestFilters {
  provider?: string;
  model?: string;
  status?: string;
  sessionId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function getRequestsPaginated(
  userId: string,
  page = 1,
  pageSize = 25,
  filters: RequestFilters = {},
): Promise<PaginatedResult> {
  const db = createServerClient();
  const { data: keys } = await db
    .from('api_keys')
    .select('id')
    .eq('user_id', userId);

  if (!keys?.length) return { data: [], total: 0, page, pageSize };

  const keyIds = keys.map((k) => k.id);

  let query = db
    .from('requests')
    .select('*', { count: 'exact' })
    .in('api_key_id', keyIds)
    .eq('source', 'proxy');

  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.model) query = query.eq('model', filters.model);
  if (filters.sessionId) query = query.eq('session_id', filters.sessionId);
  if (filters.status === 'error') query = query.not('error_code', 'is', null);
  if (filters.status === 'ok') query = query.is('error_code', null);

  const sortCol = filters.sortBy || 'created_at';
  const ascending = filters.sortOrder === 'asc';
  query = query.order(sortCol, { ascending });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count } = await query;

  return {
    data: (data as RequestRow[]) || [],
    total: count || 0,
    page,
    pageSize,
  };
}

export async function getRequestById(userId: string, requestId: string): Promise<RequestRow | null> {
  const db = createServerClient();
  const { data: keys } = await db
    .from('api_keys')
    .select('id')
    .eq('user_id', userId);

  if (!keys?.length) return null;

  const keyIds = keys.map((k) => k.id);
  const { data } = await db
    .from('requests')
    .select('*')
    .eq('id', requestId)
    .in('api_key_id', keyIds)
    .eq('source', 'proxy')
    .single();

  return (data as RequestRow) || null;
}

export async function getDistinctProviders(userId: string): Promise<string[]> {
  const requests = await getRecentRequests(userId, 1000);
  return [...new Set(requests.map((r) => r.provider))].sort();
}

export async function getDistinctModels(userId: string): Promise<string[]> {
  const requests = await getRecentRequests(userId, 1000);
  return [...new Set(requests.map((r) => r.model))].sort();
}

// ---- Cache analytics ----

export interface CacheStats {
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalInputTokens: number;
  cacheHitRate: number;
  estimatedSavingsCents: number;
}

export async function getCacheStats(userId: string, days = 30): Promise<CacheStats> {
  const requests = await getRecentRequests(userId, 10000);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalInput = 0;
  let savingsCents = 0;

  for (const req of requests) {
    if (new Date(req.created_at) < cutoff) continue;

    totalInput += req.input_tokens;
    totalCacheRead += req.cache_read_tokens;
    totalCacheWrite += req.cache_write_tokens;

    // savings = what cache reads would have cost at full input price minus what they actually cost
    if (req.cache_read_tokens > 0) {
      const fullCostPerToken = Number(req.cost_cents) / Math.max(1, req.input_tokens + req.output_tokens);
      savingsCents += req.cache_read_tokens * fullCostPerToken * 0.9;
    }
  }

  const denominator = totalCacheRead + totalInput;
  const cacheHitRate = denominator > 0 ? (totalCacheRead / denominator) * 100 : 0;

  return {
    totalCacheReadTokens: totalCacheRead,
    totalCacheWriteTokens: totalCacheWrite,
    totalInputTokens: totalInput,
    cacheHitRate: +cacheHitRate.toFixed(1),
    estimatedSavingsCents: +savingsCents.toFixed(2),
  };
}

export interface DailyCacheBreakdown {
  date: string;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  regularInputTokens: number;
}

export async function getDailyCacheBreakdown(userId: string, days = 30): Promise<DailyCacheBreakdown[]> {
  const requests = await getRecentRequests(userId, 10000);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const byDay = new Map<string, { cacheRead: number; cacheWrite: number; regular: number }>();

  for (const req of requests) {
    const date = req.created_at.slice(0, 10);
    if (new Date(date) < cutoff) continue;

    const day = byDay.get(date) || { cacheRead: 0, cacheWrite: 0, regular: 0 };
    day.cacheRead += req.cache_read_tokens;
    day.cacheWrite += req.cache_write_tokens;
    day.regular += req.input_tokens;
    byDay.set(date, day);
  }

  return Array.from(byDay.entries())
    .map(([date, d]) => ({
      date,
      cacheReadTokens: d.cacheRead,
      cacheWriteTokens: d.cacheWrite,
      regularInputTokens: d.regular,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Timeseries (raw per-request data for interactive charts) ----

export interface TimeseriesPoint {
  t: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

export async function getRequestTimeseries(userId: string, days = 30): Promise<TimeseriesPoint[]> {
  const requests = filterByDays(await getRecentRequests(userId, 10000), days);
  return requests
    .map((r) => ({
      t: r.created_at,
      costCents: Number(r.cost_cents),
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
    }))
    .sort((a, b) => a.t.localeCompare(b.t));
}

export async function getAdminRequestTimeseries(days = 0): Promise<TimeseriesPoint[]> {
  const rows = filterByDays(await getAllRequests(), days);
  return rows
    .map((r) => ({
      t: r.created_at,
      costCents: Number(r.cost_cents),
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
    }))
    .sort((a, b) => a.t.localeCompare(b.t));
}

// ---- Accounts ----

export interface AccountRow {
  user_id: string;
  plan: string;
  plan_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  granted_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export async function ensureAccount(userId: string): Promise<AccountRow> {
  const db = createServerClient();
  const { data: existing } = await db
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) return existing as AccountRow;

  const { data: created, error } = await db
    .from('accounts')
    .upsert({ user_id: userId, plan: 'beta' }, { onConflict: 'user_id', ignoreDuplicates: true })
    .select('*')
    .single();

  if (error) throw new Error('failed to provision account');
  return created as AccountRow;
}

export async function getAccount(userId: string): Promise<AccountRow | null> {
  const db = createServerClient();
  const { data } = await db
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .single();

  return (data as AccountRow) || null;
}

export async function getAllAccounts(): Promise<AccountRow[]> {
  const db = createServerClient();
  const { data } = await db
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });

  return (data as AccountRow[]) || [];
}

// ---- Admin queries (all users, platform-wide) ----

interface AdminRequest {
  api_key_id: string;
  cost_cents: number;
  latency_ms: number;
  error_code: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

async function getAllRequests(): Promise<AdminRequest[]> {
  const db = createServerClient();
  const { data } = await db
    .from('requests')
    .select('api_key_id, cost_cents, latency_ms, error_code, provider, model, input_tokens, output_tokens, created_at')
    .eq('source', 'proxy')
    .order('created_at', { ascending: false })
    .limit(50000);
  return (data as AdminRequest[]) || [];
}

function filterByDays<T extends { created_at: string }>(rows: T[], days: number): T[] {
  if (days <= 0) return rows;
  const cutoff = new Date(Date.now() - days * 86400000);
  return rows.filter((r) => new Date(r.created_at) >= cutoff);
}

export interface AdminStats {
  totalRequests: number;
  totalSpendCents: number;
  totalAccounts: number;
  activeKeysToday: number;
  activeKeysWeek: number;
  activeKeysMonth: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgTokensPerReq: number;
}

export interface UserBreakdown {
  userId: string;
  plan: string;
  note: string | null;
  requests: number;
  spendCents: number;
  errors: number;
  avgLatencyMs: number;
  lastActive: string;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  requests: number;
  spendCents: number;
  avgLatencyMs: number;
  avgTokensPerReq: number;
  costPer1kTokens: number;
}

export interface DailyAdminStats {
  date: string;
  costCents: number;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

export async function getAdminStats(days = 0): Promise<AdminStats> {
  const db = createServerClient();
  const { count: totalAccounts } = await db
    .from('accounts')
    .select('*', { count: 'exact', head: true });

  const rows = filterByDays(await getAllRequests(), days);

  const now = Date.now();
  const dayAgo = now - 86400000;
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;

  const keysToday = new Set<string>();
  const keysWeek = new Set<string>();
  const keysMonth = new Set<string>();
  let errors = 0;
  let totalLatency = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const latencies: number[] = [];

  for (const r of rows) {
    const ts = new Date(r.created_at).getTime();
    if (ts >= dayAgo) keysToday.add(r.api_key_id);
    if (ts >= weekAgo) keysWeek.add(r.api_key_id);
    if (ts >= monthAgo) keysMonth.add(r.api_key_id);
    if (r.error_code) errors++;
    totalLatency += r.latency_ms;
    latencies.push(r.latency_ms);
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
  }

  latencies.sort((a, b) => a - b);
  const p95Idx = Math.floor(latencies.length * 0.95);

  return {
    totalRequests: rows.length,
    totalSpendCents: rows.reduce((s, r) => s + Number(r.cost_cents), 0),
    totalAccounts: totalAccounts || 0,
    activeKeysToday: keysToday.size,
    activeKeysWeek: keysWeek.size,
    activeKeysMonth: keysMonth.size,
    errorRate: rows.length > 0 ? (errors / rows.length) * 100 : 0,
    avgLatencyMs: rows.length > 0 ? Math.round(totalLatency / rows.length) : 0,
    p95LatencyMs: latencies.length > 0 ? latencies[p95Idx] : 0,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    avgTokensPerReq: rows.length > 0 ? Math.round((totalInput + totalOutput) / rows.length) : 0,
  };
}

export async function getAdminDailyStats(days = 0): Promise<DailyAdminStats[]> {
  const rows = filterByDays(await getAllRequests(), days);

  const byDay = new Map<string, { costCents: number; requests: number; errors: number; inputTokens: number; outputTokens: number }>();
  for (const r of rows) {
    const date = r.created_at.slice(0, 10);
    const d = byDay.get(date) || { costCents: 0, requests: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
    d.costCents += Number(r.cost_cents);
    d.requests++;
    d.inputTokens += r.input_tokens;
    d.outputTokens += r.output_tokens;
    if (r.error_code) d.errors++;
    byDay.set(date, d);
  }

  return Array.from(byDay.entries())
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAdminUserBreakdown(days = 0): Promise<UserBreakdown[]> {
  const db = createServerClient();

  const { data: keys } = await db
    .from('api_keys')
    .select('id, user_id');

  if (!keys?.length) return [];

  const keyToUser = new Map(keys.map((k) => [k.id, k.user_id]));
  const rows = filterByDays(await getAllRequests(), days);

  const users = new Map<string, { requests: number; spendCents: number; errors: number; totalLatency: number; lastActive: string }>();
  for (const r of rows) {
    const uid = keyToUser.get(r.api_key_id);
    if (!uid) continue;
    const u = users.get(uid) || { requests: 0, spendCents: 0, errors: 0, totalLatency: 0, lastActive: '' };
    u.requests++;
    u.spendCents += Number(r.cost_cents);
    if (r.error_code) u.errors++;
    u.totalLatency += r.latency_ms;
    if (r.created_at > u.lastActive) u.lastActive = r.created_at;
    users.set(uid, u);
  }

  const { data: accounts } = await db
    .from('accounts')
    .select('user_id, plan, note');

  const acctMap = new Map((accounts || []).map((a) => [a.user_id, a]));

  return Array.from(users.entries())
    .map(([userId, u]) => ({
      userId,
      plan: acctMap.get(userId)?.plan || 'free',
      note: acctMap.get(userId)?.note || null,
      requests: u.requests,
      spendCents: u.spendCents,
      errors: u.errors,
      avgLatencyMs: u.requests > 0 ? Math.round(u.totalLatency / u.requests) : 0,
      lastActive: u.lastActive,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);
}

export async function getAdminTopModels(days = 0): Promise<ModelBreakdown[]> {
  const rows = filterByDays(await getAllRequests(), days);

  const models = new Map<string, {
    provider: string; requests: number; spendCents: number;
    totalLatency: number; totalInput: number; totalOutput: number;
  }>();
  for (const r of rows) {
    const m = models.get(r.model) || {
      provider: r.provider, requests: 0, spendCents: 0,
      totalLatency: 0, totalInput: 0, totalOutput: 0,
    };
    m.requests++;
    m.spendCents += Number(r.cost_cents);
    m.totalLatency += r.latency_ms;
    m.totalInput += r.input_tokens;
    m.totalOutput += r.output_tokens;
    models.set(r.model, m);
  }

  return Array.from(models.entries())
    .map(([model, m]) => {
      const totalTokens = m.totalInput + m.totalOutput;
      return {
        model,
        provider: m.provider,
        requests: m.requests,
        spendCents: m.spendCents,
        avgLatencyMs: m.requests > 0 ? Math.round(m.totalLatency / m.requests) : 0,
        avgTokensPerReq: m.requests > 0 ? Math.round(totalTokens / m.requests) : 0,
        costPer1kTokens: totalTokens > 0 ? +((m.spendCents / totalTokens) * 1000).toFixed(4) : 0,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents);
}

// ---- Admin: trend deltas ----

export interface AdminStatsTrend {
  current: AdminStats;
  previous: AdminStats;
  deltas: {
    spend: number | null;
    requests: number | null;
    errorRate: number | null;
    avgLatency: number | null;
    tokens: number | null;
    p95Latency: number | null;
  };
}

function computeStats(rows: AdminRequest[]): Omit<AdminStats, 'totalAccounts' | 'activeKeysToday' | 'activeKeysWeek' | 'activeKeysMonth'> {
  let errors = 0;
  let totalLatency = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const latencies: number[] = [];

  for (const r of rows) {
    if (r.error_code) errors++;
    totalLatency += r.latency_ms;
    latencies.push(r.latency_ms);
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
  }

  latencies.sort((a, b) => a - b);
  const p95Idx = Math.floor(latencies.length * 0.95);

  return {
    totalRequests: rows.length,
    totalSpendCents: rows.reduce((s, r) => s + Number(r.cost_cents), 0),
    errorRate: rows.length > 0 ? (errors / rows.length) * 100 : 0,
    avgLatencyMs: rows.length > 0 ? Math.round(totalLatency / rows.length) : 0,
    p95LatencyMs: latencies.length > 0 ? (latencies[p95Idx] ?? 0) : 0,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    avgTokensPerReq: rows.length > 0 ? Math.round((totalInput + totalOutput) / rows.length) : 0,
  };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return +((((current - previous) / previous) * 100).toFixed(1));
}

export async function getAdminStatsTrend(days: number): Promise<AdminStatsTrend> {
  const allRows = await getAllRequests();
  const now = Date.now();
  const periodMs = days > 0 ? days * 86400000 : 0;

  let currentRows: AdminRequest[];
  let previousRows: AdminRequest[];

  if (periodMs > 0) {
    const currentCutoff = new Date(now - periodMs);
    const previousCutoff = new Date(now - periodMs * 2);
    currentRows = allRows.filter((r) => new Date(r.created_at) >= currentCutoff);
    previousRows = allRows.filter((r) => {
      const d = new Date(r.created_at);
      return d >= previousCutoff && d < currentCutoff;
    });
  } else {
    currentRows = allRows;
    previousRows = [];
  }

  const db = createServerClient();
  const { count: totalAccounts } = await db
    .from('accounts')
    .select('*', { count: 'exact', head: true });

  const keysToday = new Set<string>();
  const keysWeek = new Set<string>();
  const keysMonth = new Set<string>();
  const dayAgo = now - 86400000;
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;

  for (const r of currentRows) {
    const ts = new Date(r.created_at).getTime();
    if (ts >= dayAgo) keysToday.add(r.api_key_id);
    if (ts >= weekAgo) keysWeek.add(r.api_key_id);
    if (ts >= monthAgo) keysMonth.add(r.api_key_id);
  }

  const curr = computeStats(currentRows);
  const prev = computeStats(previousRows);

  const current: AdminStats = {
    ...curr,
    totalAccounts: totalAccounts || 0,
    activeKeysToday: keysToday.size,
    activeKeysWeek: keysWeek.size,
    activeKeysMonth: keysMonth.size,
  };

  const previous: AdminStats = {
    ...prev,
    totalAccounts: 0,
    activeKeysToday: 0,
    activeKeysWeek: 0,
    activeKeysMonth: 0,
  };

  return {
    current,
    previous,
    deltas: {
      spend: pctDelta(curr.totalSpendCents, prev.totalSpendCents),
      requests: pctDelta(curr.totalRequests, prev.totalRequests),
      errorRate: pctDelta(curr.errorRate, prev.errorRate),
      avgLatency: pctDelta(curr.avgLatencyMs, prev.avgLatencyMs),
      tokens: pctDelta(curr.totalInputTokens + curr.totalOutputTokens, prev.totalInputTokens + prev.totalOutputTokens),
      p95Latency: pctDelta(curr.p95LatencyMs, prev.p95LatencyMs),
    },
  };
}

// ---- Admin: provider health ----

export interface ProviderHealth {
  provider: string;
  requests: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  spendCents: number;
  lastErrorAt: string | null;
}

export async function getAdminProviderHealth(days = 0): Promise<ProviderHealth[]> {
  const rows = filterByDays(await getAllRequests(), days);

  const providers = new Map<string, { total: number; errors: number; spendCents: number; latencies: number[]; lastErrorAt: string | null }>();

  for (const r of rows) {
    const p = providers.get(r.provider) || { total: 0, errors: 0, spendCents: 0, latencies: [], lastErrorAt: null };
    p.total++;
    if (r.error_code) {
      p.errors++;
      if (!p.lastErrorAt || r.created_at > p.lastErrorAt) p.lastErrorAt = r.created_at;
    }
    p.spendCents += Number(r.cost_cents);
    p.latencies.push(r.latency_ms);
    providers.set(r.provider, p);
  }

  return Array.from(providers.entries())
    .map(([provider, p]) => {
      p.latencies.sort((a, b) => a - b);
      const p95Idx = Math.floor(p.latencies.length * 0.95);
      const avgLatency = p.total > 0 ? Math.round(p.latencies.reduce((s, l) => s + l, 0) / p.total) : 0;
      return {
        provider,
        requests: p.total,
        successRate: p.total > 0 ? +((((p.total - p.errors) / p.total) * 100).toFixed(1)) : 100,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p.latencies.length > 0 ? (p.latencies[p95Idx] ?? 0) : 0,
        spendCents: p.spendCents,
        lastErrorAt: p.lastErrorAt,
      };
    })
    .sort((a, b) => b.requests - a.requests);
}

// ---- Admin: provider spend breakdown (for ProviderChart) ----

export async function getAdminProviderSpend(days = 0): Promise<Array<{ provider: string; cost: number; count: number }>> {
  const rows = filterByDays(await getAllRequests(), days);

  const providers = new Map<string, { cost: number; count: number }>();
  for (const r of rows) {
    const p = providers.get(r.provider) || { cost: 0, count: 0 };
    p.cost += Number(r.cost_cents) / 100;
    p.count++;
    providers.set(r.provider, p);
  }

  return Array.from(providers.entries())
    .map(([provider, p]) => ({ provider, ...p }))
    .sort((a, b) => b.cost - a.cost);
}

// ---- Provider keys + usage ----

export interface ProviderKeyRow {
  id: string;
  provider: string;
  key_prefix: string;
  key_name: string;
  created_at: string;
  revoked_at: string | null;
}

export interface ProviderActivity {
  provider: string;
  requests: number;
  spendCents: number;
  lastUsed: string;
  lastError: string | null;
  lastErrorTime: string | null;
  models: { model: string; count: number }[];
}

export async function getProviderKeys(userId: string): Promise<ProviderKeyRow[]> {
  const db = createServerClient();
  const { data } = await db
    .from('provider_keys')
    .select('id, provider, key_prefix, key_name, created_at, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  return (data as ProviderKeyRow[]) || [];
}

export async function getProviderActivity(userId: string): Promise<ProviderActivity[]> {
  const requests = await getRecentRequests(userId, 10000);

  const providers = new Map<string, {
    requests: number;
    spendCents: number;
    lastUsed: string;
    lastError: string | null;
    lastErrorTime: string | null;
    models: Map<string, number>;
  }>();

  for (const r of requests) {
    const p = providers.get(r.provider) || {
      requests: 0, spendCents: 0, lastUsed: '', lastError: null, lastErrorTime: null, models: new Map(),
    };
    p.requests++;
    p.spendCents += Number(r.cost_cents);
    if (r.created_at > p.lastUsed) p.lastUsed = r.created_at;
    if (r.error_code && (!p.lastErrorTime || r.created_at > p.lastErrorTime)) {
      p.lastError = r.error_code;
      p.lastErrorTime = r.created_at;
    }
    p.models.set(r.model, (p.models.get(r.model) || 0) + 1);
    providers.set(r.provider, p);
  }

  return Array.from(providers.entries())
    .map(([provider, p]) => ({
      provider,
      requests: p.requests,
      spendCents: p.spendCents,
      lastUsed: p.lastUsed,
      lastError: p.lastError,
      lastErrorTime: p.lastErrorTime,
      models: Array.from(p.models.entries())
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.spendCents - a.spendCents);
}

// ---- User analytics ----

export interface ModelStats {
  model: string;
  provider: string;
  requests: number;
  spendCents: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costPer1kTokens: number;
}

export interface RequestSummary {
  totalRequests: number;
  totalSpendCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgCostCents: number;
  avgLatencyMs: number;
  projectedMonthlyCents: number;
}

export async function getModelBreakdown(userId: string, days = 30): Promise<ModelStats[]> {
  const requests = filterByDays(await getRecentRequests(userId, 10000), days);

  const models = new Map<string, {
    provider: string; requests: number; spendCents: number;
    totalLatency: number; inputTokens: number; outputTokens: number;
  }>();

  for (const r of requests) {
    const m = models.get(r.model) || {
      provider: r.provider, requests: 0, spendCents: 0,
      totalLatency: 0, inputTokens: 0, outputTokens: 0,
    };
    m.requests++;
    m.spendCents += Number(r.cost_cents);
    m.totalLatency += r.latency_ms;
    m.inputTokens += r.input_tokens;
    m.outputTokens += r.output_tokens;
    models.set(r.model, m);
  }

  return Array.from(models.entries())
    .map(([model, m]) => {
      const totalTokens = m.inputTokens + m.outputTokens;
      return {
        model,
        provider: m.provider,
        requests: m.requests,
        spendCents: m.spendCents,
        avgLatencyMs: m.requests > 0 ? Math.round(m.totalLatency / m.requests) : 0,
        totalInputTokens: m.inputTokens,
        totalOutputTokens: m.outputTokens,
        costPer1kTokens: totalTokens > 0 ? +((m.spendCents / totalTokens) * 1000).toFixed(4) : 0,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents);
}

export async function getRequestSummary(userId: string, days = 30): Promise<RequestSummary> {
  const requests = filterByDays(await getRecentRequests(userId, 10000), days);

  let totalSpend = 0;
  let totalLatency = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const r of requests) {
    totalSpend += Number(r.cost_cents);
    totalLatency += r.latency_ms;
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
  }

  const count = requests.length;
  const avgCost = count > 0 ? totalSpend / count : 0;
  const avgLatency = count > 0 ? Math.round(totalLatency / count) : 0;

  // projected monthly: find daily average from last 7 days, multiply by 30
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  let weekSpend = 0;
  let weekCount = 0;
  for (const r of requests) {
    if (new Date(r.created_at) >= weekAgo) {
      weekSpend += Number(r.cost_cents);
      weekCount++;
    }
  }
  const daysActive = Math.max(1, Math.ceil((Date.now() - weekAgo.getTime()) / 86400000));
  const dailyAvg = weekSpend / daysActive;
  const projected = Math.round(dailyAvg * 30);

  return {
    totalRequests: count,
    totalSpendCents: totalSpend,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    avgCostCents: +avgCost.toFixed(4),
    avgLatencyMs: avgLatency,
    projectedMonthlyCents: projected,
  };
}

// ---- Budgets and keys ----

export async function getBudgets(userId: string): Promise<BudgetRow[]> {
  const db = createServerClient();
  const { data } = await db
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data as BudgetRow[]) || [];
}

export async function getApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const db = createServerClient();
  const { data } = await db
    .from('api_keys')
    .select('id, user_id, key_prefix, name, budget_id, created_at, revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data as ApiKeyRow[]) || [];
}

// ---- User: trend deltas ----

export interface UserStatsTrend {
  deltas: {
    spend: number | null;
    requests: number | null;
    avgCost: number | null;
    avgLatency: number | null;
  };
}

export async function getUserStatsTrend(userId: string, days: number): Promise<UserStatsTrend> {
  if (days <= 0) return { deltas: { spend: null, requests: null, avgCost: null, avgLatency: null } };

  const allRequests = await getRecentRequests(userId, 10000);
  const now = Date.now();
  const periodMs = days * 86400000;
  const currentCutoff = new Date(now - periodMs);
  const previousCutoff = new Date(now - periodMs * 2);

  let curSpend = 0, curLatency = 0, curCount = 0;
  let prevSpend = 0, prevLatency = 0, prevCount = 0;

  for (const r of allRequests) {
    const ts = new Date(r.created_at);
    const cost = Number(r.cost_cents);
    if (ts >= currentCutoff) {
      curSpend += cost;
      curLatency += r.latency_ms;
      curCount++;
    } else if (ts >= previousCutoff) {
      prevSpend += cost;
      prevLatency += r.latency_ms;
      prevCount++;
    }
  }

  const curAvgCost = curCount > 0 ? curSpend / curCount : 0;
  const prevAvgCost = prevCount > 0 ? prevSpend / prevCount : 0;
  const curAvgLatency = curCount > 0 ? curLatency / curCount : 0;
  const prevAvgLatency = prevCount > 0 ? prevLatency / prevCount : 0;

  return {
    deltas: {
      spend: pctDelta(curSpend, prevSpend),
      requests: pctDelta(curCount, prevCount),
      avgCost: pctDelta(curAvgCost, prevAvgCost),
      avgLatency: pctDelta(curAvgLatency, prevAvgLatency),
    },
  };
}

// ---- User: budget usage (computed from requests table) ----

export interface BudgetUsageSummary {
  budgetId: string;
  name: string;
  limitCents: number;
  usedCents: number;
  period: string;
  resetAt: string | null;
}

function periodToMs(period: string): number {
  if (period === 'daily') return 86400000;
  if (period === 'weekly') return 7 * 86400000;
  if (period === 'monthly') return 30 * 86400000;
  return 0;
}

export async function getBudgetUsage(userId: string): Promise<BudgetUsageSummary[]> {
  const [budgets, keys, requests] = await Promise.all([
    getBudgets(userId),
    getApiKeys(userId),
    getRecentRequests(userId, 10000),
  ]);

  if (!budgets.length) return [];

  const keyToBudget = new Map<string, string>();
  for (const k of keys) {
    if (k.budget_id) keyToBudget.set(k.id, k.budget_id);
  }

  // compute period start for each budget
  const budgetPeriodStart = new Map<string, Date>();
  for (const b of budgets) {
    const ms = periodToMs(b.period);
    if (ms > 0 && b.reset_at) {
      budgetPeriodStart.set(b.id, new Date(new Date(b.reset_at).getTime() - ms));
    } else {
      budgetPeriodStart.set(b.id, new Date(0));
    }
  }

  const usage = new Map<string, number>();
  for (const r of requests) {
    const bid = keyToBudget.get(r.api_key_id);
    if (!bid) continue;
    const start = budgetPeriodStart.get(bid);
    if (start && new Date(r.created_at) >= start) {
      usage.set(bid, (usage.get(bid) || 0) + Number(r.cost_cents));
    }
  }

  return budgets.map((b) => ({
    budgetId: b.id,
    name: b.name,
    limitCents: b.limit_cents,
    usedCents: usage.get(b.id) || 0,
    period: b.period,
    resetAt: b.reset_at,
  }));
}

export async function getSessions(userId: string, limit = 50, days = 30) {
  const requests = filterByDays(await getRecentRequests(userId, 5000), days);

  const sessions = new Map<string, {
    sessionId: string;
    requestCount: number;
    totalCostCents: number;
    providers: Set<string>;
    firstRequest: string;
    lastRequest: string;
  }>();

  for (const req of requests) {
    const sid = req.session_id || 'no-session';
    const existing = sessions.get(sid) || {
      sessionId: sid,
      requestCount: 0,
      totalCostCents: 0,
      providers: new Set<string>(),
      firstRequest: req.created_at,
      lastRequest: req.created_at,
    };
    existing.requestCount++;
    existing.totalCostCents += Number(req.cost_cents);
    existing.providers.add(req.provider);
    if (req.created_at < existing.firstRequest) existing.firstRequest = req.created_at;
    if (req.created_at > existing.lastRequest) existing.lastRequest = req.created_at;
    sessions.set(sid, existing);
  }

  return Array.from(sessions.values())
    .map((s) => ({ ...s, providers: Array.from(s.providers) }))
    .sort((a, b) => b.lastRequest.localeCompare(a.lastRequest))
    .slice(0, limit);
}

// ---- Admin: paginated request explorer ----

export interface AdminRequestRow extends RequestRow {
  user_id: string;
}

export interface AdminRequestFilters extends RequestFilters {
  userId?: string;
}

export interface AdminPaginatedResult {
  data: AdminRequestRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAdminRequestsPaginated(
  page = 1,
  pageSize = 25,
  filters: AdminRequestFilters = {},
): Promise<AdminPaginatedResult> {
  const db = createServerClient();

  // if filtering by user, resolve their key IDs first
  let keyIds: string[] | null = null;
  if (filters.userId) {
    const { data: keys } = await db
      .from('api_keys')
      .select('id')
      .eq('user_id', filters.userId);
    if (!keys?.length) return { data: [], total: 0, page, pageSize };
    keyIds = keys.map((k) => k.id);
  }

  let query = db
    .from('requests')
    .select('*', { count: 'exact' })
    .eq('source', 'proxy');

  if (keyIds) query = query.in('api_key_id', keyIds);
  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.model) query = query.eq('model', filters.model);
  if (filters.sessionId) query = query.eq('session_id', filters.sessionId);
  if (filters.status === 'error') query = query.not('error_code', 'is', null);
  if (filters.status === 'ok') query = query.is('error_code', null);

  const sortCol = filters.sortBy || 'created_at';
  const ascending = filters.sortOrder === 'asc';
  query = query.order(sortCol, { ascending });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count } = await query;
  const rows = (data as RequestRow[]) || [];

  // resolve user_id for each row via api_keys
  const uniqueKeyIds = [...new Set(rows.map((r) => r.api_key_id))];
  const keyUserMap = new Map<string, string>();

  if (uniqueKeyIds.length > 0) {
    const { data: keys } = await db
      .from('api_keys')
      .select('id, user_id')
      .in('id', uniqueKeyIds);
    for (const k of keys || []) {
      keyUserMap.set(k.id, k.user_id);
    }
  }

  const enriched: AdminRequestRow[] = rows.map((r) => ({
    ...r,
    user_id: keyUserMap.get(r.api_key_id) || 'unknown',
  }));

  return {
    data: enriched,
    total: count || 0,
    page,
    pageSize,
  };
}

export async function getAdminDistinctProviders(): Promise<string[]> {
  const db = createServerClient();
  const { data } = await db
    .from('requests')
    .select('provider')
    .eq('source', 'proxy')
    .limit(10000);

  if (!data) return [];
  return [...new Set(data.map((r: { provider: string }) => r.provider))].sort();
}

export async function getAdminDistinctModels(): Promise<string[]> {
  const db = createServerClient();
  const { data } = await db
    .from('requests')
    .select('model')
    .eq('source', 'proxy')
    .limit(10000);

  if (!data) return [];
  return [...new Set(data.map((r: { model: string }) => r.model))].sort();
}

export interface AdminUserOption {
  userId: string;
  keyCount: number;
}

export async function getAdminDistinctUsers(): Promise<AdminUserOption[]> {
  const db = createServerClient();
  const { data: keys } = await db
    .from('api_keys')
    .select('user_id');

  if (!keys?.length) return [];

  const counts = new Map<string, number>();
  for (const k of keys) {
    counts.set(k.user_id, (counts.get(k.user_id) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([userId, keyCount]) => ({ userId, keyCount }))
    .sort((a, b) => b.keyCount - a.keyCount);
}
