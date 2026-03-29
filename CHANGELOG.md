# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Dependabot config and MCP config fixer script
- Vercel custom event tracking
- `/compare` cost calculator page on the dashboard

### Fixed
- 15 adapter fixes from cross-reference audit
- xAI tool name mapping, o1-mini pricing, grok-4 alias
- Mobile responsive pass 2 (nav collapse, grids, widget, gradients)
- CSP header for Vercel analytics

## [0.6.0] - 2026-03-27

### Added
- `POST /v1/responses` - Responses API passthrough with server-side tool cost tracking
- `GET /v1/pricing/compare` - public cost comparison API across 730+ models, no auth needed
- Tool calling passthrough on `/v1/chat/completions` (tools, tool_choice, response_format)
- AI SDK provider: tool calling, structured output, multimodal support
- Non-token cost tracking for xAI (web_search, x_search, code_execution, attachment_search, collections_search)
- GitHub Action (`llmkit-budget`) for AI agent budget caps in CI
- Provider-specific body field passthrough (top_k, top_p, etc. forwarded to providers)
- Public `/pricing` page on the dashboard with 730+ models for SEO
- PR monitor CI workflow for Telegram alerts on cookbook PR changes

### Fixed
- Block sensitive field leakage in body passthrough (apiKey, secret, token, etc.)
- Pin CLI version in GitHub Action for supply chain hardening
- CLI proxy now detects xAI, DeepSeek, and Mistral base URLs correctly
- Transparent logo background (dark theme fix)
- Remove unused stream import in responses route
- Security hardening: command injection, template injection, divide-by-zero

### Changed
- Bump shared to 0.0.5 (extraRates support, div-zero fix)
- Bump CLI to 0.0.8 (xAI/DeepSeek/Mistral routing)
- CLI forwards `/v1/responses` route and unmatched routes transparently

## [0.5.0] - 2026-03-25

### Added
- Landing page: full redesign with cyberpunk theme, provider icons, animated logo
- Multi-page dashboard site (pricing, compare, MCP setup)
- MCP server universal adapter architecture: auto-detect Claude Code, Cline, Cursor
- MCP server `--hook` mode for Claude Code SessionEnd integration
- Cline adapter: WSL distro path scanning on Windows
- Cost anomaly detection in BudgetDO
- Tool invocation logging on every request
- `x-llmkit-user-id` header for per-end-user cost attribution
- Compliance-ready CSV export with sha256 integrity hash
- MCP server cumulative project costs across all sessions
- Admin: per-package daily downloads stacked bar chart, trend deltas
- Pricing expansion from 44 to 731 models via genai-prices + LiteLLM merge
- Single-source pricing architecture (pricing.json generates all consumer files)
- Weekly CI pricing auto-update from upstream sources
- Contract tests, shared exports tests (13 tests)
- AI SDK provider unit tests (17 tests), MCP server tests (15 tests)
- Smoke tests for MCP server, AI SDK provider, CLI
- Support chat widget on dashboard

### Fixed
- Cache double-counting in CLI + SDK
- Python transport null safety
- SDK ESM imports missing .js extensions (broken at runtime)
- BudgetDO session reset on period boundary
- XSS quote escaping in MCP dashboard
- OG image blocked by Clerk middleware (social shares broken)
- AI SDK provider: finishReason, provider types, stream edge cases
- Proxy stream safety and BudgetDO bugs
- MCP server silent hang when isTTY is undefined
- PostgREST injection in mcp.ts and analytics.ts
- Query param injection in client.ts, path traversal in hook
- Python SDK cache token pricing (was missing entirely)
- Key creation quickstart snippets (were fundamentally broken)

### Changed
- MCP server 0.4.0 -> 0.4.5 (Notion tools, setup instructions, version fixes)
- AI SDK provider bumped to 0.1.0 (tool calling support)
- SDK bumped to 0.0.6 (CJS fix)
- Python SDK 0.1.3 -> 0.1.5 (cache-aware pricing, calculate_cost export)
- Admin dashboard: tab-based layout with threshold cards and alerts panel
- Analytics v2 collector with anomaly detection and signup alerts
- Branding: teal -> violet, animated wordmark SVG

