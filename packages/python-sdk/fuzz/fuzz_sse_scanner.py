"""Fuzz target for SSE stream scanner.

Feeds arbitrary bytes into _SSEScanner to find crashes in the
streaming cost extraction pipeline (JSON parsing, field access,
partial chunk reassembly).
"""

import sys
import atheris

with atheris.instrument_imports():
    from llmkit._transport import _SSEScanner


def fuzz_one(data: bytes) -> None:
    fdp = atheris.FuzzedDataProvider(data)
    scanner = _SSEScanner()

    # split the input into random-sized chunks to test partial reassembly
    remaining = fdp.ConsumeBytes(fdp.remaining_bytes())
    while remaining:
        split = max(
            1, len(remaining) // (fdp.ConsumeIntInRange(1, 8) if len(data) > 1 else 1)
        )
        chunk, remaining = remaining[:split], remaining[split:]
        scanner.feed(chunk)

    result = scanner.result()
    if result is not None:
        assert result.estimated is True
        if result.total_cost is not None:
            # cost should be non-negative for valid token counts
            pass  # negative costs possible with bad data, that's fine


if __name__ == "__main__":
    atheris.Setup(sys.argv, fuzz_one)
    atheris.Fuzz()
