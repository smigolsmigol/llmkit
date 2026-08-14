import { cache } from 'react';
import { createServerClient } from './supabase';

export async function getAccountPlan(userId: string): Promise<string | null> {
  const db = createServerClient();
  const { data } = await db.from('accounts').select('plan').eq('user_id', userId).single();
  return data?.plan ?? null;
}

export interface RequestRow {
  id: string;
  api_key_id: string;
  customer_id: string | null;
  workflow_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  end_user_id: string | null;
  budget_id: string | null;
  budget_reservation_id: string | null;
  reserved_cost_cents: number | null;
  idempotency_key_hash: string | null;
  response_sha256: string | null;
  settlement_status: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_cents: number | null;
  latency_ms: number;
  status: string;
  error_code: string | null;
  tool_calls: { name: string }[] | null;
  created_at: string;
}

function knownCostCents(value: number | null): number | null {
  if (value === null) return null;
  const cost = Number(value);
  return Number.isFinite(cost) ? cost : null;
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

export interface CostCoverage {
  pricedRequests: number;
  unknownCostRequests: number;
  costComplete: boolean;
}

interface ProviderStats extends CostCoverage {
  provider: string;
  count: number;
  totalCostCents: number;
}

export const getRecentRequests = cache(async function getRecentRequests(userId: string, limit = 20): Promise<RequestRow[]> {
  const db = createServerClient();
  const { data: keys, error: keysError } = await db
    .from('api_keys')
    .select('id')
    .eq('user_id', userId);

  if (keysError) throw new Error(`Failed to load analytics keys: ${keysError.message}`);

  if (!keys?.length) return [];

  const keyIds = keys.map((k) => k.id);
  const { data, error } = await db
    .from('requests')
    .select('*')
    .in('api_key_id', keyIds)
    .eq('source', 'proxy')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load request receipts: ${error.message}`);

  return (data as RequestRow[]) || [];
});

const ANALYTICS_PAGE_SIZE = 1000;

const getUserAnalyticsRequests = cache(async function getUserAnalyticsRequests(
  userId: string,
  days = 0,
): Promise<RequestRow[]> {
  const db = createServerClient();
  const { data: keys, error: keysError } = await db
    .from('api_keys')
    .select('id')
    .eq('user_id', userId);
  if (keysError) throw new Error(`Failed to load analytics keys: ${keysError.message}`);
  if (!keys?.length) return [];

  const keyIds = keys.map((key) => key.id);
  const snapshot = new Date().toISOString();
  const cutoff = days > 0
    ? new Date(Date.now() - days * 86400000).toISOString()
    : null;
  const rows: RequestRow[] = [];
  let expectedTotal: number | null = null;
  let offset = 0;

  while (true) {
    let query = db
      .from('requests')
      .select('*', { count: 'exact' })
      .in('api_key_id', keyIds)
      .eq('source', 'proxy')
      .lte('created_at', snapshot)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
    if (cutoff) query = query.gte('created_at', cutoff);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to load analytics request page: ${error.message}`);
    if (count === null) throw new Error('Analytics request page omitted an exact row count');
    if (expectedTotal === null) expectedTotal = count;
    if (count !== expectedTotal) throw new Error('Analytics request count changed during pagination');

    const page = (data as RequestRow[]) || [];
    rows.push(...page);
    if (rows.length >= expectedTotal || page.length === 0) break;
    offset += page.length;
  }

  if (rows.length !== expectedTotal) {
    throw new Error(`Analytics pagination returned ${rows.length} of ${expectedTotal} request receipts`);
  }
  return rows;
});

export async function getSpendByProvider(userId: string, days = 30): Promise<ProviderStats[]> {
  const requests = await getUserAnalyticsRequests(userId, days);

  const byProvider = new Map<string, {
    count: number;
    pricedRequests: number;
    unknownCostRequests: number;
    totalCostCents: number;
  }>();
  for (const req of requests) {
    const existing = byProvider.get(req.provider) || {
      count: 0,
      pricedRequests: 0,
      unknownCostRequests: 0,
      totalCostCents: 0,
    };
    existing.count++;
    const cost = knownCostCents(req.cost_cents);
    if (cost === null) {
      existing.unknownCostRequests++;
    } else {
      existing.pricedRequests++;
      existing.totalCostCents += cost;
    }
    byProvider.set(req.provider, existing);
  }

  return Array.from(byProvider.entries()).map(([provider, stats]) => ({
    provider,
    ...stats,
    costComplete: stats.unknownCostRequests === 0,
  }));
}

