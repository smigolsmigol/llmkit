from __future__ import annotations

import re
from typing import NamedTuple

# Synced from packages/shared/src/providers.ts (2026-03-24)
# Prices in USD per 1M tokens


class TokenRates(NamedTuple):
    input_per_m: float
    output_per_m: float
    cache_read_per_m: float = 0.0
    cache_write_per_m: float = 0.0


_PRICING: dict[str, dict[str, TokenRates]] = {
    "anthropic": {
        "claude-opus-4-6": TokenRates(5.0, 25.0, 0.5, 6.25),
        "claude-sonnet-4-6": TokenRates(3.0, 15.0, 0.3, 3.75),
        "claude-opus-4-5": TokenRates(5.0, 25.0, 0.5, 6.25),
        "claude-sonnet-4-5": TokenRates(3.0, 15.0, 0.3, 3.75),
        "claude-haiku-4-5": TokenRates(1.0, 5.0, 0.1, 1.25),
        "claude-sonnet-4-20250514": TokenRates(3.0, 15.0, 0.3, 3.75),
        "claude-3-5-haiku-20241022": TokenRates(0.8, 4.0, 0.08, 1.0),
        "claude-3-haiku-20240307": TokenRates(0.25, 1.25),
        "claude-opus-4-20250514": TokenRates(15.0, 75.0, 1.5, 18.75),
    },
    "openai": {
        "gpt-4.1": TokenRates(2.0, 8.0),
        "gpt-4.1-mini": TokenRates(0.40, 1.60),
        "gpt-4.1-nano": TokenRates(0.10, 0.40),
        "o4-mini": TokenRates(1.10, 4.40),
        "gpt-4o": TokenRates(2.5, 10.0),
        "gpt-4o-mini": TokenRates(0.15, 0.6),
        "o3": TokenRates(2.0, 8.0),
        "o3-mini": TokenRates(1.1, 4.4),
        "gpt-4-turbo": TokenRates(10.0, 30.0),
    },
    "gemini": {
        "gemini-2.0-flash": TokenRates(0.1, 0.4),
        "gemini-2.5-pro": TokenRates(1.25, 10.0),
        "gemini-2.5-flash": TokenRates(0.15, 0.6),
    },
    "groq": {
        "llama-3.3-70b-versatile": TokenRates(0.59, 0.79),
        "llama-3.1-8b-instant": TokenRates(0.05, 0.08),
        "gemma2-9b-it": TokenRates(0.20, 0.20),
    },
    "together": {
        "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo": TokenRates(0.88, 0.88),
        "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo": TokenRates(0.18, 0.18),
        "Qwen/Qwen2.5-72B-Instruct-Turbo": TokenRates(1.20, 1.20),
        "mistralai/Mixtral-8x7B-Instruct-v0.1": TokenRates(0.60, 0.60),
    },
    "fireworks": {
        "accounts/fireworks/models/llama-v3p3-70b-instruct": TokenRates(
            0.90, 0.90, 0.45
        ),
        "accounts/fireworks/models/llama-v3p1-8b-instruct": TokenRates(
            0.20, 0.20, 0.10
        ),
    },
    "deepseek": {
        "deepseek-chat": TokenRates(0.28, 0.42, 0.028),
        "deepseek-reasoner": TokenRates(0.28, 0.42, 0.028),
    },
    "mistral": {
        "mistral-large-latest": TokenRates(2.0, 6.0),
        "mistral-small-latest": TokenRates(0.06, 0.18),
        "codestral-latest": TokenRates(0.30, 0.90),
    },
    "xai": {
        "grok-4.20-0309-reasoning": TokenRates(2.0, 6.0, 0.2),
        "grok-4.20-0309-non-reasoning": TokenRates(2.0, 6.0, 0.2),
        "grok-4.20-multi-agent-0309": TokenRates(2.0, 6.0, 0.2),
        "grok-4-1-fast-reasoning": TokenRates(0.2, 0.5, 0.05),
        "grok-4-1-fast-non-reasoning": TokenRates(0.2, 0.5, 0.05),
        "grok-4": TokenRates(3.0, 15.0),
        "grok-3": TokenRates(3.0, 15.0),
        "grok-3-mini": TokenRates(0.30, 0.50),
        "grok-2": TokenRates(2.0, 10.0),
    },
}

_PREFIXES: list[tuple[str, str]] = [
    ("gpt-", "openai"),
    ("o1-", "openai"),
    ("o3-", "openai"),
    ("o4-", "openai"),
    ("chatgpt-", "openai"),
    ("claude-", "anthropic"),
    ("gemini-", "gemini"),
    ("deepseek-", "deepseek"),
    ("mistral-", "mistral"),
    ("mixtral-", "mistral"),
    ("codestral-", "mistral"),
    ("grok-", "xai"),
    ("llama-", "groq"),
]

_FLAT: dict[str, TokenRates] = {}
for _models in _PRICING.values():
    _FLAT.update(_models)


def _strip_date_suffix(model: str) -> str:
    # handles both -YYYY-MM-DD and -YYYYMMDD formats
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
