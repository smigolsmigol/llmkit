"""Tests for tracked() httpx transport cost extraction."""

import json

import httpx

from llmkit import CostInfo, tracked, tracked_async
from llmkit._transport import (
    CostTrackingTransport,
    _SSEScanner,
    _extract_cost_from_json,
    _is_chat_endpoint,
)


# --- pure function tests ---


def test_is_chat_endpoint_openai():
    assert _is_chat_endpoint("/v1/chat/completions") is True


def test_is_chat_endpoint_anthropic():
    assert _is_chat_endpoint("/v1/messages") is True


def test_is_chat_endpoint_non_llm():
    assert _is_chat_endpoint("/v1/embeddings") is False
    assert _is_chat_endpoint("/v1/messages/list") is False
    assert _is_chat_endpoint("/health") is False


def test_extract_cost_openai_format():
    body = json.dumps(
        {
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 1000, "completion_tokens": 500},
        }
    ).encode()
    cost = _extract_cost_from_json(body)
    assert cost is not None
    assert cost.estimated is True
    expected = (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0
    assert abs(cost.total_cost - expected) < 1e-10


def test_extract_cost_anthropic_format():
    body = json.dumps(
        {
            "model": "claude-sonnet-4-6",
            "usage": {"input_tokens": 200, "output_tokens": 100},
        }
    ).encode()
    cost = _extract_cost_from_json(body)
    assert cost is not None
    expected = (200 / 1_000_000) * 3.0 + (100 / 1_000_000) * 15.0
    assert abs(cost.total_cost - expected) < 1e-10


def test_extract_cost_no_usage():
    body = json.dumps({"model": "gpt-4o"}).encode()
    assert _extract_cost_from_json(body) is None


def test_extract_cost_no_model():
    body = json.dumps({"usage": {"prompt_tokens": 10}}).encode()
    assert _extract_cost_from_json(body) is None


def test_extract_cost_malformed_json():
    assert _extract_cost_from_json(b"not json") is None


def test_extract_cost_unknown_model():
    body = json.dumps(
        {
            "model": "unknown-model-xyz",
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }
    ).encode()
    cost = _extract_cost_from_json(body)
    assert cost is not None
    assert cost.total_cost is None


# --- SSE scanner tests ---


def test_scanner_openai_stream():
    scanner = _SSEScanner()
    chunks = [
        b'data: {"id":"c1","model":"gpt-4o","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        b'data: {"id":"c1","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
        b"data: [DONE]\n\n",
    ]
    for chunk in chunks:
        scanner.feed(chunk)
    cost = scanner.result()
    assert cost is not None
    assert cost.estimated is True
    expected = (10 / 1_000_000) * 2.5 + (5 / 1_000_000) * 10.0
    assert abs(cost.total_cost - expected) < 1e-10


def test_scanner_anthropic_stream():
    scanner = _SSEScanner()
    chunks = [
        b'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":50}}}\n\n',
        b'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        b'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}\n\n',
    ]
    for chunk in chunks:
        scanner.feed(chunk)
    cost = scanner.result()
    assert cost is not None
    expected = (50 / 1_000_000) * 3.0 + (20 / 1_000_000) * 15.0
    assert abs(cost.total_cost - expected) < 1e-10


def test_scanner_no_usage():
    scanner = _SSEScanner()
    scanner.feed(b'data: {"model":"gpt-4o","choices":[{"delta":{"content":"hi"}}]}\n\n')
    scanner.feed(b"data: [DONE]\n\n")
    assert scanner.result() is None


def test_scanner_split_across_chunks():
    """SSE line split across two byte chunks."""
    scanner = _SSEScanner()
    full = b'data: {"model":"gpt-4o","usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'
    mid = len(full) // 2
    scanner.feed(full[:mid])
    scanner.feed(full[mid:])
    cost = scanner.result()
    assert cost is not None
    assert cost.total_cost is not None


def test_scanner_ignores_non_data_lines():
    scanner = _SSEScanner()
    scanner.feed(b"event: message_start\n")
    scanner.feed(
        b'data: {"model":"gpt-4o","usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n'
    )
    cost = scanner.result()
    assert cost is not None


# --- mock transport for integration tests ---


class _MockTransport(httpx.BaseTransport):
    """Returns canned responses for testing."""

    def __init__(self, response: httpx.Response) -> None:
        self._response = response

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return self._response


class _MockStream:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    def __iter__(self):
        yield from self._chunks

    def close(self):
        pass


def _make_json_response(
    body: dict, path: str = "/v1/chat/completions"
) -> tuple[httpx.Response, httpx.Request]:
    content = json.dumps(body).encode()
    request = httpx.Request("POST", f"https://api.openai.com{path}")
    response = httpx.Response(200, content=content, request=request)
    return response, request


# --- transport integration tests ---


def test_transport_non_streaming():
    body = {
        "model": "gpt-4o",
        "choices": [{"message": {"content": "Hi"}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }
    response, request = _make_json_response(body)

    costs: list[CostInfo] = []
    transport = CostTrackingTransport(
        _MockTransport(response),
        on_cost=costs.append,
    )
    result = transport.handle_request(request)
    assert result.status_code == 200
    assert len(costs) == 1
    assert costs[0].estimated is True
    assert costs[0].total_cost is not None
    assert costs[0].total_cost > 0


def test_transport_streaming():
    chunks = [
        b'data: {"id":"c1","model":"gpt-4o","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        b'data: {"id":"c1","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":10}}\n\n',
        b"data: [DONE]\n\n",
    ]
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        stream=_MockStream(chunks),
        request=request,
    )

    costs: list[CostInfo] = []
    transport = CostTrackingTransport(
        _MockTransport(response),
        on_cost=costs.append,
    )
    result = transport.handle_request(request)

    # consume the stream
    collected = list(result.stream)
    assert len(collected) == 3
    assert len(costs) == 1
    expected = (20 / 1_000_000) * 2.5 + (10 / 1_000_000) * 10.0
    assert abs(costs[0].total_cost - expected) < 1e-10


def test_transport_skips_errors():
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(429, content=b'{"error":"rate limited"}', request=request)

    costs: list[CostInfo] = []
    transport = CostTrackingTransport(
        _MockTransport(response),
        on_cost=costs.append,
    )
    result = transport.handle_request(request)
    assert result.status_code == 429
    assert len(costs) == 0


def test_transport_skips_non_chat_endpoints():
    body = {"data": [{"embedding": [0.1, 0.2]}]}
    response, request = _make_json_response(body, path="/v1/embeddings")

    costs: list[CostInfo] = []
    transport = CostTrackingTransport(
        _MockTransport(response),
        on_cost=costs.append,
    )
    transport.handle_request(request)
    assert len(costs) == 0


def test_transport_no_callback():
    """Works without on_cost callback (no crash)."""
    body = {
        "model": "gpt-4o",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }
    response, request = _make_json_response(body)
    transport = CostTrackingTransport(_MockTransport(response))
    result = transport.handle_request(request)
    assert result.status_code == 200


# --- tracked() factory tests ---


def test_tracked_returns_httpx_client():
    client = tracked()
    assert isinstance(client, httpx.Client)
    client.close()


def test_tracked_async_returns_async_client():
    client = tracked_async()
    assert isinstance(client, httpx.AsyncClient)


def test_tracked_accepts_on_cost():
    costs = []
    client = tracked(on_cost=costs.append)
    assert isinstance(client, httpx.Client)
    client.close()


# --- anthropic non-streaming ---


def test_transport_anthropic_non_streaming():
    body = {
        "model": "claude-sonnet-4-6",
        "content": [{"text": "Hello"}],
        "usage": {"input_tokens": 300, "output_tokens": 150},
    }
    content = json.dumps(body).encode()
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(200, content=content, request=request)

    costs: list[CostInfo] = []
    transport = CostTrackingTransport(
        _MockTransport(response),
        on_cost=costs.append,
    )
    transport.handle_request(request)
    assert len(costs) == 1
    expected = (300 / 1_000_000) * 3.0 + (150 / 1_000_000) * 15.0
    assert abs(costs[0].total_cost - expected) < 1e-10
