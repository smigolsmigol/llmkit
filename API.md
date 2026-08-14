# LLMKit API Reference

Base URL: `https://api.llmkit.sh`

All authenticated endpoints require a Bearer token in the `Authorization` header.
Hosted use requires an existing LLMKit API key. Check [llmkit.sh](https://llmkit.sh) for current account and service availability.

## Authentication

```
Authorization: Bearer llmk_your_key_here
```

Keys are SHA-256 hashed server-side and never stored in plaintext. If a budget is linked to the key,
the proxy enforces it before forwarding the request.

## Common request headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | yes | `Bearer <llmkit_api_key>` |
| `x-llmkit-provider` | no | Force a provider (`openai`, `anthropic`, `gemini`, `groq`, `together`, `fireworks`, `deepseek`, `mistral`, `xai`, `ollama`, `openrouter`). Auto-inferred from model name if omitted. |
| `x-llmkit-provider-key` | no | Pass the first provider's API key directly instead of using one stored in the dashboard. It is never reused for another provider domain. |
| `x-llmkit-fallback` | no | Ordered comma-separated provider chain, up to five unique providers. Later attempts require that provider's stored dashboard key. A hard budget reserves the sum of every attempt's worst-case estimate before dispatch. If a dispatched attempt fails and fallback succeeds, settlement conservatively commits that reserved ceiling because the failed attempt may still be billable. |
| `x-llmkit-customer-id` | no | Stable customer identifier for margin attribution. Defaults to the authenticated LLMKit tenant ID. |
| `x-llmkit-workflow-id` | no | Stable workflow or product-operation identifier. |
| `x-llmkit-agent-id` | no | Stable agent identity. |
| `x-llmkit-session-id` | no | Tag requests with a session/conversation ID for grouped analytics. |
| `x-llmkit-user-id` | no | Tag requests with an end-user ID for per-user cost attribution. |
| `x-llmkit-format` | no | Set to `llmkit` to get LLMKit's native response format instead of OpenAI-compatible format. |
| `Idempotency-Key` | no | Deduplicate a non-streaming Chat Completions or Responses request. Use 8-128 ASCII letters, digits, dots, underscores, colons, or hyphens. |

Provider values are allowlisted. An unsupported provider is rejected before a direct or stored
provider credential can be sent to an outbound provider URL.

## Common response headers

Returned on successful `/v1/chat/completions` and `/v1/responses` calls.

| Header | Description |
|--------|-------------|
| `x-llmkit-request-id` | Durable request receipt UUID. An idempotent replay returns the original UUID. |
| `x-llmkit-cost` | Total cost in USD (e.g. `0.0042`) |
| `x-llmkit-provider` | Provider that served the request |
| `x-llmkit-latency-ms` | End-to-end latency in milliseconds |
| `x-llmkit-provider-cost` | Provider-reported cost when available (xAI, some OpenAI models) |
| `x-llmkit-extra-costs` | JSON array of non-token costs (web search, code execution) when present |
| `x-llmkit-session-id` | Echoed back if sent |
| `x-llmkit-user-id` | Echoed back if sent |
| `Idempotency-Key` | Echoed when idempotency is used |
| `x-llmkit-idempotency-status` | `created`, `replayed`, `in-progress`, `conflict`, `indeterminate`, or `rejected` |
| `x-llmkit-settlement-status` | `pending` when a hard-budget response returns while settlement continues in the Worker execution context. The dispatched reservation remains charged against available budget until actual cost settles or the reserved ceiling is conservatively committed. |

### Request idempotency

Send the same `Idempotency-Key` with a byte-equivalent non-streaming request to prevent duplicate
provider dispatch and budget settlement during client retries. The key is scoped to the authenticated
LLMKit API key. LLMKit stores the completed status, selected headers, and response body for 24 hours
and replays those bytes without calling the provider again.

- A retry while the first request owns its 22-minute execution lease returns `409
  IDEMPOTENCY_IN_PROGRESS` with `Retry-After`.
- Reusing the key with a different body, provider, fallback chain, attribution, response format, or
  revenue context returns `409 IDEMPOTENCY_CONFLICT`.
- A request whose provider outcome cannot be proved becomes terminal for 24 hours and returns `409
  IDEMPOTENCY_INDETERMINATE` on retry. Verify the provider outcome before choosing a new key.
- `stream: true` with an idempotency key returns `400 IDEMPOTENCY_STREAM_UNSUPPORTED` before budget
  reservation or provider dispatch. Streaming replay is not claimed.
- Replayable response bodies are capped at 16 MiB. Responses above that boundary fail closed rather
  than publishing a partial replay record.
- A replay does not repeat the original transient `x-llmkit-settlement-status: pending` header.

The request fingerprint includes the route, JSON body, provider selection, fallback chain, customer,
workflow, agent, session, end-user attribution, response format, and revenue headers. Direct provider
credentials contribute only through the fingerprint digest and are not stored in the idempotency
record.

For hard-budget requests, LLMKit creates the reservation atomically at provider dispatch. Once
dispatch begins, an unknown provider or settlement outcome commits the reserved ceiling so the
ledger cannot silently undercount possible spend. Successful non-streaming responses return with
`x-llmkit-settlement-status: pending`; settlement continues through `waitUntil`, while the live
reservation and its Durable Object alarm keep the budget fail-closed across delay or Worker crash.
The 22-minute reservation and idempotency leases cover five sequential four-minute provider
timeouts plus a two-minute coordination margin.

### Durable request receipt

A linked hard budget creates one receipt in the same Durable Object transaction as the reservation.
The initial state is `pending`, with the reserved ceiling and full customer, workflow, agent, session,
end-user, budget, and reservation attribution. Settlement updates that same receipt to one terminal
state: `settled_actual`, `committed_ceiling`, `released`, or `unknown`.

The Budget Durable Object is the single writer for budgeted receipts. It keeps a retrying outbox when
the database is unavailable, so a database write failure does not replace or erase the committed
ledger state. Non-budgeted requests use `not_applicable`. Rows written by an older Worker retain
`legacy_recorded` during rollout.

For linked hard-budget non-streaming responses, `response_sha256` hashes the exact response body.
When idempotency is used, `idempotency_key_hash` is the SHA-256 digest of the authenticated API key
identity and raw idempotency key. The raw key is not stored. Streaming responses have no response
hash because byte replay is not claimed.

A linked hard budget deliberately supports a narrower request contract: an explicit output-token
maximum, an exact model entry in the bundled pricing snapshot, text input, and optional client-side
function schemas. Images, documents, audio/video, provider-managed tools, prior-response references,
alternate output maxima, multiple-completion fields, service tiers, and other provider-specific
fields are rejected before dispatch. This is the boundary LLMKit can price and reserve without
pretending that an unbounded provider feature has a dollar ceiling.

---

## POST /v1/chat/completions

Main proxy endpoint. Accepts OpenAI-compatible request bodies and routes through the supported
provider adapters. Supports text, multimodal (images), tool calling, and streaming.

**Auth:** required

### Request body

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello" }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false,
  "tools": [],
  "tool_choice": "auto",
  "response_format": { "type": "json_object" }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `model` | string | yes | Model ID. Provider is inferred from the model name unless `x-llmkit-provider` is set. |
| `messages` | array | yes | OpenAI message format. Roles: `system`, `developer`, `user`, `assistant`, `tool`. |
| `temperature` | number | no | 0-2. |
| `max_tokens` | integer | required with a linked hard budget | A linked hard budget reserves the request's maximum cost ceiling before dispatch and rejects the request if that ceiling does not fit. `maxTokens` is accepted as an alias. |
| `stream` | boolean | no | Enable SSE streaming. |
| `tools` | array | no | OpenAI function-calling tool definitions. Passed through to the provider. |
| `tool_choice` | string/object | no | `auto`, `none`, `required`, or `{ "type": "function", "function": { "name": "..." } }`. |
| `response_format` | object | no | `{ "type": "json_object" }` for JSON mode. |

Messages support multimodal content blocks:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this image?" },
    { "type": "image_url", "image_url": { "url": "https://example.com/photo.jpg" } }
  ]
}
```

Without a linked hard budget, extra provider-specific fields (e.g. `top_p`, `top_k`,
`presence_penalty`) are passed through to the provider. A linked hard budget rejects fields outside
the documented bounded contract. Sensitive fields (`apiKey`, `api_key`, `secret`, `token`) are
always blocked.

### Response (OpenAI format, default)

```json
{
  "id": "msg_abc123",
  "object": "chat.completion",
  "created": 1711900000,
  "model": "claude-sonnet-4-20250514",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help?",
        "tool_calls": []
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 8,
    "total_tokens": 20
  }
}
```

Cost data is in the response headers (see above).

### Response (LLMKit format)

Set `x-llmkit-format: llmkit` to get a flat response with cost inline:

```json
{
  "id": "msg_abc123",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "content": "Hello! How can I help?",
  "finishReason": "end_turn",
  "usage": {
    "inputTokens": 12,
    "outputTokens": 8,
    "totalTokens": 20
  },
  "cost": {
    "inputCost": 0.000036,
    "outputCost": 0.00012,
    "totalCost": 0.000156,
    "currency": "USD"
  },
  "latencyMs": 842,
  "cached": false,
  "sessionId": "session-123",
  "endUserId": "user-456",
  "toolCalls": []
}
```

### Streaming

Set `"stream": true`. The proxy returns SSE events.

**OpenAI format** (default): standard `chat.completion.chunk` events, ending with `data: [DONE]`.
A final chunk includes `usage` with token counts.

**LLMKit format** (`x-llmkit-format: llmkit`): emits `event: delta` with `{ "text": "..." }`,
then `event: done` with full usage and cost breakdown.

### curl example

```bash
curl -X POST https://api.llmkit.sh/v1/chat/completions \
  -H "Authorization: Bearer llmk_your_key" \
  -H "Content-Type: application/json" \
  -H "x-llmkit-provider-key: sk-your-openai-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 100
  }'
