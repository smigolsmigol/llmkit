# LLMKit Code Audit - 2026-02-19

Manual codebase review after initial build (sessions 1-5, ~7 hours of dev).

## Audit 1 - Initial Scan

All fixed in session 5.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | HIGH | Double budget charge on streaming | FIXED |
| 2 | HIGH | Double request logging on streaming | FIXED |
| 3 | HIGH | Auth bypass without explicit opt-in | FIXED |
| 4 | MEDIUM | No input validation | FIXED |
| 5 | LOW | Duplicated cost calculation (buildCost vs calculateCost) | deferred |
| 6 | MEDIUM | Rate limiter defined but not implemented | deferred to v2 |
| 7 | LOW | Budget estimateCost unsafe content access | deferred |
| 8 | LOW | No CORS headers (intentional, server-side SDK) | documented |

## Audit 2 - Deep Review (security, race conditions, code quality)

Three parallel scans: security, race conditions, code quality.

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | CRITICAL | Stream metadata timing - c.set() in callback runs after middleware reads c.get() | Stream handler does its own budget recording and logging. Middleware skips streams. |
| 2 | HIGH | Budget ID authorization bypass via x-llmkit-budget-id header | Removed header support. Budget only from API key record. |
| 3 | HIGH | SDK error parsing broken - reads err.message (undefined) | SDK reads body.error?.message with fallbacks. |
| 4 | MEDIUM | Gemini SSRF - model name interpolated into URL path | MODEL_NAME_RE regex validation before URL construction. |
| 5 | MEDIUM | maxTokens naming mismatch (SDK camelCase vs proxy snake_case) | Proxy accepts both max_tokens and maxTokens. |
| 6 | MEDIUM | getModelPricing prefix false positives | Longest matching prefix wins. |
| 7 | LOW | recordUsage JSON.parse without try/catch | Added try/catch. |
| 8 | LOW | Message role 'tool' in shared types but proxy rejected it | Added to VALID_ROLES (reverted in audit 3). |

## Audit 3 - Senior Line-by-Line Review

Full file-by-file review: 30 source files across 5 packages.

### Fixed

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | HIGH | **Streaming fallback broken** - generator errors in stream callback after 200 sent. catch block never fires, next provider never tried. | Warm-up: gen.next() outside callback forces the fetch. Connection errors caught in fallback loop. |
| 2 | MEDIUM | 'tool' role accepted by validation but all adapters break on it (wrong format/cast) | Reverted VALID_ROLES to system/user/assistant only. |
| 3 | LOW | getAdapter throws generic Error (500 "Something went wrong") for unknown providers | Throws ValidationError (400 with clear message). |
| 4 | LOW | findApiKey returns null on Supabase errors - backend down looks like 401 | Now throws on non-200 responses. |
| 5 | TYPE | Env Variables typed as required but conditionally set (apiKeyId, userId, etc.) | Made optional in type. Removed manual type overrides. |
| 6 | TYPE | SUPABASE_URL/KEY typed as required string but can be undefined | Made optional. Added narrowing checks for KEY alongside URL. |
| 7 | STALE | auth.ts comment referenced removed per-request budget override | Updated. |
| 8 | DEAD | ai-sdk-provider sends x-llmkit-budget-id header proxy no longer reads | Removed. |

### Deferred

| # | Severity | Issue | Notes |
|---|----------|-------|-------|
| 9 | MEDIUM | No request body size limit | CF Workers 100MB default is sufficient for now. |
| 10 | MEDIUM | No stream timeout | AbortController timeout for v2. |
| 11 | MEDIUM | Provider errors forwarded verbatim | Sanitize for v2. |
| 12 | MEDIUM | ai-sdk-provider hardcodes finishReason to 'stop' | Map from provider response for v2. |
| 13 | LOW | calculateCost dead code | Clean up when consolidating cost logic. |
| 14 | LOW | ProviderConfig, FallbackConfig, Budget - dead/mismatched types | Reconcile in v2. |
| 15 | LOW | LLMKitConfig.budgetId/defaultProvider/fallback unused in SDK | Remove or implement. |
| 16 | LOW | ollama in ProviderName but no adapter | Placeholder for v2. |
| 17 | LOW | Dashboard queries: 6 Supabase calls, 11K rows, JS aggregation | SQL aggregation for v2. |
| 18 | LOW | Non-responsive dashboard layout | Mobile layout for v2. |
| 19 | LOW | ApiKeyRow type in db.ts wider than actual SELECT | Narrow type or expand SELECT. |
| 20 | LOW | Rounding inconsistency: budget Math.ceil vs log toFixed(4) | Align rounding. |

## What's clean

- Zero `any`, zero `@ts-ignore`, zero unsafe casts
- TypeScript strict mode + noUncheckedIndexedAccess across all 5 packages (0 errors)
- No eval, no innerHTML, no prototype pollution vectors
- API key hashing via SHA-256 Web Crypto
- PostgREST query injection safe (hex-only hash output)
- Provider API keys never logged
- Error handler doesn't leak stack traces to clients
- Supabase service key only used server-side
- Env types now match runtime reality (optional where nullable)
- Streaming fallback chain works correctly
- Budget authorization locked to API key record only
