"""Tests for the LangChain callback handler (mocked, no langchain-core required)."""

from __future__ import annotations

import sys
from unittest.mock import MagicMock
from uuid import uuid4

# Mock langchain_core before importing the handler
mock_callbacks = MagicMock()
mock_outputs = MagicMock()


class FakeGeneration:
    def __init__(self, text="hello"):
        self.text = text


class FakeChatGeneration(FakeGeneration):
    def __init__(self, text="hello", message=None):
        super().__init__(text)
        self.message = message


class FakeLLMResult:
    def __init__(self, generations=None, llm_output=None):
        self.generations = generations or [[FakeGeneration()]]
        self.llm_output = llm_output


class FakeAIMessage:
    def __init__(self, content="hello", usage_metadata=None, response_metadata=None):
        self.content = content
        self.usage_metadata = usage_metadata or {}
        self.response_metadata = response_metadata or {}


mock_callbacks.BaseCallbackHandler = object
mock_outputs.LLMResult = FakeLLMResult

sys.modules["langchain_core"] = MagicMock()
sys.modules["langchain_core.callbacks"] = mock_callbacks
sys.modules["langchain_core.outputs"] = mock_outputs

from llmkit.integrations.langchain import LLMKitCallbackHandler  # noqa: E402


RUN_ID = uuid4()


def _make_llm_result(model="gpt-4.1-mini", prompt_tokens=100, completion_tokens=50):
    return FakeLLMResult(
        generations=[[FakeGeneration()]],
        llm_output={
            "token_usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            "model_name": model,
        },
    )


def _make_chat_result(model="gpt-4.1-mini", input_tokens=100, output_tokens=50):
    msg = FakeAIMessage(
        usage_metadata={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        },
        response_metadata={"model_name": model},
    )
    gen = FakeChatGeneration(message=msg)
    return FakeLLMResult(generations=[[gen]], llm_output={})


def test_single_llm_request():
    handler = LLMKitCallbackHandler()
    handler.on_llm_end(_make_llm_result(), run_id=RUN_ID)

    assert handler.request_count == 1
    assert handler.prompt_tokens == 100
    assert handler.completion_tokens == 50
    assert handler.total_tokens == 150
    assert handler.total_cost > 0


def test_cost_accumulation():
    handler = LLMKitCallbackHandler()
    for _ in range(3):
        handler.on_llm_end(_make_llm_result(), run_id=RUN_ID)

    assert handler.request_count == 3
    assert handler.total_tokens == 450
    assert handler.total_cost > 0


def test_on_cost_callback_fires():
    costs = []
    handler = LLMKitCallbackHandler(on_cost=costs.append)
    handler.on_llm_end(_make_llm_result(), run_id=RUN_ID)

    assert len(costs) == 1
    assert costs[0].total_cost is not None


def test_on_cost_fires_per_request():
    events = []
    handler = LLMKitCallbackHandler(on_cost=events.append)
    for _ in range(3):
        handler.on_llm_end(_make_llm_result(), run_id=uuid4())

    assert len(events) == 3


def test_chat_model_path():
    handler = LLMKitCallbackHandler()
    result = _make_chat_result(
        model="claude-sonnet-4-6", input_tokens=200, output_tokens=80
    )

    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 1
    assert handler.prompt_tokens == 200
    assert handler.completion_tokens == 80
    assert handler.total_tokens == 280


def test_unknown_model_records_tokens_but_no_cost():
    handler = LLMKitCallbackHandler()
    result = _make_llm_result(
        model="totally-unknown-xyz", prompt_tokens=100, completion_tokens=50
    )

    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 1
    assert handler.total_tokens == 150
    assert handler.total_cost == 0.0


def test_no_token_usage_is_ignored():
    handler = LLMKitCallbackHandler()
    result = FakeLLMResult(generations=[[FakeGeneration()]], llm_output={})
    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 0


def test_last_cost_property():
    handler = LLMKitCallbackHandler()
    assert handler.last_cost is None

    handler.on_llm_end(_make_llm_result(), run_id=RUN_ID)
    assert handler.last_cost is not None


def test_repr():
    handler = LLMKitCallbackHandler()
    handler.on_llm_end(_make_llm_result(), run_id=RUN_ID)
    r = repr(handler)
    assert "requests=1" in r
    assert "cost=$" in r