```

With fallback chain:

```bash
curl -X POST https://api.llmkit.sh/v1/chat/completions \
  -H "Authorization: Bearer llmk_your_key" \
  -H "Content-Type: application/json" \
  -H "x-llmkit-fallback: anthropic,openai,gemini" \
  -H "x-llmkit-session-id: agent-run-42" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Summarize this"}],
    "stream": true
  }'
```

Store one key for each provider in the dashboard before using a multi-provider chain. A direct
`x-llmkit-provider-key` applies only to the first provider. LLMKit never forwards that credential
to a fallback provider.

---

## POST /v1/responses

Passthrough to OpenAI's Responses API. The proxy forwards the body as-is, then extracts
usage and tool invocations from the response for cost tracking.

Non-token costs (web search, code execution, file search) are tracked automatically when
providers report tool invocations in the response.

**Auth:** required

### Request body

Without a linked hard budget, send whatever the Responses API accepts; the only required field is
`model`. A linked hard budget also requires `max_output_tokens` and the bounded request contract
described below.

```json
{
  "model": "gpt-4o",
  "input": "What is the weather in SF?",
  "tools": [{ "type": "web_search" }]
}
```

Tracked tool dimensions: `web_search`, `x_search`, `code_execution`, `code_interpreter`,
`attachment_search`, `collections_search`, `file_search`.

### Hard-budget tool boundary

When the LLMKit API key has a linked hard budget, only text input and client-side `function` tools
are accepted. Images, documents, audio/video, provider-managed tools, file attachments,
`previous_response_id`, service tiers, multiple completions, and alternate output-limit fields are
rejected before provider dispatch because current provider APIs do not expose an enforceable price
or token ceiling for those shapes. Requests without a linked budget may use provider-managed tools
and still receive post-response cost tracking.

When a provider returns an exact charged cost, LLMKit uses it for settlement and exposes it in
`x-llmkit-provider-cost`. The token and tool breakdown remains an estimate unless the provider
reports each component.

### Response (default)

The raw provider response, plus cost headers. Identical to what you'd get calling the
provider directly, with `x-llmkit-cost`, `x-llmkit-provider`, and `x-llmkit-latency-ms` headers added.

When tool invocations are detected, `x-llmkit-extra-costs` is included:

```
x-llmkit-extra-costs: [{"dimension":"web_search","cost":0.03,"quantity":1}]
```

### Response (LLMKit format)

Set `x-llmkit-format: llmkit`. Returns the provider response merged with LLMKit fields:

```json
{
  "id": "resp_abc123",
  "output": [],
  "usage": { "input_tokens": 50, "output_tokens": 120, "total_tokens": 170 },
  "provider": "openai",
  "cost": {
    "inputCost": 0.000125,
    "outputCost": 0.0006,
    "extraCosts": [{ "dimension": "web_search", "cost": 0.03, "quantity": 1 }],
    "totalCost": 0.030725,
    "currency": "USD"
  },
  "latencyMs": 1240,
  "extraUsage": [{ "dimension": "web_search", "quantity": 1 }]
}
```

### curl example

```bash
curl -X POST https://api.llmkit.sh/v1/responses \
  -H "Authorization: Bearer llmk_your_key" \
  -H "Content-Type: application/json" \
  -H "x-llmkit-provider-key: sk-your-openai-key" \
  -d '{
    "model": "gpt-4o",
    "input": "Search the web for LLMKit",
    "tools": [{"type": "web_search"}]
  }'
