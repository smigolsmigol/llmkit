"""Tests for CostInfo and SessionStats."""

from llmkit import CostInfo, SessionStats


def test_cost_info_from_dict_headers():
    headers = {
        "x-llmkit-cost": "0.0042",
        "x-llmkit-provider": "openai",
        "x-llmkit-latency-ms": "312.5",
        "x-llmkit-session-id": "sess-abc",
    }
    cost = CostInfo.from_headers(headers)
    assert cost.total_cost == 0.0042
    assert cost.provider == "openai"
    assert cost.latency_ms == 312.5
    assert cost.session_id == "sess-abc"
    assert cost.estimated is False


def test_cost_info_missing_headers():
    cost = CostInfo.from_headers({})
    assert cost.total_cost is None
    assert cost.provider is None
    assert cost.latency_ms is None
    assert cost.session_id is None


def test_cost_info_partial_headers():
    headers = {"x-llmkit-cost": "0.01", "x-llmkit-provider": "anthropic"}
    cost = CostInfo.from_headers(headers)
    assert cost.total_cost == 0.01
    assert cost.provider == "anthropic"
    assert cost.latency_ms is None
    assert cost.session_id is None


def test_cost_info_estimated_flag():
    exact = CostInfo(total_cost=0.01, estimated=False)
    estimated = CostInfo(total_cost=0.01, estimated=True)
    assert exact.estimated is False
    assert estimated.estimated is True


def test_cost_info_is_frozen():
    cost = CostInfo(total_cost=0.5)
    try:
        cost.total_cost = 1.0  # type: ignore[misc]
        assert False, "should have raised"
    except AttributeError:
        pass


def test_session_stats_record():
    stats = SessionStats(session_id="test")
    stats.record(CostInfo(total_cost=0.01))
    stats.record(CostInfo(total_cost=0.02))
    stats.record(CostInfo(total_cost=None))

    assert stats.request_count == 3
    assert abs(stats.total_cost - 0.03) < 1e-9
    assert stats.avg_cost is not None
    assert abs(stats.avg_cost - 0.01) < 1e-9


def test_session_stats_empty():
    stats = SessionStats()
    assert stats.request_count == 0
    assert stats.total_cost == 0.0
    assert stats.avg_cost is None


def test_session_stats_str():
    stats = SessionStats(session_id="agent-1")
    stats.record(CostInfo(total_cost=0.05))
    stats.record(CostInfo(total_cost=0.03))
    s = str(stats)
    assert "2 requests" in s
    assert "$0.0800" in s
    assert "agent-1" in s


def test_cost_info_malformed_headers():
    """Malformed header values should not crash, just return None."""
    headers = {"x-llmkit-cost": "not-a-number", "x-llmkit-latency-ms": "garbage"}
    cost = CostInfo.from_headers(headers)
    assert cost.total_cost is None
    assert cost.latency_ms is None


def test_session_stats_zero_cost():
    """Zero-cost responses should still be counted."""
    stats = SessionStats(session_id="test")
    stats.record(CostInfo(total_cost=0.0))
    assert stats.request_count == 1
    assert stats.total_cost == 0.0


def test_cost_info_httpx_style_headers():
    """Simulate httpx Headers object (has .get method but isn't a dict)."""

    class FakeHeaders:
        def __init__(self, data: dict):
            self._data = data

        def get(self, key: str, default=None):
            return self._data.get(key, default)

    headers = FakeHeaders(
        {
            "x-llmkit-cost": "1.50",
            "x-llmkit-provider": "gemini",
        }
    )
    cost = CostInfo.from_headers(headers)
    assert cost.total_cost == 1.50
    assert cost.provider == "gemini"
