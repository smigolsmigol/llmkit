# Quickstart

Get AI cost tracking running in under 5 minutes.

**Prerequisites:** Create a free account at [llmkit.sh](https://llmkit.sh)
and grab an API key from the Keys tab. Add your provider key (OpenAI, Anthropic, etc.) in the Providers tab.

---

## Option 1: CLI proxy (any language, zero code changes)

Wraps any command. Intercepts API calls, tracks costs, prints a summary when the process exits.

```bash
npx @f3d1/llmkit-cli -- python my_agent.py
```

That's it. Your existing code talks to OpenAI/Anthropic as usual - the CLI rewrites `base_url` to
route through the proxy. Use `-v` for per-request costs as they happen.

The CLI runs a local proxy - no LLMKit account needed. Just make sure your provider key is set (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

Works with Python, Node, Go, Rust, Ruby - anything that hits the OpenAI or Anthropic API.

---

## Option 2: TypeScript SDK

```bash
npm install @f3d1/llmkit-sdk
```

```typescript
import { LLMKit } from '@f3d1/llmkit-sdk'

const kit = new LLMKit({ apiKey: process.env.LLMKIT_KEY })
const agent = kit.session()

const res = await agent.chat({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'hello' }],
})

console.log(res.content)
console.log(res.cost)
// { inputCost: 0.003, outputCost: 0.015, totalCost: 0.018, currency: 'USD' }
```

Streaming:

```typescript
const stream = await llm.chatStream({
  model: 'gpt-4.1-mini',
  messages: [{ role: 'user', content: 'hello' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}
console.log('\ncost:', stream.cost);
```

### Vercel AI SDK

```bash
npm install @f3d1/llmkit-ai-sdk-provider
```

```typescript
import { createLLMKit } from '@f3d1/llmkit-ai-sdk-provider'
import { generateText } from 'ai'

const llmkit = createLLMKit({ apiKey: process.env.LLMKIT_KEY })

const { text } = await generateText({
  model: llmkit('claude-sonnet-4-20250514'),
  prompt: 'hello',
})
```

---

## Option 3: Python SDK

```bash
pip install llmkit-sdk
```

**With the proxy** (budget enforcement, logging, dashboard):

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llmkit-proxy.smigolsmigol.workers.dev/v1",
    api_key="llmk_your_key_here",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
```

**Without the proxy** (local cost estimation, no account needed):

```python
from llmkit import tracked
from openai import OpenAI

client = OpenAI(http_client=tracked())

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
# costs estimated locally from bundled pricing table
```

`tracked()` wraps your HTTP client and estimates costs from token usage. Works with any SDK
that accepts `http_client` (OpenAI, Anthropic, Mistral, etc.).

---

## Direct API (curl)

No SDK needed. Point any HTTP client at the proxy.

```bash
curl -X POST https://llmkit-proxy.smigolsmigol.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer llmk_your_key_here" \
  -H "Content-Type: application/json" \
  -H "x-llmkit-provider-key: sk-your-openai-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

Cost comes back in the `x-llmkit-cost` response header.

---

## What's next

- Open [llmkit.sh](https://llmkit.sh) to see your costs, requests, and sessions
- Set a budget in the dashboard to cap spend per key or per session
- Add `x-llmkit-session-id` headers to group requests by agent run
- Add `x-llmkit-user-id` headers to track costs per end-user
- Set up the [MCP server](packages/mcp-server) to query costs from Claude Code, Cline, or Cursor
- See [API.md](API.md) for full endpoint docs
