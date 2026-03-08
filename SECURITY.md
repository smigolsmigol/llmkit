# Security

LLMKit handles API keys, encrypted provider credentials, and financial data (cost tracking, budget enforcement). Security is not optional.

## Reporting vulnerabilities

If you find a security issue, please email security@llmkit.dev or open a private security advisory on GitHub. Do not open a public issue.

## What we scan

Every push runs through CI. Before releases, we also run:

- **semgrep** with `p/security-audit` and `p/secrets` rulesets (61 rules across all source)
- **knip** for dead exports and unused dependencies
- **publint** for package.json correctness

Current status: 0 findings.

## Encryption

Provider API keys stored in Supabase are encrypted with AES-256-GCM. Each ciphertext gets a unique random IV. Authenticated additional data (AAD) binds each encrypted key to its context, preventing ciphertext from being moved between records. The encryption key lives in Cloudflare Workers secrets, never in source or client-side code.

10 crypto tests cover: roundtrip correctness, wrong-context rejection, tampered ciphertext detection, tampered IV detection, and IV uniqueness.

## Budget enforcement

Budget limits use Cloudflare Durable Objects for atomic read-modify-write operations. The reservation pattern (reserve before the LLM call, settle after) prevents the check-then-act race condition that affects most budget enforcement implementations.

26 budget tests cover the reservation algorithm. 16 of those are adversarial bypass attempts: session hopping, period boundary exploitation, zero-cost reservation leaks, stale reservation buildup, config manipulation, double-record replay, and interleaved operations.

Budget enforcement is also tested live against the deployed proxy with concurrent requests, not just mocked in unit tests.

## Auth

API keys are SHA-256 hashed before storage. Plaintext keys are never persisted. Auth runs as the first middleware; invalid keys are rejected before any other processing (validation, budget check, provider routing).

## Input validation

Request bodies are validated before reaching provider adapters. Malformed JSON returns 400 (not 500). PostgREST error details are logged server-side but never returned to clients.

Session IDs are validated against `[\w-]{1,128}` to prevent injection through the session tracking header.

## Rate limiting

Per-key RPM limits enforced via Durable Objects (default 60/min, configurable per key). Returns standard `Retry-After` header on 429 responses.
