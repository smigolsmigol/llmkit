// thin PostgREST client for Supabase - zero deps, just fetch

export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  budget_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface RequestInsert {
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

  if (init.method === 'POST') {
    headers['Prefer'] = 'return=minimal';
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
    `api_keys?key_hash=eq.${keyHash}&revoked_at=is.null&select=id,user_id,key_prefix,name,budget_id`,
  );

  if (!res.ok) return null;

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
