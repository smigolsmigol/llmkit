# Supabase recovery artifacts

This directory holds read-only recovery evidence. Files here are not migrations and must never be
passed to `supabase db push` or applied to a linked project.

`20260716-055116-live-public-schema.sql.snapshot` is the live `public` schema observed through the
project-scoped read-only Supabase MCP on PostgreSQL 17.6 at 2026-07-16 05:51:16 UTC. It records the
six tables, constraints, non-constraint indexes, RLS state, policies, functions, and effective API
role grants present at capture time. It does not contain product rows, credentials, Auth data,
Storage metadata or objects, managed platform schemas, extension-owned objects, or migration
history.

Snapshot SHA-256: `A74267CB22F41B5F20A94DB68F50FB7C0B242814C202089D5F4012E876E7DFCB`.

Installed extensions observed separately at the same recovery checkpoint:

- `pgcrypto` 1.3 in `extensions`
- `pg_stat_statements` 1.11 in `extensions`
- `supabase_vault` 0.3.1 in `vault`
- `uuid-ossp` 1.1 in `extensions`
- `plpgsql` 1.0 in `pg_catalog`

The live shape is now dependency-ordered as local history baseline
`../migrations/20260716064044_live_public_schema_baseline.sql`. The production DDL candidate is
`../migrations/20260716064047_reconcile_agent_finops_security.sql`; it is locally reset-tested but
not approved for production. The baseline must be marked applied in remote history after exact
preflight and must never execute on the live database. See `../README.md` for the gated procedure.
