"""Pydantic AI integration for LLMKit gateway control and local cost estimates.

Usage:
    from llmkit.integrations.pydantic_ai import gateway_model
    from pydantic_ai import Agent

    agent = Agent(gateway_model("gpt-4.1", session_id="release-review"))
    result = await agent.run("explain CQRS")

Requires: pip install "llmkit-sdk[pydantic-ai]"
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from openai import AsyncOpenAI

try:
    from pydantic_ai import ModelRequestContext, ModelSettings, RunContext
    from pydantic_ai.capabilities import Hooks
    from pydantic_ai.messages import ModelResponse
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider
    from pydantic_ai.usage import RequestUsage
except ImportError as e:
    raise ImportError(
        "pydantic-ai is required for this integration. "
        'Install it with: pip install "llmkit-sdk[pydantic-ai]"'
    ) from e

from llmkit._client import DEFAULT_BASE_URL, ENV_API_KEY, ENV_BASE_URL, _build_headers
from llmkit._pricing import calculate_cost


def gateway_model(
    model: str,
    api_key: str | None = None,
    *,
    base_url: str | None = None,
    provider_key: str | None = None,
    provider: str | None = None,
    fallback: str | None = None,
    customer_id: str | None = None,
    workflow_id: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    end_user_id: str | None = None,
    settings: ModelSettings | None = None,
) -> OpenAIChatModel:
    """Build a Pydantic AI chat model routed through the LLMKit gateway."""
    resolved_key = api_key or os.environ.get(ENV_API_KEY)
    if not resolved_key:
        raise ValueError(f"api_key required: pass it directly or set {ENV_API_KEY}")

    headers = _build_headers(
        provider_key,
        provider,
        session_id,
        fallback,
        customer_id=customer_id,
        workflow_id=workflow_id,
        agent_id=agent_id,
        end_user_id=end_user_id,
    )
    client = AsyncOpenAI(
        api_key=resolved_key,
        base_url=base_url or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL,
        default_headers=headers,
        max_retries=0,
    )
    return OpenAIChatModel(
        model,
        provider=OpenAIProvider(openai_client=client),
        settings=settings,
    )


class LLMKitCostTracker:
    """Tracks costs across Pydantic AI agent runs via Hooks capability."""

    def __init__(self, hooks: Hooks, on_cost: Callable[[float], Any] | None = None) -> None:
        self.on_cost = on_cost
        self.total_cost: float = 0.0
        self.total_tokens: int = 0
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.request_count: int = 0
        self._last_cost: float | None = None

        @hooks.on.after_model_request
        async def _track_cost(
            ctx: RunContext[Any],
            *,
            request_context: ModelRequestContext,
            response: ModelResponse,
        ) -> ModelResponse:
            del ctx, request_context
            self._record(response.usage, _extract_model(response.model_name))
            return response

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
        return (
            "LLMKitCostTracker("
            f"requests={self.request_count}, cost=${self.total_cost:.4f}, "
            f"tokens={self.total_tokens})"
        )


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
