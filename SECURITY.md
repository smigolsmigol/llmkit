# Security Policy

## Reporting a Vulnerability

Do not open a public issue. Email security@llmkit.sh or DM @smigolsmigol on X.

Include: what you found, steps to reproduce, and your assessment of impact.

We acknowledge within 48 hours and fix critical issues within 7 days.

## Security Architecture

LLMKit is an API gateway that handles provider API keys. Every layer is built to minimize exposure.

### Key Management

Provider keys are encrypted with AES-256-GCM before storage. Each operation uses a random 12-byte IV and AAD (Additional Authenticated Data) bound to the owner and provider context, preventing ciphertext swapping between rows. User API keys are SHA-256 hashed. The raw key is shown once at creation and never stored.

### Runtime Isolation

The proxy runs in Cloudflare Workers V8 isolates without a local filesystem. Secrets are supplied through Worker bindings and provider keys are decrypted only on the scoped request path that needs them. Isolation reduces persistence and cross-request exposure; it does not make a compromised request path harmless.

### Supply Chain

All CI actions pinned to commit SHAs (not mutable version tags). Every workflow runs with explicit least-privilege permissions. npm packages published with [Sigstore provenance attestation](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC, cryptographically linking each package to its source commit.

### CI Security Pipeline

Pull requests and main-branch changes run a layered quality and security pipeline. Deployment workflows have separate environment and target gates.

1. **Secret scanning**: gitleaks (full git history) + semgrep secrets ruleset + private pattern matching
2. **Static analysis**: semgrep security-audit rules across the entire codebase
3. **Dependency audit**: `pnpm audit` (TS) + `pip-audit` (Python) + `bandit` (Python security linter)
4. **Project scanner**: [KeyGuard](https://github.com/smigolsmigol/keyguard) scans for leaked secrets, credential files, vulnerable configs
5. **Type safety**: `tsc --noEmit` + `mypy` (Python) - type errors don't ship
6. **Release verification**: health checks, pricing sync validation, phantom URL detection, and private-info scanning where the workflow has a deployed target

### Local Protection

Pre-commit hooks install automatically via `pnpm install` (sets `core.hooksPath`). The hook blocks:
- Credential files (`.pem`, `.key`, `.p12`, `.env`, `.npmrc`)
- 19 secret patterns (OpenAI, Anthropic, xAI, Google, AWS, GitHub, Slack, Stripe, Supabase, JWTs, PEM keys, SSH targets)
- Private info patterns from a local gitignored config file
- [gitleaks](https://github.com/gitleaks/gitleaks) staged file scan (when installed)

### Editor Context Hygiene

`.cursorignore` and `.claudeignore` reduce accidental inclusion of local configuration in supported editor tools. They are not access-control boundaries. Credentials must remain outside the repository and enter the runtime only through the documented secret bindings.

### Dependency Surface

The proxy has two runtime dependencies: Hono and @f3d1/llmkit-shared. Minimal attack surface by design.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
