begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(71);

insert into public.accounts (user_id, plan, stripe_customer_id)
values
  ('user_a', 'pro', 'cus_a'),
  ('user_b', 'free', 'cus_b');

insert into public.budgets (id, user_id, name, limit_cents, period, scope)
values
  ('10000000-0000-0000-0000-000000000001', 'user_a', 'A budget', 1000, 'monthly', 'key'),
  ('10000000-0000-0000-0000-000000000002', 'user_b', 'B budget', 2000, 'monthly', 'key');

insert into public.api_keys (id, user_id, key_hash, key_prefix, name, budget_id)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'user_a',
    'hash_a',
    'llmk_a',
    'A key',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'user_b',
    'hash_b',
    'llmk_b',
    'B key',
    '10000000-0000-0000-0000-000000000002'
  );

insert into public.requests (
  id,
  user_id,
  api_key_id,
  session_id,
  provider,
  model,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  cost_cents,
  latency_ms,
  status,
  source,
  end_user_id,
  tool_calls
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    'user_a',
    '20000000-0000-0000-0000-000000000001',
    'session_a',
    'openai',
    'gpt-a',
    100,
    20,
    10,
    5,
    12.5,
    250,
    'success',
    'proxy',
    'end_user_a',
    '[{"name":"search"}]'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'user_b',
    '20000000-0000-0000-0000-000000000002',
    'session_b',
    'anthropic',
    'claude-b',
    200,
    40,
    20,
    0,
    25,
    300,
    'success',
    'proxy',
    'end_user_b',
    null
  );

insert into public.provider_keys (
  id, user_id, provider, encrypted_key, iv, key_prefix, key_name
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    'user_a',
    'openai',
    'cipher_a',
    'iv_a',
    'sk-a',
    'default'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    'user_b',
    'anthropic',
    'cipher_b',
    'iv_b',
    'sk-b',
    'default'
  );

insert into public.support_messages (id, user_id, message)
values
  ('50000000-0000-0000-0000-000000000001', 'user_a', 'A message'),
  ('50000000-0000-0000-0000-000000000002', 'user_b', 'B message');

select extensions.has_function(
  'public',
  'usage_aggregate',
  array['text', 'integer', 'text'],
  'service-only compatibility aggregate exists'
); -- 1

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.usage_aggregate(text,integer,text)',
    'execute'
  ),
  'anonymous cannot execute aggregate'
); -- 2

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.usage_aggregate(text,integer,text)',
    'execute'
  ),
  'authenticated user cannot execute aggregate'
); -- 3

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.usage_aggregate(text,integer,text)',
    'execute'
  ),
  'service role can execute aggregate'
); -- 4

select extensions.is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  ),
  0::bigint,
  'public schema has no security-definer functions'
); -- 5

select extensions.is(
  (
    select p.proconfig[1]
    from pg_proc p
    where p.oid = 'public.usage_aggregate(text,integer,text)'::regprocedure
  ),
  'search_path=""'::text,
  'aggregate has an empty search path'
); -- 6

select extensions.ok(
  not has_table_privilege('anon', 'public.requests', 'select'),
  'anonymous has no request-table access'
); -- 7

select extensions.ok(
  not has_table_privilege('authenticated', 'public.provider_keys', 'select'),
  'authenticated user has no provider-key access'
); -- 8

select extensions.ok(
  not has_table_privilege('authenticated', 'public.api_keys', 'insert'),
  'authenticated user cannot insert API-key material directly'
); -- 9

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"user_a","role":"authenticated"}',
  true
);

select extensions.is(
  (select count(*) from public.accounts),
  1::bigint,
  'user A sees only own account'
); -- 10

select extensions.is(
  (select count(*) from public.api_keys),
  1::bigint,
  'user A sees only own API key'
); -- 11

select extensions.is(
  (select count(*) from public.budgets),
  1::bigint,
  'user A sees only own budget'
); -- 12

select extensions.is(
  (select count(*) from public.requests),
  1::bigint,
  'user A sees only own request'
); -- 13

select extensions.is(
  (select count(*) from public.support_messages),
  1::bigint,
  'user A sees only own support message'
); -- 14

select extensions.throws_like(
  $$select stripe_customer_id from public.accounts$$,
  '%permission denied%',
  'user A cannot select Stripe identifiers'
); -- 15

