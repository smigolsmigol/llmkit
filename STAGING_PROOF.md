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

Stop unless the pending set matches the repository migration set. Applying migrations is a separate database mutation decision.

After approval:

```powershell
node node_modules/supabase/dist/supabase.js db push --linked
node node_modules/supabase/dist/supabase.js test db --linked supabase/tests/database
node node_modules/supabase/dist/supabase.js db lint --linked --schema public --level warning --fail-on warning
node node_modules/supabase/dist/supabase.js migration list --linked
node node_modules/supabase/dist/supabase.js unlink
```

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
