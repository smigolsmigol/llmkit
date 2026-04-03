"""Tests for Pydantic AI hooks integration (mocked, no pydantic-ai required)."""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

# Mock pydantic_ai before importing
mock_capabilities = MagicMock()
mock_usage = MagicMock()


class FakeHooks:
    def __init__(self):
        self.on = SimpleNamespace(after_model_request=self._register)
        self._handlers = []

    def _register(self, fn):
        self._handlers.append(fn)
        return fn


class FakeRequestUsage:
    def __init__(self, input_tokens=0, output_tokens=0):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


mock_capabilities.Hooks = FakeHooks
mock_usage.RequestUsage = FakeRequestUsage

sys.modules["pydantic_ai"] = MagicMock()
sys.modules["pydantic_ai.capabilities"] = mock_capabilities
sys.modules["pydantic_ai.usage"] = mock_usage

from llmkit.integrations.pydantic_ai import LLMKitCostTracker, llmkit_hooks  # noqa: E402


def test_basic_tracking():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    usage = FakeRequestUsage(input_tokens=100, output_tokens=50)
    tracker._record(usage, "gpt-4.1-mini")

    assert tracker.request_count == 1
    assert tracker.input_tokens == 100
    assert tracker.output_tokens == 50
    assert tracker.total_tokens == 150
    assert tracker.total_cost > 0


def test_accumulation():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    for _ in range(3):
        tracker._record(FakeRequestUsage(100, 50), "gpt-4.1-mini")

    assert tracker.request_count == 3
    assert tracker.total_tokens == 450


def test_on_cost_callback():
    costs = []
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks, on_cost=costs.append)
    tracker._record(FakeRequestUsage(100, 50), "gpt-4.1-mini")

    assert len(costs) == 1
    assert costs[0] > 0


def test_zero_tokens_ignored():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    tracker._record(FakeRequestUsage(0, 0), "gpt-4.1-mini")

    assert tracker.request_count == 0


def test_unknown_model():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    tracker._record(FakeRequestUsage(100, 50), "unknown-model-xyz")

    assert tracker.request_count == 1
    assert tracker.total_tokens == 150


def test_last_cost():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    assert tracker.last_cost is None

    tracker._record(FakeRequestUsage(100, 50), "gpt-4.1-mini")
    assert tracker.last_cost is not None


def test_model_prefix_stripping():
    from llmkit.integrations.pydantic_ai import _extract_model
    assert _extract_model("openai:gpt-4.1-mini") == "gpt-4.1-mini"
    assert _extract_model("anthropic:claude-sonnet-4-20250514") == "claude-sonnet-4-20250514"
    assert _extract_model("gpt-4.1-mini") == "gpt-4.1-mini"
    assert _extract_model(None) == ""


def test_llmkit_hooks_factory():
    hooks, tracker = llmkit_hooks()
    assert isinstance(tracker, LLMKitCostTracker)
    assert len(hooks._handlers) == 1


def test_repr():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    tracker._record(FakeRequestUsage(100, 50), "gpt-4.1-mini")
    r = repr(tracker)
    assert "requests=1" in r
    assert "cost=$" in r


def test_anthropic_model():
    hooks = FakeHooks()
    tracker = LLMKitCostTracker(hooks)
    tracker._record(FakeRequestUsage(100, 50), "claude-sonnet-4-20250514")

    assert tracker.request_count == 1
    assert tracker.total_cost > 0
