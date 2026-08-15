# LLMKit architecture

Last reviewed: 2026-08-13

LLMKit is a monorepo containing local cost-inspection tools, published SDKs, a Cloudflare Workers API
gateway, a web dashboard, and Supabase migrations. Local tracking and hosted enforcement are
different trust and availability paths.

The public web surface is currently deployed in `public-recovery` mode. Public documentation and
pricing pages are available. Signup, sign-in, dashboard routes, and authenticated dashboard APIs are
closed with a 503 response while hosted isolation and money-path proof are completed.

## Components

| Component | Location | Responsibility | Persistent state |
| --- | --- | --- | --- |
| Shared catalog and types | `packages/shared` | Provider names, request and cost types, and the generated pricing catalog | Bundled files only |
| TypeScript SDK | `packages/sdk` | Hosted client, sessions, and local `CostTracker` | Caller process only unless it calls the gateway |
| Python SDK | `packages/python-sdk` | Local HTTP transport tracking, estimates, and hosted client | Caller process only unless it calls the gateway |
| CLI | `packages/cli` | Loopback proxy for child processes that honor supported base-URL variables | Process memory and console or JSON output |
| MCP server | `packages/mcp-server` | Reads supported local coding-session data and optionally queries authenticated gateway tools | Local editor/session storage remains the source |
| AI SDK provider | `packages/ai-sdk-provider` | Vercel AI SDK 6 adapter for the gateway | No independent durable state |
| API gateway | `packages/proxy` | Authentication, request identity, idempotency, rate limiting, budget admission, provider dispatch, cost settlement, and analytics APIs | Durable Objects plus Supabase |
| Dashboard and website | `packages/dashboard` | Public product pages and, when restored, authenticated management and analytics | Server-side access to Supabase |
| Database migrations | `supabase/migrations` | Owner constraints, row-level policies, keys, budgets, request receipts, and aggregate functions | Supabase Postgres |

## Local tracking path

1. The application calls its provider directly through a supported SDK or a CLI-injected loopback
   proxy.
2. LLMKit reads usage fields from the provider response or explicit token counts.
3. The local package estimates cost from the bundled pricing snapshot.
4. The estimate is returned to the caller, callback, terminal, or MCP tool.

This path does not create a hosted LLMKit request receipt and cannot reject provider spend. Calls
that bypass the supported client seam or omit recognized usage remain invisible or unpriced. The MCP
local tools read supported files on the user's machine; they do not upload those files to LLMKit.

## Hosted request path

For `POST /v1/chat/completions` and `POST /v1/responses`, the path is:

1. The Worker hashes the bearer key and resolves its API-key record, owner, optional budget, and
   rate limit from Supabase.
2. Request-evidence middleware assigns stable request and attribution identities.
3. Optional idempotency claims are serialized by an `IdempotencyDO`. Replay is limited to supported
   non-streaming requests and bounded response bodies.
4. A `RateLimitDO` serializes the configured per-key request rate.
5. Hard-budget validation rejects unknown prices, missing output ceilings, unsupported fields, and
   content whose cost cannot be bounded before dispatch.
6. A budget-scoped `BudgetDO` reserves the worst-case supported cost and writes the pending durable
   receipt before the provider request begins.
7. The gateway uses a request-supplied provider key or decrypts the owner's stored key only for the
   selected provider request. Provider calls use bounded timeouts and response limits.
8. Successful usage settles the reservation to actual or declared provider cost. Failure handling
   releases a request known not to have dispatched or retains a terminal conservative disposition
   when provider spend may have occurred.
9. Supabase stores request evidence for analytics. Durable Object state remains the admission owner;
   database writes do not replace the atomic budget decision.

Read-only MCP gateway queries authenticate separately and do not pass through the provider budget
or rate-limit middleware.

## Identity and ownership

- A hosted API key resolves to one `user_id`. The raw LLMKit key is shown once; only its SHA-256
  digest and prefix are stored.
- Budgets, provider keys, API keys, and requests carry owner identity. Database constraints prevent
  cross-owner key, budget, and request relationships.
- Database row-level policies scope authenticated database access by the JWT subject.
- Dashboard server actions use a privileged server client, so they must authenticate with Clerk and
  scope or verify every read and mutation against the Clerk `userId`. The service role is not a
  tenant boundary by itself.
- Customer, workflow, agent, session, and end-user identifiers are attribution dimensions. They do
  not grant authorization.

## Storage and secret boundaries

- Provider credentials are encrypted with AES-256-GCM using a random IV and additional authenticated
  data bound to owner and provider.
- Encryption keys, service credentials, and deployment tokens enter through runtime bindings or
  external secret stores. They are not repository configuration.
- `BudgetDO`, `IdempotencyDO`, and `RateLimitDO` use Cloudflare Durable Object storage for serialized
  coordination.
- Supabase owns durable relational records and analytics queries. Staging and production use distinct
  Worker and database identities.
- Local CLI, SDK, and MCP state is outside the hosted tenant and remains under the user's filesystem
  and process permissions.

## Deployment and observation

The API and website are separate Cloudflare Workers. Both bind Cloudflare version metadata and add
an immutable Worker version header. The API exposes a health endpoint. In recovery mode, the
website blocks authenticated routes before the application handler. Both Workers enable platform
observability.

Production API deployment is a separate, manually confirmed workflow action after required CI.
Post-deploy verification requires the API health response and its immutable Worker version receipt.
Staging scripts reject production targets and bind proof to an exact source revision, database, and
cleanup journal. A local or staging pass does not prove production deployment.

## Failure boundaries

- Cost values are estimates unless the provider returns an explicit compatible cost. They are not a
  provider invoice.
- Budget enforcement applies only to a key linked to a supported hard budget and to request shapes
  the gateway can bound before dispatch.
- A network failure after provider dispatch may leave billable work whose final usage is unavailable.
  The gateway favors avoiding duplicate dispatch over pretending the request was never sent.
- The pricing snapshot records prices but not a reliable modality taxonomy. LLMKit does not infer
  cross-modality comparability or rank an implicit catalog.
- Hosted account and dashboard recovery remains a release gate, not an available feature.

Security guarantees and excluded guarantees are specified in [SECURITY.md](SECURITY.md). User-facing
availability boundaries are kept in [README.md](README.md) and [QUICKSTART.md](QUICKSTART.md).
