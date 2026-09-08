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
calls only. Function tools need separate enrollment below. PydanticAI streaming and provider-managed
tools remain explicitly uncovered, as do calls made directly through the wrapped model or OpenAI client.

## PydanticAI function-tool boundary (experimental)

`protect_function_tool()` returns a native toolset for `Agent(toolsets=[...])`. It checks a signed
grant for the exact tool name, version, call ID, validated JSON arguments, identity, policy, expiry,
and budget scope before invoking the enrolled function. Arguments include native validated defaults
and are copied before an asynchronous grant resolver runs.

```python
from pydantic_ai import Agent, Tool
from llmkit.integrations.pydantic_ai import protect_function_tool

review_toolset = protect_function_tool(
    Tool(post_review_comment),
    context=boundary_context,
    runtime=boundary_runtime,
    grant_resolver=resolve_tool_grant,
    tool_version="1",
    effect_class="github.review_comment",
    acknowledgement=extract_review_acknowledgement,
)
agent = Agent(model, toolsets=[review_toolset])
```

The tool grant resolver receives the exact `EffectAction` and native `RunContext`. It returns a
signed grant or `None`, synchronously or asynchronously. The acknowledgement callback must return
an `EffectAcknowledgement` backed by the application's sink response. A successful function return
alone does not settle the effect. Missing or invalid acknowledgement, cancellation, native timeout,
and exceptions after invocation leave the receipt `uncertain`, never `released`.

Admission and dispatch have no intervening asynchronous step, so cancellation while resolving a
grant leaves no reservation. Unlike the OpenAI Agents guardrail adapter, this toolset does not need
a pending-admission finalizer. Use an application-owned context and runtime; the supplied HMAC and
in-memory replay store prove an in-process lifecycle, not durable crash recovery or cross-process
coordination.

Only explicitly wrapped native function tools with JSON-compatible validated arguments are covered.
Approval-required or deferred tools, dynamic renames, custom toolsets, MCP tools, Python-object
arguments, and direct calls to the original function are not covered. The coverage report declares
enrollment, not an inventory of everything the Agent can execute.

The [PydanticAI review example][pydantic-boundary-example] uses the same fake gateway and review sink
as the OpenAI Agents example. It requires the current editable source checkout with the `pydantic-ai`
extra installed. From `packages/python-sdk`:

```bash
python ../../examples/pydantic_ai_boundary_review.py
```

Both native SDKs deny the poisoned review before the sink and join two approved model calls and one
tool effect into nine receipt states. These local examples make no GitHub or hosted LLMKit request;
they prove SDK wiring and the shared receipt contract, not deployment.

The PydanticAI example loads `examples/pydantic_review_policy.json` relative to its own file and
uses it for both model and tool admission. Its output joins the check's policy hash to the signed
receipts. The fixture labels its input provenance as trusted; it does not establish real-world
provenance.

[pydantic-boundary-example]: https://github.com/smigolsmigol/llmkit/blob/main/examples/pydantic_ai_boundary_review.py

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

For an opt-in public-PR pilot, follow the [live review instructions][live-review-pilot]. Its default
only reads GitHub. Model spend and an interactively approved exact comment are separate opt-ins;
the pilot requires an existing gateway and does not change the adapter's enforcement scope.

[live-review-pilot]: https://github.com/smigolsmigol/llmkit/blob/main/examples/LIVE_REVIEW.md

Only function tools passed through `protect_function_tool()` and model calls routed through
`GatewayBoundaryProvider` are enforced. Streaming model calls fail before dispatch because stream
finality needs a separate evidence contract. The coverage report is declared scope, not runtime
inventory. Approval-required function tools are rejected because OpenAI Agents 0.20 does not expose
a rejection hook that can release a reserved grant. Unwrapped tools, hosted tools, hosted or local
MCP, computer, shell, apply-patch, handoffs, agent-as-tool calls, realtime, direct clients, and
background retries remain uncovered. The included HMAC authority and replay/lifecycle stores are
local proof components, not a production key service or durable coordination layer.

## Boundary Check (experimental, source checkout)

Check a declared route policy in CI, then use that same policy to restrict runtime admission.
This command requires the current source checkout; it is not in the published 0.1.11 wheel.
From the repository root, in a Python 3.11+ environment:

```console
python -m pip install -e "./packages/python-sdk[openai-agents]"
python -m llmkit.boundary_check examples/pr_review_policy.json
```

The example declares one gateway model route and one review-comment tool. Set the comment route's
`enrolled` field to `false` and rerun the command: it exits 1 with `unenrolled_route` for
`post_review_comment`. Restore `true` and it exits 0. Malformed or unreadable policy files exit 2
without echoing their contents. The repository's `quality:pr` gate runs this check on the example.
No API key, gateway, model request, or GitHub access is needed for the check.

```python
from llmkit.boundary_policy import BoundaryPolicy

policy = BoundaryPolicy.load("examples/pr_review_policy.json")
boundary_runtime = policy.runtime(authority=authority)
```

Pass this runtime to the existing native model and tool boundaries. `authority` and exact grant
issuance remain application-owned. Runtime admission requires both a matching policy route
(effect class, target, version) and a valid exact-action grant. Grants and receipts carry the same
normalized policy hash as the check; changing the policy invalidates grants for the old hash.
Policies support the `openai-agents` and `pydantic-ai` adapters with their respective SDK extras.

This is a **declared inventory**, not code discovery or proof of runtime enrollment. The command
imports only the selected built-in adapter, never an application module named in the policy.
Unlisted routes and calls outside the wrappers are not protected. A passing check does not prove
provider support, pricing, gateway configuration, or a configured hard budget. Reports explicitly
set `runtime_enforcement_verified` to `false`; enrollment requires separate consumer tests.

The [live review pilot][live-review-pilot] accepts `--policy examples/pr_review_policy.json` and
uses that policy for its model and tool runtime. Its spend and exact human-approval requirements
remain unchanged.

For the local PydanticAI consumer, run from the repository root with its extra installed:

```console
python -m llmkit.boundary_check examples/pydantic_review_policy.json
python examples/pydantic_ai_boundary_review.py
```

The check exits 0 and the example reports zero poisoned sink calls and one approved sink call.
Change the tool route's version to `2`: the declaration still checks, but the example's version `1`
tool is denied with `action_outside_policy` before the sink. The example exits nonzero because its
approved-path assertion no longer holds. Restore version `1` to run the approved path again.
This demonstrates policy-to-runtime wiring through the native Agent, not automatic route discovery.

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
