# LLMKit first Supabase migration contract

Status: data-preserving candidate under revalidation; not staging- or production-approved. The
empty-database premise was disproved by direct production counts on 2026-07-16.

## Outcome

Convert the populated live database from an ad hoc service-role schema into one versioned baseline
that preserves historical records and explicit unknown-cost state, enforces user identity at both
data and RLS layers, and exposes no aggregate RPC to anonymous or authenticated callers.

The migration is promoted only after a populated live-shaped local database reaches the target and
all preservation, access, and violation fixtures pass. Schema drift or an incompatible production
row is a kill condition, not a reason to weaken the assertions or rewrite data silently.

## Verified inputs

- Live public-schema snapshot: `20260716-055116-live-public-schema.sql.snapshot`
- Snapshot SHA-256: `A74267CB22F41B5F20A94DB68F50FB7C0B242814C202089D5F4012E876E7DFCB`
- Live product tables: six. A direct `count(*)` on 2026-07-16 proves 5 accounts, 23 API keys, 9
  budgets, 15 provider keys, 121,328 requests, and 0 support messages. The table-list tool reported
  misleading zero estimates and must not be used as row-count evidence.
- Historical requests cover 2026-02-06 through 2026-05-27 and two distinct request owners. All
  121,328 request-to-key relationships are present and tenant-consistent.
- One historical request has `cost_cents is null`. This is unknown cost, not zero, and must remain
  distinguishable in storage and aggregates.
- One API key is linked to a budget owned by another tenant. This is the only observed relational
  blocker. The migration must reject it until Federico reviews the affected key and chooses the
  intended same-tenant budget or explicit detachment.
- Aggregate-only follow-up proves the mismatched key is active but has zero historical requests; its
  owner already has eight budgets. The foreign budget is used by two keys, including one key owned
  by that budget's owner. Do not mutate or clone the foreign budget. Prefer attaching the unused key
  to the intended existing same-owner budget after Federico identifies it by key name/prefix.
- All request API-key IDs are non-empty UUID text; statuses are 121,227 `success` and 101 `error`;
  runtime counters are otherwise non-null and non-negative. There are no request-key orphans,
  request/key tenant mismatches, duplicate key hashes, orphan budgets, invalid budget enums, or
  duplicate active provider-key names.
- Remote migration history: absent
- Application branch: `feat/agent-finops-pilot` at `b34b6ce`
- Database runtime: PostgreSQL 17.6
- Application runtime floor: Node.js 22 or later; the repository still has Node 20 CI and MCP
  image references that must be removed because the Supabase JS family ended Node 20 support on
  2026-06-30
- Authentication authority: Clerk user subject, exposed to Supabase RLS through a third-party token
- Trusted database principals: Cloudflare proxy service role; narrow dashboard provider-key and
  admin operations until their dedicated server boundary is replaced
- Previous empty-fixture proof: Supabase CLI 2.109.1 on PostgreSQL 17.6.1; clean reset passed; 44/44
  pgTAP fixtures passed; local schema lint reported no errors or warnings; direct PostgREST probes
  returned 401 for anon, 403 for authenticated, and 200 with the expected aggregate for
  `service_role`. This evidence remains useful for access control but no longer proves migration of
  production data.
- Required replacement proof: the populated migration runner must preserve row counts and one NULL
  cost, report priced versus unknown-cost requests, reject the cross-tenant budget fixture for the
  named reason, then leave the local database at the full target migration.

## Authority matrix

| Surface | Anonymous | Clerk authenticated user | Trusted service role |
|---|---|---|---|
| `accounts` | none | select own `user_id`, `plan`, and `plan_expires_at` only | admin read/update after application admin assertion |
| `api_keys` | none | select safe columns from own rows; no direct mutation | generate, update, and revoke key material; key-hash lookup and budget join |
| `budgets` | none | select, insert, and delete own rows; update only mutable budget fields | budget enforcement join |
| `requests` | none | select own rows only | insert request records and aggregate usage |
| `provider_keys` | none | no direct table access | encrypt/store/list/decrypt/revoke with explicit user filter |
| `support_messages` | none | insert and select own rows | support read/reply path |
| aggregate functions | none | none | execute the one current aggregate only |

`service_role` bypasses RLS. Every trusted query therefore keeps an explicit `user_id` predicate
where it operates on user-selected identifiers. RLS is defense in depth for authenticated database
access, not an excuse to weaken trusted-code filtering.

## Exact target changes

### Request runtime compatibility

1. Preserve live `user_id`, `source`, `end_user_id`, and `tool_calls`; root `schema.sql` is stale and
   must be replaced after migration proof.
