"""Fuzz target for JSON cost extraction from API response bodies.

Exercises _extract_cost_from_json with arbitrary bytes including
valid-ish JSON, truncated payloads, and pure noise.
"""

import sys
import atheris

with atheris.instrument_imports():
    import json

    from llmkit._transport import _extract_cost_from_json


def fuzz_raw_bytes(data: bytes) -> None:
    """Feed raw bytes - tests malformed JSON handling."""
    result = _extract_cost_from_json(data)
    if result is not None:
        assert result.estimated is True


def fuzz_structured(data: bytes) -> None:
    """Build semi-valid JSON payloads that exercise the extraction logic."""
    fdp = atheris.FuzzedDataProvider(data)

    models = [
        "gpt-4o",
        "claude-sonnet-4-6",
        "gpt-4o-mini",
        fdp.ConsumeUnicodeNoSurrogates(64),
    ]
    model = models[fdp.ConsumeIntInRange(0, len(models) - 1)]

    payload: dict = {}
    if fdp.ConsumeBool():
        payload["model"] = model
    if fdp.ConsumeBool():
        usage: dict = {}
        if fdp.ConsumeBool():
            usage["prompt_tokens"] = fdp.ConsumeIntInRange(-100, 5_000_000)
        if fdp.ConsumeBool():
            usage["completion_tokens"] = fdp.ConsumeIntInRange(-100, 5_000_000)
        if fdp.ConsumeBool():
            usage["input_tokens"] = fdp.ConsumeIntInRange(-100, 5_000_000)
        if fdp.ConsumeBool():
            usage["output_tokens"] = fdp.ConsumeIntInRange(-100, 5_000_000)
        if fdp.ConsumeBool():
            usage["cache_read_input_tokens"] = fdp.ConsumeIntInRange(0, 1_000_000)
        if fdp.ConsumeBool():
            usage["cache_creation_input_tokens"] = fdp.ConsumeIntInRange(0, 1_000_000)
        if fdp.ConsumeBool():
            usage["prompt_tokens_details"] = {
                "cached_tokens": fdp.ConsumeIntInRange(0, 1_000_000)
            }
        payload["usage"] = usage

    body = json.dumps(payload).encode()
    result = _extract_cost_from_json(body)
    if result is not None:
        assert result.estimated is True


def fuzz_one(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    if fdp.ConsumeBool():
        fuzz_raw_bytes(data[1:])
    else:
        fuzz_structured(data[1:])


if __name__ == "__main__":
    atheris.Setup(sys.argv, fuzz_one)
    atheris.Fuzz()