### Security
- Pin CI actions to commit SHAs
- Pin Docker images by SHA hash (OpenSSF Scorecard)
- CodeQL SAST + artifact attestation in CI
- PyPI trusted publisher workflow
- KeyGuard integration, SECURITY.md, AI tool exclusions (.cursorignore, .claudeignore)
- Hardened pre-commit hooks, provenance workflow

## [0.4.0] - 2026-03-20

### Added
- Admin unified dashboard with ecosystem metrics, sparklines, download trends
- Hourly health check: proxy, dashboard, npm, PyPI, Glama, MCP Registry, Hetzner
- Telegram alerts on health check failures
- MCP server v0.3.0: annotations, structured content, MCP app dashboard
- Admin analytics tab with npm/PyPI/GitHub/health metrics
- E2E checks in CI: pricing sync validation, phantom URL detection, private info scan
- Post-deploy verification in CI pipeline
- Privacy policy and security policy pages
- Source column filtering and RPC aggregation for analytics

### Fixed
- Opus 4-5/4-6 pricing corrected to $5/$25 (was $15/$75)
- Health check: follow redirects, port-alive for Hetzner
- Analytics: PyPI monthly downloads not release count, daily avg column
- Admin dashboard: double borders, dead sidebar code, sparkline fallback
- Turbo.json: add analytics + pricing env vars (stale Vercel builds)

### Changed
- README rewrite: cut 50%, fix stale numbers
- Dashboard URL renamed to llmkit-dashboard.vercel.app
- MCP server README: example prompts, compliance features
- Next.js bumped to 15.5.12 (HTTP smuggling + disk cache vulns)

## [0.3.0] - 2026-03-17

### Added
- Admin panel with platform metrics, trend deltas, provider health, 4 charts
- User overview: trend deltas, clickable sessions, budget usage progress bars
- Admin request explorer with user resolution, full filtering, pagination
- Multimodal image support across OpenAI, Anthropic, Gemini
- Interactive ECharts (replaced recharts): zoom, pan, hourly bucketing
- Session filtering via `x-llmkit-session-id` badge on requests page
- Providers page with usage data, health status, add-key form
- Getting-started checklist on dashboard
- Export CSV button
- Landing page with CLI demo video

### Changed
- Admin access driven by database (accounts.plan) instead of env var
- Charts: stacked bars, tight layout, compact height

## [0.2.0] - 2026-03-10

### Added
- MCP server with 11 tools (6 proxy, 5 local)
- Claude Code local cost tracking tools (cache savings, forecast, project costs)
- SessionEnd hook for automatic cost summary on exit
- MCP over HTTP endpoint at `/mcp`
- Telegram alerts for new users and error notifications
- Accounts table with admin panel
- Per-key RPM rate limiting
- LiteLLM community pricing fallback with zero-cost warnings
- CI pipeline: gitleaks, semgrep, pnpm audit

### Fixed
- Budget enforcement: DO was never initialized from Supabase
- Chart Y-axis showing $0 for sub-dollar amounts
- NaN on providers with stored keys but no requests

## [0.1.0] - 2026-03-01

### Added
- Hono-based proxy on Cloudflare Workers
- 11 provider adapters: Anthropic, OpenAI, Gemini, Groq, Together, Fireworks, DeepSeek, Mistral, xAI, Ollama, OpenRouter
- Budget enforcement via Durable Objects with reservation pattern
- TypeScript SDK with CostTracker and streaming
- Python SDK with `tracked()` httpx transport
- CLI proxy (`npx @f3d1/llmkit-cli -- <cmd>`)
- Vercel AI SDK custom provider
- Next.js dashboard with Clerk auth
- AES-256-GCM provider key vault
- Fallback chains via `x-llmkit-fallback` header
- Session tracking via `x-llmkit-session-id` header
