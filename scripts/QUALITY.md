# LLMKit quality gates

The local gate is the source of truth for pull-request readiness. CI bootstraps the same pinned
tools and runs the same `quality:pr` command. Run commands from the repository root through the
declared pnpm version:

```bash
corepack pnpm@9.15.4 install --frozen-lockfile
corepack pnpm@9.15.4 quality:bootstrap:all
corepack pnpm@9.15.4 quality:pr
```

`quality:bootstrap:all` creates the ignored `.venv`, hydrates pinned pre-commit environments, and
pulls the digest-pinned Semgrep image. Docker must be available for Semgrep and the local Supabase
proof. No quality command deploys or mutates the hosted Supabase project.

## Gate levels

| Command | Contract |
| --- | --- |
| `quality:fast` | Repository hygiene, secret checks, GitHub Actions lint, Ruff, Bandit, Biome, dormant-package boundary, and the proxy logging guard. |
| `quality:static` | Fast gate plus workspace build/typecheck, Knip, Publint, generated pricing check, strict Mypy, Semgrep rules and scan, and KeyGuard fixtures. |
| `quality:pr` | Static gate plus deterministic JavaScript tests, Python tests and fuzzing, Python statement/branch coverage, zero-known-vulnerability npm and Python audits, the local data-preserving Supabase migration proof, and a real Worker/database compatibility request. |

The Python gate independently requires at least 90% statement and branch coverage. Repository-wide
JavaScript coverage is not yet at the required 90% statements, branches, functions, and lines, so a
green `quality:pr` is a foundation-PR contract, not proof that the final coverage objective is met.

## Intentional Knip boundaries

The package test programs are explicit Knip entries because the root test runner invokes them by
path. Biome, KeyGuard, Publint, and the pinned Supabase CLI are intentional root development
dependencies invoked by quality scripts, which are excluded from Knip's product-source graph. New
exceptions require the same narrow explanation and a real execution gate.

## Fail-closed checks

```bash
node scripts/run-quality-gate.mjs --self-test
node scripts/run-ts-quality.mjs --self-test
node packages/proxy/test/worker-deploy-guard-test.mjs
```

The full test runner also exercises the deployment guard, secret-log boundary, and adjacent valid
fixtures. Production deployment remains a separate manual workflow with an exact target string and
protected environment approval.
