"""Tests for LLMKit client construction, sessions, env vars, callbacks."""

import os
from unittest.mock import patch

from llmkit import LLMKit, AsyncLLMKit, CostInfo


def test_client_sets_base_url():
    with patch("llmkit._client.OpenAI") as mock_openai:
        LLMKit(api_key="llmk_test")
        kw = mock_openai.call_args.kwargs
        assert kw["base_url"] == "https://llmkit-proxy.smigolsmigol.workers.dev/v1"
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
    with patch.dict(os.environ, {}, clear=True):
        try:
            LLMKit()
            assert False, "should have raised"
        except ValueError as e:
            assert "LLMKIT_API_KEY" in str(e)


def test_client_headers():
    with patch("llmkit._client.OpenAI") as mock_openai:
        LLMKit(
            api_key="llmk_test",
            provider_key="sk-abc",
            provider="anthropic",
            session_id="sess-1",
            fallback="openai",
        )
        headers = mock_openai.call_args.kwargs["default_headers"]
        assert headers["x-llmkit-provider-key"] == "sk-abc"
        assert headers["x-llmkit-provider"] == "anthropic"
        assert headers["x-llmkit-session-id"] == "sess-1"
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
            fallback="openai",
        )
        client.session("s1")
        child_headers = mock_openai.call_args.kwargs["default_headers"]
        assert child_headers["x-llmkit-provider-key"] == "sk-abc"
        assert child_headers["x-llmkit-provider"] == "anthropic"
        assert child_headers["x-llmkit-fallback"] == "openai"
        assert child_headers["x-llmkit-session-id"] == "s1"


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
    with patch("llmkit._client.OpenAI"):
        with LLMKit(api_key="llmk_test") as client:
            assert client is not None
            assert hasattr(client, "chat")


def test_async_client_sets_base_url():
    with patch("llmkit._client.AsyncOpenAI") as mock_openai:
        AsyncLLMKit(api_key="llmk_test")
        assert (
            mock_openai.call_args.kwargs["base_url"]
            == "https://llmkit-proxy.smigolsmigol.workers.dev/v1"
        )


def test_async_session():
    with patch("llmkit._client.AsyncOpenAI"):
        client = AsyncLLMKit(api_key="llmk_test")
        child = client.session("async-sess")
        assert child.session_id == "async-sess"
        assert isinstance(child, AsyncLLMKit)
