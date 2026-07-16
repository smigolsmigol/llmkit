-- Reconcile the captured production schema with a tenant-safe runtime contract without discarding data.
-- This migration is intentionally fail-closed. Any incompatible data or schema drift requires a
-- separately reviewed repair before this migration may run.

do $$
declare
  request_shape_blockers bigint;
  request_relation_blockers bigint;
  budget_relation_blockers bigint;
  duplicate_key_hashes bigint;
  invalid_budgets bigint;
  duplicate_active_provider_keys bigint;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'expected PostgreSQL 17.x, found %', current_setting('server_version');
  end if;

  if to_regclass('public.accounts') is null
     or to_regclass('public.api_keys') is null
     or to_regclass('public.budgets') is null
     or to_regclass('public.provider_keys') is null
     or to_regclass('public.requests') is null
     or to_regclass('public.support_messages') is null then
    raise exception 'captured product table set is incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requests'
      and column_name = 'api_key_id'
      and data_type = 'text'
      and is_nullable = 'YES'
  ) then
    raise exception 'requests.api_key_id no longer matches captured nullable text shape';
  end if;

  if to_regprocedure('public.get_user_usage(text,integer)') is null
     or to_regprocedure('public.usage_aggregate(text,integer)') is null
     or to_regprocedure('public.usage_aggregate(text,integer,text)') is null then
    raise exception 'captured aggregate function set has drifted';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid = 'public.usage_aggregate(text,integer,text)'::regprocedure
      and p.prosecdef
  ) then
    raise exception 'captured three-argument aggregate is no longer security definer';
  end if;

  -- Preserve historical unknown cost as NULL. All other runtime fields must be compatible with the
  -- target constraints before any DDL starts.
  select count(*) into request_shape_blockers
  from public.requests
  where api_key_id is null
     or btrim(api_key_id) = ''
     or api_key_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or input_tokens is null
     or output_tokens is null
     or cache_read_tokens is null
     or cache_write_tokens is null
     or latency_ms is null
     or status is null
     or created_at is null
     or input_tokens < 0
     or output_tokens < 0
     or cache_read_tokens < 0
     or cache_write_tokens < 0
     or cost_cents < 0
     or latency_ms < 0
     or status not in ('success', 'error');

  if request_shape_blockers <> 0 then
    raise exception 'found % request rows incompatible with the target shape', request_shape_blockers;
  end if;

  select count(*) into request_relation_blockers
  from public.requests r
  left join public.api_keys k on k.id::text = r.api_key_id
  where k.id is null
     or r.user_id is distinct from k.user_id;

  if request_relation_blockers <> 0 then
    raise exception 'found % request rows with missing or cross-tenant API-key ownership',
      request_relation_blockers;
  end if;

  select count(*) into budget_relation_blockers
  from public.api_keys k
  join public.budgets b on b.id = k.budget_id
  where k.user_id is distinct from b.user_id;

  if budget_relation_blockers <> 0 then
    raise exception 'found % cross-tenant API-key budget assignments; repair them explicitly before migration',
      budget_relation_blockers;
  end if;

  select count(*) into duplicate_key_hashes
  from (
    select key_hash
    from public.api_keys
    group by key_hash
    having count(*) > 1
  ) duplicate_hash;

  if duplicate_key_hashes <> 0 then
    raise exception 'found % duplicate API-key hash groups', duplicate_key_hashes;
  end if;

  select count(*) into invalid_budgets
  from public.budgets
  where limit_cents < 0
     or period not in ('daily', 'weekly', 'monthly', 'total')
     or scope is null
     or scope not in ('key', 'session');

  if invalid_budgets <> 0 then
    raise exception 'found % budgets incompatible with the target constraints', invalid_budgets;
  end if;

  select count(*) into duplicate_active_provider_keys
  from (
    select user_id, provider, key_name
    from public.provider_keys
    where revoked_at is null
    group by user_id, provider, key_name
    having count(*) > 1
  ) duplicate_provider_key;

  if duplicate_active_provider_keys <> 0 then
    raise exception 'found % duplicate active provider-key name groups',
      duplicate_active_provider_keys;
  end if;
