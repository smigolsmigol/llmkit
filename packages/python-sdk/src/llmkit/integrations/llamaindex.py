"""LlamaIndex callback handler for LLMKit cost tracking.

Usage:
    from llmkit.integrations.llamaindex import LLMKitCallbackHandler
    from llama_index.core import Settings

    handler = LLMKitCallbackHandler()
    Settings.callback_manager.add_handler(handler)

    # ... run queries ...
    print(f"Total: ${handler.total_cost:.4f}")

Requires: pip install llama-index-core
"""

from __future__ import annotations

from typing import Any, Callable

try:
    from llama_index.core.callbacks.base_handler import BaseCallbackHandler
    from llama_index.core.callbacks.schema import CBEventType, EventPayload
except ImportError as e:
    raise ImportError(
        "llama-index-core is required for this integration. "
        "Install it with: pip install llama-index-core"
    ) from e

from llmkit._pricing import calculate_cost


class LLMKitCallbackHandler(BaseCallbackHandler):
    """Tracks LLM costs across LlamaIndex queries."""

    def __init__(self, on_cost: Callable[[float], Any] | None = None) -> None:
        try:
            super().__init__(event_starts_to_ignore=[], event_ends_to_ignore=[])
        except TypeError:
            super().__init__()
        self.on_cost = on_cost
        self.total_cost: float = 0.0
        self.total_tokens: int = 0
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0
        self.request_count: int = 0
        self._last_cost: float | None = None

    @property
    def last_cost(self) -> float | None:
        return self._last_cost

    def on_event_start(
        self,
        event_type: CBEventType,
        payload: dict | None = None,
        event_id: str = "",
        parent_id: str = "",
        **kwargs: Any,
    ) -> str:
        return event_id

    def on_event_end(
        self,
        event_type: CBEventType,
        payload: dict | None = None,
        event_id: str = "",
        **kwargs: Any,
    ) -> None:
        if event_type != CBEventType.LLM or not payload:
            return

        response = payload.get(EventPayload.RESPONSE)
        if response is None:
            return

        raw = getattr(response, "raw", None)
        if raw is None:
            return

        usage = getattr(raw, "usage", None)
        if usage is None:
            return

        prompt_tok = getattr(usage, "prompt_tokens", 0) or 0
        completion_tok = getattr(usage, "completion_tokens", 0) or 0
        model = getattr(raw, "model", None) or ""

        if prompt_tok == 0 and completion_tok == 0:
            return

        cost_value = calculate_cost(model, prompt_tok, completion_tok)

        self.prompt_tokens += prompt_tok
        self.completion_tokens += completion_tok
        self.total_tokens += prompt_tok + completion_tok
        self.request_count += 1
        if cost_value is not None:
            self.total_cost += cost_value

        self._last_cost = cost_value
        if self.on_cost and cost_value is not None:
            self.on_cost(cost_value)

    def start_trace(self, trace_id: str | None = None) -> None:
        pass

    def end_trace(
        self,
        trace_id: str | None = None,
        trace_map: dict[str, list[str]] | None = None,
    ) -> None:
        pass

    def __repr__(self) -> str:
        return f"LLMKitCallbackHandler(requests={self.request_count}, cost=${self.total_cost:.4f}, tokens={self.total_tokens})"
