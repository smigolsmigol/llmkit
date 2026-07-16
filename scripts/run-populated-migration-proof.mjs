import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const supabaseLauncher = join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
const baselineVersion = '20260716064044';
const databaseContainer = 'supabase_db_llmkit';
const windowsDocker = join(
  process.env.ProgramFiles || 'C:\\Program Files',
  'Docker',
  'Docker',
  'resources',
  'bin',
  'docker.exe',
);
const dockerCommand = process.platform === 'win32' && existsSync(windowsDocker)
  ? windowsDocker
  : 'docker';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}).\n${result.stderr || result.stdout}`,
    );
  }
  if (!options.input) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return result;
}

function supabase(...args) {
  const invocation = supabaseInvocation(args);
  return runChecked(invocation.command, invocation.args);
}

function supabaseInvocation(args) {
  if (!existsSync(supabaseLauncher)) {
    throw new Error('Pinned Supabase CLI is missing. Run pnpm install --frozen-lockfile.');
  }
  if (!args.every((arg) => /^[A-Za-z0-9@._:-]+$/.test(arg))) {
    throw new Error('Refusing an unsafe Supabase CLI argument.');
  }
  return { command: process.execPath, args: [supabaseLauncher, ...args] };
}

function resetToBaseline() {
  supabase('db', 'reset', '--local', '--no-seed', '--version', baselineVersion);
}

function resetToTarget() {
  supabase('db', 'reset', '--local', '--no-seed');
}

function psql(sql) {
  return runChecked(
    dockerCommand,
    [
      'exec',
      '-i',
      databaseContainer,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql },
  );
}

const legitimateFixture = `
begin;
insert into public.accounts (user_id, plan)
values ('migration-proof-a', 'pro'), ('migration-proof-b', 'free');

insert into public.budgets (id, user_id, name, limit_cents, period, scope)
values
  ('10000000-0000-4000-8000-0000000000a1', 'migration-proof-a', 'A budget', 1000, 'daily', 'key'),
  ('10000000-0000-4000-8000-0000000000b1', 'migration-proof-b', 'B budget', 2000, 'total', 'session');

insert into public.api_keys (id, user_id, key_hash, key_prefix, name, budget_id)
values (
  '20000000-0000-4000-8000-0000000000a1',
  'migration-proof-a',
  'migration-proof-hash-a',
  'llmk_proof_a',
  'A key',
  '10000000-0000-4000-8000-0000000000a1'
);

insert into public.requests (
  id, user_id, api_key_id, provider, model, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, cost_cents, latency_ms, status, source
)
values
  (
    '30000000-0000-4000-8000-0000000000a1',
    'migration-proof-a',
    '20000000-0000-4000-8000-0000000000a1',
    'openai',
    'known-cost-model',
    10,
    5,
    2,
    1,
    12.5,
    100,
    'success',
    'proxy'
  ),
  (
    '30000000-0000-4000-8000-0000000000a2',
    'migration-proof-a',
    '20000000-0000-4000-8000-0000000000a1',
    'openai',
    'historical-unknown-cost-model',
    10,
    5,
    0,
    0,
    null,
    120,
    'success',
    'proxy'
  );
commit;
`;

const legitimateAssertions = `
do $$
declare
  aggregate json;
begin
  if (select count(*) from public.accounts) <> 2
     or (select count(*) from public.budgets) <> 2
     or (select count(*) from public.api_keys) <> 1
     or (select count(*) from public.requests) <> 2 then
    raise exception 'populated migration changed fixture row counts';
  end if;

  if (select count(*) from public.requests where cost_cents is null) <> 1 then
    raise exception 'historical unknown cost was not preserved';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requests'
      and column_name = 'api_key_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  ) then
    raise exception 'request API-key identity did not reach target UUID shape';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requests'
      and column_name = 'cost_cents'
      and is_nullable = 'YES'
      and column_default is null
  ) then
    raise exception 'unknown cost is not represented explicitly';
  end if;

  aggregate := public.usage_aggregate(
    '20000000-0000-4000-8000-0000000000a1',
    30,
    'proxy'
  );
  if (aggregate->>'requests')::bigint <> 2
     or (aggregate->>'pricedRequests')::bigint <> 1
     or (aggregate->>'unknownCostRequests')::bigint <> 1
     or (aggregate->>'totalCostCents')::numeric <> 12.5 then
    raise exception 'aggregate completeness result is incorrect: %', aggregate;
  end if;
