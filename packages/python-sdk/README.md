# llmkit

Python SDK for [LLMKit](https://github.com/smigolsmigol/llmkit), the AI API gateway with cost tracking and budget enforcement.

## Install

```bash
pip install llmkit-sdk
```

## Quick start

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
