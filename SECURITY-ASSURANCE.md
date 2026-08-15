# LLMKit security assurance case

Last reviewed: 2026-08-14

This is a maintainer self-assessment of the security requirements in
[SECURITY.md](SECURITY.md). It is not an independent audit, penetration test, certification,
bug bounty, uptime promise, or claim that hosted service recovery is complete.

The source-level controls below are supported by code and executable tests. Hosted claims remain
`HOLD` unless a receipt binds the deployed Worker, database target, source revision, and observed
behavior. A green OpenSSF badge answer is not evidence for this case; the evidence must stand on its
own.

## Scope and critical claims

The assessed system is the LLMKit monorepo: local SDK and CLI tracking, the Cloudflare Worker API,
the public-recovery web Worker, and the Supabase schema used by the hosted path. The component and
data-flow map is in [ARCHITECTURE.md](ARCHITECTURE.md).

| Claim | Argument | Code evidence | Executable evidence | State |
| --- | --- | --- | --- | --- |
| C1. An unauthenticated or unknown caller cannot enter a protected hosted route. | `/v1/*` and `/mcp` authenticate centrally. Missing database configuration fails closed unless a local operator explicitly enables `DEV_MODE=true` without Supabase. | [auth middleware](packages/proxy/src/middleware/auth.ts), [application middleware order](packages/proxy/src/index.ts) | [auth negative tests](packages/proxy/test/auth-test.mjs), [production route behavior](packages/proxy/test/budget-falsifier/production-routes.behavior.test.ts) | Supported in source |
| C2. A hosted identity cannot select another tenant's key, budget, provider credential, or request record through a supported path. | The bearer-key lookup establishes one `user_id`; application queries scope by that identity; composite foreign keys and RLS reject cross-owner relationships. The service role is not treated as a tenant boundary. | [database access](packages/proxy/src/db.ts), [security reconciliation migration](supabase/migrations/20260716064047_reconcile_agent_finops_security.sql), [dashboard queries](packages/dashboard/src/lib/queries.ts) | [tenant-isolation pgTAP suite](supabase/tests/database/tenant_isolation.test.sql), [dashboard server-action tests](packages/dashboard/test/server-actions.test.ts) | Supported in source; hosted database version unverified |
| C3. Stored provider credentials are not persisted or returned as plaintext and cannot be swapped across owner/provider contexts. | WebCrypto AES-256-GCM uses a random 96-bit IV and owner/provider AAD. Only ciphertext, IV, and a display prefix are stored. Unsupported provider names are rejected before outbound credential dispatch. | [cryptography](packages/proxy/src/crypto.ts), [provider-key routes](packages/proxy/src/routes/keys.ts), [provider allowlist](packages/proxy/src/providers/index.ts) | [crypto negative tests](packages/proxy/test/crypto-test.mjs), [secret-log proof](packages/proxy/test/log-secret-runtime-proof.mjs), [production provider-route tests](packages/proxy/test/budget-falsifier/production-routes.behavior.test.ts) | Supported in source; rotation procedure remains limited |
| C4. A supported hard budget cannot be overspent by concurrent admission inside the modeled gateway path. | The request shape must have a conservative price ceiling. A budget-scoped Durable Object serializes reservations and writes a pending receipt before dispatch. Unknown or unbounded shapes fail closed. | [budget middleware](packages/proxy/src/middleware/budget.ts), [budget Durable Object](packages/proxy/src/do/budget-do.ts) | [budget falsifier](packages/proxy/test/budget-falsifier/gate0.test.ts), [BudgetDO behavior](packages/proxy/test/budget-falsifier/budget-do.behavior.test.ts), [coverage contract](scripts/check-budget-falsifier-coverage.mjs) | Supported for declared request shapes; not a provider invoice guarantee |
| C5. Retry handling does not silently turn an uncertain provider outcome into a second dispatch. | An Idempotency Durable Object serializes claims. Supported non-streaming responses are replayed only within a byte bound. Post-dispatch unknown outcomes remain terminal; pre-dispatch failures release the claim. | [idempotency middleware](packages/proxy/src/middleware/idempotency.ts), [Idempotency Durable Object](packages/proxy/src/do/idempotency-do.ts) | [idempotency behavior](packages/proxy/test/budget-falsifier/idempotency-do.behavior.test.ts), [production route falsifier](packages/proxy/test/budget-falsifier/production-routes.behavior.test.ts) | Supported for declared non-streaming behavior |
| C6. Restricted untrusted inputs and provider outputs are bounded and rejected by allowlist, type, range, pattern, time, or byte checks. | Provider names, roles, attribution IDs, idempotency keys, numeric ranges, message counts, provider errors, response bodies, and SSE frames have explicit validation or bounds. | [chat validation](packages/proxy/src/routes/chat.ts), [request evidence validation](packages/proxy/src/middleware/request-evidence.ts), [bounded response reader](packages/proxy/src/response-body.ts), [provider timeouts](packages/proxy/src/providers/request.ts) | [validation attacks](packages/proxy/test/validation-test.mjs), [bounded body tests](packages/proxy/test/budget-falsifier/response-body.behavior.test.ts), [bounded stream tests](packages/proxy/test/budget-falsifier/provider-streams.behavior.test.ts) | Supported for documented restrictions |
| C7. A source or staging result cannot be represented as a production deployment merely because local tests pass. | Production deployment requires an exact target, two matching approval signals, clean `main == origin/main`, required CI, and a post-deploy Worker-version receipt. Staging uses a separate Worker and database identity. | [deployment guard](scripts/run-worker-deploy.mjs), [CI deployment gate](.github/workflows/ci.yml), [staging proof surface](packages/proxy/src/staging.ts) | [deployment guard tests](packages/proxy/test/worker-deploy-guard-test.mjs), [hosted staging proof runner](scripts/run-hosted-budget-proof.mjs) | Supported in source; current production receipt absent |
| C8. The public web surface fails closed while hosted isolation and money-path proof are incomplete. | Recovery routing rejects authenticated UI and API paths before application handling and exposes an immutable web Worker version. | [recovery boundary](packages/dashboard/src/lib/public-recovery.ts), [web Worker](packages/dashboard/cloudflare-worker.ts), [web deployment config](packages/dashboard/wrangler.jsonc) | [recovery boundary tests](packages/dashboard/test/recovery-boundary-test.mjs), [HTTPS runtime test](packages/dashboard/test/https-redirect-runtime-test.mjs) | Observed on the public web Worker; hosted features remain closed |