export async function getTotalSpend(userId: string, days?: number): Promise<{
  today: number;
  week: number;
  month: number;
  range: number;
} & CostCoverage> {
  const analyticsDays = days === 0 ? 0 : Math.max(days ?? 30, 30);
  const requests = await getUserAnalyticsRequests(userId, analyticsDays);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);
  const rangeAgo = days ? new Date(now.getTime() - days * 86400000) : null;

  let today = 0;
  let week = 0;
  let month = 0;
  let range = 0;
  let pricedRequests = 0;
  let unknownCostRequests = 0;

  for (const req of requests) {
    const cost = knownCostCents(req.cost_cents);
    const date = new Date(req.created_at);
    if (!rangeAgo || date >= rangeAgo) {
      if (cost === null) unknownCostRequests++;
      else pricedRequests++;
    }
    if (cost === null) continue;
    if (req.created_at.startsWith(todayStr)) today += cost;
    if (date >= weekAgo) week += cost;
    if (date >= monthAgo) month += cost;
    if (!rangeAgo || date >= rangeAgo) range += cost;
  }

  return {
    today,
    week,
    month,
    range,
    pricedRequests,
    unknownCostRequests,
    costComplete: unknownCostRequests === 0,
  };
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

  const ALLOWED_SORT = ['created_at', 'cost_cents', 'latency_ms', 'provider', 'model', 'input_tokens', 'output_tokens'];
  const requestedSort = filters.sortBy;
  const sortCol = requestedSort && ALLOWED_SORT.includes(requestedSort) ? requestedSort : 'created_at';
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
  const requests = await getUserAnalyticsRequests(userId);
  return [...new Set(requests.map((r) => r.provider))].sort();
}

export async function getDistinctModels(userId: string): Promise<string[]> {
  const requests = await getUserAnalyticsRequests(userId);
  return [...new Set(requests.map((r) => r.model))].sort();
}

// ---- Cache analytics ----

// ---- Timeseries (raw per-request data for interactive charts) ----

export interface TimeseriesPoint {
  t: string;
  costCents: number | null;
  inputTokens: number;
  outputTokens: number;
}

