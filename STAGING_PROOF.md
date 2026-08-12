# Hosted staging proof

This procedure evaluates the budget-control path in an isolated Cloudflare Worker and an isolated Supabase project. It is intentionally separate from the normal README because it is an operator proof, not a quick start.

## Safety contract

- Production is not a valid target.
- The worktree must be clean and committed.
- The Worker name must be `llmkit-proxy-staging`.
- The staging and production Supabase project refs must differ.
- Deployment and proof execution require separate explicit confirmation values.
- Secret values stay in an external file. The repository records only expected secret names.
- A recovery journal is written before the first external fixture mutation.

## Local preflight

```bash
corepack pnpm@9.15.4 install --frozen-lockfile
corepack pnpm@9.15.4 --filter @f3d1/llmkit-proxy build
corepack pnpm@9.15.4 --filter @f3d1/llmkit-proxy test:budget-falsifier
```

Do not continue if the repository is dirty or the deterministic Worker proof fails.

## External secret file

Create an `.env` or JSON file outside the repository containing exactly these names:

```text
ENCRYPTION_KEY
STAGING_PROOF_TOKEN
STAGING_SUPABASE_PROJECT_REF
SUPABASE_KEY
SUPABASE_URL
```

The deploy guard reads secret names back from Cloudflare without printing their values. Authentication, account, target, unexpected-secret, and database-binding failures stop the deployment.

## Database preflight

Use the pinned Supabase CLI and inspect the migration set before applying it:

```powershell
$stagingRef = 'abcdefghijklmnopqrst'
$productionRef = 'zyxwvutsrqponmlkjihg'
if ($stagingRef -eq $productionRef) { throw 'staging database matches production' }

node node_modules/supabase/dist/supabase.js link --project-ref $stagingRef
node node_modules/supabase/dist/supabase.js migration list --linked
node node_modules/supabase/dist/supabase.js db push --linked --dry-run
```

Supabase data-less branches created from an unversioned production project may contain one synthetic
`remote_schema` migration. That record is a branch bootstrap marker, not proof that the repository
migrations ran. For a disposable branch only:

1. Generate `db diff --from migrations --to linked --schema public` and retain the output as the
   pre-migration drift observation.
2. Mark the synthetic `remote_schema` version reverted and the repository baseline version applied.
3. Repeat the dry-run. It must name exactly the remaining repository migrations. The first pending
   migration contains a fail-closed baseline preflight; do not bypass it if it rejects the inherited
   schema.

Do not repair migration history on production. Applying migrations remains a separate database
mutation decision.

After approval:

```powershell
node node_modules/supabase/dist/supabase.js db push --linked
node node_modules/supabase/dist/supabase.js db lint --linked --schema public --level warning --fail-on warning
node node_modules/supabase/dist/supabase.js migration list --linked
node node_modules/supabase/dist/supabase.js db diff --from migrations --to linked --schema public
node node_modules/supabase/dist/supabase.js unlink
```

The final schema diff must be empty. SQL pgTAP tests remain a local/CI gate because hosted branch
login roles may not be allowed to execute the `extensions.plan` helper. The hosted proof below is
the branch's real-consumer gate; a remote pgTAP permission error is `NOT RUN`, never a pass.

## Guarded deployment

```powershell
$accountId = '0123456789abcdef0123456789abcdef'
$approval = "staging:llmkit-proxy-staging:account:$accountId:db:$stagingRef"
$env:LLMKIT_DEPLOY_APPROVED = $approval

corepack pnpm@9.15.4 --filter @f3d1/llmkit-proxy deploy:staging -- `
  --confirm $approval `
  --account-id $accountId `
  --database-project-ref $stagingRef `
  --production-database-project-ref $productionRef `
  --bootstrap `
  --secrets-file C:\secure\llmkit-staging.env
```

Bootstrap is valid only for a recognized Worker-not-found response. Later deployments omit `--bootstrap` and must match the existing account, database binding, and secret-name set.

## Proof run

The runner binds the host, database, deployed source commit, and unique fixture identities. It joins HTTP receipt IDs to database rows and exercises concurrent admission, retries, attribution, settlement, Durable Object alarm recovery, PostgREST outbox recovery, coordination latency, and cleanup.

```powershell
$host = 'llmkit-proxy-staging.<account>.workers.dev'
$proofApproval = "staging:$host:db:$stagingRef"
$env:LLMKIT_HOSTED_PROOF_APPROVED = $proofApproval

corepack pnpm@9.15.4 --filter @f3d1/llmkit-proxy proof:hosted:staging -- --confirm $proofApproval
```

The primary receipt is ignored locally at `audits/llmkit-hosted-staging-budget-proof.json`. The coordination thresholds are 50 ms median and 150 ms p95 over 40 post-warmup samples.

## Recovery

Before the first mutation, the runner writes non-secret fixture identities to `audits/llmkit-hosted-staging-recovery.json`. An unresolved journal blocks another run.

```powershell
corepack pnpm@9.15.4 --filter @f3d1/llmkit-proxy proof:hosted:staging -- --recover --confirm $proofApproval
```

A clean recovery requires zero proof rows, API keys, budgets, reservations, settlements, evidence records, outbox entries, rate-limit entries, idempotency entries, and alarms for the recorded fixture identities.

Deleting the staging Worker, rotating its token, or changing either database remains a separate external mutation.
