from __future__ import annotations

import os
import uuid
from typing import Any, AsyncIterator, Callable, Iterator

from openai import AsyncOpenAI, OpenAI
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from ._pricing import calculate_cost
from ._types import CostInfo, SessionStats

DEFAULT_BASE_URL = "https://llmkit-proxy.smigolsmigol.workers.dev/v1"
ENV_API_KEY = "LLMKIT_API_KEY"
ENV_BASE_URL = "LLMKIT_BASE_URL"


def _build_headers(
    provider_key: str | None,
    provider: str | None,
    session_id: str | None,
    fallback: str | None,
) -> dict[str, str]:
    headers: dict[str, str] = {}
    if provider_key:
        headers["x-llmkit-provider-key"] = provider_key
    if provider:
        headers["x-llmkit-provider"] = provider
    if session_id:
        headers["x-llmkit-session-id"] = session_id
    if fallback:
        headers["x-llmkit-fallback"] = fallback
    return headers


def _cost_from_usage(model: str | None, usage: Any) -> CostInfo:
    """Calculate cost from token usage (streaming or no-proxy fallback)."""
    if not usage or not model:
        return CostInfo()
    input_t = getattr(usage, "prompt_tokens", 0) or 0
    output_t = getattr(usage, "completion_tokens", 0) or 0
    estimated = calculate_cost(model, input_t, output_t)
    return CostInfo(total_cost=estimated, estimated=True)


def estimate_cost(response: ChatCompletion) -> CostInfo:
    """Estimate cost from any ChatCompletion response.

    Works without the LLMKit proxy. Uses a bundled pricing table
    to calculate cost from token counts. Returns CostInfo with
    estimated=True.

    Unknown models return CostInfo with total_cost=None.
    """
    if not response.usage:
        return CostInfo()
    return _cost_from_usage(response.model, response.usage)


