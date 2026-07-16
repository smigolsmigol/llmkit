from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

import httpx

from ._pricing import calculate_cost
from ._types import CostInfo


def _token_count(value: Any) -> int:
    """Return a safe provider token count for untrusted response data."""
    return value if type(value) is int and value >= 0 else 0


def _optional_token_count(value: Any) -> int | None:
    """Preserve the distinction between an absent and zero provider count."""
    return value if type(value) is int and value >= 0 else None


def _extract_cost_from_json(body: bytes) -> CostInfo | None:
    """Extract cost from a non-streaming LLM API response body."""
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None

    if not isinstance(data, dict):
        return None

    model = data.get("model")
    usage = data.get("usage")
    if not isinstance(model, str) or not model or not isinstance(usage, dict):
        return None

    output_t = _token_count(usage.get("completion_tokens"))
    if output_t == 0:
        output_t = _token_count(usage.get("output_tokens"))
    cache_write = _token_count(usage.get("cache_creation_input_tokens"))

    # OpenAI: prompt_tokens includes cached_tokens as subset
    # Anthropic: input_tokens is separate from cache_read_input_tokens
    prompt_details = usage.get("prompt_tokens_details")
    openai_cached = (
        _token_count(prompt_details.get("cached_tokens")) if isinstance(prompt_details, dict) else 0
    )
    anthropic_cached = _token_count(usage.get("cache_read_input_tokens"))

    prompt_tokens = _optional_token_count(usage.get("prompt_tokens"))
    if prompt_tokens is not None:
        cache_read = openai_cached
        input_t = max(prompt_tokens - cache_read, 0)
    else:
        input_t = _token_count(usage.get("input_tokens"))
        cache_read = anthropic_cached

    total = calculate_cost(model, input_t, output_t, cache_read, cache_write)
    return CostInfo(total_cost=total, estimated=True)


def _is_chat_endpoint(path: str) -> bool:
    return path.endswith(("/chat/completions", "/messages"))


def _is_sse(response: httpx.Response) -> bool:
    return "text/event-stream" in response.headers.get("content-type", "")


