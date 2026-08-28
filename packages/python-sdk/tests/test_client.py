"""Tests for LLMKit client construction, sessions, env vars, callbacks."""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from llmkit import AsyncLLMKit, CostInfo, LLMKit
from llmkit._client import _cost_from_usage, estimate_cost


def _usage(**overrides):
    values = {
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "prompt_tokens_details": None,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _sync_openai(raw_or_stream):
    create = MagicMock(return_value=raw_or_stream)
    completions = SimpleNamespace(
        create=create,
        with_raw_response=SimpleNamespace(create=create),
    )
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), create


def _async_openai(raw_or_stream):
    create = AsyncMock(return_value=raw_or_stream)
    completions = SimpleNamespace(
        create=create,
        with_raw_response=SimpleNamespace(create=create),
    )
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), create


def test_client_sets_base_url():
    with patch("llmkit._client.OpenAI") as mock_openai:
        LLMKit(api_key="llmk_test")
        kw = mock_openai.call_args.kwargs
        assert kw["base_url"] == "https://api.llmkit.sh/v1"
        assert kw["api_key"] == "llmk_test"


def test_client_custom_base_url():
    with patch("llmkit._client.OpenAI") as mock_openai:
        LLMKit(api_key="llmk_test", base_url="http://localhost:8787/v1")
        assert mock_openai.call_args.kwargs["base_url"] == "http://localhost:8787/v1"


def test_client_env_var_api_key():
    with (
        patch("llmkit._client.OpenAI"),
        patch.dict(os.environ, {"LLMKIT_API_KEY": "llmk_from_env"}),
    ):
        LLMKit()  # should not raise, resolved from env


def test_client_env_var_base_url():
    with (
        patch("llmkit._client.OpenAI") as mock_openai,
        patch.dict(os.environ, {"LLMKIT_BASE_URL": "http://custom:8787/v1"}),
    ):
        LLMKit(api_key="llmk_test")
        assert mock_openai.call_args.kwargs["base_url"] == "http://custom:8787/v1"


def test_client_missing_key_raises():
    with (
        patch.dict(os.environ, {}, clear=True),
        pytest.raises(ValueError, match="LLMKIT_API_KEY"),
    ):
        LLMKit()


def test_client_headers():
    with patch("llmkit._client.OpenAI") as mock_openai:
        LLMKit(
            api_key="llmk_test",
            provider_key="sk-abc",
            provider="anthropic",
            customer_id="tenant-1",
            workflow_id="release-review",
            agent_id="reviewer",
            session_id="sess-1",
            end_user_id="user@example.com",
            fallback="openai",
        )
        headers = mock_openai.call_args.kwargs["default_headers"]
        assert headers["x-llmkit-provider-key"] == "sk-abc"
        assert headers["x-llmkit-provider"] == "anthropic"
        assert headers["x-llmkit-customer-id"] == "tenant-1"
        assert headers["x-llmkit-workflow-id"] == "release-review"
        assert headers["x-llmkit-agent-id"] == "reviewer"
        assert headers["x-llmkit-session-id"] == "sess-1"
        assert headers["x-llmkit-user-id"] == "user@example.com"
        assert headers["x-llmkit-fallback"] == "openai"


def test_client_no_optional_headers():
    with patch("llmkit._client.OpenAI") as mock_openai:
        LLMKit(api_key="llmk_test")
        headers = mock_openai.call_args.kwargs["default_headers"]
        assert headers == {}


def test_session_creates_new_client():
    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test")
        child = client.session("my-session")
        assert child.session_id == "my-session"
        assert child is not client
        assert child.stats is not client.stats


def test_session_auto_generates_id():
    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test")
        child = client.session()
        assert child.session_id is not None
        assert len(child.session_id) == 36