## Threat model

### Assets

- LLMKit bearer keys and their ownership mapping.
- Provider API keys, encryption material, Supabase service credentials, deployment credentials, and
  proof tokens.
- Budget limits, reservations, settlement state, request receipts, and attribution identifiers.
- Tenant-scoped analytics and support data.
- Source, packages, workflow definitions, release provenance, and deployed Worker/database identity.
- Local coding-session and cost data read by the CLI, SDKs, or MCP server.

### Adversaries and failures

- An unauthenticated internet caller or a tenant attempting horizontal access.
- A caller with one valid LLMKit key sending malformed input, a stolen provider key, replayed
  requests, concurrency bursts, oversized responses, or cost shapes that cannot be bounded.
- A provider, webhook target, dependency, or returned payload behaving unexpectedly or maliciously.
- A compromised contributor token, CI action, deployment credential, or mutable dependency.
- Operator error: wrong account, wrong database, stale source, partial cleanup, secret disclosure, or
  an unsupported claim based on local evidence.
- Network failure after dispatch, database unavailability, Durable Object retry, or an ambiguous
  settlement outcome.

Denial of service by a sufficiently capable platform-level attacker, compromise of Cloudflare,
Supabase, Clerk, GitHub, package registries, or an upstream model provider, and recovery of an
already-compromised client are outside the guarantees. They remain ecosystem and operational risks.

### Entry points and trust boundaries

