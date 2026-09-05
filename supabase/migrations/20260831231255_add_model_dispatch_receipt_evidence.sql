begin;

-- Preserve the exact request-to-provider join without rewriting historical receipts.
-- Null means the worker version that wrote the row did not record this evidence.
alter table public.requests
  add column requested_provider text,
  add column requested_model text,
  add column last_dispatched_provider text,
  add column last_dispatched_model text,
  add column provider_response_id text,
  add column dispatch_status text;

alter table public.requests
  add constraint requests_dispatch_status_check
    check (dispatch_status is null or dispatch_status in ('admitted', 'dispatched'));

alter table public.requests
  add constraint requests_dispatch_evidence_check
    check (
      dispatch_status is null
      or dispatch_status not in ('admitted', 'dispatched')
      or (
        requested_provider is not null
        and requested_model is not null
        and (
          (
            dispatch_status = 'admitted'
            and budget_id is not null
            and budget_reservation_id is not null
            and reserved_cost_cents is not null
            and last_dispatched_provider is null
            and last_dispatched_model is null
          )
          or (
            dispatch_status = 'dispatched'
            and last_dispatched_provider is not null
            and last_dispatched_model is not null
            and (
              (
                budget_id is null
                and budget_reservation_id is null
                and reserved_cost_cents is null
              )
              or (
                budget_id is not null
                and budget_reservation_id is not null
                and reserved_cost_cents is not null
              )
            )
          )
        )
      )
    );

grant update on table public.requests to service_role;

comment on column public.requests.last_dispatched_provider is
  'Provider used by the most recently started provider attempt; null means not recorded.';
comment on column public.requests.last_dispatched_model is
  'Requested model used by the most recently started provider attempt; null means not recorded.';
comment on column public.requests.dispatch_status is
  'admitted means a durable budget reservation exists; dispatched means the proxy durably armed an attempt immediately before the provider network request, not that the provider accepted it.';

commit;