2. Change `requests.status` default from `ok` to `success` and constrain values to `success` or
   `error`, matching both logger paths.
3. Make token counters, latency, status, and timestamp non-null after the populated preflight proves
   they contain no NULL or negative values. Keep `cost_cents` nullable, drop its misleading zero
   default, and report priced versus unknown-cost request counts in the aggregate.
4. Add non-negative constraints for request usage/cost/latency and budget limits. A NULL cost remains
   the explicit unknown state and is not rejected by the non-negative constraint.
5. Keep attribution columns and indexes out of this foundation. They belong to the later product
   migration together with the proxy and dashboard consumers that use them.

### Identity and relational integrity

1. Make `api_keys.key_hash` unique and set `api_keys.name` default to `default`.
2. Add `unique (id, user_id)` on both `api_keys` and `budgets`.
3. Replace the simple budget foreign key with
   `api_keys (budget_id, user_id) -> budgets (id, user_id)`. A user's key cannot bind another user's
   budget even if trusted application code misses a filter.
4. Convert `requests.api_key_id` from nullable text to non-null UUID.
5. Add `requests (api_key_id, user_id) -> api_keys (id, user_id)`. A request cannot be attributed to
   a user different from the API-key owner.
6. Add database checks for budget period (`daily`, `weekly`, `monthly`, `total`) and scope (`key`,
   `session`).
7. Replace the provider-key full unique constraint with an active-row partial unique index on
   `(user_id, provider, key_name) where revoked_at is null`, allowing a revoked name to be replaced
   without permitting two active copies.
8. Add explicit child-side indexes for `(budget_id, user_id)` and `(api_key_id, user_id)`, plus
   ownership indexes used by RLS and dashboard reads: `api_keys (user_id)`, `budgets (user_id)`,
   `requests (user_id, created_at desc)`, and `support_messages (user_id, created_at desc)`.

### Function boundary

1. Drop `get_user_usage(text, integer)` and `usage_aggregate(text, integer)`.
2. Replace `usage_aggregate(text, integer, text)` with a `security invoker` implementation that
   preserves the deployed proxy signature during the foundation rollout.
3. Set `search_path = ''` and schema-qualify every `public.requests` reference.
4. Revoke execution from `public`, `anon`, and `authenticated`; grant only `service_role`.
5. Revoke function execution from API roles in default privileges so the same failure does not
   recur on the next function.
6. A tenant-explicit replacement signature is deferred until its runtime caller and dual-schema
   compatibility proof are reviewed in the same later slice.

### Table grants and RLS

1. Revoke all public-table privileges from `anon`.
2. Revoke the current blanket privileges from `authenticated`, then grant only the operations in
   the authority matrix.
3. Use PostgreSQL column grants for `accounts`, `api_keys`, and `budgets`; row ownership alone must
   not expose Stripe identifiers, admin notes, hashes, or immutable owner fields to direct clients.
4. Resolve the current Clerk subject as `(select auth.jwt()->>'sub')`.
5. Add separate select/insert/update/delete policies rather than one broad `for all` policy where
   the operations differ.
6. Use both `using` and `with check` on authenticated writes.
7. Give `provider_keys` no authenticated policy because row filtering cannot prevent selection of
   ciphertext and IV columns. Keep that table behind the trusted server boundary.
8. Give authenticated users no plan/account mutation policy. Admin changes remain a separately
   asserted trusted operation.
9. Revoke automatic table and sequence privileges for future `public` objects, then make every
   `anon`, `authenticated`, and `service_role` grant explicit in the migration. Grants and RLS are
   separate gates; both must match the authority matrix.

### Local runtime contract

1. Use Node.js 22 or later and the repository-pinned pnpm 9.15.4. Node 20 is no longer an accepted
   baseline even though several current CI jobs and the MCP-server image still reference it.
2. Discover the current Supabase CLI commands with `--help`; do not install or invoke a guessed
   global command.
3. Configure the local Supabase stack for the same Clerk third-party issuer used by staging.
4. Database fixtures may set the authenticated role and request JWT claims directly for deterministic
   user-A/user-B policy tests. That is not evidence that a real Clerk token works; staging must prove
   the actual token exchange separately.

## Migration ordering

1. Assert PostgreSQL version and the captured live schema preconditions.
2. Prove all request IDs, relations, statuses, counters, key hashes, budgets, and active provider-key
   names are compatible with the target. Preserve NULL cost as unknown.
3. Abort on any orphan, request/key tenant mismatch, cross-tenant key/budget assignment, duplicate
   key hash, invalid budget, duplicate active provider-key name, or negative runtime value.
