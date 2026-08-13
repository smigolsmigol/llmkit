# Security Policy

## Supported Versions

Security fixes are applied to the latest release. Older releases are not supported unless a
security advisory says otherwise.

## Report a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/smigolsmigol/llmkit/security/advisories/new)
when possible. If GitHub is unavailable, email `security@llmkit.sh`.

Do not open a public issue, discussion, or social-media message for a suspected vulnerability.
Include the affected component and version, impact, reproduction steps, and any proof of concept
that is safe to share.

We aim to acknowledge reports within 48 hours. After reproduction, we will confirm the scope,
severity, and coordinated disclosure plan. Resolution time depends on impact and complexity;
critical issues are prioritized immediately. We will keep the reporter informed while the issue is
being investigated and fixed.

LLMKit does not currently operate a paid bug bounty. We can credit reporters in the advisory when
requested and appropriate.

## Scope and Safe Testing

The source in this repository, published LLMKit packages, and reachable LLMKit-hosted services are
in scope. Reports about authorization failures, credential exposure, budget-enforcement bypasses,
request or tenant data exposure, and supply-chain compromise are especially useful.

Please test only with accounts and data you own or have permission to use. Do not degrade service
availability, access or retain data beyond what is needed to demonstrate the issue, use social
engineering, or publish details before a coordinated fix. Third-party provider outages and purely
theoretical findings without a practical security impact are out of scope.

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

1. **Secret scanning**: gitleaks + semgrep secrets ruleset + private pattern matching
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