end
$$;

-- Close the exposed RPC boundary before changing its dependent column type.
revoke all privileges on function public.get_user_usage(text, integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.usage_aggregate(text, integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.usage_aggregate(text, integer, text)
  from public, anon, authenticated, service_role;

drop function public.get_user_usage(text, integer);
drop function public.usage_aggregate(text, integer);
drop function public.usage_aggregate(text, integer, text);

-- New public objects must opt in to Data API access explicitly.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables
  from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences
  from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions
  from public, anon, authenticated, service_role;

-- Request runtime compatibility.
alter table public.requests
  alter column api_key_id type uuid using api_key_id::uuid,
  alter column api_key_id set not null,
  alter column input_tokens set default 0,
  alter column input_tokens set not null,
  alter column output_tokens set default 0,
  alter column output_tokens set not null,
  alter column cache_read_tokens set default 0,
  alter column cache_read_tokens set not null,
  alter column cache_write_tokens set default 0,
  alter column cache_write_tokens set not null,
  alter column cost_cents drop default,
  alter column latency_ms set default 0,
  alter column latency_ms set not null,
  alter column status set default 'success',
  alter column status set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

alter table public.requests
  add constraint requests_status_check check (status in ('success', 'error')),
  add constraint requests_nonnegative_usage_check check (
    input_tokens >= 0
    and output_tokens >= 0
    and cache_read_tokens >= 0
    and cache_write_tokens >= 0
    and (cost_cents is null or cost_cents >= 0)
    and latency_ms >= 0
  );

-- Ownership integrity across user-selected identifiers.
alter table public.api_keys
  drop constraint api_keys_budget_id_fkey,
  alter column name set default 'default';

alter table public.budgets
  alter column scope set default 'key',
  alter column scope set not null,
  add constraint budgets_nonnegative_limit_check
    check (limit_cents >= 0),
  add constraint budgets_period_check
    check (period in ('daily', 'weekly', 'monthly', 'total')),
  add constraint budgets_scope_check
    check (scope in ('key', 'session')),
  add constraint budgets_id_user_id_key unique (id, user_id);

alter table public.api_keys
  add constraint api_keys_key_hash_key unique (key_hash),
  add constraint api_keys_id_user_id_key unique (id, user_id),
  add constraint api_keys_budget_owner_fkey
    foreign key (budget_id, user_id)
    references public.budgets (id, user_id);

alter table public.requests
  add constraint requests_api_key_owner_fkey
    foreign key (api_key_id, user_id)
    references public.api_keys (id, user_id);

alter table public.provider_keys
  drop constraint provider_keys_user_id_provider_key_name_key;

create unique index provider_keys_active_name_key
  on public.provider_keys (user_id, provider, key_name)
  where revoked_at is null;

create index api_keys_user_id_idx
  on public.api_keys (user_id);
create index api_keys_budget_owner_idx
  on public.api_keys (budget_id, user_id)
  where budget_id is not null;
create index budgets_user_id_idx
  on public.budgets (user_id);
create index requests_api_key_owner_idx
  on public.requests (api_key_id, user_id);
create index requests_user_created_idx
  on public.requests (user_id, created_at desc);
create index support_messages_user_created_idx
  on public.support_messages (user_id, created_at desc);

-- Replace all aggregate generations with one service-only, invoker-rights RPC while preserving
-- the deployed proxy's three-argument contract. A later product slice may introduce a new
-- tenant-explicit signature only together with its runtime consumer.
create function public.usage_aggregate(
  p_key_id text,
  p_days integer,
  p_source text default 'proxy'
)
returns json
language sql
stable
security invoker
set search_path = ''
as $function$
  select json_build_object(
    'requests', count(*),
    'pricedRequests', count(r.cost_cents),
    'unknownCostRequests', count(*) filter (where r.cost_cents is null),
    'totalCostCents', coalesce(sum(r.cost_cents), 0),
    'totalInputTokens', coalesce(sum(r.input_tokens), 0),
    'totalOutputTokens', coalesce(sum(r.output_tokens), 0),
    'totalCacheReadTokens', coalesce(sum(r.cache_read_tokens), 0),
    'topModels', coalesce(
      (
        select json_agg(row_to_json(top_model))
        from (
          select model, count(*) as requests
          from public.requests
          where api_key_id = p_key_id::uuid
            and created_at >= now() - make_interval(days => p_days)
            and source = p_source
            and p_days between 1 and 365
          group by model
          order by count(*) desc
          limit 5
        ) top_model
      ),
      '[]'::json
    )
  )
  from public.requests r
  where r.api_key_id = p_key_id::uuid
    and r.created_at >= now() - make_interval(days => p_days)
    and r.source = p_source
    and p_days between 1 and 365;
$function$;

revoke all privileges on function public.usage_aggregate(text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.usage_aggregate(text, integer, text)
  to service_role;

-- Replace legacy blanket table grants with the exact API authority matrix.
revoke all privileges on table
  public.accounts,
  public.api_keys,
  public.budgets,
  public.provider_keys,
  public.requests,
  public.support_messages
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.accounts to service_role;
grant select, insert, update on table public.api_keys to service_role;
grant select, insert, update, delete on table public.budgets to service_role;
grant select, insert, update on table public.provider_keys to service_role;
grant select, insert on table public.requests to service_role;
grant select, insert, update on table public.support_messages to service_role;

grant select (user_id, plan, plan_expires_at)
  on table public.accounts to authenticated;
grant select (id, user_id, key_prefix, name, budget_id, created_at, revoked_at, rpm_limit)
  on table public.api_keys to authenticated;
grant select (id, user_id, name, limit_cents, period, reset_at, created_at, scope, alert_webhook_url)
  on table public.budgets to authenticated;
grant insert (user_id, name, limit_cents, period, reset_at, scope, alert_webhook_url)
  on table public.budgets to authenticated;
grant update (name, limit_cents, period, reset_at, scope, alert_webhook_url)
  on table public.budgets to authenticated;
grant delete on table public.budgets to authenticated;
grant select on table public.requests to authenticated;
grant select (id, user_id, message, replied, created_at)
  on table public.support_messages to authenticated;
grant insert (user_id, message)
  on table public.support_messages to authenticated;

drop policy "deny anon" on public.requests;

create policy accounts_select_own
  on public.accounts
  for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy api_keys_select_own
  on public.api_keys
  for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy budgets_select_own
  on public.budgets
  for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy budgets_insert_own
  on public.budgets
  for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

create policy budgets_update_own
  on public.budgets
  for update
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'))
  with check (user_id = (select auth.jwt()->>'sub'));

create policy budgets_delete_own
  on public.budgets
  for delete
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy requests_select_own
  on public.requests
  for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy support_messages_select_own
  on public.support_messages
  for select
  to authenticated
  using (user_id = (select auth.jwt()->>'sub'));

create policy support_messages_insert_own
  on public.support_messages
  for insert
  to authenticated
  with check (user_id = (select auth.jwt()->>'sub'));

-- Catalog assertions make privilege regressions fail the migration itself.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  ) then
    raise exception 'public security-definer function remains after reconciliation';
  end if;

  if has_function_privilege(
       'anon',
       'public.usage_aggregate(text,integer,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.usage_aggregate(text,integer,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.usage_aggregate(text,integer,text)',
       'execute'
     ) then
    raise exception 'aggregate execution privileges do not match the authority matrix';
  end if;

  if has_table_privilege('anon', 'public.requests', 'select')
     or has_table_privilege('authenticated', 'public.provider_keys', 'select')
     or has_table_privilege('authenticated', 'public.api_keys', 'insert') then
    raise exception 'table privileges exceed the authority matrix';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public') <> 9 then
    raise exception 'expected nine explicit authenticated policies';
  end if;
end
$$;