| Boundary | Untrusted input crossing it | Control and evidence |
| --- | --- | --- |
| Client -> public web Worker | URL, headers, and browser navigation | Recovery route classification, HTTPS redirect, CSP/HSTS and other response headers in [cloudflare-worker.ts](packages/dashboard/cloudflare-worker.ts); authenticated surfaces are closed. |
| Client -> API Worker | Bearer token, provider selection, prompts, attribution, direct provider credential, replay key | Central auth and middleware order in [index.ts](packages/proxy/src/index.ts); validation and negative route tests linked in C1 and C6. |
| API Worker -> Supabase | Service credential and tenant-scoped queries | Header construction and encoded filters in [db.ts](packages/proxy/src/db.ts); owner constraints, grants, and RLS in the migration and pgTAP proof linked in C2. |
| API Worker -> provider | Provider credential and user payload | Fixed provider table and certificate-validating platform `fetch`; direct credentials are only used for the selected first attempt. Unknown providers now fail closed before dispatch. |
| API Worker -> Durable Objects | Budget ID, API-key rate-limit identity, idempotency hash, receipts | One object identity per coordination scope, serialized storage, bounded leases, and behavior tests linked in C4 and C5. |
| Dashboard server -> Clerk/Supabase | Clerk identity plus privileged database access | Every supported action authenticates and scopes or verifies ownership. The service role alone is explicitly insufficient. Hosted paths stay closed in recovery mode. |
| Local process -> local SDK/CLI/MCP | Application calls, local files, environment variables | Local tools inherit host filesystem/process permissions and do not create a hosted receipt merely by calculating local cost. |
| GitHub Actions -> registries/Cloudflare | Source revision, OIDC identity, release/deploy tokens | Explicit job permissions, commit-pinned actions, protected production environment, provenance, exact target guard, and post-deploy receipt. |

## Secure design argument

| Principle | Application | Limitation |
| --- | --- | --- |
| Fail-safe defaults | Missing auth, missing key-vault configuration, unknown providers, unpriceable hard-budget requests, oversized bodies, and ambiguous post-dispatch retries deny or retain the conservative outcome. Public recovery closes hosted account routes. | Local `DEV_MODE` is an explicit operator bypass only when Supabase is absent. Soft budgets do not deny spend. |
| Complete mediation | Protected `/v1/*` routes traverse central auth; inference traverses request identity, idempotency, rate limiting, budget admission, and logging. Database relationships also enforce owner integrity. | Public pricing/health/discovery and read-only MCP behavior are intentional exceptions. Direct provider traffic that bypasses LLMKit is outside mediation. |
| Least privilege | CI jobs declare permissions; release jobs use OIDC; database grants restrict authenticated columns and operations; the public web Worker does not load Clerk or Supabase service secrets in recovery mode. | The API and dashboard server use a Supabase service credential, so application scoping and database constraints remain critical. |
| Separation of privilege | Production deploy requires an exact argument, matching environment approval, clean exact-main ancestry, required CI, and a protected environment. Provider-key use requires both tenant auth and the owner/provider AAD context. | One maintainer still controls critical project services; access continuity is tracked separately and is not solved by code review. |
| Economy of mechanism | Authentication, provider selection, cryptography, coordination, and bounded response reading use small shared modules and platform primitives. | The multi-provider cost model is inherently complex. The assurance case does not treat test count as proof of completeness. |
| Defense in depth | Auth, owner constraints, RLS, encryption, Durable Objects, input bounds, timeouts, static analysis, dependency scanning, provenance, and deploy gates address different failure layers. | A failure in privileged application scoping can still be serious; RLS and encryption do not make arbitrary service-role code safe. |

## Common weakness countermeasures

