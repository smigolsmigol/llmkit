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

Install the provider SDK separately and configure its API key. Calls go to that provider; local
tracking sends no telemetry to LLMKit. Costs use the bundled pricing snapshot, not a provider invoice.

## Integration guide

The [Python guide](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/python.md) owns the full API examples,
enrollment instructions and limitations.

- [PydanticAI gateway model](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/python.md#pydanticai-gateway-model)
- [PydanticAI function-tool boundary](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/python.md#pydanticai-function-tool-boundary-experimental)
- [OpenAI Agents exact-effect boundary](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/python.md#openai-agents-exact-effect-boundary-experimental)
- [Boundary Check](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/python.md#boundary-check-experimental)
- [Sessions, gateway and async clients](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/python.md#sessions-and-gateway-mode)
- [Release verification and recovery](https://github.com/smigolsmigol/llmkit/blob/main/docs/operations/python-releases.md)

Boundary Check requires the 0.1.12 release candidate or newer; the published 0.1.11 wheel does not
contain its commands. Follow the guide's source-wheel install until 0.1.12 is published.
Hosted calls require an existing LLMKit key. New account creation and key management remain
temporarily unavailable.

## License

[MIT](https://github.com/smigolsmigol/llmkit/blob/main/LICENSE)
