// thin PostgREST client for Supabase - zero deps, just fetch

export interface BudgetRow {
  limit_cents: number;
  period: 'daily' | 'weekly' | 'monthly' | 'total';
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  budget_id: string | null;
  budgets: BudgetRow | null;
  rpm_limit: number;
  created_at: string;
  revoked_at: string | null;
}

export interface ProviderKeyRow {
  id: string;
  user_id: string;
  provider: string;
  encrypted_key: string;
  iv: string;
  key_prefix: string;
  key_name: string;
  created_at: string;
  revoked_at: string | null;
}

export interface RequestInsert {
  user_id: string;
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
  source: 'proxy' | 'claude-code';
}

function postgrest(
  url: string,
  serviceKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  if (init.method === 'POST' && !path.startsWith('rpc/')) {
    headers.Prefer = 'return=minimal';
  } else if (!init.method || init.method === 'GET') {
    headers.Prefer = 'count=exact';
  }

  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
}

export async function findApiKey(
  url: string,
  serviceKey: string,
  keyHash: string,
): Promise<ApiKeyRow | null> {
  const res = await postgrest(
    url,
    serviceKey,
    `api_keys?key_hash=eq.${keyHash}&revoked_at=is.null&select=id,user_id,key_prefix,name,budget_id,rpm_limit,budgets(limit_cents,period)`,
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`api key lookup failed (${res.status}): ${detail}`);
    throw new Error('database operation failed');
  }

  const rows = await res.json() as ApiKeyRow[];
  return rows[0] ?? null;
}

export async function logRequest(
  url: string,
  serviceKey: string,
  row: RequestInsert,
): Promise<void> {
  const res = await postgrest(url, serviceKey, 'requests', {
    method: 'POST',
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    console.error('failed to log request:', res.status, await res.text().catch(() => ''));
  }
}

export async function findProviderKey(
  url: string,
  serviceKey: string,
  userId: string,
  provider: string,
): Promise<ProviderKeyRow | null> {
  const res = await postgrest(
    url,
    serviceKey,
    `provider_keys?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}&revoked_at=is.null&select=id,user_id,provider,encrypted_key,iv,key_prefix,key_name,created_at&limit=1`,
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`provider key lookup failed (${res.status}): ${detail}`);
    throw new Error('database operation failed');
  }

  const rows = await res.json() as ProviderKeyRow[];
  return rows[0] ?? null;
}

export async function listProviderKeys(
  url: string,
  serviceKey: string,
  userId: string,
): Promise<Omit<ProviderKeyRow, 'encrypted_key' | 'iv'>[]> {
  const res = await postgrest(
    url,
    serviceKey,
    `provider_keys?user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null&select=id,provider,key_prefix,key_name,created_at&order=created_at.desc`,
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`provider keys list failed (${res.status}): ${detail}`);
    throw new Error('database operation failed');
  }

  return await res.json();
}

export async function storeProviderKey(
  url: string,
  serviceKey: string,
  row: Omit<ProviderKeyRow, 'created_at' | 'revoked_at'>,
): Promise<void> {
  const res = await postgrest(url, serviceKey, 'provider_keys', {
    method: 'POST',
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`provider key store failed (${res.status}): ${detail}`);
    throw new Error('database operation failed');
  }
}

export async function revokeProviderKey(
  url: string,
  serviceKey: string,
  keyId: string,
  userId: string,
): Promise<boolean> {
  const res = await postgrest(
    url,
    serviceKey,
    `provider_keys?id=eq.${encodeURIComponent(keyId)}&user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null`,
    {
      method: 'PATCH',
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`provider key revoke failed (${res.status}): ${detail}`);
    throw new Error('database operation failed');
  }

  return true;
}
