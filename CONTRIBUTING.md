# Contributing to LLMKit

## Quick setup

```bash
git clone https://github.com/smigolsmigol/llmkit.git
cd llmkit
pnpm install          # installs deps + activates pre-commit hooks
pnpm check-all        # typecheck + lint + dead code + publish validation
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

1. Run `pnpm check-all` before pushing (CI runs the same checks)
2. Keep PRs focused: one feature or fix per PR
3. Write a clear description: what changed, why, how to test
4. Link the GitHub Issue if there is one

## Quality gate

Every PR must pass:
- `tsc --noEmit` across all packages (zero errors)
- `biome check` (lint + format)
- `knip` (no dead exports or unused deps)
- `publint` (package.json correctness for published packages)
- 270+ tests across TS and Python (unit, smoke, integration, contract)
- Security: gitleaks, semgrep, keyguard, pnpm audit, pip-audit, bandit

Run the TS quality gate locally: `pnpm check-all`

## Security

The pre-commit hook blocks credential files and 19 secret patterns automatically. If you have [gitleaks](https://github.com/gitleaks/gitleaks) installed locally, the hook also runs a staged file scan.

CI enforces the full security pipeline: secrets scan, semgrep static analysis, dependency audits, and keyguard project scan. Deploy is gated behind all security jobs. See [SECURITY.md](SECURITY.md) for details.

Do not commit `.env` files, API keys, PEM files, or tokens. The hook will catch most of these, but review your diff before pushing.

## Code style

- TypeScript strict, no `any`
- Follow existing patterns in the codebase
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

## Need help?

Open an issue or start a discussion on GitHub.