end
$$;
`;

const crossTenantFixture = `
begin;
insert into public.accounts (user_id, plan)
values ('migration-proof-a', 'pro'), ('migration-proof-b', 'free');

insert into public.budgets (id, user_id, name, limit_cents, period, scope)
values (
  '10000000-0000-4000-8000-0000000000b1',
  'migration-proof-b',
  'B budget',
  2000,
  'total',
  'key'
);

insert into public.api_keys (id, user_id, key_hash, key_prefix, name, budget_id)
values (
  '20000000-0000-4000-8000-0000000000a1',
  'migration-proof-a',
  'migration-proof-hash-a',
  'llmk_proof_a',
  'A key',
  '10000000-0000-4000-8000-0000000000b1'
);
commit;
`;

const productionScaleFixture = `
begin;

insert into public.accounts (user_id, plan)
select
  'scale-user-' || i,
  case when i <= 2 then 'pro' else 'free' end
from generate_series(1, 5) as users(i);

insert into public.budgets (id, user_id, name, limit_cents, period, scope)
select
  ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  case when i <= 5 then 'scale-user-1' else 'scale-user-2' end,
  'scale-budget-' || i,
  100000 + i,
  case when i % 2 = 0 then 'daily' else 'total' end,
  case when i = 9 then 'session' else 'key' end
from generate_series(1, 9) as budget_rows(i);

