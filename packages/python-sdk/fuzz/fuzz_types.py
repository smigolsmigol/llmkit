"""Fuzz target for CostInfo.from_headers and SessionStats."""

import sys
import atheris

with atheris.instrument_imports():
    from llmkit._types import CostInfo, SessionStats


def fuzz_from_headers_dict(data: bytes) -> None:
    """Fuzz CostInfo.from_headers with dict input."""
    fdp = atheris.FuzzedDataProvider(data)
    headers: dict[str, str] = {}

    keys = [
        "x-llmkit-cost",
        "x-llmkit-latency-ms",
        "x-llmkit-provider",
        "x-llmkit-session-id",
        fdp.ConsumeUnicodeNoSurrogates(32),
    ]
    for key in keys:
        if fdp.ConsumeBool():
            headers[key] = fdp.ConsumeUnicodeNoSurrogates(64)

    info = CostInfo.from_headers(headers)
    assert isinstance(info, CostInfo)
    assert info.estimated is False


def fuzz_session_stats(data: bytes) -> None:
    """Fuzz SessionStats.record with random CostInfo objects."""
    fdp = atheris.FuzzedDataProvider(data)
    stats = SessionStats(session_id=fdp.ConsumeUnicodeNoSurrogates(16))

    n = fdp.ConsumeIntInRange(0, 20)
    for _ in range(n):
        cost_val = None
        if fdp.ConsumeBool():
            cost_val = fdp.ConsumeFloatInRange(-1000.0, 1000.0)
        info = CostInfo(total_cost=cost_val, estimated=fdp.ConsumeBool())
        stats.record(info)

    assert stats.request_count == n
    str(stats)  # __str__ shouldn't crash
    stats.avg_cost  # property access shouldn't crash


def fuzz_one(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    if fdp.ConsumeBool():
        fuzz_from_headers_dict(data[1:])
    else:
        fuzz_session_stats(data[1:])


if __name__ == "__main__":
    atheris.Setup(sys.argv, fuzz_one)
    atheris.Fuzz()