4. Revoke the exposed function execution first.
5. Normalize existing columns and constraints without rewriting historical cost.
6. Replace obsolete functions and privileges.
7. Replace blanket table grants and install RLS policies.
8. Create ownership indexes.
9. Run catalog assertions inside the same test transaction where possible.

The production execution must use a reviewed Supabase CLI migration after a fresh schema capture,
data-integrity preflight, secure logical backup, and current physical-backup confirmation. MCP
remains read-only and must not apply it.

## Required fixtures

| Fixture | Expected result |
|---|---|
| Anonymous calls any usage function | permission denied |
| Authenticated user A calls any usage function | permission denied |
| User A selects user B requests or budgets | zero rows |
| User A inserts or updates a budget with user B's subject | RLS denial |
| User A inserts and reads an own-user budget | pass |
| User A reads own requests | pass |
| Authenticated user attempts to insert API-key hash or prefix material directly | permission denied |
| Trusted key-creation route inserts a generated key and user A reads only its safe columns | pass |
| Authenticated user selects `provider_keys` | permission denied |
| Authenticated user updates `accounts.plan` | permission denied |
| Service role looks up an API key, inserts a full branch-shaped request, and aggregates it | pass |
| Populated legacy fixture contains one NULL cost | migration preserves NULL; aggregate reports one unknown-cost request |
| Populated legacy fixture contains a cross-tenant API-key/budget link | migration aborts before DDL with the named ownership error |
| Synthetic fixture matches observed table cardinalities: 5 accounts, 23 API keys, 9 budgets, 15 provider keys, 121,328 requests | every row count and observed shape control survives; tenant/key query selects `requests_api_key_owner_idx`; local DDL completes within 30 seconds |
| Negative request cost, token count, latency, or budget limit | database constraint failure |
| Request user does not match API-key owner | foreign-key failure |
| API key user does not match budget owner | foreign-key failure |
| Same provider key name is inserted twice while active | unique violation |
| Revoked provider key name is replaced | pass |
| Catalog inspection finds a definer function or mutable public-function search path | fail |
| Security and performance advisors after migration | no new security findings; performance findings triaged against workload |

Every guard needs both the violation and the legitimate pass. A green advisor result alone does not
prove the proxy, Clerk token, or Cloudflare runtime works.

## Runtime proof

After database fixtures pass, the staging application must prove:

1. Clerk sign-in produces a Supabase-accepted token with the expected `sub`.
2. Public pages load without database credentials.
3. A user can create a budget, create an API key through the trusted key-generation route, make one
   traced request, see its aggregate, export it, and revoke the key.
4. A second user cannot observe or mutate any first-user object by guessing IDs.
5. Provider-key encryption/decryption works only through the trusted Worker path.
6. Health distinguishes application liveness from database readiness.

## Rollout and rollback

- Rollout requires a current physical-backup receipt covering the populated database, an encrypted
  logical backup stored outside the repository, an independent logical schema artifact, populated
  local fixture receipts, staging runtime receipts, resolution of the one cross-tenant budget link,
  and Federico's approval for the exact SQL.
- Preserve the deployed aggregate signature through this migration. Any later signature or
  attribution change ships with its runtime consumer in a separately proved compatibility window.
- On failure, stop the application rollout and preserve the tightened grants/function revocations.
  Prefer a corrective forward migration. Restoring the physical backup is the last-resort full
  database rollback and does not restore Supabase Storage objects.

## Current production blocker

Do not apply or dry-run-promote the reconciliation migration yet. In the Supabase dashboard, inspect
the one API key whose `budget_id` resolves to a budget with a different `user_id`. Do not paste key
material or user IDs into chat. Federico must choose one of these explicit outcomes:

```sql
select
  k.id as api_key_id,
  k.key_prefix,
  k.name as api_key_name,
  k.user_id as api_key_owner,
  b.id as budget_id,
  b.name as budget_name,
  b.user_id as budget_owner
from public.api_keys k
join public.budgets b on b.id = k.budget_id
where k.user_id is distinct from b.user_id;
```

Run this read-only query in the authenticated Supabase SQL editor. Review the one returned row in the
dashboard; do not copy its identifiers into chat.

1. Preferred: attach the unused key to the intended named budget already owned by the key owner.
2. Create a new budget for the key owner with deliberately reviewed limits, then attach it.
3. Detach the budget only if temporary unbudgeted operation is acceptable and recorded.

Never clone the other tenant's webhook, budget, or ownership fields automatically. After the chosen
repair is separately approved and applied, rerun only the aggregate integrity preflight. The target
migration must still abort if any mismatch remains.
