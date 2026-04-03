"""Pydantic AI hooks for LLMKit cost tracking.

Usage:
    from llmkit.integrations.pydantic_ai import llmkit_hooks
    from pydantic_ai import Agent

    hooks, tracker = llmkit_hooks()
    agent = Agent("openai:gpt-4.1", capabilities=[hooks])

    result = await agent.run("explain CQRS")
    print(f"Cost: ${tracker.total_cost:.4f}")

Or manually with an existing Hooks instance:
    from llmkit.integrations.pydantic_ai import LLMKitCostTracker
    from pydantic_ai.capabilities import Hooks

    hooks = Hooks()
    tracker = LLMKitCostTracker(hooks)
    # tracker registers itself on hooks.on.after_model_request

Requires: pip install pydantic-ai
"""

from __future__ import annotations

from typing import Any, Callable

try:
    from pydantic_ai.capabilities import Hooks
    from pydantic_ai.usage import RequestUsage
except ImportError as e:
    raise ImportError(
        "pydantic-ai is required for this integration. "
        "Install it with: pip install pydantic-ai"
    ) from e

from llmkit._pricing import calculate_cost


class LLMKitCostTracker:
    """Tracks costs across Pydantic AI agent runs via Hooks capability."""

    def __init__(
        self, hooks: Hooks, on_cost: Callable[[float], Any] | None = None
    ) -> None:
        self.on_cost = on_cost
        self.total_cost: float = 0.0
        self.total_tokens: int = 0
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.request_count: int = 0
        self._last_cost: float | None = None

        @hooks.on.after_model_request
        async def _track_cost(
            usage: RequestUsage, model: Any = None, **kwargs: Any
        ) -> None:
            self._record(usage, _extract_model(model))

    @property
    def last_cost(self) -> float | None:
        return self._last_cost

    def _record(self, usage: RequestUsage, model: str) -> None:
        input_tok = usage.input_tokens or 0
        output_tok = usage.output_tokens or 0

        if input_tok == 0 and output_tok == 0:
            return

        cost_value = calculate_cost(model, input_tok, output_tok)

        self.input_tokens += input_tok
        self.output_tokens += output_tok
        self.total_tokens += input_tok + output_tok
        self.request_count += 1
        if cost_value is not None:
            self.total_cost += cost_value

        self._last_cost = cost_value
        if self.on_cost and cost_value is not None:
            self.on_cost(cost_value)

    def __repr__(self) -> str:
        return f"LLMKitCostTracker(requests={self.request_count}, cost=${self.total_cost:.4f}, tokens={self.total_tokens})"


def _extract_model(model: Any) -> str:
    if model is None:
        return ""
    if isinstance(model, str):
        # pydantic-ai uses "provider:model" format, strip the provider prefix
        return model.split(":", 1)[-1] if ":" in model else model
    name = getattr(model, "model_name", None) or getattr(model, "name", None) or ""
    return name.split(":", 1)[-1] if ":" in name else name


def llmkit_hooks(
    on_cost: Callable[[float], Any] | None = None,
) -> tuple[Hooks, LLMKitCostTracker]:
    """Create a Hooks capability with LLMKit cost tracking.

    Returns (hooks, tracker) - pass hooks to Agent capabilities,
    read costs from tracker.
    """
    hooks = Hooks()
    tracker = LLMKitCostTracker(hooks, on_cost=on_cost)
    return hooks, tracker
