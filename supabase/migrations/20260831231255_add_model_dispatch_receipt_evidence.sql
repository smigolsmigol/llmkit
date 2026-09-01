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

comment on column public.requests.last_dispatched_provider is
  'Provider used by the most recently started provider attempt; null means not recorded.';
comment on column public.requests.last_dispatched_model is
  'Requested model used by the most recently started provider attempt; null means not recorded.';
comment on column public.requests.dispatch_status is
  'admitted means a durable budget reservation exists; dispatched means the proxy durably armed an attempt immediately before invoking the provider adapter, not that the provider accepted it.';

commit;
