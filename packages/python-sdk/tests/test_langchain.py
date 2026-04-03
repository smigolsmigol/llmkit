"""Tests for the LangChain callback handler."""

from __future__ import annotations

from uuid import uuid4

from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, Generation, LLMResult

from llmkit.integrations.langchain import LLMKitCallbackHandler


RUN_ID = uuid4()


def _make_llm_result(
    *,
    model: str = "gpt-4o",
    prompt_tokens: int = 100,
    completion_tokens: int = 50,
    text: str = "hello",
) -> LLMResult:
    """Build an LLMResult with llm_output token_usage (OpenAI-style LLM path)."""
    return LLMResult(
        generations=[[Generation(text=text)]],
        llm_output={
            "token_usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            "model_name": model,
        },
    )


def _make_chat_result(
    *,
    model: str = "claude-sonnet-4-6",
    input_tokens: int = 200,
    output_tokens: int = 80,
) -> LLMResult:
    """Build an LLMResult from ChatGeneration (chat model path)."""
    msg = AIMessage(
        content="response text",
        usage_metadata={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
        response_metadata={"model_name": model},
    )
    return LLMResult(
        generations=[[ChatGeneration(message=msg)]],
    )


def test_single_llm_request():
    handler = LLMKitCallbackHandler()
    result = _make_llm_result(model="gpt-4o", prompt_tokens=1000, completion_tokens=500)

    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 1
    assert handler.prompt_tokens == 1000
    assert handler.completion_tokens == 500
    assert handler.total_tokens == 1500
    assert handler.total_cost > 0


def test_cost_accumulation():
    handler = LLMKitCallbackHandler()

    handler.on_llm_end(
        _make_llm_result(prompt_tokens=1000, completion_tokens=500),
        run_id=RUN_ID,
    )
    cost_after_first = handler.total_cost

    handler.on_llm_end(
        _make_llm_result(prompt_tokens=2000, completion_tokens=1000),
        run_id=uuid4(),
    )

    assert handler.request_count == 2
    assert handler.total_tokens == 1500 + 3000
    assert handler.total_cost > cost_after_first


def test_on_cost_callback_fires():
    events: list = []
    handler = LLMKitCallbackHandler(on_cost=events.append)

    handler.on_llm_end(
        _make_llm_result(prompt_tokens=500, completion_tokens=200),
        run_id=RUN_ID,
    )

    assert len(events) == 1
    cost_info = events[0]
    assert cost_info.total_cost is not None
    assert cost_info.total_cost > 0
    assert cost_info.estimated is True


def test_on_cost_fires_per_request():
    events: list = []
    handler = LLMKitCallbackHandler(on_cost=events.append)

    for _ in range(3):
        handler.on_llm_end(_make_llm_result(), run_id=uuid4())

    assert len(events) == 3


def test_chat_model_path():
    handler = LLMKitCallbackHandler()
    result = _make_chat_result(model="claude-sonnet-4-6", input_tokens=200, output_tokens=80)

    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 1
    assert handler.prompt_tokens == 200
    assert handler.completion_tokens == 80
    assert handler.total_tokens == 280
    assert handler.total_cost > 0


def test_unknown_model_records_tokens_but_no_cost():
    handler = LLMKitCallbackHandler()
    result = _make_llm_result(model="totally-unknown-xyz", prompt_tokens=100, completion_tokens=50)

    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 1
    assert handler.total_tokens == 150
    assert handler.total_cost == 0.0
    assert handler.last_cost is not None
    assert handler.last_cost.total_cost is None


def test_no_token_usage_is_ignored():
    handler = LLMKitCallbackHandler()
    result = LLMResult(generations=[[Generation(text="hi")]])

    handler.on_llm_end(result, run_id=RUN_ID)

    assert handler.request_count == 0
    assert handler.total_tokens == 0


def test_last_cost_property():
    handler = LLMKitCallbackHandler()
    assert handler.last_cost is None

    handler.on_llm_end(_make_llm_result(), run_id=RUN_ID)
    assert handler.last_cost is not None
    assert handler.last_cost.estimated is True


def test_repr():
    handler = LLMKitCallbackHandler()
    handler.on_llm_end(
        _make_llm_result(prompt_tokens=100, completion_tokens=50),
        run_id=RUN_ID,
    )
    r = repr(handler)
    assert "requests=1" in r
    assert "cost=$" in r
    assert "tokens=150" in r


def test_cost_calculation_matches_pricing():
    """Verify cost matches calculate_cost for a known model."""
    from llmkit._pricing import calculate_cost

    handler = LLMKitCallbackHandler()
    handler.on_llm_end(
        _make_llm_result(model="gpt-4o", prompt_tokens=10000, completion_tokens=5000),
        run_id=RUN_ID,
    )

    expected = calculate_cost("gpt-4o", 10000, 5000)
    assert expected is not None
    assert abs(handler.total_cost - expected) < 1e-10


def test_cache_tokens_from_llm_output():
    """llm_output with cache token fields should be passed to calculate_cost."""
    handler = LLMKitCallbackHandler()
    result = LLMResult(
        generations=[[Generation(text="cached")]],
        llm_output={
            "token_usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 500,
                "cache_read_input_tokens": 200,
                "cache_creation_input_tokens": 100,
            },
            "model_name": "claude-opus-4-6",
        },
    )

    handler.on_llm_end(result, run_id=RUN_ID)

    from llmkit._pricing import calculate_cost

    expected = calculate_cost("claude-opus-4-6", 1000, 500, 200, 100)
    assert expected is not None
    assert abs(handler.total_cost - expected) < 1e-10
