"""LangChain callback handler for LLMKit cost tracking.

Requires langchain-core >= 0.1.0 (optional dependency).
"""

from __future__ import annotations

from typing import Any, Callable, Sequence
from uuid import UUID

try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.outputs import LLMResult
except ImportError as e:
    raise ImportError(
        "langchain-core is required for LLMKit's LangChain integration. "
        "Install it with: pip install langchain-core"
    ) from e

from .._pricing import calculate_cost
from .._types import CostInfo


def _extract_model(response: LLMResult) -> str | None:
    """Pull model name from LLMResult, trying multiple locations."""
    # llm_output is the standard place for OpenAI-style LLMs
    llm_out = response.llm_output or {}
    if model := llm_out.get("model_name") or llm_out.get("model"):
        return model

    # chat models: dig into the first generation's message metadata
    for gen_list in response.generations:
        for gen in gen_list:
            msg = getattr(gen, "message", None)
            if not msg:
                continue
            meta = getattr(msg, "response_metadata", None) or {}
            if model := meta.get("model_name") or meta.get("model"):
                return model

    return None


def _extract_tokens_from_llm_output(
    llm_output: dict[str, Any],
) -> tuple[int, int, int, int] | None:
    """Extract token counts from llm_output.token_usage dict."""
    usage = llm_output.get("token_usage")
    if not usage:
        return None
    prompt = usage.get("prompt_tokens", 0) or 0
    completion = usage.get("completion_tokens", 0) or 0
    cache_read = usage.get("cache_read_input_tokens", 0) or 0
    cache_write = usage.get("cache_creation_input_tokens", 0) or 0
    return prompt, completion, cache_read, cache_write


def _extract_tokens_from_generations(
    generations: Sequence[Sequence[Any]],
) -> tuple[int, int, int, int] | None:
    """Extract token counts from ChatGeneration message usage_metadata."""
    for gen_list in generations:
        for gen in gen_list:
            msg = getattr(gen, "message", None)
            if not msg:
                continue
            usage = getattr(msg, "usage_metadata", None)
            if not usage:
                continue
            # usage_metadata is a dict-like with input_tokens / output_tokens
            get = usage.get if isinstance(usage, dict) else getattr(usage, "get", None)
            if not get:
                # try attribute access as fallback
                input_t = getattr(usage, "input_tokens", 0) or 0
                output_t = getattr(usage, "output_tokens", 0) or 0
            else:
                input_t = get("input_tokens", 0) or 0
                output_t = get("output_tokens", 0) or 0

            # cache tokens from input_token_details if present
            details = (
                get("input_token_details", None)
                if get
                else getattr(usage, "input_token_details", None)
            )
            cache_read = 0
            if details:
                d_get = (
                    details.get
                    if isinstance(details, dict)
                    else getattr(details, "get", None)
                )
                if d_get:
                    cache_read = d_get("cache_read", 0) or 0
                else:
                    cache_read = getattr(details, "cache_read", 0) or 0

            return input_t, output_t, cache_read, 0

    return None


class LLMKitCallbackHandler(BaseCallbackHandler):
    """LangChain callback handler that tracks LLM costs via LLMKit pricing.

    Usage::

        handler = LLMKitCallbackHandler()
        chain.invoke("hello", config={"callbacks": [handler]})
        print(f"Cost: ${handler.total_cost:.6f}")
        print(f"Tokens: {handler.total_tokens}")
    """

    total_cost: float
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    request_count: int

    def __init__(
        self,
        *,
        on_cost: Callable[[CostInfo], Any] | None = None,
    ) -> None:
        super().__init__()
        self.total_cost = 0.0
        self.total_tokens = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.request_count = 0
        self._on_cost = on_cost
        self._costs: list[CostInfo] = []

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        model = _extract_model(response)

        # try llm_output first (OpenAI-style), fall back to generation metadata
        tokens = None
        if response.llm_output:
            tokens = _extract_tokens_from_llm_output(response.llm_output)
        if tokens is None:
            tokens = _extract_tokens_from_generations(response.generations)

        if tokens is None:
            return

        input_t, output_t, cache_read, cache_write = tokens
        self.prompt_tokens += input_t
        self.completion_tokens += output_t
        self.total_tokens += input_t + output_t
        self.request_count += 1

        cost_value = None
        if model:
            cost_value = calculate_cost(
                model, input_t, output_t, cache_read, cache_write
            )

        if cost_value is not None:
            self.total_cost += cost_value

        cost_info = CostInfo(total_cost=cost_value, provider=None, estimated=True)
        self._costs.append(cost_info)
        if self._on_cost:
            self._on_cost(cost_info)

    @property
    def last_cost(self) -> CostInfo | None:
        return self._costs[-1] if self._costs else None

    def __repr__(self) -> str:
        return (
            f"LLMKitCallbackHandler("
            f"requests={self.request_count}, "
            f"cost=${self.total_cost:.6f}, "
            f"tokens={self.total_tokens})"
        )