select extensions.throws_like(
  $$select * from public.provider_keys$$,
  '%permission denied%',
  'user A cannot select provider ciphertext'
); -- 16

select extensions.throws_like(
  $$select public.usage_aggregate(
      '20000000-0000-0000-0000-000000000001',
      30,
      'proxy'
    )$$,
  '%permission denied%',
  'user A cannot call service aggregate'
); -- 17

select extensions.throws_like(
  $$insert into public.api_keys (user_id, key_hash, key_prefix, name)
    values ('user_a', 'forbidden_hash', 'llmk_x', 'forbidden')$$,
  '%permission denied%',
  'user A cannot create key material directly'
); -- 18

select extensions.lives_ok(
  $$insert into public.budgets (user_id, name, limit_cents, period, scope)
    values ('user_a', 'own insert', 3000, 'weekly', 'session')$$,
  'user A can insert own budget'
); -- 19

select extensions.throws_like(
  $$insert into public.budgets (user_id, name, limit_cents, period, scope)
    values ('user_b', 'cross-tenant insert', 3000, 'weekly', 'key')$$,
  '%row-level security policy%',
  'user A cannot insert user B budget'
); -- 20

select extensions.lives_ok(
  $$update public.budgets
    set limit_cents = 1500
    where id = '10000000-0000-0000-0000-000000000001'$$,
  'user A can update own budget'
); -- 21

select extensions.lives_ok(
  $$update public.budgets
    set limit_cents = 9999
    where id = '10000000-0000-0000-0000-000000000002'$$,
  'cross-tenant update is filtered without leaking row existence'
); -- 22

select extensions.lives_ok(
  $$insert into public.support_messages (user_id, message)
    values ('user_a', 'own support insert')$$,
  'user A can insert own support message'
); -- 23

select extensions.throws_like(
  $$insert into public.support_messages (user_id, message)
    values ('user_b', 'cross-tenant support insert')$$,
  '%row-level security policy%',
  'user A cannot insert user B support message'
); -- 24

reset role;

select extensions.is(
  (
    select limit_cents
    from public.budgets
    where id = '10000000-0000-0000-0000-000000000002'
  ),
  2000,
  'user B budget was not changed by user A'
); -- 25

set local role service_role;

select extensions.is(
  (
    public.usage_aggregate(
      '20000000-0000-0000-0000-000000000001',
      30,
      'proxy'
    )->>'requests'
  )::bigint,
  1::bigint,
  'service aggregate returns user A request'
); -- 26

select extensions.is(
  (
    public.usage_aggregate(
      '20000000-0000-0000-0000-000000000001',
      30,
      'other-source'
    )->>'requests'
  )::bigint,
  0::bigint,
  'service aggregate scopes requests by source'
); -- 27

select extensions.lives_ok(
  $$insert into public.requests (
      id, user_id, api_key_id,
      provider, model, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, cost_cents, latency_ms, status, source
    ) values (
      '30000000-0000-0000-0000-000000000003',
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-new',
      10,
      5,
      2,
      1,
      3.5,
      100,
      'success',
      'proxy'
    )$$,
  'service role inserts a complete request'
); -- 28

reset role;

select extensions.throws_like(
  $$insert into public.requests (
      id, user_id, api_key_id, provider, model, status
    ) values (
      '30000000-0000-0000-0000-000000000004',
      'user_b',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-bad',
      'success'
    )$$,
  '%requests_api_key_owner_fkey%',
  'request owner must match API-key owner'
); -- 29

select extensions.throws_like(
  $$insert into public.api_keys (
      id, user_id, key_hash, key_prefix, name, budget_id
    ) values (
      '20000000-0000-0000-0000-000000000003',
      'user_a',
      'hash_bad_budget',
      'llmk_bad',
      'bad budget owner',
      '10000000-0000-0000-0000-000000000002'
    )$$,
  '%api_keys_budget_owner_fkey%',
  'API-key owner must match budget owner'
); -- 30

select extensions.throws_like(
  $$insert into public.provider_keys (
      user_id, provider, encrypted_key, iv, key_prefix, key_name
    ) values (
      'user_a', 'openai', 'cipher_dup', 'iv_dup', 'sk-dup', 'default'
    )$$,
  '%provider_keys_active_name_key%',
  'two active provider keys cannot share a name'
); -- 31

