<p align="center">
  <img src="https://raw.githubusercontent.com/smigolsmigol/llmkit/main/.github/logo-wordmark-animated.svg" width="240" alt="LLMKit" />
</p>

<h3 align="center">Track what your AI agents cost. One line of code.</h3>

<p align="center">
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/v/llmkit-sdk?color=blue" alt="PyPI" /></a>
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/dm/llmkit-sdk" alt="Downloads" /></a>
  <a href="https://github.com/smigolsmigol/llmkit"><img src="https://img.shields.io/github/stars/smigolsmigol/llmkit?style=flat" alt="Stars" /></a>
  <a href="https://github.com/smigolsmigol/llmkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/smigolsmigol/llmkit"><img src="https://api.scorecard.dev/projects/github.com/smigolsmigol/llmkit/badge" alt="Scorecard" /></a>
</p>

---

Cost tracking for LLM APIs. Works with OpenAI, Anthropic, Gemini, Groq, Mistral, Together, and any OpenAI-compatible SDK. 730+ models priced. Zero config, zero account needed for local tracking.

```bash
pip install llmkit-sdk
```

## Zero-config cost tracking

Wrap any OpenAI-compatible client. Costs are estimated locally from a bundled pricing table - no proxy, no account, no network calls:

```python
from llmkit import tracked
from openai import OpenAI

client = OpenAI(http_client=tracked())
res = client.chat.completions.create(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "explain CQRS"}],
)
# costs calculated automatically from response usage data
```

Works the same with Anthropic, Gemini, Groq, Mistral, Together, and any OpenAI-compatible SDK:

```python
from anthropic import Anthropic

client = Anthropic(http_client=tracked())
msg = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "explain event sourcing"}],
)
```

## Collect costs

```python
costs = []
client = OpenAI(http_client=tracked(on_cost=costs.append))

# ... run your agent ...

total = sum(c.total_cost for c in costs if c.total_cost)
print(f"Agent run cost: ${total:.4f}")
```

## Estimate from any response

```python
from llmkit import estimate_cost

cost = estimate_cost(response)
print(f"~${cost.total_cost:.6f}")
```

## How it compares

| Feature | llmkit-sdk | tokencost | litellm |
|---|---|---|---|
| Zero-config tracking | yes (httpx transport) | no (manual call) | no (callback setup) |
| Works with existing SDK code | yes (drop-in) | no (separate function) | yes (but requires litellm wrapper) |
| Local estimation (no proxy) | yes | yes | no |
| Budget enforcement | yes (via proxy) | no | yes (but 9+ bypass bugs) |
| Streaming cost tracking | yes | no | yes |
| Session grouping | yes | no | no |
| Models priced | 730+ | 400+ | 100+ |
| Install size | ~200KB | ~50KB | ~50MB |

## Framework integrations

Drop-in cost tracking for popular agent frameworks:

```python
# LangChain
from llmkit.integrations.langchain import LLMKitCallbackHandler
handler = LLMKitCallbackHandler()
chain.invoke("...", config={"callbacks": [handler]})
print(f"${handler.total_cost:.4f}")

# LlamaIndex
from llmkit.integrations.llamaindex import LLMKitCallbackHandler
from llama_index.core import Settings
Settings.callback_manager.add_handler(LLMKitCallbackHandler())

# Pydantic AI
from llmkit.integrations.pydantic_ai import llmkit_hooks
hooks, tracker = llmkit_hooks()
agent = Agent("openai:gpt-4.1", capabilities=[hooks])
result = await agent.run("...")
print(f"${tracker.total_cost:.4f}")
```

Frameworks are optional dependencies - install only what you use.

## Session tracking

Group costs by agent run:

```python
from llmkit import LLMKit

client = LLMKit(api_key="llmk_...")
agent = client.session()

for task in tasks:
    completion, cost = agent.chat(
        model="gpt-4.1",
        messages=[{"role": "user", "content": task}],
    )

print(f"Session: ${agent.stats.total_cost:.4f} across {agent.stats.request_count} requests")
```

## Streaming

```python
stream = client.chat_stream(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "write a haiku"}],
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")

print(f"\nCost: ${stream.cost.total_cost:.6f}")
```

## Proxy mode (budget enforcement)

Route through the LLMKit proxy for hard budget limits, per-key rate limiting, and dashboard analytics:

```python
client = LLMKit(api_key="llmk_...")
completion, cost = client.chat(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "hello"}],
)
print(f"${cost.total_cost:.4f} via {cost.provider}")
```

Set a $10 daily budget in the dashboard. When it's hit, requests get a 402 - not a log message, an actual block. No more runaway agents.

## Async

```python
from llmkit import AsyncLLMKit

client = AsyncLLMKit(api_key="llmk_...")
completion, cost = await client.chat(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "hello"}],
)
```

## No SDK needed

LLMKit is OpenAI-compatible. Any client works:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llmkit-proxy.smigolsmigol.workers.dev/v1",
    api_key="llmk_...",
)
```

## Part of LLMKit

This is the Python SDK for [LLMKit](https://github.com/smigolsmigol/llmkit), an open-source AI API gateway. The full platform includes:

- **Proxy** (Cloudflare Workers) - budget enforcement, cost tracking, provider routing
- **Dashboard** (Next.js) - analytics, API key management, budget configuration
- **MCP server** - 11 tools for Claude Code, Cursor, and Cline cost tracking
- **TypeScript SDK** - same features for Node.js/Deno/Bun
- **CLI** - wrap any command with `npx @f3d1/llmkit-cli -- node agent.js`

## License

MIT
