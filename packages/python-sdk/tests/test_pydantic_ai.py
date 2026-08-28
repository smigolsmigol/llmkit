"""Real Pydantic AI integration tests with an in-process HTTP transport."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent, ModelSettings
from pydantic_ai.exceptions import ModelHTTPError

import llmkit.integrations.pydantic_ai as integration
from llmkit.integrations.pydantic_ai import (
    LLMKitCostTracker,
    _extract_model,
    gateway_model,
    llmkit_hooks,
)


def _completion() -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": "gpt-4.1-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "pong"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 7, "completion_tokens": 2, "total_tokens": 9},
    }


def test_gateway_model_requires_api_key(monkeypatch):
    monkeypatch.delenv(integration.ENV_API_KEY, raising=False)

    with pytest.raises(ValueError, match="api_key required"):
        gateway_model("gpt-4.1-mini")


def test_gateway_model_runs_real_agent_with_attribution(monkeypatch):
    observed: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        observed["headers"] = dict(request.headers)
        observed["body"] = json.loads(request.content)
        return httpx.Response(200, json=_completion())

    transport = httpx.MockTransport(handler)
    original_client = AsyncOpenAI

    def client_factory(**kwargs):
        observed["client"] = kwargs
        return original_client(
            **kwargs,
            http_client=httpx.AsyncClient(transport=transport),
        )

    monkeypatch.setattr(integration, "AsyncOpenAI", client_factory)

    async def run():
        model = gateway_model(
            "gpt-4.1-mini",
            api_key="llmk_test",
            base_url="https://gateway.invalid/v1",
            provider="openai",
            fallback="anthropic",
            customer_id="tenant-1",
            workflow_id="release-review",
            agent_id="reviewer",
            session_id="session-1",
            end_user_id="user@example.com",
            settings=ModelSettings(max_tokens=64),
        )
        hooks, tracker = llmkit_hooks()
        try:
            result = await Agent(model, capabilities=[hooks]).run("ping")
        finally:
            await model.client.close()
        return result, tracker

    result, tracker = asyncio.run(run())

    assert result.output == "pong"
    assert observed["client"]["base_url"] == "https://gateway.invalid/v1"
    assert observed["client"]["max_retries"] == 0
    assert observed["body"]["max_completion_tokens"] == 64
    assert observed["headers"]["x-llmkit-customer-id"] == "tenant-1"
    assert observed["headers"]["x-llmkit-workflow-id"] == "release-review"
    assert observed["headers"]["x-llmkit-agent-id"] == "reviewer"
    assert observed["headers"]["x-llmkit-session-id"] == "session-1"
    assert observed["headers"]["x-llmkit-user-id"] == "user@example.com"
    assert tracker.request_count == 1
    assert tracker.input_tokens == 7
    assert tracker.output_tokens == 2


def test_gateway_transient_rejection_is_not_retried(monkeypatch):
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        del request
        attempts += 1
        return httpx.Response(
            503,
            json={"error": {"message": "provider unavailable", "type": "server_error"}},
        )

    transport = httpx.MockTransport(handler)
    original_client = AsyncOpenAI

    def client_factory(**kwargs):
        return original_client(
            **kwargs,
            http_client=httpx.AsyncClient(transport=transport),
        )

    monkeypatch.setattr(integration, "AsyncOpenAI", client_factory)

    async def run():
        model = gateway_model(
            "gpt-4.1-mini",
            api_key="llmk_test",
            base_url="https://gateway.invalid/v1",
            settings=ModelSettings(max_tokens=64),
        )
        try:
            with pytest.raises(ModelHTTPError, match="provider unavailable"):
                await Agent(model).run("ping")
        finally:
            await model.client.close()

    asyncio.run(run())
    assert attempts == 1


def test_local_tracker_accumulates_known_usage():
    observed_costs: list[float] = []
    hooks, tracker = llmkit_hooks(observed_costs.append)
    assert isinstance(tracker, LLMKitCostTracker)
    assert hooks is not None

    tracker._record(SimpleNamespace(input_tokens=0, output_tokens=0), "gpt-4.1-mini")
    tracker._record(SimpleNamespace(input_tokens=100, output_tokens=50), "gpt-4.1-mini")
    tracker._record(SimpleNamespace(input_tokens=100, output_tokens=50), "gpt-4.1-mini")

    assert tracker.request_count == 2
    assert tracker.total_tokens == 300
    assert tracker.total_cost > 0
    assert tracker.last_cost is not None
    assert observed_costs == [tracker.last_cost, tracker.last_cost]
    assert "requests=2" in repr(tracker)
    assert "tokens=300" in repr(tracker)


def test_unknown_model_keeps_usage_without_inventing_cost():
    _, tracker = llmkit_hooks()
    tracker._record(SimpleNamespace(input_tokens=10, output_tokens=5), "unknown-model")

    assert tracker.request_count == 1
    assert tracker.total_tokens == 15
    assert tracker.last_cost is None


def test_model_prefix_stripping():
    assert _extract_model("openai:gpt-4.1-mini") == "gpt-4.1-mini"
    assert _extract_model("anthropic:claude-sonnet-4") == "claude-sonnet-4"
    assert _extract_model("gpt-4.1-mini") == "gpt-4.1-mini"
    assert _extract_model(SimpleNamespace(model_name="openai:gpt-4.1-mini")) == "gpt-4.1-mini"
    assert _extract_model(SimpleNamespace(name="openai:gpt-4.1-mini")) == "gpt-4.1-mini"
    assert _extract_model(None) == ""
