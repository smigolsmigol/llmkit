# AUTO-GENERATED from packages/shared/pricing.json
# Do not edit manually. Run: node scripts/generate-pricing.mjs

UPDATED_AT = "2026-03-25"

PRICING: dict[str, dict[str, tuple[float, ...]]] = {
    "anthropic": {
        "claude-opus-4-6": (5, 25, 0.5, 6.25),
        "claude-sonnet-4-6": (3, 15, 0.3, 3.75),
        "claude-opus-4-5": (5, 25, 0.5, 6.25),
        "claude-sonnet-4-5": (3, 15, 0.3, 3.75),
        "claude-haiku-4-5": (1, 5, 0.1, 1.25),
        "claude-sonnet-4-20250514": (3, 15, 0.3, 3.75),
        "claude-3-5-haiku-20241022": (0.8, 4, 0.08, 1),
        "claude-3-haiku-20240307": (0.25, 1.25),
        "claude-opus-4-20250514": (15, 75, 1.5, 18.75),
    },
    "openai": {
        "gpt-4.1": (2, 8),
        "gpt-4.1-mini": (0.4, 1.6),
        "gpt-4.1-nano": (0.1, 0.4),
        "o4-mini": (1.1, 4.4),
        "gpt-4o": (2.5, 10),
        "gpt-4o-mini": (0.15, 0.6),
        "o3": (2, 8),
        "o3-mini": (1.1, 4.4),
        "gpt-4-turbo": (10, 30),
    },
    "gemini": {
        "gemini-2.0-flash": (0.1, 0.4),
        "gemini-2.5-pro": (1.25, 10),
        "gemini-2.5-flash": (0.15, 0.6),
    },
    "groq": {
        "llama-3.3-70b-versatile": (0.59, 0.79),
        "llama-3.1-8b-instant": (0.05, 0.08),
        "gemma2-9b-it": (0.2, 0.2),
    },
    "together": {
        "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo": (0.88, 0.88),
        "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo": (0.18, 0.18),
        "Qwen/Qwen2.5-72B-Instruct-Turbo": (1.2, 1.2),
        "mistralai/Mixtral-8x7B-Instruct-v0.1": (0.6, 0.6),
    },
    "fireworks": {
        "accounts/fireworks/models/llama-v3p3-70b-instruct": (0.9, 0.9, 0.45),
        "accounts/fireworks/models/llama-v3p1-8b-instruct": (0.2, 0.2, 0.1),
    },
    "deepseek": {
        "deepseek-chat": (0.28, 0.42, 0.028),
        "deepseek-reasoner": (0.28, 0.42, 0.028),
    },
    "mistral": {
        "mistral-large-latest": (2, 6),
        "mistral-small-latest": (0.06, 0.18),
        "codestral-latest": (0.3, 0.9),
    },
    "xai": {
        "grok-4.20-0309-reasoning": (2, 6, 0.2),
        "grok-4.20-0309-non-reasoning": (2, 6, 0.2),
        "grok-4.20-multi-agent-0309": (2, 6, 0.2),
        "grok-4-1-fast-reasoning": (0.2, 0.5, 0.05),
        "grok-4-1-fast-non-reasoning": (0.2, 0.5, 0.05),
        "grok-4": (3, 15),
        "grok-3": (3, 15),
        "grok-3-mini": (0.3, 0.5),
        "grok-2": (2, 10),
    },
}

PREFIXES: list[tuple[str, str]] = [
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
    ("pixtral-", "mistral"),
    ("grok-", "xai"),
    ("llama-", "groq"),
    ("llama3", "groq"),
]