class _SSEScanner:
    """Scans SSE byte chunks for model and usage data. O(1) memory."""

    def __init__(self) -> None:
        self.model: str | None = None
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.cache_read_tokens: int = 0
        self.cache_write_tokens: int = 0
        self.has_usage: bool = False
        self._partial: str = ""

    def feed(self, chunk: bytes) -> None:
        text = self._partial + chunk.decode("utf-8", errors="replace")
        lines = text.split("\n")
        self._partial = lines[-1]

        for line in lines[:-1]:
            if not line.startswith("data: "):
                continue
            payload = line[6:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            model = data.get("model")
            if isinstance(model, str) and model:
                self.model = model

            # anthropic: model inside message object
            message = data.get("message")
            msg = message if isinstance(message, dict) else {}
            message_model = msg.get("model")
            if isinstance(message_model, str) and message_model:
                self.model = message_model

            # openai: usage in final chunk (prompt_tokens includes cached_tokens)
            usage = data.get("usage")
            if isinstance(usage, dict):
                self.has_usage = True
                prompt_details = usage.get("prompt_tokens_details")
                cached = (
                    _token_count(prompt_details.get("cached_tokens"))
                    if isinstance(prompt_details, dict)
                    else 0
                )
                prompt_tokens = _optional_token_count(usage.get("prompt_tokens"))
                raw_input = (
                    prompt_tokens
                    if prompt_tokens is not None
                    else _token_count(usage.get("input_tokens"))
                )
                self.input_tokens += max(raw_input - cached, 0)
                output_tokens = _token_count(usage.get("completion_tokens"))
                if output_tokens == 0:
                    output_tokens = _token_count(usage.get("output_tokens"))
                self.output_tokens += output_tokens
                self.cache_read_tokens += cached

            # anthropic: usage split across message_start and message_delta
            msg_usage = msg.get("usage") if isinstance(msg, dict) else None
            if isinstance(msg_usage, dict):
                self.has_usage = True
                self.input_tokens += _token_count(msg_usage.get("input_tokens"))
                self.output_tokens += _token_count(msg_usage.get("output_tokens"))
                self.cache_read_tokens += _token_count(msg_usage.get("cache_read_input_tokens"))
                self.cache_write_tokens += _token_count(
                    msg_usage.get("cache_creation_input_tokens")
                )

    def result(self) -> CostInfo | None:
        if not self.model or not self.has_usage:
            return None
        total = calculate_cost(
            self.model,
            self.input_tokens,
            self.output_tokens,
            self.cache_read_tokens,
            self.cache_write_tokens,
        )
        return CostInfo(total_cost=total, estimated=True)


class _CostCapturingStream(httpx.SyncByteStream):
    """Wraps a sync byte stream, scans for usage, reports cost when done."""

    def __init__(self, stream: Any, callback: Callable[[CostInfo], Any] | None) -> None:
        self._stream = stream
        self._callback = callback
        self._scanner = _SSEScanner()

    def __iter__(self) -> Iterator[bytes]:
        for chunk in self._stream:
            self._scanner.feed(chunk)
            yield chunk
        cost = self._scanner.result()
        if cost and self._callback:
            self._callback(cost)

    def close(self) -> None:
        self._stream.close()


class _AsyncCostCapturingStream(httpx.AsyncByteStream):
    """Wraps an async byte stream, scans for usage, reports cost when done."""

    def __init__(self, stream: Any, callback: Callable[[CostInfo], Any] | None) -> None:
        self._stream = stream
        self._callback = callback
        self._scanner = _SSEScanner()

    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for chunk in self._stream:
            self._scanner.feed(chunk)
            yield chunk
        cost = self._scanner.result()
        if cost and self._callback:
            self._callback(cost)

    async def aclose(self) -> None:
        await self._stream.aclose()


class CostTrackingTransport(httpx.BaseTransport):
    """httpx transport that extracts LLM API costs from responses.

    Wraps any BaseTransport (defaults to HTTPTransport). For non-streaming
    responses, parses the JSON body. For streaming (SSE), scans chunks
    as they pass through with O(1) memory overhead.

    Works with OpenAI, Anthropic, Groq, Together, Cohere, Mistral SDKs.
    """

    def __init__(
        self,
        transport: httpx.BaseTransport | None = None,
        *,
        on_cost: Callable[[CostInfo], Any] | None = None,
    ) -> None:
        self._transport = transport or httpx.HTTPTransport()
        self._on_cost = on_cost

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._transport.handle_request(request)

        if response.status_code >= 400 or not _is_chat_endpoint(str(request.url.path)):
            return response

        if _is_sse(response):
            response.stream = _CostCapturingStream(response.stream, self._on_cost)
            return response

        # non-streaming: read body (stays cached), extract cost
        response.read()
        cost = _extract_cost_from_json(response.content)
        if cost and self._on_cost:
            self._on_cost(cost)
        return response

    def close(self) -> None:
        self._transport.close()


class AsyncCostTrackingTransport(httpx.AsyncBaseTransport):
    """Async variant of CostTrackingTransport."""

    def __init__(
        self,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        on_cost: Callable[[CostInfo], Any] | None = None,
    ) -> None:
        self._transport = transport or httpx.AsyncHTTPTransport()
        self._on_cost = on_cost

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._transport.handle_async_request(request)

        if response.status_code >= 400 or not _is_chat_endpoint(str(request.url.path)):
            return response

        if _is_sse(response):
            response.stream = _AsyncCostCapturingStream(response.stream, self._on_cost)
            return response

        await response.aread()
        cost = _extract_cost_from_json(response.content)
        if cost and self._on_cost:
            self._on_cost(cost)
        return response

    async def aclose(self) -> None:
        await self._transport.aclose()


def tracked(
    *,
    on_cost: Callable[[CostInfo], Any] | None = None,
    **kwargs: Any,
) -> httpx.Client:
    """Create an httpx.Client with transparent LLM cost tracking.

    Works with any SDK that accepts an http_client parameter:

        from openai import OpenAI
        from llmkit import tracked

        costs = []
        client = OpenAI(http_client=tracked(on_cost=costs.append))
        client.chat.completions.create(model="gpt-4o", messages=[...])
        print(costs[-1].total_cost)

    Extracts token usage from API responses (both streaming and
    non-streaming) and calculates cost from the bundled pricing table.
    No proxy required. Works with OpenAI, Anthropic, Groq, Together,
    Cohere, and Mistral SDKs.
    """
    transport = CostTrackingTransport(on_cost=on_cost)
    return httpx.Client(transport=transport, **kwargs)


def tracked_async(
    *,
    on_cost: Callable[[CostInfo], Any] | None = None,
    **kwargs: Any,
) -> httpx.AsyncClient:
    """Async variant of tracked(). Use with AsyncOpenAI, AsyncAnthropic, etc."""
    transport = AsyncCostTrackingTransport(on_cost=on_cost)
    return httpx.AsyncClient(transport=transport, **kwargs)
