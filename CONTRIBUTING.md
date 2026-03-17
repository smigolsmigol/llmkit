# Contributing to LLMKit

## Quick setup

```bash
git clone https://github.com/smigolsmigol/llmkit.git
cd llmkit
pnpm install
pnpm check-all        # typecheck + lint + dead code + publish validation
```

Proxy local dev (needs wrangler):
```bash
cd packages/proxy
cp ../../.env .dev.vars
pnpm dev
```

Dashboard local dev:
```bash
cd packages/dashboard
cp ../../.env .env.local
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
- All test suites (200+ tests across 9 packages)

Run everything at once: `pnpm check-all`

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
  shared/       types, constants, pricing (published to npm)
  proxy/        CF Workers API gateway (private, deployed)
  sdk/          TypeScript client + CostTracker (published)
  ai-sdk-provider/  Vercel AI SDK v6 provider (published)
  cli/          Forward proxy for Python/Go/Rust (published)
  mcp-server/   MCP tools for Claude Code (published)
  dashboard/    Next.js 15 admin UI (private, deployed)
```

## Need help?

Open an issue or start a discussion on GitHub.