select extensions.lives_ok(
  $$update public.provider_keys
    set revoked_at = now()
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'provider key can be revoked'
); -- 32

select extensions.lives_ok(
  $$insert into public.provider_keys (
      user_id, provider, encrypted_key, iv, key_prefix, key_name
    ) values (
      'user_a', 'openai', 'cipher_replacement', 'iv_new', 'sk-new', 'default'
    )$$,
  'revoked provider-key name can be replaced'
); -- 33

select extensions.lives_ok(
  $$insert into public.requests (
      id, user_id, api_key_id, provider, model, status
    ) values (
      '30000000-0000-0000-0000-000000000005',
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-error',
      'error'
    )$$,
  'error request status is accepted'
); -- 34

select extensions.throws_like(
  $$insert into public.requests (
      id, user_id, api_key_id, provider, model, status
    ) values (
      '30000000-0000-0000-0000-000000000006',
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-invalid',
      'ok'
    )$$,
  '%requests_status_check%',
  'legacy ok status is rejected'
); -- 35

select extensions.throws_like(
  $$insert into public.api_keys (user_id, key_hash, key_prefix, name)
    values ('user_a', 'hash_a', 'llmk_dup', 'duplicate hash')$$,
  '%api_keys_key_hash_key%',
  'API-key hashes are unique'
); -- 36

select extensions.throws_like(
  $$insert into public.requests (user_id, provider, model, status)
    values ('user_a', 'openai', 'gpt-null-key', 'success')$$,
  '%null value in column "api_key_id"%',
  'request API-key identity is required'
); -- 37

select extensions.is(
  (
    select count(*)
    from public.requests
    where model = 'gpt-new'
      and cache_write_tokens = 1
  ),
  1::bigint,
  'request runtime fields persist together'
); -- 38

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"user_a","role":"authenticated"}',
  true
);

select extensions.throws_like(
  $$update public.accounts
    set plan = 'admin'
    where user_id = 'user_a'$$,
  '%permission denied%',
  'user A cannot mutate own account plan'
); -- 39

select extensions.throws_like(
  $$select key_hash from public.api_keys$$,
  '%permission denied%',
  'user A cannot select API-key hashes'
); -- 40

select extensions.lives_ok(
  $$delete from public.budgets
    where user_id = 'user_a' and name = 'own insert'$$,
  'user A can delete an own unreferenced budget'
); -- 41

reset role;
set local role service_role;

select extensions.lives_ok(
  $$insert into public.api_keys (
      id, user_id, key_hash, key_prefix, name
    ) values (
      '20000000-0000-0000-0000-000000000004',
      'user_a',
      'hash_service_created',
      'llmk_service',
      'service-created key'
    )$$,
  'service role inserts generated API-key material'
); -- 42

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"user_a","role":"authenticated"}',
  true
);

select extensions.is(
  (
    select key_prefix
    from public.api_keys
    where id = '20000000-0000-0000-0000-000000000004'
  ),
  'llmk_service'::text,
  'user A sees the safe prefix of a service-created key'
); -- 43

select extensions.throws_like(
  $$update public.budgets
    set user_id = 'user_b'
    where id = '10000000-0000-0000-0000-000000000001'$$,
  '%permission denied%',
  'user A cannot reassign immutable budget ownership'
); -- 44

reset role;
set local role service_role;

select extensions.is(
  (
    public.usage_aggregate(
      '20000000-0000-0000-0000-000000000001',
      30,
      'proxy'
    )->>'pricedRequests'
  )::bigint,
  2::bigint,
  'aggregate counts only requests with known cost as priced'
); -- 45

select extensions.is(
  (
    public.usage_aggregate(
      '20000000-0000-0000-0000-000000000001',
      30,
      'proxy'
    )->>'unknownCostRequests'
  )::bigint,
  1::bigint,
  'aggregate reports historical unknown cost instead of treating it as zero'
); -- 46

reset role;

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, cost_cents, status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-negative-cost',
      -1,
      'success'
    )$$,
  '%requests_nonnegative_usage_check%',
  'negative request cost is rejected'
); -- 47

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, input_tokens, status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-negative-tokens',
      -1,
      'success'
    )$$,
  '%requests_nonnegative_usage_check%',
  'negative token usage is rejected'
); -- 48

