# LLMKit Supabase workflow

This is an imperative migration project pinned to Supabase CLI `2.109.1`, PostgreSQL 17, and the
repository's pnpm `9.15.4`. Production is not linked by default, and local commands must never be
given production credentials.

## Local proof

Docker Desktop must be running with the WSL 2 backend.

```text
corepack pnpm@9.15.4 db:start
corepack pnpm@9.15.4 db:verify
corepack pnpm@9.15.4 db:stop
```

`db:verify` destroys and recreates only the local database. It first proves migration of a populated
legacy fixture, proves a cross-tenant budget assignment is rejected for the expected reason, resets
to the captured baseline again, and exercises the migration at the observed production table counts:
5 accounts, 23 API keys, 9 budgets, 15 provider keys, and 121,328 synthetic requests. The scale
fixture preserves the observed one unknown-cost row, 101 errors, and two request owners, checks the
post-migration ownership index plan, and fails if local DDL exceeds 30 seconds. It then resets to the
full target, runs the pgTAP tenant/privilege suite, and fails on local schema lint warnings. This is
cardinality and local DDL evidence, not a claim about production values, locks, or hardware. The
pgTAP suite owns its data inside a transaction and rolls it back.

Authenticated dashboard and Worker/database runtime proofs belong to the later isolated staging
slice. This foundation deliberately proves only the local database contract and preserves the
deployed Worker's three-argument aggregate signature.

The local stack uses Supabase's shared development keys and binds services to the host. Keep it
stopped when not testing and never reuse its keys anywhere.

## Migration roles

- `20260716064044_live_public_schema_baseline.sql` dependency-orders the checksumed production
  snapshot so an empty local database reproduces the captured live shape.
- `20260716064047_reconcile_agent_finops_security.sql` is the production DDL candidate. It aborts
  unless PostgreSQL is 17.x, the captured table/function shape still matches, and every populated
  relational and value invariant is compatible. NULL historical cost is preserved as unknown.
- `scripts/run-populated-migration-proof.mjs` proves preservation and the cross-tenant rejection
  against the actual migration boundary.
- `tests/database/tenant_isolation.test.sql` proves 49 legitimate and adversarial cases.

The baseline migration must never execute on production. Direct counts now prove the database is
populated, and one current API-key/budget ownership mismatch intentionally blocks reconciliation.
After that mismatch is explicitly resolved and the final preflight still matches, the production
procedure requires Federico's separate approval for these exact state changes:

1. Link the CLI to the intended project and verify the ref out loud.
2. Mark only baseline version `20260716064044` as applied with
   `supabase migration repair 20260716064044 --status applied --linked`.
3. Run `supabase db push --linked --dry-run` and prove only
   `20260716064047_reconcile_agent_finops_security.sql` is pending.
4. Apply only after current physical and encrypted logical backups, populated-data integrity,
   schema, application-compatibility, staging, and rollback gates pass.

Do not use `--include-all`, `--include-seed`, or `db reset --linked` on production.

## Clerk runtime evidence

Database fixtures set request JWT claims directly for deterministic user-A/user-B tests. The Clerk
development issuer `healthy-bat-61.clerk.accounts.dev` is configured locally, its live OIDC metadata
resolves, and local PostgREST loads the matching RS256 public key. On 2026-07-16, a real Clerk
development session passed the standalone browser proof and the actual authenticated Next.js
`/dashboard` load created exactly one local account. Re-run the browser proof whenever the Clerk or
Supabase third-party-auth configuration changes. Never paste a session token into chat or commit it.