```

---

## GET /v1/pricing/compare

Public endpoint. No auth required. Estimate costs for up to 20 exact model keys from the bundled
pricing snapshot dated 2026-03-25. This is a reference snapshot, not a live provider quote or a
cheapest-model recommendation. The snapshot does not encode model modality, so callers must select
models they have independently verified are billed per input and output token.

### Query parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | string | yes | Must be `text-token` |
| `models` | string | yes | Comma-separated exact `provider/model` keys, maximum 20 |
| `input` | non-negative integer | yes | Input tokens to price |
| `output` | non-negative integer | yes | Output tokens to price |
| `cacheRead` | non-negative integer | yes | Cache read tokens |
| `cacheWrite` | non-negative integer | yes | Cache write tokens |

Every parameter must appear exactly once. Empty, negative, fractional, non-finite, unsafe integer,
duplicate, unknown model, and unknown query values are rejected with `400 INVALID_PRICING_QUERY` or
`400 UNKNOWN_PRICING_MODEL`. At least one token count must be greater than zero.

### Response

```json
{
  "schemaVersion": 2,
  "snapshot": {
    "date": "2026-03-25",
    "liveQuote": false,
    "sourceModalityEncoded": false,
    "rateUnit": "USD_PER_MILLION_TOKENS"
  },
  "selection": {
    "mode": "text-token",
    "basis": "explicit-model-keys",
    "recommendation": false
  },
  "usage": {
    "input": 1000,
    "output": 1000,
    "cacheRead": 0,
    "cacheWrite": 0
  },
  "count": 1,
  "models": [
    {
      "key": "openai/gpt-4o",
      "provider": "openai",
      "model": "gpt-4o",
      "rates": {
        "inputPerMillion": 2.5,
        "outputPerMillion": 10,
        "cacheReadPerMillion": 1.25,
        "cacheWritePerMillion": null
      },
      "costs": {
        "input": 0.0025,
        "output": 0.01,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.0125,
        "currency": "USD"
      }
    }
  ],
  "exclusions": [
    "Model modality is not encoded in the source snapshot; callers must verify that every selected model is token-billed."
  ]
}
```

Selected models are sorted by total estimate, then provider and model for deterministic ties. This
ordering compares only the caller's explicit selection and is not a global recommendation. Responses
are cached for 1 hour. Rate-limit failures remain `429 RATE_LIMITED` and are separate from pricing
input validation.

### curl example

```bash
# Compare two exact model entries you have verified are token-billed
curl "https://api.llmkit.sh/v1/pricing/compare?mode=text-token&models=anthropic%2Fclaude-sonnet-4-6%2Copenai%2Fgpt-4o&input=10000&output=2000&cacheRead=0&cacheWrite=0"
```

---

## POST /v1/provider-keys

Store a provider API key in the encrypted vault. Keys are encrypted with AES-256-GCM and
tied to your user ID.

**Auth:** required

### Request body

```json
{
  "provider": "openai",
  "key": "sk-proj-abc123...",
  "name": "production"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `provider` | string | yes | One of: `anthropic`, `openai`, `gemini`, `groq`, `together`, `fireworks`, `deepseek`, `mistral`, `xai`, `ollama`, `openrouter` |
| `key` | string | yes | The provider API key. Minimum 8 characters. |
| `name` | string | no | Label for the key. Defaults to `"default"`. |

### Response (201)

```json
{
  "id": "uuid-here",
  "provider": "openai",
  "key_prefix": "sk-proj...-c123",
  "key_name": "production"
}
```

### curl example

```bash
curl -X POST https://api.llmkit.sh/v1/provider-keys \
  -H "Authorization: Bearer llmk_your_key" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "key": "sk-proj-abc123...", "name": "production"}'
```

---

## GET /v1/provider-keys

List stored provider keys for the authenticated user. Only key prefixes are returned, never
the full key.

**Auth:** required

### Response

```json
{
  "keys": [
    {
      "id": "uuid-here",
      "provider": "openai",
      "key_prefix": "sk-proj...-c123",
      "key_name": "production",
      "created_at": "2026-03-15T10:00:00Z"
    }
  ]
}
```

---

## DELETE /v1/provider-keys/:id

Revoke a stored provider key.

**Auth:** required

### Response

```json
{ "revoked": true }
```

### curl example

```bash
curl -X DELETE https://api.llmkit.sh/v1/provider-keys/uuid-here \
  -H "Authorization: Bearer llmk_your_key"
```

---

## GET /v1/analytics/receipts/:id

Returns one tenant-scoped request receipt. The authenticated tenant must own the row. A UUID owned by
another tenant returns the same `404` shape as a missing UUID.

**Auth:** required

```json
{
  "receipt": {
    "id": "0190f28a-2fb1-7df3-a8d8-bca0f9055af2",
    "customer_id": "customer-42",
    "workflow_id": "invoice-extraction",
    "agent_id": "agent-7",
    "session_id": "run-2026-08-04",
    "budget_id": "b2e3f18a-7c29-44f7-ae68-d25b1aec98d0",
    "budget_reservation_id": "08270ce7-a12a-4bcd-ab69-5e32dbbd9865",
    "reserved_cost_cents": 10,
    "cost_cents": 7,
    "settlement_status": "settled_actual",
    "idempotency_key_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "response_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "status": "success"
  }
}
```

`cost_cents: null` means committed cost is not yet known. Clients must not interpret it as zero.

---

## GET /v1/analytics/usage

Aggregated usage stats for the authenticated user.

**Auth:** required

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `month` | One of: `today`, `week`, `month` |

### Response

```json
{
  "period": "month",
  "requests": 1842,
  "pricedRequests": 1839,
  "unknownCostRequests": 3,
  "costComplete": false,
  "totalCostCents": 4215,
  "totalInputTokens": 2450000,
  "totalOutputTokens": 890000,
  "totalCacheReadTokens": 120000,
  "cacheHitRate": 4.7,
  "topModels": [
    { "model": "claude-sonnet-4-20250514", "requests": 1200 },
    { "model": "gpt-4o", "requests": 642 }
  ]
}
```

`totalCostCents` is the sum of priced requests. `costComplete` is true only when
`unknownCostRequests` is zero; otherwise the total is a known-cost lower bound.

---

## GET /v1/analytics/costs

Cost breakdown grouped by a dimension.

**Auth:** required

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `groupBy` | string | `provider` | One of: `provider`, `model`, `session`, `day` |
| `days` | number | 30 | Lookback window in days (max 365) |
| `provider` | string | - | Filter to a specific provider |
| `model` | string | - | Filter to a specific model |

### Response

```json
{
  "groupBy": "model",
  "days": 30,
  "pricedRequests": 1198,
  "unknownCostRequests": 2,
  "costComplete": false,
  "breakdown": [
    {
      "key": "claude-sonnet-4-20250514",
      "count": 1200,
      "pricedRequests": 1198,
      "unknownCostRequests": 2,
      "costCents": 3100,
      "inputTokens": 1800000,
      "outputTokens": 650000,
      "toolCalls": 42
    }
  ]
}
```

Every group retains its total request count plus priced and unknown-cost counts. `costCents` never
converts unknown committed cost to zero.

---

## GET /v1/analytics/keys

List API keys with metadata for the authenticated user.

**Auth:** required

### Response

```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "agent-key",
      "key_prefix": "llmk_ab...",
      "budget_id": "uuid-or-null",
      "created_at": "2026-03-10T08:00:00Z",
      "revoked_at": null
    }
  ]
}
```

---

## GET /v1/analytics/budgets

List budgets for the authenticated user.

**Auth:** required

### Response

```json
{
  "budgets": [
    {
      "id": "uuid",
      "name": "daily-cap",
      "limit_cents": 500,
      "period": "daily",
      "created_at": "2026-03-10T08:00:00Z"
    }
  ]
}
```

---

## GET /v1/analytics/sessions

Session summaries aggregated from request data.

**Auth:** required

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `sessionId` | string | - | Filter to a single session |
| `limit` | number | 10 | Max sessions to return |

### Response

```json
{
  "pricedRequests": 14,
  "unknownCostRequests": 1,
  "costComplete": false,
  "sessions": [
    {
      "sessionId": "agent-run-42",
      "requests": 15,
      "pricedRequests": 14,
      "unknownCostRequests": 1,
      "costComplete": false,
      "costCents": 312,
      "providers": ["anthropic", "openai"],
      "models": ["claude-sonnet-4-20250514", "gpt-4o"],
      "first": "2026-03-28T14:00:00Z",
      "last": "2026-03-28T14:12:00Z"
    }
  ]
}
```

Session `costCents` is the priced-request sum. Use `unknownCostRequests` and `costComplete` before
treating it as a complete session cost.

---

## GET /health

Health check. No auth.

### Response

```json
{ "status": "ok", "version": "0.0.1" }
```

---

## Errors

All errors follow this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "model is required and must be a string"
  }
}
```

| Code | HTTP | When |
|------|------|------|
| `AUTH_ERROR` | 401 | Missing or invalid API key |
| `INVALID_REQUEST` | 400 | Bad request body or parameters |
| `BUDGET_EXCEEDED` | 402 | Budget limit hit |
| `RATE_LIMIT` | 429 | RPM limit exceeded |
| `ALL_PROVIDERS_FAILED` | 503 | Every provider in the fallback chain failed |
| `PROVIDER_ERROR` | 502 | Single provider returned an error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Rate limiting

Per-key RPM limit (default 60). Headers on every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Requests allowed per minute |
| `X-RateLimit-Remaining` | Requests left in current window |
| `Retry-After` | Seconds until the window resets (on 429) |

## CORS

All origins allowed. The proxy exposes cost and rate-limit headers for browser access.