select extensions.throws_like(
  $$insert into public.budgets (user_id, name, limit_cents, period, scope)
    values ('user_a', 'negative budget', -1, 'monthly', 'key')$$,
  '%budgets_nonnegative_limit_check%',
  'negative budget limit is rejected'
); -- 49

select extensions.is(
  (
    select count(*)
    from public.requests
    where settlement_status = 'legacy_recorded'
      and dispatch_status is null
  ),
  4::bigint,
  'pre-receipt request writes retain an explicit legacy settlement state'
); -- 50

select extensions.ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.requests'::regclass
  ),
  'request receipt extension preserves row-level security'
); -- 51

select extensions.is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'requests'
      and policyname = 'requests_select_own'
  ),
  1::bigint,
  'request receipt extension preserves the tenant-select policy'
); -- 52

set local role service_role;

select extensions.lives_ok(
  $$insert into public.requests (
      id, user_id, api_key_id, provider, model, status,
      customer_id, workflow_id, agent_id, session_id, end_user_id,
      budget_id, budget_reservation_id, reserved_cost_cents,
      idempotency_key_hash, settlement_status,
      requested_provider, requested_model, dispatch_status
    ) values (
      '70000000-0000-4000-8000-000000000001',
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-receipt-pending',
      'pending',
      'customer-a',
      'workflow-a',
      'agent-a',
      'session-receipt-a',
      'end-user-receipt-a',
      '10000000-0000-0000-0000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      9.5,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'pending',
      'openai',
      'gpt-receipt-pending',
      'admitted'
    )$$,
  'service role inserts a complete pending request receipt'
); -- 53

select extensions.is(
  (
    select count(*)
    from public.requests
    where id = '70000000-0000-4000-8000-000000000001'
      and customer_id = 'customer-a'
      and workflow_id = 'workflow-a'
      and agent_id = 'agent-a'
      and budget_id = '10000000-0000-0000-0000-000000000001'
      and budget_reservation_id = '71000000-0000-4000-8000-000000000001'
      and reserved_cost_cents = 9.5
      and idempotency_key_hash =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and response_sha256 is null
      and settlement_status = 'pending'
      and requested_provider = 'openai'
      and requested_model = 'gpt-receipt-pending'
      and last_dispatched_provider is null
      and last_dispatched_model is null
      and provider_response_id is null
      and dispatch_status = 'admitted'
  ),
  1::bigint,
  'request receipt persists reservation and attribution fields together'
); -- 54

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, customer_id
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-bad-customer',
      'pending',
      ' customer-a'
    )$$,
  '%requests_receipt_attribution_ids_check%',
  'untrimmed attribution identifiers are rejected'
); -- 55

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, idempotency_key_hash
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-bad-idempotency-hash',
      'pending',
      'ABC123'
    )$$,
  '%requests_receipt_hashes_check%',
  'non-SHA-256 idempotency hashes are rejected'
); -- 56

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, response_sha256
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-bad-response-hash',
      'success',
      'not-a-sha256'
    )$$,
  '%requests_receipt_hashes_check%',
  'non-SHA-256 response hashes are rejected'
); -- 57

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-bad-request-status',
      'complete'
    )$$,
  '%requests_status_check%',
  'unknown request lifecycle status is rejected'
); -- 58

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, settlement_status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-bad-settlement-status',
      'success',
      'settled'
    )$$,
  '%requests_settlement_status_check%',
  'ambiguous settlement status is rejected'
); -- 59

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, reserved_cost_cents
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-negative-reservation',
      'pending',
      -0.1
    )$$,
  '%requests_reserved_cost_check%',
  'negative reserved cost is rejected'
); -- 60

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, budget_id
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-cross-tenant-budget',
      'pending',
      '10000000-0000-0000-0000-000000000002'
    )$$,
  '%requests_budget_owner_fkey%',
  'request receipt cannot reference another tenant budget'
); -- 61

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, idempotency_key_hash
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000001',
      'openai',
      'gpt-duplicate-idempotency',
      'pending',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )$$,
  '%requests_api_key_idempotency_key_hash_key%',
  'one API key cannot record the same idempotency scope twice'
); -- 62

