# Security Policy

## Reporting vulnerabilities

If you find a security vulnerability in LLMKit, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainer through the [GitHub profile](https://github.com/smigolsmigol) or use [GitHub Security Advisories](https://github.com/smigolsmigol/llmkit/security/advisories/new)
3. Include steps to reproduce and potential impact

We aim to acknowledge reports within 48 hours and provide a fix timeline within 7 days.

## Security measures

**Encryption**: Provider API keys are encrypted at rest with AES-GCM. User API keys are hashed with SHA-256 before storage.

**Authentication**: All proxy API calls require a valid API key via `Authorization: Bearer` header. Dashboard uses Clerk for user authentication.

**Data boundaries**: The MCP server's local tools (`llmkit_local_*`) never transmit data. Proxy tools only send request metadata (model, tokens, cost), never prompt content or completions.

**Infrastructure**: Proxy runs on Cloudflare Workers (edge, no persistent server). Database on Supabase with Row Level Security enabled on all tables. Dashboard on Vercel with Clerk SSO.

**CI/CD**: Automated secret scanning (gitleaks), security linting (semgrep), and dependency auditing on every push.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | Yes       |
| < 0.4   | No        |

## Scope

This policy covers the `@f3d1/llmkit-mcp-server` npm package and the hosted proxy at `llmkit-proxy.smigolsmigol.workers.dev`.
