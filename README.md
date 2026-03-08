<p align="center">
  <img src=".github/logo.png" width="120" alt="LLMKit" />
</p>

<h1 align="center">LLMKit</h1>

<p align="center">
  Know exactly what your AI agents cost.
</p>

[![CI](https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml/badge.svg)](https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

---

Open-source API gateway that sits between your app and AI providers. Every request gets logged with token counts and dollar costs. Budget limits actually reject requests when exceeded, unlike the "soft limits" other tools ship.

Works with any language. Wrap your existing command with the CLI, or use the TypeScript SDK for full control.

## Get started

1. **Create an account** at [dashboard-two-zeta-54.vercel.app](https://dashboard-two-zeta-54.vercel.app) (free while in beta)
2. **Create an API key** in the Keys tab
3. **Use it**: pick any method below

## Quick start

The CLI intercepts OpenAI and Anthropic API calls, forwards them transparently, and prints a cost summary when your process exits. No code changes.

```bash
npx @f3d1/llmkit-cli -- python my_agent.py
```

```
LLMKit Cost Summary
---
Total: $0.0215 (3 requests, 4.2s)

By model:
  claude-sonnet-4-20250514  1 req   $0.0156
  gpt-4o                    2 reqs  $0.0059
```

Works with Python, Ruby, Go, Rust, anything that calls the OpenAI or Anthropic API. The CLI sets `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` on the child process and runs a local transparent proxy. Your code doesn't know it's there.

```bash
# see per-request costs as they happen
npx @f3d1/llmkit-cli -v -- python multi_agent.py
#  [llmkit] openai/gpt-4o $0.0031 (420ms)
#  [llmkit] anthropic/claude-sonnet-4-20250514 $0.0156 (1200ms)

# machine-readable output
npx @f3d1/llmkit-cli --json -- node my_agent.js
```

## Python

Point your existing OpenAI client at the LLMKit proxy. The proxy returns OpenAI-compatible responses, so your code works unchanged.

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llmkit-proxy.smigolsmigol.workers.dev/v1",
    api_key="llmk_...",  # from dashboard -> Keys tab
    default_headers={"x-llmkit-provider-key": "sk-your-openai-key"},
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)

print(response.choices[0].message.content)
```

Cost data comes back in response headers:

```python
# access via httpx response headers
print(response.headers.get("x-llmkit-cost"))      # "0.0031"
print(response.headers.get("x-llmkit-provider"))   # "openai"
```

Or skip code changes entirely with env vars:

```bash
export OPENAI_BASE_URL=https://llmkit-proxy.smigolsmigol.workers.dev/v1
export OPENAI_API_KEY=llmk_...  # your LLMKit key
python my_agent.py
```

## TypeScript SDK

```typescript
import { LLMKit } from '@f3d1/llmkit-sdk'

const kit = new LLMKit({ apiKey: process.env.LLMKIT_KEY })

const agent = kit.session()

const res = await agent.chat({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'summarize this document' }],
})

console.log(res.content)
console.log(res.cost)   // { inputCost: 0.003, outputCost: 0.015, totalCost: 0.018, currency: 'USD' }
console.log(res.usage)  // { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 }
```

Streaming:

```typescript
const stream = await agent.chatStream({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'explain quantum computing' }],
})

for await (const chunk of stream) {
  process.stdout.write(chunk)
}

// usage and cost available after stream ends
console.log(stream.cost)
```

### CostTracker (no proxy needed)

Track costs locally without running the proxy. Pass any OpenAI or Anthropic SDK response and get costs calculated from the built-in pricing table.

```typescript
import { CostTracker } from '@f3d1/llmkit-sdk'
import Anthropic from '@anthropic-ai/sdk'

const tracker = new CostTracker({ log: true })
const anthropic = new Anthropic()

const msg = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hello' }],
})

tracker.trackResponse('anthropic', msg)
// [llmkit] anthropic/claude-sonnet-4-20250514: $0.0234 (800 in, 120 out)

console.log(tracker.totalDollars)  // "0.0234"
console.log(tracker.byModel())     // breakdown by model
console.log(tracker.bySession())   // breakdown by session
```

## Vercel AI SDK

```typescript
import { generateText } from 'ai'
import { createLLMKit } from '@f3d1/llmkit-ai-sdk-provider'

const llmkit = createLLMKit({
  apiKey: process.env.LLMKIT_KEY,
  provider: 'anthropic',
})

