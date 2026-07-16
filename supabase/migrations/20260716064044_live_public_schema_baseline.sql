-- HISTORY BASELINE FOR LOCAL REPRODUCTION.
-- Recreates the captured live schema on an empty local database.
-- On production this version must be marked applied after exact preflight; never execute it there.

-- LLMKit live public-schema snapshot
-- Captured: 2026-07-16 05:51:16 UTC
-- Server: PostgreSQL 17.6
-- Project: cwfjofyplyfjtanzavsm
-- Source: project-scoped read-only Supabase MCP catalog queries
-- SNAPSHOT ONLY. This file is not a migration and must not be applied to production.

create table public.accounts (
  user_id text not null,
  plan text default 'free'::text not null,
  plan_expires_at timestamp with time zone,
  stripe_customer_id text,
  stripe_subscription_id text,
  granted_by text,
  note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.api_keys (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  key_hash text not null,
  key_prefix text not null,
  name text not null,
  budget_id uuid,
  created_at timestamp with time zone default now(),
  revoked_at timestamp with time zone,
  rpm_limit integer default 60 not null
);

create table public.budgets (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  name text not null,
  limit_cents integer not null,
  period text default 'monthly'::text not null,
  reset_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  scope text default 'key'::text,
  alert_webhook_url text
);

create table public.provider_keys (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  provider text not null,
  encrypted_key text not null,
  iv text not null,
  key_prefix text not null,
  key_name text default 'default'::text not null,
  created_at timestamp with time zone default now() not null,
  revoked_at timestamp with time zone
);

create table public.requests (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  api_key_id text,
  session_id text,
  provider text not null,
  model text not null,
  input_tokens integer default 0,
  output_tokens integer default 0,
  cache_read_tokens integer default 0,
  cache_write_tokens integer default 0,
  cost_cents numeric default 0,
  latency_ms integer default 0,
  status text default 'ok'::text,
  error_code text,
  created_at timestamp with time zone default now(),
  source text default 'proxy'::text not null,
  end_user_id text,
  tool_calls jsonb
);

create table public.support_messages (
  id uuid default gen_random_uuid() not null,
  user_id text not null,
  message text not null,
  replied boolean default false,
  created_at timestamp with time zone default now()
);

alter table only public.accounts
  add constraint accounts_pkey primary key (user_id);
alter table only public.accounts
  add constraint accounts_stripe_customer_id_key unique (stripe_customer_id);
alter table only public.accounts
  add constraint accounts_stripe_subscription_id_key unique (stripe_subscription_id);
alter table only public.budgets
  add constraint budgets_pkey primary key (id);
alter table only public.api_keys
  add constraint api_keys_budget_id_fkey foreign key (budget_id) references public.budgets(id);
alter table only public.api_keys
  add constraint api_keys_pkey primary key (id);
alter table only public.provider_keys
  add constraint provider_keys_pkey primary key (id);
alter table only public.provider_keys
  add constraint provider_keys_user_id_provider_key_name_key unique (user_id, provider, key_name);
alter table only public.requests
  add constraint requests_pkey primary key (id);
alter table only public.support_messages
  add constraint support_messages_pkey primary key (id);

create index idx_provider_keys_lookup
  on public.provider_keys using btree (user_id, provider)
  where revoked_at is null;
create index idx_requests_key_source_created
  on public.requests using btree (api_key_id, source, created_at desc);

alter table public.accounts enable row level security;
alter table public.api_keys enable row level security;
alter table public.budgets enable row level security;
alter table public.provider_keys enable row level security;
alter table public.requests enable row level security;
alter table public.support_messages enable row level security;

create policy "deny anon"
  on public.requests
  as permissive
  for all
  to anon
  using (false);

create or replace function public.get_user_usage(p_key_id text, p_days integer)
returns json
language plpgsql
as $function$
declare
  result json;
  kid uuid;
begin
  kid := p_key_id::uuid;

  select json_build_object(
    'requests', count(*),
    'totalCostCents', coalesce(sum(cost_cents), 0),
    'totalInputTokens', coalesce(sum(input_tokens), 0),
    'totalOutputTokens', coalesce(sum(output_tokens), 0),
    'totalCacheReadTokens', coalesce(sum(cache_read_tokens), 0),
    'topModels', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select model, count(*) as requests
        from requests
        where api_key_id = kid
          and created_at >= now() - (p_days || ' days')::interval
        group by model
        order by count(*) desc
        limit 5
      ) t
    )
  ) into result
  from requests
  where api_key_id = kid
    and created_at >= now() - (p_days || ' days')::interval;

  return result;
end;
$function$;

create or replace function public.usage_aggregate(p_key_id text, p_days integer)
returns json
language sql
as $function$
  select json_build_object(
    'requests', count(*),
    'totalCostCents', coalesce(sum(cost_cents), 0),
    'totalInputTokens', coalesce(sum(input_tokens), 0),
    'totalOutputTokens', coalesce(sum(output_tokens), 0),
    'totalCacheReadTokens', coalesce(sum(cache_read_tokens), 0),
    'topModels', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select model, count(*) as requests
        from requests
        where api_key_id = $1
          and created_at >= now() - ($2 || ' days')::interval
        group by model
        order by count(*) desc
        limit 5
      ) t
    )
  )
  from requests
  where api_key_id = $1
    and created_at >= now() - ($2 || ' days')::interval;
$function$;

create or replace function public.usage_aggregate(
  p_key_id text,
  p_days integer,
  p_source text default 'proxy'::text
)
returns json
language plpgsql
security definer
as $function$
declare
  result json;
begin
  select json_build_object(
    'requests', coalesce(count(*), 0),
    'totalCostCents', coalesce(sum(cost_cents), 0),
    'totalInputTokens', coalesce(sum(input_tokens), 0),
    'totalOutputTokens', coalesce(sum(output_tokens), 0),
    'totalCacheReadTokens', coalesce(sum(cache_read_tokens), 0),
    'topModels', coalesce(
      (
        select json_agg(sub)
        from (
          select model, count(*) as requests
          from requests
          where api_key_id = p_key_id
            and created_at >= now() - (p_days || ' days')::interval
            and source = p_source
          group by model
          order by count(*) desc
          limit 5
        ) sub
      ),
      '[]'::json
    )
  ) into result
  from requests
  where api_key_id = p_key_id
    and created_at >= now() - (p_days || ' days')::interval
    and source = p_source;

  return result;
end;
$function$;

grant delete, insert, references, select, trigger, truncate, update
  on table public.accounts to anon, authenticated, service_role;
grant delete, insert, references, select, trigger, truncate, update
  on table public.api_keys to anon, authenticated, service_role;
grant delete, insert, references, select, trigger, truncate, update
  on table public.budgets to anon, authenticated, service_role;
grant delete, insert, references, select, trigger, truncate, update
  on table public.provider_keys to anon, authenticated, service_role;
grant delete, insert, references, select, trigger, truncate, update
  on table public.requests to anon, authenticated, service_role;
grant delete, insert, references, select, trigger, truncate, update
  on table public.support_messages to anon, authenticated, service_role;

grant execute on function public.get_user_usage(text, integer)
  to public, anon, authenticated, service_role;
grant execute on function public.usage_aggregate(text, integer)
  to public, anon, authenticated, service_role;
grant execute on function public.usage_aggregate(text, integer, text)
  to public, anon, authenticated, service_role;
