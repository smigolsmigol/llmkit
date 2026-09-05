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

Use the native PydanticAI model interface to route requests through LLMKit for server-side budget
admission, stable attribution, and gateway receipts:

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
Gateway-routed client-side function tools are supported but are not exact-effect-enforced;
provider-managed tools, images, and file attachments fail closed when the gateway cannot prove a
pre-dispatch cost ceiling.
Transparent OpenAI SDK transport retries are disabled in gateway mode. Retry transient failures
explicitly at the run boundary so every dispatch has a distinct budget reservation and receipt.

`gateway_model()` does not locally verify that a grant and terminal receipt match the exact request.
Use the opt-in boundary model when the caller must withhold the model result until that proof is
complete:

```python
from pydantic_ai import Agent, ModelSettings
from llmkit.integrations.pydantic_ai import (
    PydanticAIBoundaryContext,
    gateway_boundary_model,
)

boundary_context = PydanticAIBoundaryContext(
    principal="reviewer@example.com",
    tenant="acme",
    workload="release-review",
    budget_scope="approved-budget-id",
    model_grant_resolver=resolve_model_grant,
    provenance="trusted",
)
model = gateway_boundary_model(
    "gpt-4.1-mini",
    context=boundary_context,
    runtime=boundary_runtime,
    provider="openai",
    settings=ModelSettings(max_tokens=512),
)

async with model:
    result = await Agent(model).run("Review this release candidate.")
```

Here, `boundary_runtime` and `resolve_model_grant` are application-owned. The resolver receives the
exact serialized request action and must return its signed grant. The result is released only after
the authenticated terminal receipt matches the request identity, budget, provider and model,
response ID and body hash, and idempotency key. A denial stops before network dispatch; missing or
mismatched evidence after dispatch produces `uncertain`. This boundary enforces non-streaming model
calls only. PydanticAI streaming, function tools, and provider-managed tools remain explicitly
uncovered, as do calls made directly through the wrapped model or OpenAI client.

## OpenAI Agents exact-effect boundary (experimental)

Use the opt-in boundary when an OpenAI Agents run must prove both model dispatch and function-tool
effects. `protect_function_tool()` requires a signed grant for the exact tool, call ID, arguments,
identity, policy, expiry, and budget scope before invoking the tool. `GatewayBoundaryProvider` uses
the Agents `ModelProvider` seam to bind a separate grant to the exact serialized non-streaming
model request before the HTTP transport sends it.

The model result remains withheld until an authenticated LLMKit receipt matches the request ID,
identity, budget reservation, requested and last-dispatched provider and model, provider response
ID, response-body hash, idempotency evidence, and terminal `settled_actual` state. Missing, expired,
changed, or replayed grants stop before network dispatch. Cancellation, parsing failure, or missing
terminal evidence after dispatch produces `uncertain`. The provider accepts one explicit provider
and disables transparent OpenAI retries so one grant maps to one transport attempt.

```bash
pip install "llmkit-sdk[openai-agents]"
```

The [local PR-review example][openai-boundary-example] runs the real Agents `Runner` against an
in-process fake gateway. The poisoned review receives no tool grant and reaches the sink zero times.
The approved review joins two model calls and one tool effect into three signed receipt chains. The
fixture sends no GitHub or hosted LLMKit request, so it proves consumer wiring rather than hosted
deployment.

From `packages/python-sdk`, the check takes a few minutes:

```bash
python -m venv .venv
.venv/bin/python -m pip install -e ".[openai-agents]"
.venv/bin/python ../../examples/openai_agents_boundary_review.py
```

On Windows, use `.venv\Scripts\python.exe`. A passing result reports zero poisoned sink calls, one
approved sink call, two approved model requests, and nine approved receipt states in
`reserved`, `dispatched`, `settled` order.

Wrap each Agents run in `try` / `finally` and call
`await release_pending_admissions(boundary_context)` in the finalizer. This closes reservations
when a run ends after the guardrail allows a tool but before the SDK invokes it. The context is
single-run and rejects admissions after finalization.

[openai-boundary-example]: https://github.com/smigolsmigol/llmkit/blob/main/examples/openai_agents_boundary_review.py

Only function tools passed through `protect_function_tool()` and model calls routed through
`GatewayBoundaryProvider` are enforced. Streaming model calls fail before dispatch because stream
finality needs a separate evidence contract. The coverage report is declared scope, not runtime
inventory. Approval-required function tools are rejected because OpenAI Agents 0.20 does not expose
a rejection hook that can release a reserved grant. Unwrapped tools, hosted tools, hosted or local
MCP, computer, shell, apply-patch, handoffs, agent-as-tool calls, realtime, direct clients, and
background retries remain uncovered. The included HMAC authority and replay/lifecycle stores are
local proof components, not a production key service or durable coordination layer.

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