export async function getRequestTimeseries(userId: string, days = 30): Promise<TimeseriesPoint[]> {
  const requests = await getUserAnalyticsRequests(userId, days);
  return requests
    .map((r) => ({
      t: r.created_at,
      costCents: knownCostCents(r.cost_cents),
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
      costCents: knownCostCents(r.cost_cents),
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
  id: string;
  api_key_id: string;
  cost_cents: number | null;
  latency_ms: number;
  error_code: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

const getAllRequests = cache(async function getAllRequests(): Promise<AdminRequest[]> {
  const db = createServerClient();
  const snapshot = new Date().toISOString();
  const rows: AdminRequest[] = [];
  let expectedTotal: number | null = null;
  let offset = 0;

  while (true) {
    const { data, error, count } = await db
      .from('requests')
      .select('id, api_key_id, cost_cents, latency_ms, error_code, provider, model, input_tokens, output_tokens, created_at', { count: 'exact' })
      .eq('source', 'proxy')
      .lte('created_at', snapshot)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load admin request page: ${error.message}`);
    if (count === null) throw new Error('Admin request page omitted an exact row count');
    if (expectedTotal === null) expectedTotal = count;
    if (count !== expectedTotal) throw new Error('Admin request count changed during pagination');

    const page = (data as AdminRequest[]) || [];
    rows.push(...page);
    if (rows.length >= expectedTotal || page.length === 0) break;
    offset += page.length;
  }

  if (rows.length !== expectedTotal) {
    throw new Error(`Admin pagination returned ${rows.length} of ${expectedTotal} request receipts`);
  }
  return rows;
});

function filterByDays<T extends { created_at: string }>(rows: T[], days: number): T[] {
  if (days <= 0) return rows;
  const cutoff = new Date(Date.now() - days * 86400000);
  return rows.filter((r) => new Date(r.created_at) >= cutoff);
}

export interface AdminStats extends CostCoverage {
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

export interface UserBreakdown extends CostCoverage {
  userId: string;
  plan: string;
  note: string | null;
  requests: number;
  spendCents: number;
  errors: number;
  avgLatencyMs: number;
  lastActive: string;
}

export interface ModelBreakdown extends CostCoverage {
  model: string;
  provider: string;
  requests: number;
  spendCents: number;
  avgLatencyMs: number;
  avgTokensPerReq: number;
  costPer1kTokens: number;
}

export async function getAdminUserBreakdown(days = 0): Promise<UserBreakdown[]> {
  const db = createServerClient();

  const { data: keys } = await db
    .from('api_keys')
    .select('id, user_id');

  if (!keys?.length) return [];

  const keyToUser = new Map(keys.map((k) => [k.id, k.user_id]));
  const rows = filterByDays(await getAllRequests(), days);

  const users = new Map<string, {
    requests: number; pricedRequests: number; unknownCostRequests: number;
    spendCents: number; errors: number; totalLatency: number; lastActive: string;
  }>();
  for (const r of rows) {
    const uid = keyToUser.get(r.api_key_id);
    if (!uid) continue;
    const u = users.get(uid) || {
      requests: 0, pricedRequests: 0, unknownCostRequests: 0,
      spendCents: 0, errors: 0, totalLatency: 0, lastActive: '',
    };
    u.requests++;
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) u.unknownCostRequests++;
    else {
      u.pricedRequests++;
      u.spendCents += cost;
    }
    if (r.error_code) u.errors++;
    u.totalLatency += r.latency_ms;
    if (r.created_at > u.lastActive) u.lastActive = r.created_at;
    users.set(uid, u);
  }

  const { data: accounts } = await db
    .from('accounts')
    .select('user_id, plan, note');

  const acctMap = new Map((accounts || []).map((a) => [a.user_id, a]));

  // include all accounts, even those with 0 requests
  for (const acct of accounts || []) {
    if (!users.has(acct.user_id)) {
      users.set(acct.user_id, {
        requests: 0, pricedRequests: 0, unknownCostRequests: 0,
        spendCents: 0, errors: 0, totalLatency: 0, lastActive: '',
      });
    }
  }

  return Array.from(users.entries())
    .map(([userId, u]) => ({
      userId,
      plan: acctMap.get(userId)?.plan || 'free',
      note: acctMap.get(userId)?.note || null,
      requests: u.requests,
      pricedRequests: u.pricedRequests,
      unknownCostRequests: u.unknownCostRequests,
      costComplete: u.unknownCostRequests === 0,
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
    provider: string; requests: number; pricedRequests: number; unknownCostRequests: number;
    spendCents: number; totalLatency: number; totalInput: number; totalOutput: number;
    pricedInput: number; pricedOutput: number;
  }>();
  for (const r of rows) {
    const m = models.get(r.model) || {
      provider: r.provider, requests: 0, pricedRequests: 0, unknownCostRequests: 0,
      spendCents: 0, totalLatency: 0, totalInput: 0, totalOutput: 0,
      pricedInput: 0, pricedOutput: 0,
    };
    m.requests++;
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) m.unknownCostRequests++;
    else {
      m.pricedRequests++;
      m.spendCents += cost;
      m.pricedInput += r.input_tokens;
      m.pricedOutput += r.output_tokens;
    }
    m.totalLatency += r.latency_ms;
    m.totalInput += r.input_tokens;
    m.totalOutput += r.output_tokens;
    models.set(r.model, m);
  }

  return Array.from(models.entries())
    .map(([model, m]) => {
      const totalTokens = m.totalInput + m.totalOutput;
      const pricedTokens = m.pricedInput + m.pricedOutput;
      return {
        model,
        provider: m.provider,
        requests: m.requests,
        pricedRequests: m.pricedRequests,
        unknownCostRequests: m.unknownCostRequests,
        costComplete: m.unknownCostRequests === 0,
        spendCents: m.spendCents,
        avgLatencyMs: m.requests > 0 ? Math.round(m.totalLatency / m.requests) : 0,
        avgTokensPerReq: m.requests > 0 ? Math.round(totalTokens / m.requests) : 0,
        costPer1kTokens: pricedTokens > 0 ? +((m.spendCents / pricedTokens) * 1000).toFixed(4) : 0,
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
  let totalSpend = 0;
  let pricedRequests = 0;
  let unknownCostRequests = 0;
  const latencies: number[] = [];

  for (const r of rows) {
    if (r.error_code) errors++;
    totalLatency += r.latency_ms;
    latencies.push(r.latency_ms);
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) unknownCostRequests++;
    else {
      pricedRequests++;
      totalSpend += cost;
    }
  }

  latencies.sort((a, b) => a - b);
  const p95Idx = Math.floor(latencies.length * 0.95);

  return {
    totalRequests: rows.length,
    pricedRequests,
    unknownCostRequests,
    costComplete: unknownCostRequests === 0,
    totalSpendCents: totalSpend,
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
      spend: curr.costComplete && prev.costComplete
        ? pctDelta(curr.totalSpendCents, prev.totalSpendCents)
        : null,
      requests: pctDelta(curr.totalRequests, prev.totalRequests),
      errorRate: pctDelta(curr.errorRate, prev.errorRate),
      avgLatency: pctDelta(curr.avgLatencyMs, prev.avgLatencyMs),
      tokens: pctDelta(curr.totalInputTokens + curr.totalOutputTokens, prev.totalInputTokens + prev.totalOutputTokens),
      p95Latency: pctDelta(curr.p95LatencyMs, prev.p95LatencyMs),
    },
  };
}

// ---- Admin: provider health ----

export interface ProviderHealth extends CostCoverage {
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

  const providers = new Map<string, {
    total: number; pricedRequests: number; unknownCostRequests: number;
    errors: number; spendCents: number; latencies: number[]; lastErrorAt: string | null;
  }>();

  for (const r of rows) {
    const p = providers.get(r.provider) || {
      total: 0, pricedRequests: 0, unknownCostRequests: 0,
      errors: 0, spendCents: 0, latencies: [], lastErrorAt: null,
    };
    p.total++;
    if (r.error_code) {
      p.errors++;
      if (!p.lastErrorAt || r.created_at > p.lastErrorAt) p.lastErrorAt = r.created_at;
    }
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) p.unknownCostRequests++;
    else {
      p.pricedRequests++;
      p.spendCents += cost;
    }
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
        pricedRequests: p.pricedRequests,
        unknownCostRequests: p.unknownCostRequests,
        costComplete: p.unknownCostRequests === 0,
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

export async function getAdminProviderSpend(days = 0): Promise<Array<{
  provider: string; cost: number; count: number;
  pricedRequests: number; unknownCostRequests: number; costComplete: boolean;
}>> {
  const rows = filterByDays(await getAllRequests(), days);

  const providers = new Map<string, {
    cost: number; count: number; pricedRequests: number; unknownCostRequests: number;
  }>();
  for (const r of rows) {
    const p = providers.get(r.provider) || {
      cost: 0, count: 0, pricedRequests: 0, unknownCostRequests: 0,
    };
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) p.unknownCostRequests++;
    else {
      p.pricedRequests++;
      p.cost += cost / 100;
    }
    p.count++;
    providers.set(r.provider, p);
  }

  return Array.from(providers.entries())
    .map(([provider, p]) => ({
      provider,
      ...p,
      costComplete: p.unknownCostRequests === 0,
    }))
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

export interface ProviderActivity extends CostCoverage {
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
  const requests = await getUserAnalyticsRequests(userId);

  const providers = new Map<string, {
    requests: number;
    pricedRequests: number;
    unknownCostRequests: number;
    spendCents: number;
    lastUsed: string;
    lastError: string | null;
    lastErrorTime: string | null;
    models: Map<string, number>;
  }>();

  for (const r of requests) {
    const p = providers.get(r.provider) || {
      requests: 0, pricedRequests: 0, unknownCostRequests: 0,
      spendCents: 0, lastUsed: '', lastError: null, lastErrorTime: null, models: new Map(),
    };
    p.requests++;
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) p.unknownCostRequests++;
    else {
      p.pricedRequests++;
      p.spendCents += cost;
    }
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
      pricedRequests: p.pricedRequests,
      unknownCostRequests: p.unknownCostRequests,
      costComplete: p.unknownCostRequests === 0,
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

export interface ModelStats extends CostCoverage {
  model: string;
  provider: string;
  requests: number;
  spendCents: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costPer1kTokens: number;
}

export interface RequestSummary extends CostCoverage {
  totalRequests: number;
  totalSpendCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgCostCents: number;
  avgLatencyMs: number;
  projectedMonthlyCents: number;
}

export async function getModelBreakdown(userId: string, days = 30): Promise<ModelStats[]> {
  const requests = await getUserAnalyticsRequests(userId, days);

  const models = new Map<string, {
    provider: string; requests: number; pricedRequests: number; unknownCostRequests: number;
    spendCents: number; totalLatency: number; inputTokens: number; outputTokens: number;
    pricedInputTokens: number; pricedOutputTokens: number;
  }>();

  for (const r of requests) {
    const m = models.get(r.model) || {
      provider: r.provider, requests: 0, pricedRequests: 0, unknownCostRequests: 0,
      spendCents: 0, totalLatency: 0, inputTokens: 0, outputTokens: 0,
      pricedInputTokens: 0, pricedOutputTokens: 0,
    };
    m.requests++;
    const cost = knownCostCents(r.cost_cents);
    if (cost === null) m.unknownCostRequests++;
    else {
      m.pricedRequests++;
      m.spendCents += cost;
      m.pricedInputTokens += r.input_tokens;
      m.pricedOutputTokens += r.output_tokens;
    }
    m.totalLatency += r.latency_ms;
    m.inputTokens += r.input_tokens;
    m.outputTokens += r.output_tokens;
    models.set(r.model, m);
  }

  return Array.from(models.entries())
    .map(([model, m]) => {
      const pricedTokens = m.pricedInputTokens + m.pricedOutputTokens;
      return {
        model,
        provider: m.provider,
        requests: m.requests,
        pricedRequests: m.pricedRequests,
        unknownCostRequests: m.unknownCostRequests,
        costComplete: m.unknownCostRequests === 0,
        spendCents: m.spendCents,
        avgLatencyMs: m.requests > 0 ? Math.round(m.totalLatency / m.requests) : 0,
        totalInputTokens: m.inputTokens,
        totalOutputTokens: m.outputTokens,
        costPer1kTokens: pricedTokens > 0 ? +((m.spendCents / pricedTokens) * 1000).toFixed(4) : 0,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents);
}

export async function getRequestSummary(userId: string, days = 30): Promise<RequestSummary> {
  const requests = await getUserAnalyticsRequests(userId, days);

  let totalSpend = 0;
  let pricedCount = 0;
  let totalLatency = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const r of requests) {
    const cost = knownCostCents(r.cost_cents);
    totalSpend += cost ?? 0;
    pricedCount += Number(cost !== null);
    totalLatency += r.latency_ms;
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
  }

  const count = requests.length;
  const avgCost = pricedCount > 0 ? totalSpend / pricedCount : 0;
  const avgLatency = count > 0 ? Math.round(totalLatency / count) : 0;

  // projected monthly: find daily average from last 7 days, multiply by 30
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  let weekSpend = 0;
  for (const r of requests) {
    if (new Date(r.created_at) >= weekAgo) {
      const cost = knownCostCents(r.cost_cents);
      weekSpend += cost ?? 0;
    }
  }
  const daysActive = Math.max(1, Math.ceil((Date.now() - weekAgo.getTime()) / 86400000));
  const dailyAvg = weekSpend / daysActive;
  const projected = Math.round(dailyAvg * 30);

  return {
    totalRequests: count,
    pricedRequests: pricedCount,
    unknownCostRequests: count - pricedCount,
    costComplete: pricedCount === count,
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

  const allRequests = await getUserAnalyticsRequests(userId, days * 2);
  const now = Date.now();
  const periodMs = days * 86400000;
  const currentCutoff = new Date(now - periodMs);
  const previousCutoff = new Date(now - periodMs * 2);

  let curSpend = 0, curLatency = 0, curCount = 0, curPricedCount = 0, curUnknownCost = 0;
  let prevSpend = 0, prevLatency = 0, prevCount = 0, prevPricedCount = 0, prevUnknownCost = 0;

  for (const r of allRequests) {
    const ts = new Date(r.created_at);
    const cost = knownCostCents(r.cost_cents);
    if (ts >= currentCutoff) {
      curSpend += cost ?? 0;
      curPricedCount += Number(cost !== null);
      curUnknownCost += Number(cost === null);
      curLatency += r.latency_ms;
      curCount++;
    } else if (ts >= previousCutoff) {
      prevSpend += cost ?? 0;
      prevPricedCount += Number(cost !== null);
      prevUnknownCost += Number(cost === null);
      prevLatency += r.latency_ms;
      prevCount++;
    }
  }

  const curAvgCost = curPricedCount > 0 ? curSpend / curPricedCount : 0;
  const prevAvgCost = prevPricedCount > 0 ? prevSpend / prevPricedCount : 0;
  const curAvgLatency = curCount > 0 ? curLatency / curCount : 0;
  const prevAvgLatency = prevCount > 0 ? prevLatency / prevCount : 0;

  return {
    deltas: {
      spend: curUnknownCost === 0 && prevUnknownCost === 0 ? pctDelta(curSpend, prevSpend) : null,
      requests: pctDelta(curCount, prevCount),
      avgCost: curUnknownCost === 0 && prevUnknownCost === 0 ? pctDelta(curAvgCost, prevAvgCost) : null,
      avgLatency: pctDelta(curAvgLatency, prevAvgLatency),
    },
  };
}

// ---- User: budget usage (computed from requests table) ----

export interface BudgetUsageSummary extends CostCoverage {
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
  const budgets = await getBudgets(userId);
  if (!budgets.length) return [];
  const analyticsDays = budgets.some((budget) => periodToMs(budget.period) === 0) ? 0 : 30;
  const requests = await getUserAnalyticsRequests(userId, analyticsDays);

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

  const usage = new Map<string, {
    usedCents: number;
    pricedRequests: number;
    unknownCostRequests: number;
  }>();
  for (const r of requests) {
    const bid = r.budget_id;
    if (!bid) continue;
    const start = budgetPeriodStart.get(bid);
    if (start && new Date(r.created_at) >= start) {
      const current = usage.get(bid) || {
        usedCents: 0,
        pricedRequests: 0,
        unknownCostRequests: 0,
      };
      const cost = knownCostCents(r.cost_cents);
      if (cost === null) current.unknownCostRequests++;
      else {
        current.pricedRequests++;
        current.usedCents += cost;
      }
      usage.set(bid, current);
    }
  }

  return budgets.map((b) => {
    const current = usage.get(b.id) || {
      usedCents: 0,
      pricedRequests: 0,
      unknownCostRequests: 0,
    };
    return {
      budgetId: b.id,
      name: b.name,
      limitCents: b.limit_cents,
      usedCents: current.usedCents,
      pricedRequests: current.pricedRequests,
      unknownCostRequests: current.unknownCostRequests,
      costComplete: current.unknownCostRequests === 0,
      period: b.period,
      resetAt: b.reset_at,
    };
  });
}

export async function getSessions(userId: string, limit = 50, days = 30) {
  const requests = await getUserAnalyticsRequests(userId, days);

  const sessions = new Map<string, {
    sessionId: string;
    requestCount: number;
    pricedRequests: number;
    unknownCostRequests: number;
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
      pricedRequests: 0,
      unknownCostRequests: 0,
      totalCostCents: 0,
      providers: new Set<string>(),
      firstRequest: req.created_at,
      lastRequest: req.created_at,
    };
    existing.requestCount++;
    const cost = knownCostCents(req.cost_cents);
    if (cost === null) existing.unknownCostRequests++;
    else {
      existing.pricedRequests++;
      existing.totalCostCents += cost;
    }
    existing.providers.add(req.provider);
    if (req.created_at < existing.firstRequest) existing.firstRequest = req.created_at;
    if (req.created_at > existing.lastRequest) existing.lastRequest = req.created_at;
    sessions.set(sid, existing);
  }

  return Array.from(sessions.values())
    .map((s) => ({
      ...s,
      costComplete: s.unknownCostRequests === 0,
      providers: Array.from(s.providers),
    }))
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

  const ALLOWED_SORT = ['created_at', 'cost_cents', 'latency_ms', 'provider', 'model', 'input_tokens', 'output_tokens'];
  const requestedSort = filters.sortBy;
  const sortCol = requestedSort && ALLOWED_SORT.includes(requestedSort) ? requestedSort : 'created_at';
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
