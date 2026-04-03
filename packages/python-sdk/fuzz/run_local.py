"""Local fuzz smoke test - runs fuzz logic without atheris.

Atheris only builds on Linux (needs libfuzzer). This script exercises
the same code paths with fixed + random inputs to validate the harnesses
work before pushing to CI where ClusterFuzzLite runs them properly.

Usage: python fuzz/run_local.py
"""

import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from llmkit._pricing import _strip_date_suffix, calculate_cost, lookup_pricing
from llmkit._transport import _SSEScanner, _extract_cost_from_json
from llmkit._types import CostInfo, SessionStats

SEED = 42
N_ITERATIONS = 500


def rand_bytes(rng: random.Random, max_len: int = 512) -> bytes:
    n = rng.randint(0, max_len)
    return bytes(rng.randint(0, 255) for _ in range(n))


def rand_str(rng: random.Random, max_len: int = 128) -> str:
    n = rng.randint(0, max_len)
    chars = [chr(rng.randint(0, 0x10FFFF)) for _ in range(n)]
    return "".join(c for c in chars if c.isprintable())


def test_pricing(rng: random.Random) -> int:
    errors = 0
    for _ in range(N_ITERATIONS):
        model = rand_str(rng, 256)
        lookup_pricing(model)

        input_t = rng.randint(0, 10_000_000)
        output_t = rng.randint(0, 10_000_000)
        cache_r = rng.randint(0, 10_000_000)
        cache_w = rng.randint(0, 10_000_000)
        calculate_cost(model, input_t, output_t, cache_r, cache_w)

        stripped = _strip_date_suffix(model)
        if len(stripped) > len(model):
            print(f"  FAIL: _strip_date_suffix grew string: {model!r} -> {stripped!r}")
            errors += 1

    # known models
    for model in ["gpt-4o", "claude-sonnet-4-6", "gpt-4o-mini", "o3-mini"]:
        r = lookup_pricing(model)
        assert r is not None, f"known model {model} not found"
        c = calculate_cost(model, 1000, 500)
        assert c is not None and c > 0, f"cost for {model} should be positive"

    return errors


def test_sse_scanner(rng: random.Random) -> int:
    errors = 0
    for _ in range(N_ITERATIONS):
        scanner = _SSEScanner()
        n_chunks = rng.randint(1, 10)
        for _ in range(n_chunks):
            chunk = rand_bytes(rng, 1024)
            try:
                scanner.feed(chunk)
            except Exception as e:
                print(f"  FAIL: _SSEScanner.feed crashed: {e}")
                errors += 1
        try:
            scanner.result()
        except Exception as e:
            print(f"  FAIL: _SSEScanner.result crashed: {e}")
            errors += 1

    # valid SSE stream
    scanner = _SSEScanner()
    scanner.feed(
        b'data: {"model":"gpt-4o","usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'
    )
    r = scanner.result()
    assert r is not None and r.total_cost is not None
    return errors


def test_json_extract(rng: random.Random) -> int:
    errors = 0
    for _ in range(N_ITERATIONS):
        raw = rand_bytes(rng, 2048)
        try:
            _extract_cost_from_json(raw)
        except Exception as e:
            print(f"  FAIL: _extract_cost_from_json crashed on random bytes: {e}")
            errors += 1

    # semi-structured payloads
    for _ in range(N_ITERATIONS):
        payload: dict = {}
        if rng.random() > 0.3:
            payload["model"] = rng.choice(
                ["gpt-4o", "claude-sonnet-4-6", rand_str(rng, 64)]
            )
        if rng.random() > 0.3:
            usage: dict = {}
            for key in [
                "prompt_tokens",
                "completion_tokens",
                "input_tokens",
                "output_tokens",
            ]:
                if rng.random() > 0.5:
                    usage[key] = rng.randint(-100, 5_000_000)
            if rng.random() > 0.7:
                usage["prompt_tokens_details"] = {
                    "cached_tokens": rng.randint(0, 1_000_000)
                }
            payload["usage"] = usage
        try:
            _extract_cost_from_json(json.dumps(payload).encode())
        except Exception as e:
            print(f"  FAIL: _extract_cost_from_json crashed on structured: {e}")
            errors += 1

    return errors


def test_types(rng: random.Random) -> int:
    errors = 0
    for _ in range(N_ITERATIONS):
        headers: dict[str, str] = {}
        for key in [
            "x-llmkit-cost",
            "x-llmkit-latency-ms",
            "x-llmkit-provider",
            "x-llmkit-session-id",
        ]:
            if rng.random() > 0.5:
                headers[key] = rand_str(rng, 64)
        try:
            info = CostInfo.from_headers(headers)
            assert isinstance(info, CostInfo)
        except Exception as e:
            print(f"  FAIL: CostInfo.from_headers crashed: {e}")
            errors += 1

    for _ in range(N_ITERATIONS // 5):
        stats = SessionStats(session_id=rand_str(rng, 16))
        for _ in range(rng.randint(0, 20)):
            cost_val = rng.uniform(-1000, 1000) if rng.random() > 0.3 else None
            stats.record(CostInfo(total_cost=cost_val, estimated=rng.random() > 0.5))
        try:
            str(stats)
            stats.avg_cost
        except Exception as e:
            print(f"  FAIL: SessionStats method crashed: {e}")
            errors += 1

    return errors


def main() -> None:
    rng = random.Random(SEED)
    total_errors = 0

    for name, fn in [
        ("pricing", test_pricing),
        ("sse_scanner", test_sse_scanner),
        ("json_extract", test_json_extract),
        ("types", test_types),
    ]:
        print(f"fuzzing {name}...")
        errs = fn(rng)
        total_errors += errs
        status = "PASS" if errs == 0 else f"FAIL ({errs} errors)"
        print(f"  {name}: {status}")

    print(f"\ntotal errors: {total_errors}")
    sys.exit(1 if total_errors > 0 else 0)


if __name__ == "__main__":
    main()