def test_session_inherits_config():
    with patch("llmkit._client.OpenAI") as mock_openai:
        client = LLMKit(
            api_key="llmk_test",
            provider_key="sk-abc",
            provider="anthropic",
            customer_id="tenant-1",
            workflow_id="release-review",
            agent_id="reviewer",
            end_user_id="user@example.com",
            fallback="openai",
        )
        client.session("s1")
        child_headers = mock_openai.call_args.kwargs["default_headers"]
        assert child_headers["x-llmkit-provider-key"] == "sk-abc"
        assert child_headers["x-llmkit-provider"] == "anthropic"
        assert child_headers["x-llmkit-customer-id"] == "tenant-1"
        assert child_headers["x-llmkit-workflow-id"] == "release-review"
        assert child_headers["x-llmkit-agent-id"] == "reviewer"
        assert child_headers["x-llmkit-user-id"] == "user@example.com"
        assert child_headers["x-llmkit-fallback"] == "openai"
        assert child_headers["x-llmkit-session-id"] == "s1"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("session_id", "contains spaces", "invalid session ID"),
        ("customer_id", "../tenant", "invalid customer ID"),
        ("workflow_id", " release-review", "invalid workflow ID"),
        ("end_user_id", "user/segment", "invalid end user ID"),
    ],
)
def test_client_rejects_invalid_attribution(field, value, message):
    with patch("llmkit._client.OpenAI"), pytest.raises(ValueError, match=message):
        LLMKit(api_key="llmk_test", **{field: value})


def test_on_cost_callback():
    costs_received = []
    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test", on_cost=costs_received.append)
        cost = CostInfo(total_cost=0.05, provider="openai")
        client._record(cost)
        assert len(costs_received) == 1
        assert costs_received[0].total_cost == 0.05


def test_on_cost_inherited_by_session():
    costs_received = []
    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test", on_cost=costs_received.append)
        child = client.session("s1")
        child._record(CostInfo(total_cost=0.01))
        assert len(costs_received) == 1


def test_context_manager():
    with patch("llmkit._client.OpenAI"), LLMKit(api_key="llmk_test") as client:
        assert client is not None
        assert hasattr(client, "chat")


def test_async_client_sets_base_url():
    with patch("llmkit._client.AsyncOpenAI") as mock_openai:
        AsyncLLMKit(api_key="llmk_test")
        assert mock_openai.call_args.kwargs["base_url"] == "https://api.llmkit.sh/v1"


def test_async_session():
    with patch("llmkit._client.AsyncOpenAI"):
        client = AsyncLLMKit(api_key="llmk_test")
        child = client.session("async-sess")
        assert child.session_id == "async-sess"
        assert isinstance(child, AsyncLLMKit)


def test_cost_estimation_boundaries():
    assert _cost_from_usage(None, _usage()) == CostInfo()
    assert _cost_from_usage("gpt-4o", None) == CostInfo()
    assert estimate_cost(SimpleNamespace(model="gpt-4o", usage=None)) == CostInfo()

    usage = _usage(
        prompt_tokens_details=SimpleNamespace(cached_tokens=20),
        cache_read_input_tokens=5,
        cache_creation_input_tokens=2,
    )
    cost = estimate_cost(SimpleNamespace(model="gpt-4o", usage=usage))
    assert cost.estimated is True
    assert cost.total_cost is not None
    assert cost.total_cost > 0


def test_chat_prefers_exact_proxy_headers():
    parsed = SimpleNamespace(model="gpt-4o", usage=_usage())
    raw = MagicMock(
        headers={
            "x-llmkit-cost": "0.125",
            "x-llmkit-provider": "openai",
            "x-llmkit-session-id": "session-1",
        }
    )
    raw.parse.return_value = parsed

    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test")
    client.openai, create = _sync_openai(raw)

    completion, cost = client.chat(model="gpt-4o", messages=[])

    assert completion is parsed
    assert cost.total_cost == 0.125
    assert cost.estimated is False
    assert client.stats.request_count == 1
    create.assert_called_once_with(model="gpt-4o", messages=[])


def test_chat_falls_back_to_usage_estimate():
    parsed = SimpleNamespace(model="gpt-4o", usage=_usage())
    raw = MagicMock(headers={})
    raw.parse.return_value = parsed

    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test")
    client.openai, _ = _sync_openai(raw)

    completion, cost = client.chat(model="gpt-4o", messages=[])

    assert completion is parsed
    assert cost.total_cost is not None
    assert cost.estimated is True
    assert client.stats.total_cost == cost.total_cost


