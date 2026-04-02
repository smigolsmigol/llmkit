"""Fuzz target for pricing lookup and cost calculation."""

import sys
import atheris

with atheris.instrument_imports():
    from llmkit._pricing import _strip_date_suffix, calculate_cost, lookup_pricing


def fuzz_lookup(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    model = fdp.ConsumeUnicodeNoSurrogates(256)
    lookup_pricing(model)


def fuzz_calculate(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    model = fdp.ConsumeUnicodeNoSurrogates(128)
    input_t = fdp.ConsumeIntInRange(0, 10_000_000)
    output_t = fdp.ConsumeIntInRange(0, 10_000_000)
    cache_read = fdp.ConsumeIntInRange(0, 10_000_000)
    cache_write = fdp.ConsumeIntInRange(0, 10_000_000)

    extra: dict[str, int] | None = None
    if fdp.ConsumeBool():
        n = fdp.ConsumeIntInRange(0, 5)
        extra = {}
        for _ in range(n):
            key = fdp.ConsumeUnicodeNoSurrogates(32)
            val = fdp.ConsumeIntInRange(-1000, 10_000_000)
            extra[key] = val

    result = calculate_cost(model, input_t, output_t, cache_read, cache_write, extra)
    if result is not None:
        assert result >= 0 or extra is not None, (
            "cost should never be negative without extra_usage"
        )


def fuzz_strip_date(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    model = fdp.ConsumeUnicodeNoSurrogates(256)
    stripped = _strip_date_suffix(model)
    assert len(stripped) <= len(model)


def fuzz_one(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    choice = fdp.ConsumeIntInRange(0, 2)
    if choice == 0:
        fuzz_lookup(data[1:])
    elif choice == 1:
        fuzz_calculate(data[1:])
    else:
        fuzz_strip_date(data[1:])


if __name__ == "__main__":
    atheris.Setup(sys.argv, fuzz_one)
    atheris.Fuzz()
