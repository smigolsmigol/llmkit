# llmkit

Python SDK for [LLMKit](https://github.com/smigolsmigol/llmkit), the AI API gateway with cost tracking and budget enforcement.

## Install

```bash
pip install llmkit-sdk
```

## Local cost tracking (no proxy)

Drop-in cost tracking for any OpenAI-compatible SDK. No account, no proxy, no config:

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

Collect costs with a callback:

```python
costs = []
client = OpenAI(http_client=tracked(on_cost=costs.append))
# ... make requests ...
total = sum(c.total_cost for c in costs if c.total_cost)
```

Or estimate from any existing response:

```python
from llmkit import estimate_cost

cost = estimate_cost(response)
print(f"~${cost.total_cost:.6f}")
```

Works with OpenAI, Anthropic, Groq, Together, Cohere, and Mistral SDKs.

## Quick start (proxy mode)

```python
from llmkit import LLMKit

client = LLMKit(api_key="llmk_...")
completion, cost = client.chat(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)

print(completion.choices[0].message.content)
print(f"Cost: ${cost.total_cost:.4f} via {cost.provider}")
```

## Session tracking

Group costs by agent run using sessions:

```python
agent = client.session()

for task in tasks:
    completion, cost = agent.chat(
        model="gpt-4o",
        messages=[{"role": "user", "content": task}],
    )

print(f"Session total: ${agent.stats.total_cost:.4f}")
print(f"Requests: {agent.stats.request_count}")
```

## Bring your own provider key

```python
client = LLMKit(
    api_key="llmk_...",
    provider_key="sk-...",
)
```

## Streaming with cost tracking

```python
stream = client.chat_stream(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")

print(f"\nCost: ${stream.cost.total_cost:.6f}")
```

Cost is captured from the final stream chunk's usage data. Cumulative totals are available on `client.stats`.

## Escape hatch

The underlying OpenAI client is always accessible for anything the SDK doesn't cover:

```python
stream = client.openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

## Async

```python
from llmkit import AsyncLLMKit

client = AsyncLLMKit(api_key="llmk_...")
completion, cost = await client.chat(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
```

## No SDK needed

LLMKit works with any OpenAI-compatible client. No pip install required:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llmkit-proxy.smigolsmigol.workers.dev/v1",
    api_key="llmk_...",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
```

## License

MIT