const { text } = await generateText({
  model: llmkit.chat('claude-sonnet-4-20250514'),
  prompt: 'hello',
})
```

## Why LLMKit

**Budget enforcement that works.** Cost estimation runs before every request. If it would blow the budget, it gets rejected before hitting the provider. Per-key or per-session scope. Not the advisory "soft limits" that agents blow past.

**Per-agent cost tracking.** Tag requests with a session ID to track costs per agent, per conversation, per user. The dashboard and MCP server surface this data.

**11 providers, one interface.** Anthropic, OpenAI, Google Gemini, Groq, Together, Fireworks, DeepSeek, Mistral, xAI, Ollama, OpenRouter. Fallback chains via header (`x-llmkit-fallback: anthropic,openai,gemini`).

**Edge-deployed proxy.** Runs on Cloudflare Workers. Requests route through the nearest datacenter.

**Cache-aware pricing.** Prompt caching savings from Anthropic, DeepSeek, and Fireworks are tracked correctly. 40+ models priced.

**Open source.** Proxy, SDK, CLI, and MCP server are all MIT. Self-host or use the managed service.

## How it works

```
Your app (TypeScript, Python, Go, anything)
    |
    v
LLMKit Proxy (Cloudflare Workers)
  auth -> budget check -> provider routing -> cost logging -> budget alert
    |
    v
AI Provider (Anthropic, OpenAI, Gemini, ...)
    |
    v
Supabase (Postgres) -> Dashboard + MCP Server
```

The middleware chain runs on every request: authenticate the API key, check the budget, route to the provider (with fallback), log the response with token counts and costs, update the budget, and fire alert webhooks at 80% threshold.

## Packages

| Package | Description |
|---------|-------------|
| [@f3d1/llmkit-cli](packages/cli) | `npx @f3d1/llmkit-cli -- <cmd>` - zero-code cost tracking for any language |
| [@f3d1/llmkit-sdk](packages/sdk) | TypeScript client + CostTracker + streaming |
| [@f3d1/llmkit-proxy](packages/proxy) | Hono-based CF Workers proxy - auth, budgets, routing, logging |
| [@f3d1/llmkit-ai-sdk-provider](packages/ai-sdk-provider) | Vercel AI SDK v6 custom provider |
| [@f3d1/llmkit-mcp-server](packages/mcp-server) | 6 tools for Claude Code / Cursor |
| [@f3d1/llmkit-shared](packages/shared) | Types, pricing table (11 providers, 40+ models), cost calculation |

## MCP Server

<a href="https://glama.ai/mcp/servers/@smigolsmigol/llmkit-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@smigolsmigol/llmkit-mcp-server/badge" alt="llmkit-mcp-server MCP server" />
</a>

Query your AI costs from Claude Code or Cursor.

```json
{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["@f3d1/llmkit-mcp-server"]
    }
  }
}
```

Tools: `llmkit_usage_stats`, `llmkit_cost_query`, `llmkit_budget_status`, `llmkit_session_summary`, `llmkit_list_keys`, `llmkit_health`.

## Testing

114 tests across the monorepo, run on every push via GitHub Actions.

| Suite | What it covers |
|-------|----------------|
| Unit (29) | Provider adapters, cost calculation, fallback routing, error handling |
| Crypto (10) | AES-GCM encrypt/decrypt roundtrips, tampered ciphertext, AAD context |
| Budget (18) | Cost estimation, period resets, max_tokens clamping, affordable output calculation |
| Reservation (10) | Concurrent budget checks, reservation settle/release, session scope, lazy init |
| Budget bypass (16) | Adversarial vectors: session hopping, period manipulation, replay attacks, stale reservations |
| CLI parser (15) | OpenAI/Anthropic response and stream parsing, edge cases |
| SDK tracker (16) | CostTracker aggregation, listeners, multi-session, provider/model grouping |

Budget enforcement is additionally tested with live concurrency against the deployed proxy, not just mocks.

See [SECURITY.md](SECURITY.md) for the security audit methodology.

## Self-host

```bash
git clone https://github.com/smigolsmigol/llmkit
cd llmkit && pnpm install && pnpm build

cd packages/proxy
echo 'DEV_MODE=true' > .dev.vars
pnpm dev
# proxy running at http://localhost:8787
```

Deploy to Cloudflare Workers:

```bash
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy
```

## License

MIT