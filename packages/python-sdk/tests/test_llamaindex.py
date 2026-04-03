"""Tests for LlamaIndex callback handler (mocked, no llama-index-core required)."""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

# Mock llama_index.core before importing the handler
mock_base = MagicMock()
mock_schema = MagicMock()

CBEventType = SimpleNamespace(LLM="llm", EMBEDDING="embedding", QUERY="query")
EventPayload = SimpleNamespace(RESPONSE="response")

mock_schema.CBEventType = CBEventType
mock_schema.EventPayload = EventPayload

sys.modules["llama_index"] = MagicMock()
sys.modules["llama_index.core"] = MagicMock()
sys.modules["llama_index.core.callbacks"] = MagicMock()
sys.modules["llama_index.core.callbacks.base_handler"] = mock_base
sys.modules["llama_index.core.callbacks.schema"] = mock_schema

mock_base.BaseCallbackHandler = object

from llmkit.integrations.llamaindex import LLMKitCallbackHandler  # noqa: E402


def _make_response(model: str, prompt_tokens: int, completion_tokens: int):
    usage = SimpleNamespace(
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
    )
    raw = SimpleNamespace(usage=usage, model=model)
    return SimpleNamespace(raw=raw)


def test_basic_cost_tracking():
    handler = LLMKitCallbackHandler()
    resp = _make_response("gpt-4.1-mini", 100, 50)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert handler.request_count == 1
    assert handler.prompt_tokens == 100
    assert handler.completion_tokens == 50
    assert handler.total_tokens == 150
    assert handler.total_cost > 0


def test_accumulation():
    handler = LLMKitCallbackHandler()
    for _ in range(3):
        resp = _make_response("gpt-4.1-mini", 100, 50)
        handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert handler.request_count == 3
    assert handler.total_tokens == 450


def test_on_cost_callback():
    costs = []
    handler = LLMKitCallbackHandler(on_cost=costs.append)
    resp = _make_response("gpt-4.1-mini", 100, 50)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert len(costs) == 1
    assert costs[0] > 0


def test_ignores_non_llm_events():
    handler = LLMKitCallbackHandler()
    resp = _make_response("gpt-4.1-mini", 100, 50)
    handler.on_event_end(CBEventType.EMBEDDING, {EventPayload.RESPONSE: resp})

    assert handler.request_count == 0


def test_ignores_no_usage():
    handler = LLMKitCallbackHandler()
    raw = SimpleNamespace(usage=None, model="gpt-4.1-mini")
    resp = SimpleNamespace(raw=raw)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert handler.request_count == 0


def test_ignores_zero_tokens():
    handler = LLMKitCallbackHandler()
    resp = _make_response("gpt-4.1-mini", 0, 0)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert handler.request_count == 0


def test_unknown_model():
    handler = LLMKitCallbackHandler()
    resp = _make_response("unknown-model-xyz", 100, 50)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert handler.request_count == 1
    assert handler.total_tokens == 150


def test_last_cost():
    handler = LLMKitCallbackHandler()
    assert handler.last_cost is None

    resp = _make_response("gpt-4.1-mini", 100, 50)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    assert handler.last_cost is not None


def test_repr():
    handler = LLMKitCallbackHandler()
    resp = _make_response("gpt-4.1-mini", 100, 50)
    handler.on_event_end(CBEventType.LLM, {EventPayload.RESPONSE: resp})

    r = repr(handler)
    assert "requests=1" in r
    assert "cost=$" in r
