<p align="center">
  <img src="https://raw.githubusercontent.com/smigolsmigol/llmkit/main/.github/logo-wordmark-animated.svg" width="240" alt="LLMKit" />
</p>

<h3 align="center">Local LLM cost estimates for existing Python SDK calls</h3>

<p align="center">
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/v/llmkit-sdk?color=blue" alt="PyPI" /></a>
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/pyversions/llmkit-sdk" alt="Python versions" /></a>
  <a href="https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml"><img src="https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/smigolsmigol/llmkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT" /></a>
</p>

`llmkit-sdk` wraps supported HTTP clients, reads token usage from provider responses, and estimates cost from a bundled pricing catalog. Local tracking does not require an LLMKit account or proxy.

```bash
pip install llmkit-sdk
```

## Track an existing client

```python
from llmkit import tracked
from openai import OpenAI

costs = []
client = OpenAI(http_client=tracked(on_cost=costs.append))

client.chat.completions.create(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "Explain CQRS."}],
)

print(f"${sum(item.total_cost or 0 for item in costs):.6f}")
```

The same transport can wrap an Anthropic client:

```python
from anthropic import Anthropic
from llmkit import tracked

costs = []
client = Anthropic(http_client=tracked(on_cost=costs.append))

client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=512,
    messages=[{"role": "user", "content": "Explain event sourcing."}],
)
```

## Estimate a completed response

```python
from llmkit import estimate_cost

cost = estimate_cost(response)
print(f"~${cost.total_cost:.6f}")
```

## LangChain callback

```python
from llmkit.integrations.langchain import LLMKitCallbackHandler

handler = LLMKitCallbackHandler()
chain.invoke("Summarize this report", config={"callbacks": [handler]})
print(f"${handler.total_cost:.4f}")
```

Framework integrations are optional. Use a tested LLMKit extra where one is documented below;
other integrations require their framework package separately.

## PydanticAI gateway model

Use the native PydanticAI model interface when requests need shared budget admission, stable
attribution, and gateway receipts:

```bash
pip install "llmkit-sdk[pydantic-ai]"
```

```python
from pydantic_ai import Agent, ModelSettings, UsageLimits
from llmkit.integrations.pydantic_ai import gateway_model

model = gateway_model(
    "gpt-4.1-mini",
    session_id="release-review-42",
    workflow_id="release-review",
    agent_id="reviewer",
)
agent = Agent(model, model_settings=ModelSettings(max_tokens=512))

result = await agent.run(
    "Review this release candidate.",
    usage_limits=UsageLimits(request_limit=4, total_tokens_limit=8_000),
)
```

`UsageLimits` remains the in-run token and request guard. LLMKit gateway mode adds the shared,
multi-run spend boundary and receipt. Hard budgets require an explicit positive output-token limit.
Client-side function tools are supported; provider-managed tools, images, and file attachments fail
closed when the gateway cannot prove a pre-dispatch cost ceiling.
Transparent OpenAI SDK transport retries are disabled in gateway mode. Retry transient failures
explicitly at the run boundary so every dispatch has a distinct budget reservation and receipt.

## OpenAI Agents function-tool boundary (experimental)

Use the opt-in boundary when an OpenAI Agents `FunctionTool` can create an external side effect.
The wrapper requires a signed grant for the exact tool, call ID, arguments, identity, policy,
expiry, and budget scope before invoking the tool. Rejected requests produce a signed `denied`
receipt, while reservations proven not to dispatch produce `released`. An invoked tool records
`reserved`, `dispatched`, and a terminal `settled` or `uncertain` receipt without storing raw
arguments. `settled` requires an application acknowledgement with a stable effect ID, source, and
version. It is not independent proof from the remote system.

```bash
pip install "llmkit-sdk[openai-agents]"
```

The [local PR-review example][openai-boundary-example] calls the SDK guardrail and tool primitives
directly. It runs one poisoned request with no grant and one granted request without calling a
Runner, model, or GitHub.

[openai-boundary-example]: https://github.com/smigolsmigol/llmkit/blob/main/examples/openai_agents_boundary_review.py

Only function tools passed through `protect_function_tool()` are enforced. The coverage report is
a declared list, not runtime inventory. Approval-required function tools are rejected because
OpenAI Agents 0.20 does not expose a rejection hook that can release a reserved grant. Unwrapped
function tools, hosted tools, hosted or local MCP, computer, shell, apply-patch, handoffs,
agent-as-tool calls, realtime, direct clients, and background retries remain uncovered. The
included HMAC authority and replay/lifecycle stores are local proof components, not a production
key service or durable coordination layer.

## Sessions and gateway mode

Use the hosted or self-hosted LLMKit gateway when you need shared budgets, request receipts,
provider routing, or dashboard analytics. Hosted calls require an existing key. New hosted account
creation and key management are temporarily unavailable.

```python
from llmkit import LLMKit

client = LLMKit(api_key="llmk_your_key_here")
session = client.session()

completion, cost = session.chat(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "Draft a release note."}],
)

print(f"${cost.total_cost:.4f} via {cost.provider}")
```

For an OpenAI-compatible client:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.llmkit.sh/v1",
    api_key="llmk_your_key_here",
)
```

## Async client

```python
from llmkit import AsyncLLMKit

client = AsyncLLMKit(api_key="llmk_your_key_here")
completion, cost = await client.chat(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "Summarize this incident."}],
)
```

## Accuracy boundary

- Local values are estimates derived from response usage metadata and the bundled pricing table.
- Provider invoice adjustments, account-specific discounts, and pricing changes may differ.
- Local tracking observes cost; budget rejection requires gateway mode.
- Streaming cost is final only after the stream completes and usage metadata is available.

## LLMKit repository

The [LLMKit monorepo](https://github.com/smigolsmigol/llmkit) also contains the Cloudflare Worker
gateway, dashboard, TypeScript SDK, CLI, Vercel AI SDK provider, MCP server, database migrations,
and deterministic budget-control fixtures.

## License

MIT
