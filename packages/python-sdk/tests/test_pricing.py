"""Tests for pricing lookup and cost calculation."""

from llmkit._pricing import lookup_pricing, calculate_cost, TokenRates


def test_exact_match():
    p = lookup_pricing("gpt-4o")
    assert p is not None
    assert p.input_per_m == 2.5
    assert p.output_per_m == 10.0


def test_date_suffix_stripped():
    p = lookup_pricing("gpt-4o-2025-04-14")
    assert p is not None
    assert p.input_per_m == 2.5


def test_date_suffix_no_dashes():
    p = lookup_pricing("gpt-4o-20250414")
    assert p is not None
    assert p.input_per_m == 2.5


def test_prefix_match():
    p = lookup_pricing("claude-sonnet-4-6-20260301")
    assert p is not None
    assert p.input_per_m == 3.0


def test_unknown_model():
    assert lookup_pricing("totally-unknown-model") is None


def test_calculate_cost_gpt4o():
    cost = calculate_cost("gpt-4o", input_tokens=1000, output_tokens=500)
    assert cost is not None
    expected = (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0
    assert abs(cost - expected) < 1e-10


def test_calculate_cost_with_cache():
    cost = calculate_cost(
        "claude-opus-4-6",
        input_tokens=1000,
        output_tokens=500,
        cache_read_tokens=200,
        cache_write_tokens=100,
    )
    assert cost is not None
    expected = (
        (1000 / 1e6) * 5.0
        + (500 / 1e6) * 25.0
        + (200 / 1e6) * 0.5
        + (100 / 1e6) * 6.25
    )
    assert abs(cost - expected) < 1e-10


def test_calculate_cost_unknown():
    assert calculate_cost("unknown-model", input_tokens=100, output_tokens=50) is None


def test_calculate_cost_zero_tokens():
    cost = calculate_cost("gpt-4o", input_tokens=0, output_tokens=0)
    assert cost is not None
    assert cost == 0.0


def test_anthropic_pricing():
    p = lookup_pricing("claude-sonnet-4-6")
    assert p is not None
    assert p.input_per_m == 3.0
    assert p.cache_read_per_m == 0.3
    assert p.cache_write_per_m == 3.75


def test_gemini_pricing():
    p = lookup_pricing("gemini-2.5-pro")
    assert p is not None
    assert p.input_per_m == 1.25


def test_deepseek_pricing():
    p = lookup_pricing("deepseek-chat")
    assert p is not None
    assert p.input_per_m == 0.28
    assert p.cache_read_per_m == 0.028


def test_grok_pricing():
    p = lookup_pricing("grok-4")
    assert p is not None
    assert p.input_per_m == 3.0


def test_grok_cache_pricing():
    p = lookup_pricing("grok-4.20-0309-reasoning")
    assert p is not None
    assert p.cache_read_per_m == 0.2


def test_mistral_pricing():
    p = lookup_pricing("mistral-large-latest")
    assert p is not None
    assert p.input_per_m == 2.0


def test_calculate_large_request():
    cost = calculate_cost("gpt-4o", input_tokens=1_000_000, output_tokens=100_000)
    assert cost is not None
    expected = 2.5 + (100_000 / 1_000_000) * 10.0
    assert abs(cost - expected) < 1e-10


def test_short_model_no_wrong_match():
    assert lookup_pricing("gpt-4") is None


def test_estimate_cost_public():
    from unittest.mock import MagicMock

    from llmkit import estimate_cost

    resp = MagicMock()
    resp.model = "gpt-4o"
    resp.usage.prompt_tokens = 100
    resp.usage.completion_tokens = 50
    cost = estimate_cost(resp)
    assert cost.total_cost is not None
    assert cost.estimated is True
    assert cost.total_cost > 0


def test_token_rates_is_tuple():
    r = TokenRates(1.0, 2.0, 0.1, 0.2)
    assert isinstance(r, tuple)
    assert len(r) == 4