class LLMKit:
    """LLMKit Python client.

    Pre-configured OpenAI client pointed at the LLMKit proxy,
    with cost extraction and session tracking.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        provider_key: str | None = None,
        provider: str | None = None,
        session_id: str | None = None,
        fallback: str | None = None,
        on_cost: Callable[[CostInfo], Any] | None = None,
        **openai_kwargs: Any,
    ) -> None:
        resolved_key = api_key or os.environ.get(ENV_API_KEY)
        if not resolved_key:
            raise ValueError(f"api_key required: pass it directly or set {ENV_API_KEY}")

        self._session_id = session_id
        self._provider_key = provider_key
        self._provider = provider
        self._fallback = fallback
        self._base_url = base_url or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL
        self._on_cost = on_cost
        self._stats = SessionStats(session_id=session_id or "")

        headers = _build_headers(provider_key, provider, session_id, fallback)

        self.openai = OpenAI(
            api_key=resolved_key,
            base_url=self._base_url,
            default_headers=headers,
            **openai_kwargs,
        )

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def stats(self) -> SessionStats:
        return self._stats

    def _record(self, cost: CostInfo) -> None:
        self._stats.record(cost)
        if self._on_cost:
            self._on_cost(cost)

    def session(self, session_id: str | None = None) -> LLMKit:
        """Create a new client with a fresh session ID. No shared state."""
        sid = session_id or str(uuid.uuid4())
        return LLMKit(
            api_key=self.openai.api_key,
            base_url=self._base_url,
            provider_key=self._provider_key,
            provider=self._provider,
            fallback=self._fallback,
            on_cost=self._on_cost,
            session_id=sid,
        )

    def chat(self, **kwargs: Any) -> tuple[ChatCompletion, CostInfo]:
        """Chat completion with cost extraction.

        Returns (completion, cost_info). For proxy users, cost comes from
        response headers (exact). For direct API usage, use estimate_cost().
        """
        raw = self.openai.chat.completions.with_raw_response.create(**kwargs)
        cost = CostInfo.from_headers(raw.headers)
        if cost.total_cost is None:
            # no proxy headers: fall back to usage-based estimation
            parsed = raw.parse()
            cost = _cost_from_usage(parsed.model, parsed.usage)
            self._record(cost)
            return parsed, cost
        completion = raw.parse()
        self._record(cost)
        return completion, cost

    def chat_stream(self, **kwargs: Any) -> CostStream:
        """Streaming chat completion with cost tracking.

        Yields ChatCompletionChunks. After iteration, access cost
        via the returned iterator's .cost and .usage properties,
        or check client.stats for cumulative totals.

        Cost is captured from the final stream chunk (proxy sends
        token counts as the last event before [DONE]).
        """
        kwargs["stream"] = True
        kwargs.setdefault("stream_options", {"include_usage": True})
        stream = self.openai.chat.completions.create(**kwargs)
        return CostStream(stream, self._record)

    def __enter__(self) -> LLMKit:
        return self

    def __exit__(self, *args: Any) -> None:
        pass


class CostStream:
    """Wrapper around a streaming response that captures usage from the final chunk."""

    def __init__(
        self,
        stream: Iterator[ChatCompletionChunk],
        on_done: Callable[[CostInfo], Any],
    ) -> None:
        self._stream = stream
        self._on_done = on_done
        self._model: str | None = None
        self._usage: Any = None
        self._cost: CostInfo | None = None

    def __iter__(self) -> Iterator[ChatCompletionChunk]:
        for chunk in self._stream:
            if chunk.model:
                self._model = chunk.model
            if chunk.usage:
                self._usage = chunk.usage
            yield chunk

        # stream exhausted: compute cost from final usage
        cost = _cost_from_usage(self._model, self._usage)
        self._cost = cost
        self._on_done(cost)

    @property
    def cost(self) -> CostInfo | None:
        """Available after stream is fully consumed."""
        return self._cost


class AsyncLLMKit:
    """Async LLMKit client. Same API, backed by AsyncOpenAI."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        provider_key: str | None = None,
        provider: str | None = None,
        session_id: str | None = None,
        fallback: str | None = None,
        on_cost: Callable[[CostInfo], Any] | None = None,
        **openai_kwargs: Any,
    ) -> None:
        resolved_key = api_key or os.environ.get(ENV_API_KEY)
        if not resolved_key:
            raise ValueError(f"api_key required: pass it directly or set {ENV_API_KEY}")

        self._session_id = session_id
        self._provider_key = provider_key
        self._provider = provider
        self._fallback = fallback
        self._base_url = base_url or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL
        self._on_cost = on_cost
        self._stats = SessionStats(session_id=session_id or "")

        headers = _build_headers(provider_key, provider, session_id, fallback)

        self.openai = AsyncOpenAI(
            api_key=resolved_key,
            base_url=self._base_url,
            default_headers=headers,
            **openai_kwargs,
        )

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def stats(self) -> SessionStats:
        return self._stats

    def _record(self, cost: CostInfo) -> None:
        self._stats.record(cost)
        if self._on_cost:
            self._on_cost(cost)

    def session(self, session_id: str | None = None) -> AsyncLLMKit:
        """Create a new client with a fresh session ID. No shared state."""
        sid = session_id or str(uuid.uuid4())
        return AsyncLLMKit(
            api_key=self.openai.api_key,
            base_url=self._base_url,
            provider_key=self._provider_key,
            provider=self._provider,
            fallback=self._fallback,
            on_cost=self._on_cost,
            session_id=sid,
        )

    async def chat(self, **kwargs: Any) -> tuple[ChatCompletion, CostInfo]:
        """Async chat completion with cost extraction."""
        raw = await self.openai.chat.completions.with_raw_response.create(**kwargs)
        cost = CostInfo.from_headers(raw.headers)
        if cost.total_cost is None:
            parsed = raw.parse()
            cost = _cost_from_usage(parsed.model, parsed.usage)
            self._record(cost)
            return parsed, cost
        completion = raw.parse()
        self._record(cost)
        return completion, cost

    async def chat_stream(self, **kwargs: Any) -> AsyncCostStream:
        """Async streaming chat with cost tracking."""
        kwargs["stream"] = True
        kwargs.setdefault("stream_options", {"include_usage": True})
        stream = await self.openai.chat.completions.create(**kwargs)
        return AsyncCostStream(stream, self._record)

    async def __aenter__(self) -> AsyncLLMKit:
        return self

    async def __aexit__(self, *args: Any) -> None:
        pass


class AsyncCostStream:
    """Async wrapper that captures usage from the final chunk."""

    def __init__(
        self,
        stream: AsyncIterator[ChatCompletionChunk],
        on_done: Callable[[CostInfo], Any],
    ) -> None:
        self._stream = stream
        self._on_done = on_done
        self._model: str | None = None
        self._usage: Any = None
        self._cost: CostInfo | None = None

    async def __aiter__(self) -> AsyncIterator[ChatCompletionChunk]:
        async for chunk in self._stream:
            if chunk.model:
                self._model = chunk.model
            if chunk.usage:
                self._usage = chunk.usage
            yield chunk

        cost = _cost_from_usage(self._model, self._usage)
        self._cost = cost
        self._on_done(cost)

    @property
    def cost(self) -> CostInfo | None:
        """Available after stream is fully consumed."""
        return self._cost
