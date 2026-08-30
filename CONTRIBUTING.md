# Contributing to LLMKit

## Quick setup

```bash
git clone https://github.com/smigolsmigol/llmkit.git
cd llmkit
corepack pnpm@9.15.4 install --frozen-lockfile
corepack pnpm@9.15.4 quality:bootstrap:all
corepack pnpm@9.15.4 quality:pr
```

`pnpm install` runs the `prepare` script which sets `core.hooksPath` to `.github/hooks/`. The pre-commit hook scans staged files for secrets and credential patterns before every commit.

Proxy local dev (needs wrangler):
```bash
cd packages/proxy
cp ../../.env.example .dev.vars   # then fill in your keys
pnpm dev
```

Dashboard local dev:
```bash
cd packages/dashboard
cp ../../.env.example .env.local  # then fill in your keys
pnpm dev
```

## Branch naming

`feature/short-description`, `fix/short-description`, `docs/short-description`

Always branch from `main`. Keep branches short-lived.

## Pull requests

1. Run `corepack pnpm@9.15.4 quality:pr` before pushing (CI runs the same contract)
2. Keep PRs focused: one feature or fix per PR
3. Write a clear description: what changed, why, how to test
4. Link the GitHub Issue if there is one
5. Sign every commit to certify that you have the right to submit it

## Developer Certificate of Origin

LLMKit uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Every
commit must include a `Signed-off-by` trailer matching the contributor's Git author identity:

```bash
git commit -s -m "describe the change"
```

The sign-off certifies contribution rights under the DCO. It is not a cryptographic signature and
does not assign copyright to LLMKit. If a commit is missing the trailer, amend it yourself; another
person must not add your certification for you.

## Quality gate

Every PR must pass:
- `tsc --noEmit` across all packages (zero errors)
- `biome check` (lint + format)
- `knip` (no dead exports or unused deps)
- `publint` (package.json correctness for published packages)
- Deterministic JavaScript programs plus Python tests and fuzzing
- Python statement and branch coverage at or above 90%
- Security: gitleaks, Semgrep, KeyGuard, zero-known-vulnerability dependency audits, and Bandit
- Data-preserving local Supabase migration fixtures, pgTAP, and schema lint

Major new functionality must add automated tests in the same pull request. The tests must exercise
the new behavior and a nearby failure or boundary case. A pull request may claim that tests are not
applicable only when its description identifies the non-executable change and the maintainer accepts
that rationale during review.

The exact commands, gate levels, and current JavaScript coverage boundary are documented in
[`scripts/QUALITY.md`](scripts/QUALITY.md).

## Security

The pre-commit hook blocks credential files and 19 secret patterns automatically. If you have [gitleaks](https://github.com/gitleaks/gitleaks) installed locally, the hook also runs a staged file scan.

CI enforces the full security pipeline: secrets scan, semgrep static analysis, dependency audits, and keyguard project scan. Deploy is gated behind all security jobs. See [SECURITY.md](SECURITY.md) for details.

Do not commit `.env` files, API keys, PEM files, or tokens. The hook will catch most of these, but review your diff before pushing.

## Coding standards

- TypeScript and JavaScript follow the versioned [Biome recommended rules](https://biomejs.dev/linter/)
  in `biome.json`, plus TypeScript strict mode and the repository's explicit security rules.
- Python follows the [Ruff formatter's Black-compatible style](https://docs.astral.sh/ruff/formatter/)
  and the rule families selected in `packages/python-sdk/pyproject.toml`.
- Biome errors and every warning category except the documented cognitive-complexity baseline fail
  the local and CI quality gate. Complexity advisories remain visible and are capped per file; a
  reduction must lower the matching cap in `scripts/run-biome-policy.mjs`, and growth is rejected.
- Proxy DB calls use raw PostgREST fetch (no ORM)
- Dashboard DB calls use @supabase/supabase-js
- Comments only where the logic isn't obvious
- Error handling at boundaries (user input, external APIs), not everywhere

## Commits

- Short, lowercase, imperative: "fix auth redirect", "add session filter"
- Body explains why, not what (the diff shows what)
- No bullet lists in commit bodies

## Project structure

```
packages/
  shared/           types, constants, pricing data (published to npm)
  proxy/            CF Workers API gateway (private, deployed)
  sdk/              TypeScript client + CostTracker (published to npm)
  python-sdk/       Python SDK: tracked(), cost estimation (published to PyPI)
  ai-sdk-provider/  Vercel AI SDK v6 provider (published to npm)
  cli/              forward proxy for Python/Go/Rust (published to npm)
  mcp-server/       MCP tools for Claude Code, Cline, Cursor (published to npm)
  dashboard/        Next.js 15 admin UI (private, deployed)
```

## Brand assets

`.github/logo-wordmark.svg` and `.github/logo-wordmark-animated.svg` are the canonical logo
sources. The matching files under `packages/dashboard/public/` must remain byte-identical.
Repository and website preview PNGs are reviewed raster exports from those sources; update and
visually review both when the canonical logo changes.

Project decisions, maintainer responsibilities, and dispute handling are documented in
[`GOVERNANCE.md`](GOVERNANCE.md). The current product boundaries are documented in
[`ARCHITECTURE.md`](ARCHITECTURE.md) and [`SECURITY.md`](SECURITY.md).

## Need help?

Open an issue or start a discussion on GitHub.
