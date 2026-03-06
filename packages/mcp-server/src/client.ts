// PostgREST client for Supabase - same pattern as proxy/src/db.ts
// No @supabase/supabase-js dependency. Raw fetch keeps the package tiny
// and startup instant (MCP servers need to boot in <500ms).

interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  userId: string;
  proxyUrl?: string;
}

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const supabaseUrl = process.env.LLMKIT_SUPABASE_URL;
  const supabaseKey = process.env.LLMKIT_SUPABASE_KEY;
  const userId = process.env.LLMKIT_USER_ID;

  if (!supabaseUrl || !supabaseKey || !userId) {
    throw new Error(
      'Missing env vars. Set LLMKIT_SUPABASE_URL, LLMKIT_SUPABASE_KEY, and LLMKIT_USER_ID.'
    );
  }

  cachedConfig = {
    supabaseUrl,
    supabaseKey,
    userId,
    proxyUrl: process.env.LLMKIT_PROXY_URL,
  };

  return cachedConfig;
}

async function query<T>(path: string): Promise<T[]> {
  const { supabaseUrl, supabaseKey } = loadConfig();

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase query failed (${res.status}): ${path}`);
  }

  return res.json() as Promise<T[]>;
}

// ---- Query functions used by MCP tools ----

interface RequestRow {
  id: string;
  api_key_id: string;
  session_id: string | null;
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

interface ApiKeyRow {
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
  created_at: string;
}

export async function getUserKeyIds(): Promise<string[]> {
  const { userId } = loadConfig();
  const keys = await query<{ id: string }>(
    `api_keys?user_id=eq.${userId}&select=id`
  );
  return keys.map((k) => k.id);
}

export async function getRequests(days: number, limit = 5000): Promise<RequestRow[]> {
  const keyIds = await getUserKeyIds();
  if (!keyIds.length) return [];

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const filter = `api_key_id=in.(${keyIds.join(',')})&created_at=gte.${cutoff}&order=created_at.desc&limit=${limit}`;

  return query<RequestRow>(`requests?${filter}&select=*`);
}

export async function getApiKeys(): Promise<ApiKeyRow[]> {
  const { userId } = loadConfig();
  return query<ApiKeyRow>(
    `api_keys?user_id=eq.${userId}&order=created_at.desc&select=id,name,key_prefix,budget_id,created_at,revoked_at`
  );
}

export async function getBudgets(): Promise<BudgetRow[]> {
  const { userId } = loadConfig();
  return query<BudgetRow>(
    `budgets?user_id=eq.${userId}&order=created_at.desc&select=id,name,limit_cents,period,created_at`
  );
}
