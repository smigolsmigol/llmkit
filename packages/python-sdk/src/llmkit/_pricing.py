from __future__ import annotations

# Synced from packages/shared/src/providers.ts (2026-03-07)
# Prices in USD per 1M tokens

_PRICING: dict[str, dict[str, tuple[float, float]]] = {
    # provider -> model -> (input_per_million, output_per_million)
    "anthropic": {
        "claude-opus-4-6": (5.0, 25.0),
        "claude-sonnet-4-6": (3.0, 15.0),
        "claude-opus-4-5": (5.0, 25.0),
        "claude-sonnet-4-5": (3.0, 15.0),
        "claude-haiku-4-5": (1.0, 5.0),
        "claude-sonnet-4-20250514": (3.0, 15.0),
        "claude-3-5-haiku-20241022": (0.8, 4.0),
        "claude-3-haiku-20240307": (0.25, 1.25),
        "claude-opus-4-20250514": (15.0, 75.0),
    },
    "openai": {
        "gpt-4.1": (2.0, 8.0),
        "gpt-4.1-mini": (0.40, 1.60),
        "gpt-4.1-nano": (0.10, 0.40),
        "o4-mini": (1.10, 4.40),
        "gpt-4o": (2.5, 10.0),
        "gpt-4o-mini": (0.15, 0.6),
        "o3": (2.0, 8.0),
        "o3-mini": (1.1, 4.4),
        "gpt-4-turbo": (10.0, 30.0),
    },
    "gemini": {
        "gemini-2.0-flash": (0.1, 0.4),
        "gemini-2.5-pro": (1.25, 10.0),
        "gemini-2.5-flash": (0.15, 0.6),
    },
    "groq": {
        "llama-3.3-70b-versatile": (0.59, 0.79),
        "llama-3.1-8b-instant": (0.05, 0.08),
        "gemma2-9b-it": (0.20, 0.20),
    },
    "together": {
        "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo": (0.88, 0.88),
        "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo": (0.18, 0.18),
        "Qwen/Qwen2.5-72B-Instruct-Turbo": (1.20, 1.20),
        "mistralai/Mixtral-8x7B-Instruct-v0.1": (0.60, 0.60),
    },
    "fireworks": {
        "accounts/fireworks/models/llama-v3p3-70b-instruct": (0.90, 0.90),
        "accounts/fireworks/models/llama-v3p1-8b-instruct": (0.20, 0.20),
    },
    "deepseek": {
        "deepseek-chat": (0.28, 0.42),
        "deepseek-reasoner": (0.28, 0.42),
    },
    "mistral": {
        "mistral-large-latest": (2.0, 6.0),
        "mistral-small-latest": (0.06, 0.18),
        "codestral-latest": (0.30, 0.90),
    },
    "xai": {
        "grok-4.20-0309-reasoning": (2.0, 6.0),
        "grok-4.20-0309-non-reasoning": (2.0, 6.0),
        "grok-4.20-multi-agent-0309": (2.0, 6.0),
        "grok-4-1-fast-reasoning": (0.2, 0.5),
        "grok-4-1-fast-non-reasoning": (0.2, 0.5),
        "grok-4": (3.0, 15.0),
        "grok-3": (3.0, 15.0),
        "grok-3-mini": (0.30, 0.50),
        "grok-2": (2.0, 10.0),
    },
}

# model prefix -> provider (for auto-detection)
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

# flattened lookup: model -> (input_per_million, output_per_million)
_FLAT: dict[str, tuple[float, float]] = {}
for _models in _PRICING.values():
    _FLAT.update(_models)


def _strip_date_suffix(model: str) -> str:
    import re

    return re.sub(r"-\d{4}-\d{2}-\d{2}$", "", model)


def _infer_provider(model: str) -> str | None:
    lower = model.lower()
    for prefix, provider in _PREFIXES:
        if lower.startswith(prefix):
            return provider
    return None


def lookup_pricing(model: str) -> tuple[float, float] | None:
    """Look up (input_per_million, output_per_million) for a model.

    Tries exact match, date-suffix-stripped match, then prefix match.
    Returns None for unknown models.
    """
    if model in _FLAT:
        return _FLAT[model]

    stripped = _strip_date_suffix(model)
    if stripped != model and stripped in _FLAT:
        return _FLAT[stripped]

    # prefix match: model starts with a known key, longest key wins
    best: tuple[float, float] | None = None
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
) -> float | None:
    """Calculate estimated cost in USD from model name and token counts.

    Returns None if the model is not in the pricing table.
    """
    pricing = lookup_pricing(model)
    if not pricing:
        return None
    input_per_m, output_per_m = pricing
    return (input_tokens / 1_000_000) * input_per_m + (
        output_tokens / 1_000_000
    ) * output_per_m
