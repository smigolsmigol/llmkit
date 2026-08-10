begin;

-- Extend the tenant-owned request record into the durable reservation and settlement receipt.
-- The default preserves writes from the pre-receipt Worker during a staged rollout; the new
-- runtime must set its lifecycle state explicitly.
alter table public.requests
  add column customer_id text,
  add column workflow_id text,
  add column agent_id text,
  add column budget_id uuid,
  add column budget_reservation_id uuid,
  add column reserved_cost_cents numeric,
  add column idempotency_key_hash text,
  add column response_sha256 text,
  add column settlement_status text not null default 'legacy_recorded';

alter table public.requests
  drop constraint requests_status_check;

alter table public.requests
  add constraint requests_status_check
    check (status in ('pending', 'success', 'error')),
  add constraint requests_receipt_attribution_ids_check
    check (
      (customer_id is null
        or customer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,254}$')
      and (workflow_id is null
        or workflow_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,254}$')
      and (agent_id is null
        or agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,254}$')
    ),
  add constraint requests_reserved_cost_check
    check (
      reserved_cost_cents is null
      or (
        reserved_cost_cents >= 0
        and reserved_cost_cents <= 1000000000000000
      )
    ),
  add constraint requests_receipt_hashes_check
    check (
      (idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$')
      and (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$')
    ),
  add constraint requests_settlement_status_check
    check (settlement_status in (
      'legacy_recorded',
      'pending',
      'settled_actual',
      'committed_ceiling',
      'released',
      'unknown',
      'not_applicable'
    )),
  add constraint requests_budget_owner_fkey
    foreign key (budget_id, user_id)
    references public.budgets (id, user_id);

create unique index requests_api_key_idempotency_key_hash_key
  on public.requests (api_key_id, idempotency_key_hash)
  where idempotency_key_hash is not null;

create index requests_budget_owner_idx
  on public.requests (budget_id, user_id)
  where budget_id is not null;
create index requests_user_customer_created_idx
  on public.requests (user_id, customer_id, created_at desc)
  where customer_id is not null;
create index requests_user_workflow_created_idx
  on public.requests (user_id, workflow_id, created_at desc)
  where workflow_id is not null;
create index requests_user_agent_created_idx
  on public.requests (user_id, agent_id, created_at desc)
  where agent_id is not null;

commit;
