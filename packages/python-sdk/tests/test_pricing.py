"""Tests for pricing lookup and cost calculation."""

from llmkit._pricing import lookup_pricing, calculate_cost


def test_exact_match():
    p = lookup_pricing("gpt-4o")
    assert p is not None
    assert p == (2.5, 10.0)


def test_date_suffix_stripped():
    p = lookup_pricing("gpt-4o-2025-04-14")
    assert p is not None
    assert p == (2.5, 10.0)


def test_prefix_match():
    p = lookup_pricing("claude-sonnet-4-6-20260301")
    assert p is not None
    assert p == (3.0, 15.0)


def test_unknown_model():
    p = lookup_pricing("totally-unknown-model")
    assert p is None


def test_calculate_cost_gpt4o():
    cost = calculate_cost("gpt-4o", input_tokens=1000, output_tokens=500)
    assert cost is not None
    expected = (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0
    assert abs(cost - expected) < 1e-10


def test_calculate_cost_unknown():
    cost = calculate_cost("unknown-model", input_tokens=100, output_tokens=50)
    assert cost is None


def test_calculate_cost_zero_tokens():
    cost = calculate_cost("gpt-4o", input_tokens=0, output_tokens=0)
    assert cost is not None
    assert cost == 0.0


def test_anthropic_pricing():
    p = lookup_pricing("claude-sonnet-4-6")
    assert p == (3.0, 15.0)


def test_gemini_pricing():
    p = lookup_pricing("gemini-2.5-pro")
    assert p == (1.25, 10.0)


def test_deepseek_pricing():
    p = lookup_pricing("deepseek-chat")
    assert p == (0.28, 0.42)


def test_grok_pricing():
    p = lookup_pricing("grok-4")
    assert p == (3.0, 15.0)


def test_mistral_pricing():
    p = lookup_pricing("mistral-large-latest")
    assert p == (2.0, 6.0)


def test_calculate_large_request():
    """1M input + 100K output on gpt-4o."""
    cost = calculate_cost("gpt-4o", input_tokens=1_000_000, output_tokens=100_000)
    assert cost is not None
    expected = 2.5 + (100_000 / 1_000_000) * 10.0  # $2.50 + $1.00
    assert abs(cost - expected) < 1e-10


def test_short_model_no_wrong_match():
    """gpt-4 should NOT match gpt-4.1 (different price family)."""
    result = lookup_pricing("gpt-4")
    # gpt-4 is not in the table, and should NOT reverse-match gpt-4.1
    assert result is None


def test_estimate_cost_public():
    """estimate_cost() works with a mock ChatCompletion."""
    from llmkit import estimate_cost
    from unittest.mock import MagicMock

    resp = MagicMock()
    resp.model = "gpt-4o"
    resp.usage.prompt_tokens = 100
    resp.usage.completion_tokens = 50
    cost = estimate_cost(resp)
    assert cost.total_cost is not None
    assert cost.estimated is True
    assert cost.total_cost > 0
