from __future__ import annotations

import re
from typing import NamedTuple

from ._pricing_data import PREFIXES as _RAW_PREFIXES
from ._pricing_data import PRICING as _RAW_PRICING
from ._pricing_data import PricingEntry as _RawPricingEntry


class TokenRates(NamedTuple):
    input_per_m: float
    output_per_m: float
    cache_read_per_m: float = 0.0
    cache_write_per_m: float = 0.0
    extra_rates: dict[str, tuple[float, float]] | None = None


_PREFIXES: list[tuple[str, str]] = _RAW_PREFIXES


def _token_rates(rates: _RawPricingEntry) -> TokenRates:
    return TokenRates(*rates)


def _build_pricing() -> dict[str, dict[str, TokenRates]]:
    pricing: dict[str, dict[str, TokenRates]] = {}
    for provider, models in _RAW_PRICING.items():
        pricing[provider] = {}
        for model, rates in models.items():
            pricing[provider][model] = _token_rates(rates)
    return pricing


_PRICING: dict[str, dict[str, TokenRates]] = _build_pricing()


def _strip_date_suffix(model: str) -> str:
    return re.sub(r"-\d{4}-?\d{2}-?\d{2}$", "", model)


def _infer_provider(model: str) -> str | None:
    lower = model.lower()
    for prefix, provider in _PREFIXES:
        if lower.startswith(prefix):
            return provider
    return None


def _lookup_exact(table: dict[str, TokenRates], model: str) -> TokenRates | None:
    if model in table:
        return table[model]

    stripped = _strip_date_suffix(model)
    if stripped != model and stripped in table:
        return table[stripped]

    return None


def _lookup_table(table: dict[str, TokenRates], model: str) -> TokenRates | None:
    exact = _lookup_exact(table, model)
    if exact is not None:
        return exact

    best: TokenRates | None = None
    best_len = 0
    for key, pricing in table.items():
        if model.startswith(key) and len(key) > best_len:
            best_len = len(key)
            best = pricing
    return best


def _build_flat() -> dict[str, TokenRates]:
    candidates: dict[str, list[tuple[str, TokenRates]]] = {}
    for provider, models in _PRICING.items():
        for model, rates in models.items():
            candidates.setdefault(model, []).append((provider, rates))

    flat: dict[str, TokenRates] = {}
    for model, matches in candidates.items():
        if len(matches) == 1:
            flat[model] = matches[0][1]
            continue
        inferred = _infer_provider(model)
        provider_matches = [rates for provider, rates in matches if provider == inferred]
        if len(provider_matches) == 1:
            flat[model] = provider_matches[0]
    return flat


_FLAT: dict[str, TokenRates] = _build_flat()


def lookup_pricing(model: str) -> TokenRates | None:
    """Look up pricing, using provider/model when a bare model ID is ambiguous."""
    provider, separator, provider_model = model.partition("/")
    provider = provider.lower()
    if separator and provider in _PRICING:
        return _lookup_table(_PRICING[provider], provider_model)

    pricing = _lookup_exact(_FLAT, model)
    if pricing is not None:
        return pricing

    inferred = _infer_provider(model)
    if inferred and inferred in _PRICING:
        pricing = _lookup_table(_PRICING[inferred], model)
        if pricing is not None:
            return pricing

    return _lookup_table(_FLAT, model)


def calculate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    extra_usage: dict[str, int] | None = None,
) -> float | None:
    """Calculate cost in USD. Returns None if model is unknown.

    extra_usage: optional dict of tool invocation counts, e.g.
    {"web_search": 2, "code_execution": 1} for xAI server-side tools.
    """
    pricing = lookup_pricing(model)
    if not pricing:
        return None
    per_m = 1_000_000
    cost = (input_tokens / per_m) * pricing.input_per_m
    cost += (output_tokens / per_m) * pricing.output_per_m
    if cache_read_tokens and pricing.cache_read_per_m:
        cost += (cache_read_tokens / per_m) * pricing.cache_read_per_m
    if cache_write_tokens and pricing.cache_write_per_m:
        cost += (cache_write_tokens / per_m) * pricing.cache_write_per_m
    if extra_usage and pricing.extra_rates:
        for dimension, quantity in extra_usage.items():
            rate_info = pricing.extra_rates.get(dimension)
            if rate_info and quantity > 0:
                rate, per = rate_info
                cost += (quantity / per) * rate
    return cost
