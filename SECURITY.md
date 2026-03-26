# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in LLMKit, please report it responsibly.

**Do not open a public issue.** Email security@llmkit.dev or DM @smigolsmigol on X.

Include: description of the vulnerability, steps to reproduce, and impact assessment.

We will acknowledge receipt within 48 hours and release a fix within 7 days for critical issues.

## How LLMKit Secures Your Keys

LLMKit is an API gateway that handles provider API keys (OpenAI, Anthropic, Google, xAI, etc.). Security is non-negotiable.

**Encryption**: Provider keys are encrypted with AES-256-GCM before storage. Each encryption uses a random 12-byte IV and AAD (Additional Authenticated Data) that binds the ciphertext to its owner and provider context, preventing ciphertext swapping between database rows.

**Hashing**: User API keys are SHA-256 hashed before storage. The raw key is shown once at creation and never stored.

**Runtime isolation**: The proxy runs on Cloudflare Workers. Workers execute in V8 isolates with no filesystem, no .env files, no SSH keys, and no persistent storage. Even if a Worker is compromised, there is nothing on disk to exfiltrate.

**Supply chain**: All CI actions are pinned to commit SHAs, not mutable version tags. Every workflow has explicit least-privilege permissions. This prevents the class of attack that compromised LiteLLM in March 2026. Security enforced by [KeyGuard](https://github.com/smigolsmigol/keyguard).

**AI tool exclusion**: `.cursorignore` and `.claudeignore` prevent AI coding assistants from reading secret files in the project.

**Dependency policy**: `pnpm audit` and `semgrep` run in CI. The proxy has two runtime dependencies (Hono, @f3d1/llmkit-shared). Minimal attack surface.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
