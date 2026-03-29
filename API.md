# LLMKit API Reference

Base URL: `https://llmkit-proxy.smigolsmigol.workers.dev`

All authenticated endpoints require a Bearer token in the `Authorization` header.
Create API keys at [llmkit-dashboard.vercel.app](https://llmkit-dashboard.vercel.app).

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
| `x-llmkit-provider-key` | no | Pass a provider API key directly instead of using one stored in the dashboard. |
| `x-llmkit-fallback` | no | Comma-separated fallback chain, e.g. `anthropic,openai,gemini`. Tried in order. |
| `x-llmkit-session-id` | no | Tag requests with a session/conversation ID for grouped analytics. |
| `x-llmkit-user-id` | no | Tag requests with an end-user ID for per-user cost attribution. |
| `x-llmkit-format` | no | Set to `llmkit` to get LLMKit's native response format instead of OpenAI-compatible format. |

## Common response headers

Returned on successful `/v1/chat/completions` and `/v1/responses` calls.

| Header | Description |
|--------|-------------|
| `x-llmkit-cost` | Total cost in USD (e.g. `0.0042`) |
| `x-llmkit-provider` | Provider that served the request |
| `x-llmkit-latency-ms` | End-to-end latency in milliseconds |
| `x-llmkit-provider-cost` | Provider-reported cost when available (xAI, some OpenAI models) |
| `x-llmkit-extra-costs` | JSON array of non-token costs (web search, code execution) when present |
| `x-llmkit-session-id` | Echoed back if sent |
| `x-llmkit-user-id` | Echoed back if sent |

---

## POST /v1/chat/completions

Main proxy endpoint. Accepts OpenAI-compatible request bodies and routes to 11 providers.
Supports text, multimodal (images), tool calling, and streaming.

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
| `max_tokens` | integer | no | Budget-enforced: if the key has a max-token limit, the lower value wins. |
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

Extra provider-specific fields (e.g. `top_p`, `top_k`, `presence_penalty`) are passed through
to the provider. Sensitive fields (`apiKey`, `api_key`, `secret`, `token`) are blocked.

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
curl -X POST https://llmkit-proxy.smigolsmigol.workers.dev/v1/chat/completions \
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
curl -X POST https://llmkit-proxy.smigolsmigol.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer llmk_your_key" \
  -H "Content-Type: application/json" \
  -H "x-llmkit-fallback: anthropic,openai,gemini" \
  -H "x-llmkit-provider-key: sk-your-key" \
  -H "x-llmkit-session-id: agent-run-42" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Summarize this"}],
    "stream": true
  }'
```

---

## POST /v1/responses

Passthrough to OpenAI's Responses API. The proxy forwards the body as-is, then extracts
usage and tool invocations from the response for cost tracking.

Non-token costs (web search, code execution, file search) are tracked automatically when
providers report tool invocations in the response.

**Auth:** required

### Request body

Send whatever the Responses API accepts. The only required field is `model`.

```json
{
  "model": "gpt-4o",
  "input": "What is the weather in SF?",
  "tools": [{ "type": "web_search" }]
}
```

Tracked tool dimensions: `web_search`, `x_search`, `code_execution`, `code_interpreter`,
`attachment_search`, `collections_search`, `file_search`.

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
curl -X POST https://llmkit-proxy.smigolsmigol.workers.dev/v1/responses \
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

Public endpoint. No auth required. Compare costs across all 730+ models in the pricing table.

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `input` | number | 0 | Input tokens to price |
| `output` | number | 0 | Output tokens to price |
| `cacheRead` | number | 0 | Cache read tokens |
| `cacheWrite` | number | 0 | Cache write tokens |
| `provider` | string | all | Filter to one provider |

### Response

```json
{
  "input": 1000,
  "output": 1000,
  "cacheRead": 0,
  "cacheWrite": 0,
  "provider": "all",
  "count": 731,
  "models": [
    {
      "provider": "gemini",
      "model": "gemini-2.0-flash-lite",
      "inputCost": 0.000075,
      "outputCost": 0.0003,
      "totalCost": 0.000375
    },
    {
      "provider": "deepseek",
      "model": "deepseek-chat",
      "inputCost": 0.00014,
      "outputCost": 0.00028,
      "totalCost": 0.00042
    }
  ]
}
```

Models are sorted by `totalCost` ascending (cheapest first). Response is cached for 1 hour.

### curl example

```bash
# Compare cost of 10k input + 2k output tokens across all providers
curl "https://llmkit-proxy.smigolsmigol.workers.dev/v1/pricing/compare?input=10000&output=2000"

# Filter to Anthropic only
curl "https://llmkit-proxy.smigolsmigol.workers.dev/v1/pricing/compare?input=10000&output=2000&provider=anthropic"
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
curl -X POST https://llmkit-proxy.smigolsmigol.workers.dev/v1/provider-keys \
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
curl -X DELETE https://llmkit-proxy.smigolsmigol.workers.dev/v1/provider-keys/uuid-here \
  -H "Authorization: Bearer llmk_your_key"
```

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
  "breakdown": [
    {
      "key": "claude-sonnet-4-20250514",
      "count": 1200,
      "costCents": 3100,
      "inputTokens": 1800000,
      "outputTokens": 650000,
      "toolCalls": 42
    }
  ]
}
```

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
  "sessions": [
    {
      "sessionId": "agent-run-42",
      "requests": 15,
      "costCents": 312,
      "providers": ["anthropic", "openai"],
      "models": ["claude-sonnet-4-20250514", "gpt-4o"],
      "first": "2026-03-28T14:00:00Z",
      "last": "2026-03-28T14:12:00Z"
    }
  ]
}
```

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
| `VALIDATION_ERROR` | 400 | Bad request body or parameters |
| `BUDGET_EXCEEDED` | 429 | Budget limit hit |
| `RATE_LIMIT` | 429 | RPM limit exceeded |
| `ALL_PROVIDERS_FAILED` | 502 | Every provider in the fallback chain failed |
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