def test_chat_stream_records_final_usage_and_preserves_options():
    chunks = [
        SimpleNamespace(model="gpt-4o", usage=None),
        SimpleNamespace(model=None, usage=None),
        SimpleNamespace(model="gpt-4o", usage=_usage()),
    ]
    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test")
    client.openai, create = _sync_openai(iter(chunks))

    stream = client.chat_stream(
        model="gpt-4o",
        messages=[],
        stream_options={"include_usage": False},
    )

    assert stream.cost is None
    assert list(stream) == chunks
    assert stream.cost is not None
    assert stream.cost.estimated is True
    assert client.stats.request_count == 1
    create.assert_called_once_with(
        model="gpt-4o",
        messages=[],
        stream=True,
        stream_options={"include_usage": False},
    )


def test_chat_stream_adds_usage_option_by_default():
    with patch("llmkit._client.OpenAI"):
        client = LLMKit(api_key="llmk_test")
    client.openai, create = _sync_openai(iter(()))

    list(client.chat_stream(model="gpt-4o", messages=[]))

    create.assert_called_once_with(
        model="gpt-4o",
        messages=[],
        stream=True,
        stream_options={"include_usage": True},
    )


def test_async_client_boundaries():
    async def exercise() -> None:
        callback_costs = []
        with patch("llmkit._client.AsyncOpenAI"):
            client = AsyncLLMKit(
                api_key="llmk_test",
                on_cost=callback_costs.append,
            )

        parsed = SimpleNamespace(model="gpt-4o", usage=_usage())
        raw = MagicMock(headers={})
        raw.parse.return_value = parsed
        client.openai, create = _async_openai(raw)

        completion, cost = await client.chat(model="gpt-4o", messages=[])
        assert completion is parsed
        assert cost.estimated is True
        assert client.stats.request_count == 1
        assert callback_costs == [cost]
        create.assert_awaited_once_with(model="gpt-4o", messages=[])

        async with client as entered:
            assert entered is client

    asyncio.run(exercise())


def test_async_chat_prefers_exact_headers():
    async def exercise() -> None:
        with patch("llmkit._client.AsyncOpenAI"):
            client = AsyncLLMKit(api_key="llmk_test")

        parsed = SimpleNamespace(model="gpt-4o", usage=_usage())
        raw = MagicMock(headers={"x-llmkit-cost": "0.25"})
        raw.parse.return_value = parsed
        client.openai, _ = _async_openai(raw)

        completion, cost = await client.chat(model="gpt-4o", messages=[])
        assert completion is parsed
        assert cost.total_cost == 0.25
        assert cost.estimated is False

    asyncio.run(exercise())


def test_async_stream_and_generated_session():
    async def chunks():
        yield SimpleNamespace(model="gpt-4o", usage=None)
        yield SimpleNamespace(model=None, usage=None)
        yield SimpleNamespace(model="gpt-4o", usage=_usage())

    async def exercise() -> None:
        with patch("llmkit._client.AsyncOpenAI"):
            client = AsyncLLMKit(api_key="llmk_test")
            child = client.session()
        assert child.session_id is not None
        assert len(child.session_id) == 36

        client.openai, create = _async_openai(chunks())
        stream = await client.chat_stream(model="gpt-4o", messages=[])
        assert stream.cost is None
        assert [chunk async for chunk in stream]
        assert stream.cost is not None
        assert stream.cost.estimated is True
        assert client.stats.request_count == 1
        create.assert_awaited_once_with(
            model="gpt-4o",
            messages=[],
            stream=True,
            stream_options={"include_usage": True},
        )

    asyncio.run(exercise())


def test_async_missing_key_raises():
    with (
        patch.dict(os.environ, {}, clear=True),
        pytest.raises(ValueError, match="LLMKIT_API_KEY"),
    ):
        AsyncLLMKit()