select extensions.lives_ok(
  $$insert into public.requests (
      id, user_id, api_key_id, provider, model, status,
      idempotency_key_hash, response_sha256, settlement_status
    ) values (
      '70000000-0000-4000-8000-000000000002',
      'user_a',
      '20000000-0000-0000-0000-000000000004',
      'openai',
      'gpt-same-idempotency-other-key',
      'success',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'not_applicable'
    )$$,
  'idempotency uniqueness is scoped to one API key'
); -- 63

insert into public.requests (
  id, user_id, api_key_id, provider, model, status,
  customer_id, workflow_id, agent_id, budget_id,
  budget_reservation_id, reserved_cost_cents, idempotency_key_hash,
  response_sha256, settlement_status
)
values (
  '70000000-0000-4000-8000-000000000003',
  'user_b',
  '20000000-0000-0000-0000-000000000002',
  'anthropic',
  'claude-receipt-b',
  'success',
  'customer-b',
  'workflow-b',
  'agent-b',
  '10000000-0000-0000-0000-000000000002',
  '71000000-0000-4000-8000-000000000003',
  4.25,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'settled_actual'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"user_a","role":"authenticated"}',
  true
);

select extensions.is(
  (
    select count(*)
    from public.requests
    where id = '70000000-0000-4000-8000-000000000003'
       or customer_id = 'customer-b'
       or workflow_id = 'workflow-b'
       or agent_id = 'agent-b'
  ),
  0::bigint,
  'user A cannot observe user B receipt identifiers or attribution'
); -- 64

reset role;
set local role service_role;

update public.api_keys
set budget_id = null
where user_id = 'user_a'
  and budget_id = '10000000-0000-0000-0000-000000000001';

select extensions.throws_like(
  $$delete from public.budgets
    where id = '10000000-0000-0000-0000-000000000001'$$,
  '%requests_budget_owner_fkey%',
  'durable receipt attribution prevents deleting a referenced budget'
); -- 65

select extensions.lives_ok(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status,
      requested_provider, requested_model,
      last_dispatched_provider, last_dispatched_model,
      provider_response_id, dispatch_status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000004',
      'openai',
      'gpt-dispatch-evidence',
      'success',
      'openai',
      'gpt-dispatch-evidence',
      'openai',
      'gpt-dispatch-evidence',
      'chatcmpl-dispatch-evidence',
      'dispatched'
    )$$,
  'service role records a dispatched provider-call boundary'
); -- 66

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status, dispatch_status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000004',
      'openai',
      'gpt-invalid-dispatch-status',
      'success',
      'provider_received'
    )$$,
  '%requests_dispatch_status_check%',
  'unproved provider-receipt status is rejected'
); -- 67

select extensions.lives_ok(
  $$update public.requests
    set last_dispatched_provider = 'openai',
        last_dispatched_model = 'gpt-receipt-pending',
        provider_response_id = 'chatcmpl-receipt-pending',
        dispatch_status = 'dispatched'
    where id = '70000000-0000-4000-8000-000000000001'$$,
  'service role revises existing request receipt evidence'
); -- 68

select extensions.is(
  (
    select count(*)
    from public.requests
    where id = '70000000-0000-4000-8000-000000000001'
      and last_dispatched_provider = 'openai'
      and last_dispatched_model = 'gpt-receipt-pending'
      and provider_response_id = 'chatcmpl-receipt-pending'
      and dispatch_status = 'dispatched'
  ),
  1::bigint,
  'request receipt revisions persist dispatch evidence'
); -- 69

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status,
      budget_id, reserved_cost_cents,
      requested_provider, requested_model, dispatch_status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000004',
      'openai',
      'gpt-incomplete-admission',
      'pending',
      '10000000-0000-0000-0000-000000000001',
      1,
      'openai',
      'gpt-incomplete-admission',
      'admitted'
    )$$,
  '%requests_dispatch_evidence_check%',
  'admitted receipts require reservation identity'
); -- 70

select extensions.throws_like(
  $$insert into public.requests (
      user_id, api_key_id, provider, model, status,
      requested_provider, requested_model, dispatch_status
    ) values (
      'user_a',
      '20000000-0000-0000-0000-000000000004',
      'openai',
      'gpt-incomplete-dispatch',
      'error',
      'openai',
      'gpt-incomplete-dispatch',
      'dispatched'
    )$$,
  '%requests_dispatch_evidence_check%',
  'dispatched receipts require provider-attempt identity'
); -- 71

select * from extensions.finish();
rollback;