insert into public.api_keys (id, user_id, key_hash, key_prefix, name, budget_id, revoked_at)
select
  ('20000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  case when i <= 12 then 'scale-user-1' else 'scale-user-2' end,
  'scale-hash-' || i,
  'scale-prefix-' || i,
  'scale-key-' || i,
  (
    '10000000-0000-4000-8000-' || lpad(
      (
        case
          when i <= 12 then ((i - 1) % 5) + 1
          else 6 + ((i - 13) % 4)
        end
      )::text,
      12,
      '0'
    )
  )::uuid,
  case when i = 23 then now() else null end
from generate_series(1, 23) as key_rows(i);

insert into public.provider_keys (
  id, user_id, provider, encrypted_key, iv, key_prefix, key_name, revoked_at
)
select
  ('40000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'scale-user-' || (((i - 1) % 5) + 1),
  'scale-provider-' || i,
  'scale-ciphertext-' || i,
  'scale-iv-' || i,
  'scale-provider-prefix-' || i,
  'default',
  case when i > 10 then now() else null end
from generate_series(1, 15) as provider_rows(i);

insert into public.requests (
  id, user_id, api_key_id, session_id, provider, model,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_cents, latency_ms, status, created_at, source, tool_calls
)
select
  ('30000000-0000-4000-8000-' || lpad(request_number::text, 12, '0'))::uuid,
  keys.user_id,
  keys.id::text,
  'scale-session-' || (request_number % 1000),
  case when request_number % 2 = 0 then 'openai' else 'anthropic' end,
  'scale-model-' || (request_number % 7),
  100 + (request_number % 1000),
  10 + (request_number % 200),
  request_number % 50,
  request_number % 20,
  case when request_number = 1 then null else (request_number % 1000)::numeric / 100 end,
  50 + (request_number % 2000),
  case when request_number <= 101 then 'error' else 'success' end,
  now() - make_interval(
    days => (request_number % 110)::integer,
    mins => (request_number % 1440)::integer
  ),
  'proxy',
  null
from generate_series(1, 121328) as requests(request_number)
join public.api_keys keys
  on keys.id = (
    '20000000-0000-4000-8000-' || lpad((((request_number - 1) % 23) + 1)::text, 12, '0')
  )::uuid;

commit;
`;

const productionScaleAssertions = `
do $$
declare
  aggregate json;
  expected_requests bigint;
  aggregate_plan json;
begin
  if (select count(*) from public.accounts) <> 5
     or (select count(*) from public.budgets) <> 9
     or (select count(*) from public.api_keys) <> 23
     or (select count(*) from public.provider_keys) <> 15
     or (select count(*) from public.requests) <> 121328 then
    raise exception 'scale migration changed fixture row counts';
  end if;

  if (select count(*) from public.requests where status = 'error') <> 101
     or (select count(*) from public.requests where cost_cents is null) <> 1
     or (select count(distinct user_id) from public.requests) <> 2 then
    raise exception 'scale migration changed the observed data-shape controls';
  end if;

  select count(*)
    into expected_requests
  from public.requests
  where user_id = 'scale-user-1'
    and api_key_id = '20000000-0000-4000-8000-000000000001'::uuid;

  aggregate := public.usage_aggregate(
    '20000000-0000-4000-8000-000000000001',
    365,
    'proxy'
  );
  if (aggregate->>'requests')::bigint <> expected_requests
     or (aggregate->>'pricedRequests')::bigint
        + (aggregate->>'unknownCostRequests')::bigint <> expected_requests then
    raise exception 'scale aggregate completeness is incorrect: %', aggregate;
  end if;

  set local enable_seqscan = off;
  execute $plan$
    explain (format json)
    select id
    from public.requests
    where api_key_id = '20000000-0000-4000-8000-000000000001'::uuid
      and user_id = 'scale-user-1'
  $plan$ into aggregate_plan;
  if position('requests_api_key_owner_idx' in aggregate_plan::text) = 0 then
    raise exception 'tenant/key lookup did not select the ownership index: %', aggregate_plan;
  end if;
end
$$;
`;

function verifyLocalDatabase() {
  const containers = runChecked(dockerCommand, ['ps', '--format', '{{.Names}}']).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  if (!containers.includes(databaseContainer)) {
    throw new Error(
      `Expected ${databaseContainer} to be running. Run corepack pnpm@9.15.4 db:start first.`,
    );
  }
}

let primaryError;
try {
  verifyLocalDatabase();

  resetToBaseline();
  psql(legitimateFixture);
  supabase('migration', 'up', '--local');
  psql(legitimateAssertions);
  console.log('POPULATED_MIGRATION_PROOF legitimate data: PASS');

  resetToBaseline();
  psql(crossTenantFixture);
  const rejectedInvocation = supabaseInvocation([
    'migration',
    'up',
    '--local',
  ]);
  const rejected = run(rejectedInvocation.command, rejectedInvocation.args);
  const rejectionOutput = `${rejected.stdout || ''}\n${rejected.stderr || ''}`;
  if (rejected.status === 0) {
    throw new Error('Cross-tenant budget fixture was not rejected.');
  }
  if (!rejectionOutput.includes('cross-tenant API-key budget assignments')) {
    throw new Error(`Migration failed for the wrong reason.\n${rejectionOutput}`);
  }
  console.log('POPULATED_MIGRATION_PROOF cross-tenant budget violation: PASS');

  resetToBaseline();
  psql(productionScaleFixture);
  const scaleStartedAt = performance.now();
  supabase('migration', 'up', '--local');
  const scaleDurationSeconds = (performance.now() - scaleStartedAt) / 1000;
  psql(productionScaleAssertions);
  if (scaleDurationSeconds > 30) {
    throw new Error(
      `Observed-cardinality migration took ${scaleDurationSeconds.toFixed(2)}s; local kill threshold is 30s.`,
    );
  }
  console.log(
    `POPULATED_MIGRATION_PROOF observed cardinality: PASS (${scaleDurationSeconds.toFixed(2)}s)`,
  );
} catch (error) {
  primaryError = error;
} finally {
  try {
    resetToTarget();
  } catch (cleanupError) {
    primaryError = primaryError
      ? new AggregateError([primaryError, cleanupError], 'Proof and local reset both failed.')
      : cleanupError;
  }
}

if (primaryError) throw primaryError;

console.log('POPULATED_MIGRATION_PROOF PASS');
