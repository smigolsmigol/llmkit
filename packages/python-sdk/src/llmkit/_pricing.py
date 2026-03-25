from __future__ import annotations

import re
from typing import NamedTuple

from llmkit._pricing_data import PREFIXES as _RAW_PREFIXES
from llmkit._pricing_data import PRICING as _RAW_PRICING


class TokenRates(NamedTuple):
    input_per_m: float
    output_per_m: float
    cache_read_per_m: float = 0.0
    cache_write_per_m: float = 0.0


_PRICING: dict[str, dict[str, TokenRates]] = {
    provider: {model: TokenRates(*rates) for model, rates in models.items()}
    for provider, models in _RAW_PRICING.items()
}

_PREFIXES: list[tuple[str, str]] = _RAW_PREFIXES

_FLAT: dict[str, TokenRates] = {}
for _models in _PRICING.values():
    _FLAT.update(_models)


def _strip_date_suffix(model: str) -> str:
    return re.sub(r"-\d{4}-?\d{2}-?\d{2}$", "", model)


def _infer_provider(model: str) -> str | None:
    lower = model.lower()
    for prefix, provider in _PREFIXES:
        if lower.startswith(prefix):
            return provider
    return None


def lookup_pricing(model: str) -> TokenRates | None:
    """Look up pricing for a model. Returns None for unknown models."""
    if model in _FLAT:
        return _FLAT[model]

    stripped = _strip_date_suffix(model)
    if stripped != model and stripped in _FLAT:
        return _FLAT[stripped]

    best: TokenRates | None = None
    best_len = 0
    for key, pricing in _FLAT.items():
        if model.startswith(key) and len(key) > best_len:
            best_len = len(key)
            best = pricing

    return best


def calculate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float | None:
    """Calculate cost in USD. Returns None if model is unknown."""
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
    return cost
