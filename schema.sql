-- LLMKit database schema
-- target: Supabase (PostgreSQL 15+)
-- run via Supabase SQL editor or psql

create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  limit_cents integer not null,
  period text not null check (period in ('daily', 'weekly', 'monthly', 'total')),
  reset_at timestamptz,
  created_at timestamptz not null default now()
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  key_hash text not null unique,
  key_prefix text not null,
  name text not null default 'default',
  budget_id uuid references budgets(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references api_keys(id),
  session_id text,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_cents numeric(10, 4) not null default 0,
  latency_ms integer not null default 0,
  status text not null default 'success',
  error_code text,
  created_at timestamptz not null default now()
);

create index idx_api_keys_user_id on api_keys(user_id);
create index idx_requests_api_key on requests(api_key_id);
create index idx_requests_session on requests(session_id) where session_id is not null;
create index idx_requests_created on requests(created_at);
