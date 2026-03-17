// HTTP client for the LLMKit proxy analytics API.
// Authenticates with the user's LLMKit API key, never touches Supabase directly.

interface Config {
  proxyUrl: string;
  apiKey: string;
}

let cachedConfig: Config | null = null;
let configChecked = false;

export function loadConfig(): Config | null {
  if (configChecked) return cachedConfig;
  configChecked = true;

  const apiKey = process.env.LLMKIT_API_KEY;
  const proxyUrl = process.env.LLMKIT_PROXY_URL || 'https://llmkit-proxy.smigolsmigol.workers.dev';

  if (!apiKey) return null;

  cachedConfig = { proxyUrl, apiKey };
  return cachedConfig;
}

function requireConfig(): Config {
  const config = loadConfig();
  if (!config) {
    const dashUrl = process.env.LLMKIT_DASHBOARD_URL || 'https://dashboard-two-zeta-54.vercel.app';
    throw new Error(
      `LLMKIT_API_KEY required. The llmkit_cc_* tools work without a key.\nGet one at ${dashUrl}`,
    );
  }
  return config;
}

async function api<T>(path: string): Promise<T> {
  const { proxyUrl, apiKey } = requireConfig();

  const res = await fetch(`${proxyUrl}/v1${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API request failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

// ---- Analytics API types ----

export interface UsageResponse {
  period: string;
  requests: number;
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  cacheHitRate: number;
  topModels: { model: string; requests: number }[];
}

export interface CostsResponse {
  groupBy: string;
  days: number;
  breakdown: { key: string; count: number; costCents: number; inputTokens: number; outputTokens: number }[];
}

export interface KeysResponse {
  keys: {
    id: string;
    name: string;
    key_prefix: string;
    budget_id: string | null;
    created_at: string;
    revoked_at: string | null;
  }[];
}

export interface BudgetsResponse {
  budgets: {
    id: string;
    name: string;
    limit_cents: number;
    period: string;
    created_at: string;
  }[];
}

export interface SessionsResponse {
  sessions: {
    sessionId: string;
    requests: number;
    costCents: number;
    providers: string[];
    models: string[];
    first: string;
    last: string;
  }[];
}

// ---- API calls ----

export function getUsage(period: string): Promise<UsageResponse> {
  return api(`/analytics/usage?period=${period}`);
}

export function getCosts(groupBy: string, days: number, provider?: string, model?: string): Promise<CostsResponse> {
  let path = `/analytics/costs?groupBy=${groupBy}&days=${days}`;
  if (provider) path += `&provider=${encodeURIComponent(provider)}`;
  if (model) path += `&model=${encodeURIComponent(model)}`;
  return api(path);
}

export function getKeys(): Promise<KeysResponse> {
  return api('/analytics/keys');
}

export function getBudgets(): Promise<BudgetsResponse> {
  return api('/analytics/budgets');
}

export function getSessions(sessionId?: string, limit?: number): Promise<SessionsResponse> {
  let path = '/analytics/sessions';
  const params: string[] = [];
  if (sessionId) params.push(`sessionId=${encodeURIComponent(sessionId)}`);
  if (limit) params.push(`limit=${limit}`);
  if (params.length) path += `?${params.join('&')}`;
  return api(path);
}
