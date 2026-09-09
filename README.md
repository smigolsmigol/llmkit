<p align="center">
  <img src=".github/logo-wordmark-animated.svg" width="280" alt="LLMKit" />
</p>

<h3 align="center">Measure what your AI agents cost. Stop requests before they exceed a budget.</h3>

<p align="center">
  <a href="https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml"><img src="https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/v/llmkit-sdk?label=python" alt="PyPI" /></a>
  <a href="https://www.npmjs.com/package/@f3d1/llmkit-mcp-server"><img src="https://img.shields.io/npm/v/@f3d1/llmkit-mcp-server?label=mcp" alt="npm" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/smigolsmigol/llmkit"><img src="https://api.scorecard.dev/projects/github.com/smigolsmigol/llmkit/badge" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.bestpractices.dev/projects/12288"><img src="https://www.bestpractices.dev/projects/12288/badge" alt="OpenSSF Best Practices" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://llmkit.sh">Website</a> | <a href="docs/README.md">Docs</a> | <a href="https://api.llmkit.sh/v1/pricing/compare?mode=text-token&models=anthropic%2Fclaude-sonnet-4-6%2Copenai%2Fgpt-4o&input=1000&output=1000&cacheRead=0&cacheWrite=0">Pricing API</a> | <a href="docs/architecture.md">Architecture</a> | <a href="SECURITY.md">Security</a> | <a href="docs/security-assurance.md">Assurance case</a>
</p>

LLMKit is an open-source AI gateway and SDK suite for cost attribution, budget admission and
request evidence. Local tracking works without an LLMKit account. The gateway reserves bounded
spend before provider dispatch and settles admitted requests when usage arrives.

## Start locally

```bash
pip install llmkit-sdk openai
```

```python
from llmkit import tracked
from openai import OpenAI

costs = []
client = OpenAI(http_client=tracked(on_cost=costs.append))

client.chat.completions.create(
    model="gpt-4.1",
    messages=[{"role": "user", "content": "Summarize this incident."}],
)

print(f"${sum(item.total_cost or 0 for item in costs):.6f}")
```

The transport reads provider usage metadata and estimates cost from the bundled pricing catalog. It does not send tracking data to LLMKit.

Set your provider API key before running the example. The call is billed by the provider; LLMKit
only estimates its cost. For an existing compatible command, use
`npx @f3d1/llmkit-cli -- python my_agent.py`.

## Find your integration

| Surface | Guide |
| --- | --- |
| Python tracking, OpenAI Agents and PydanticAI boundaries | [Python](docs/integrations/python.md) |
| TypeScript client and local CostTracker | [TypeScript](docs/integrations/typescript.md) |
| Zero-code tracking for compatible child processes | [CLI](docs/integrations/cli.md) |
| 11 tools for local session evidence and gateway queries | [MCP](docs/integrations/mcp.md) |
| Vercel AI SDK 6 provider | [AI SDK](docs/integrations/vercel-ai-sdk.md) |
| Shared types and pricing data | [Shared package](docs/integrations/shared.md) |

[All documentation](docs/README.md) includes the [quickstart](docs/getting-started.md),
[API reference](docs/api.md) and [live review pilot](docs/guides/live-review.md).
Boundary Check is experimental; follow the Python guide's version and enrollment requirements.

## Budget boundary

<p align="center">
  <img src=".github/budget-path.svg" width="100%" alt="Authenticate, reserve bounded cost, reject over-budget requests before dispatch, then settle admitted usage." />
</p>

Local tracking observes cost; hard-budget enforcement requires an enrolled gateway path.
A provider call that may have dispatched remains uncertain when its final evidence is missing.
The pricing catalog is a bundled reference snapshot, not a live quote or provider invoice.

Gateway calls require an existing LLMKit key. Account creation and key management remain temporarily
unavailable. See the [staging proof](docs/operations/staging-proof.md) for the isolated hosted
verification contract; local fixtures do not establish production acceptance.

## Project policy and design

| Document | What it owns |
| --- | --- |
| [Governance](GOVERNANCE.md) | Decision authority, roles, disputes, and the current continuity gap |
| [Roadmap](docs/roadmap.md) | Intended and excluded work through August 2027 |
| [Architecture](docs/architecture.md) | Components, request flows, identity, storage, deployment, and failure boundaries |
| [Security](SECURITY.md) | Security requirements, excluded guarantees, reporting, and supported versions |
| [Security assurance](docs/security-assurance.md) | Threat model, trust boundaries, executable evidence, residual risks, and runtime HOLDs |
| [Accessibility](docs/accessibility.md) | Public-site controls, verification method, known gaps, and language scope |
| [Contributing](CONTRIBUTING.md) | Setup, quality gates, review expectations, and DCO sign-off |

## Contributing and security

Start with [Contributing](CONTRIBUTING.md) and the [quality gates](docs/operations/quality.md).
Read the [Security Insights snapshot](security-insights.yml). Report vulnerabilities through
[GitHub private reporting](https://github.com/smigolsmigol/llmkit/security/advisories/new)
or email `security@llmkit.sh`.

[MIT](LICENSE)