The mapping uses the [OWASP Top 10](https://owasp.org/www-project-top-ten/) and MITRE CWE entries as
review prompts, not certifications.

| Weakness class | Countermeasure and negative proof | Residual risk |
| --- | --- | --- |
| [CWE-287 Improper Authentication](https://cwe.mitre.org/data/definitions/287.html), OWASP A07 | Bearer parsing and SHA-256 lookup fail closed; production database presence disables the local bypass. Auth and production-route tests cover absent, malformed, unknown, and unavailable identity. | A stolen valid bearer remains valid until revoked. |
| [CWE-862 Missing Authorization](https://cwe.mitre.org/data/definitions/862.html) and [CWE-639 Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html), OWASP A01 | Tenant identity comes from the authenticated key or Clerk, not an attribution header. Composite owner foreign keys, RLS, scoped queries, and cross-tenant pgTAP violations provide independent layers. | Privileged service-role code must preserve explicit scoping. |
| [CWE-200 Exposure of Sensitive Information](https://cwe.mitre.org/data/definitions/200.html), OWASP A02 | Raw LLMKit keys are not stored; provider keys are AES-GCM encrypted; API responses return only prefixes; log boundary tests use canary secrets. | Plaintext exists in Worker memory during an authorized provider call. Error and observability configuration require continued review. |
| [CWE-20 Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html), OWASP A03 | Allowlisted providers/roles, patterns, numeric ranges, length limits, JSON shape checks, encoded database filters, and rejection tests cover supported restrictions. | Provider-specific `extra` fields are intentionally extensible; sensitive/core names are blocked but provider semantics can change. |
| [CWE-400 Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html), OWASP A04 | Rate limits, provider timeouts, maximum provider-chain length, message limits, bounded response/error/SSE readers, and idempotency body limits cap modeled work. | Distributed denial of service and third-party provider capacity are platform risks. |
| [CWE-362 Concurrent Execution Using Shared Resource with Improper Synchronization](https://cwe.mitre.org/data/definitions/362.html) | Durable Objects serialize budget, idempotency, and rate-limit decisions. Burst, exact-fit, replay, expiry, and settlement-failure scenarios are falsified. | Guarantees apply only to calls traversing the same declared scope and deployed code/database contract. |
| [CWE-295 Improper Certificate Validation](https://cwe.mitre.org/data/definitions/295.html), OWASP A02 | Hosted cloud provider URLs are fixed HTTPS origins and platform `fetch` performs certificate and hostname validation before private headers are sent. No code disables verification. | The explicit Ollama adapter uses `http://localhost` only when selected. Public domains currently accept TLS 1.1, so the network-protocol criterion remains `HOLD`. |
| [CWE-918 Server-Side Request Forgery](https://cwe.mitre.org/data/definitions/918.html), OWASP A10 | Provider destinations are fixed and unsupported providers fail closed. Budget webhooks require HTTPS. | User-configured webhook hosts are not allowlisted and redirects are platform-managed. No private credential is attached, but egress abuse remains possible. |
| [CWE-327 Use of a Broken or Risky Cryptographic Algorithm](https://cwe.mitre.org/data/definitions/327.html) | WebCrypto AES-256-GCM and SHA-256 are the only application cryptographic primitives; IV tampering, ciphertext tampering, wrong keys, and wrong AAD fail tests. | Stored ciphertext has no algorithm/key version field, so algorithm migration and key rotation require a controlled data migration. |
| OWASP A06 Vulnerable and Outdated Components and A08 Integrity Failures | Frozen lockfiles, zero-known-vulnerability audit gates, OSV, CodeQL, Semgrep, Scorecard supply-chain checks, SBOM generation, SHA-pinned actions, and package provenance run in CI. | Scanners can miss malicious or newly disclosed behavior; dependency review remains required. |

## Cryptography, credentials, and network posture

- LLMKit bearer keys use SHA-256 as a lookup digest for high-entropy API keys, not as password
  hashing. Human passwords are delegated to Clerk and are not stored by this repository.
- Provider secrets use AES-256-GCM with a fresh 12-byte IV and AAD of `user_id:provider`. WebCrypto
  rejects a modified ciphertext, IV, key, or context.
- Runtime encryption, database, deployment, and notification credentials are separate bindings or
  external secrets and can be replaced without recompiling code. Rotating the provider-encryption
  key requires re-encrypting stored rows; no zero-downtime rotation tool is claimed.
- The application has no algorithm-versioned ciphertext envelope or secondary algorithm. OpenSSF
  cryptographic algorithm agility is therefore not claimed. Adding unused algorithms would increase
  mechanism complexity; an algorithm change requires a reviewed format and migration plan.
- Cloud provider destinations are fixed HTTPS URLs. The optional Ollama adapter is explicitly
  selected and uses localhost HTTP for a local runtime; it is not evidence for a secure hosted
  transport.
- On 2026-08-14, forced TLS 1.1 probes using curl 8.21.0 with Schannel and .NET both received HTTP
  200 from `llmkit.sh` and `api.llmkit.sh`. This proves the Cloudflare minimum TLS setting is weaker
  than the desired TLS 1.2 floor. Do not mark the secure-network criterion met until a forced TLS
  1.1 probe fails and TLS 1.2 or 1.3 succeeds on both hosts.

## Runtime evidence register

Observations are point-in-time evidence and do not prove future availability.

| Observed UTC | Surface | Identity and result | Claim allowed |
| --- | --- | --- | --- |
| 2026-08-14 14:50 | `https://llmkit.sh/` | HTTP 200 in `public-recovery`; `X-LLMKit-Worker-Version: 21214168-5f7e-425a-9af1-d0bc1b298251`; HSTS, CSP, frame, referrer, permissions, and content-type headers present. | The public-recovery web Worker and its observed version were serving. This does not bind the version UUID to a source commit by itself. |
| 2026-08-14 14:50 | `https://api.llmkit.sh/health` | HTTP 200 with static application version `0.0.1`; no immutable Worker version header before this source change. | Health only. No source revision, database version, security posture, or deployment freshness claim. |
| Current source change | API deploy contract | The proxy config binds `CF_VERSION_METADATA`, every API response exposes its Worker version ID, and post-deploy CI requires a UUID-shaped header. | No deployed claim until the manual production workflow runs on exact `main` and its GitHub run records the commit and observed Worker UUID. |
| No current receipt | Hosted staging/database | [run-hosted-budget-proof.mjs](scripts/run-hosted-budget-proof.mjs) can bind a staging Worker to a source commit and database project ref, exercise concurrency/idempotency/crash recovery, and emit a hashed cleanup receipt. | No hosted database-version or staging PASS claim without the actual exact-head receipt and clean cleanup journal. |

## Residual risks and current HOLDs

1. **Minimum TLS version: HOLD.** TLS 1.1 was accepted by both public hosts on 2026-08-14. Raise the
   Cloudflare minimum to TLS 1.2 or later, then repeat positive and negative protocol probes.
2. **Hosted database identity: HOLD.** There is no current public receipt binding the production
   Supabase migration state to the served API Worker. Hosted account and dashboard routes remain
   closed.
3. **API deployment identity: HOLD until deployment.** The source now exposes immutable Worker
   metadata and CI verifies it, but the currently served API predates that contract.
4. **Cryptographic agility and rotation:** AES-GCM is appropriate, but ciphertext is not versioned
   and encryption-key rotation requires a controlled row migration.
5. **Webhook egress:** alert webhook URLs require HTTPS but are not host-allowlisted. Redirect and
   destination policy should be tightened before treating them as a high-trust integration.
6. **Browser hardening:** the public CSP retains `unsafe-inline` and `unsafe-eval` for the current
   Next.js/Clerk build. `frame-ancestors 'none'`, HSTS, and other headers reduce adjacent risk but do
   not remove script-injection risk.
7. **Single-maintainer operations:** protected automation reduces accidental mutation but does not
   provide access continuity or independent security review.

## Recheck and decision procedure

Re-evaluate this case when any auth, tenant, provider, pricing, budget, idempotency, crypto, secret,
database, workflow, dependency, deployment, or recovery boundary changes. Also recheck when a public
Worker version changes, a vulnerability report lands, a dependency scanner alerts, or hosted access
is reopened.

The minimum source review is:

1. Inspect the exact base-to-head diff and confirm every linked evidence path still exists.
2. Run the focused negative tests for the affected boundary, then the repository `quality:pr` gate.
3. Run the budget falsifier when the money path or its dependencies change.
4. For staging, retain the exact-head hosted proof receipt and clean recovery journal.
5. For production, retain the GitHub run URL, source commit, observed Worker version UUID, verified
   database migration identity, TLS protocol probes, and runtime checks.
6. Obtain independent review for any hosted-security or availability claim. A maintainer self-review
   cannot close that requirement.

Current conclusion: the source has substantial, executable security controls and an explicit threat
model, but the full hosted assurance claim is `HOLD` on TLS minimum, exact deployed API identity,
database-version evidence, and independent review.
