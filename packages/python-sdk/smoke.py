#!/usr/bin/env python3
"""LLMKit smoke test - validates tracked() against live LLM APIs.

Runs real API calls through the cost-tracking transport and verifies
that costs are captured accurately. Use as a pre-publish gate or CI check.

Usage:
    python smoke.py                          # run all available tests
    python smoke.py --provider openai        # openai only
    python smoke.py --json                   # machine-readable output
    python smoke.py --verbose                # show raw API responses

Env vars:
    OPENAI_API_KEY      - required for OpenAI tests
    ANTHROPIC_API_KEY   - required for Anthropic tests
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field

from llmkit import CostInfo, tracked, tracked_async
from llmkit._pricing import lookup_pricing

# cheapest models to keep smoke test cost near zero
OPENAI_MODEL = "gpt-4o-mini"
ANTHROPIC_MODEL = "claude-3-haiku-20240307"
PROMPT = "Say 'ok' and nothing else."


@dataclass
class Result:
    name: str
    passed: bool
    cost: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0
    error: str | None = None
    details: dict = field(default_factory=dict)


def _col(code: int, text: str) -> str:
    if not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"


def _green(t: str) -> str:
    return _col(32, t)


def _red(t: str) -> str:
    return _col(31, t)


def _dim(t: str) -> str:
    return _col(90, t)


def _bold(t: str) -> str:
    return _col(1, t)


def _cyan(t: str) -> str:
    return _col(36, t)


def _yellow(t: str) -> str:
    return _col(33, t)


# -- OpenAI tests ----------------------------------------------------------


def test_openai_nonstream(verbose: bool) -> Result:
    from openai import OpenAI

    costs: list[CostInfo] = []
    client = OpenAI(http_client=tracked(on_cost=costs.append))

    t0 = time.perf_counter()
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": PROMPT}],
        max_tokens=10,
    )
    elapsed = (time.perf_counter() - t0) * 1000

    usage = resp.usage
    details = {}
    if verbose and usage:
        details["raw_usage"] = {
            "prompt_tokens": usage.prompt_tokens,
            "completion_tokens": usage.completion_tokens,
        }
        details["content"] = resp.choices[0].message.content

    if not costs:
        return Result("openai/non-stream", False, latency_ms=elapsed, error="no cost captured")

    cost = costs[0]
    pricing = lookup_pricing(OPENAI_MODEL)
    if not pricing or not usage:
        return Result("openai/non-stream", False, latency_ms=elapsed, error="missing pricing or usage")

    expected = (usage.prompt_tokens / 1e6) * pricing[0] + (usage.completion_tokens / 1e6) * pricing[1]
    drift = abs((cost.total_cost or 0) - expected)
    ok = drift < 0.0001  # less than $0.0001 drift

    return Result(
        "openai/non-stream",
        ok,
        cost=cost.total_cost,
        input_tokens=usage.prompt_tokens,
        output_tokens=usage.completion_tokens,
        latency_ms=elapsed,
        error=f"cost drift ${drift:.6f}" if not ok else None,
        details={**details, "expected": expected, "actual": cost.total_cost, "drift": drift},
    )


def test_openai_stream(verbose: bool) -> Result:
    from openai import OpenAI

    costs: list[CostInfo] = []
    client = OpenAI(
        http_client=tracked(on_cost=costs.append),
    )

    chunks = []
    t0 = time.perf_counter()
    stream = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": PROMPT}],
        max_tokens=10,
        stream=True,
        stream_options={"include_usage": True},
    )
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            chunks.append(chunk.choices[0].delta.content)
    elapsed = (time.perf_counter() - t0) * 1000

    details = {}
    if verbose:
        details["content"] = "".join(chunks)

    if not costs:
        return Result("openai/stream", False, latency_ms=elapsed, error="no cost captured from stream")

    cost = costs[0]
    ok = cost.total_cost is not None and cost.total_cost > 0
    return Result(
        "openai/stream",
        ok,
        cost=cost.total_cost,
        latency_ms=elapsed,
        error="cost is zero or None" if not ok else None,
        details=details,
    )


# -- Anthropic tests -------------------------------------------------------


def test_anthropic_nonstream(verbose: bool) -> Result:
    import anthropic

    costs: list[CostInfo] = []
    client = anthropic.Anthropic(http_client=tracked(on_cost=costs.append))

    t0 = time.perf_counter()
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=10,
        messages=[{"role": "user", "content": PROMPT}],
    )
    elapsed = (time.perf_counter() - t0) * 1000

    details = {}
    if verbose:
        details["raw_usage"] = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}
        details["content"] = msg.content[0].text if msg.content else ""

    if not costs:
        return Result("anthropic/non-stream", False, latency_ms=elapsed, error="no cost captured")

    cost = costs[0]
    pricing = lookup_pricing(ANTHROPIC_MODEL)
    if not pricing:
        return Result("anthropic/non-stream", False, latency_ms=elapsed, error="missing pricing")

    expected = (msg.usage.input_tokens / 1e6) * pricing[0] + (msg.usage.output_tokens / 1e6) * pricing[1]
    drift = abs((cost.total_cost or 0) - expected)
    ok = drift < 0.0001

    return Result(
        "anthropic/non-stream",
        ok,
        cost=cost.total_cost,
        input_tokens=msg.usage.input_tokens,
        output_tokens=msg.usage.output_tokens,
        latency_ms=elapsed,
        error=f"cost drift ${drift:.6f}" if not ok else None,
        details={**details, "expected": expected, "actual": cost.total_cost, "drift": drift},
    )


def test_anthropic_stream(verbose: bool) -> Result:
    import anthropic

    costs: list[CostInfo] = []
    client = anthropic.Anthropic(http_client=tracked(on_cost=costs.append))

    chunks = []
    t0 = time.perf_counter()
    with client.messages.stream(
        model=ANTHROPIC_MODEL,
        max_tokens=10,
        messages=[{"role": "user", "content": PROMPT}],
    ) as stream:
        for text in stream.text_stream:
            chunks.append(text)
    elapsed = (time.perf_counter() - t0) * 1000

    details = {}
    if verbose:
        details["content"] = "".join(chunks)

    if not costs:
        return Result("anthropic/stream", False, latency_ms=elapsed, error="no cost captured from stream")

    cost = costs[0]
    ok = cost.total_cost is not None and cost.total_cost > 0
    return Result(
        "anthropic/stream",
        ok,
        cost=cost.total_cost,
        latency_ms=elapsed,
        error="cost is zero or None" if not ok else None,
        details=details,
    )


# -- Async tests -----------------------------------------------------------


def test_openai_async(verbose: bool) -> Result:
    import asyncio

    from openai import AsyncOpenAI

    costs: list[CostInfo] = []

    async def run() -> tuple[object, float]:
        client = AsyncOpenAI(http_client=tracked_async(on_cost=costs.append))
        t0 = time.perf_counter()
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": PROMPT}],
            max_tokens=10,
        )
        return resp, (time.perf_counter() - t0) * 1000

    resp, elapsed = asyncio.run(run())

    if not costs:
        return Result("openai/async", False, latency_ms=elapsed, error="no cost captured")

    cost = costs[0]
    ok = cost.total_cost is not None and cost.total_cost > 0
    return Result(
        "openai/async",
        ok,
        cost=cost.total_cost,
        latency_ms=elapsed,
        error="cost is zero or None" if not ok else None,
    )


def test_anthropic_async(verbose: bool) -> Result:
    import asyncio

    import anthropic

    costs: list[CostInfo] = []

    async def run() -> tuple[object, float]:
        client = anthropic.AsyncAnthropic(http_client=tracked_async(on_cost=costs.append))
        t0 = time.perf_counter()
        msg = await client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=10,
            messages=[{"role": "user", "content": PROMPT}],
        )
        return msg, (time.perf_counter() - t0) * 1000

    resp, elapsed = asyncio.run(run())

    if not costs:
        return Result("anthropic/async", False, latency_ms=elapsed, error="no cost captured")

    cost = costs[0]
    ok = cost.total_cost is not None and cost.total_cost > 0
    return Result(
        "anthropic/async",
        ok,
        cost=cost.total_cost,
        latency_ms=elapsed,
        error="cost is zero or None" if not ok else None,
    )


# -- Cost accuracy audit ---------------------------------------------------


def test_pricing_sanity(_verbose: bool) -> Result:
    """Verify bundled pricing table has entries for the models we test."""
    missing = []
    for model in [OPENAI_MODEL, ANTHROPIC_MODEL]:
        if not lookup_pricing(model):
            missing.append(model)
    ok = len(missing) == 0
    return Result(
        "pricing/sanity",
        ok,
        error=f"missing pricing: {', '.join(missing)}" if missing else None,
    )


# -- Runner -----------------------------------------------------------------

ALL_TESTS = {
    "openai": [
        test_openai_nonstream,
        test_openai_stream,
        test_openai_async,
    ],
    "anthropic": [
        test_anthropic_nonstream,
        test_anthropic_stream,
        test_anthropic_async,
    ],
    "pricing": [
        test_pricing_sanity,
    ],
}


def run(provider: str | None, verbose: bool, json_out: bool) -> int:
    results: list[Result] = []
    total_cost = 0.0

    providers = [provider] if provider else list(ALL_TESTS.keys())

    for prov in providers:
        tests = ALL_TESTS.get(prov)
        if not tests:
            print(_red(f"unknown provider: {prov}"))
            return 1

        # skip providers without API keys (except pricing which needs none)
        if prov == "openai" and not os.environ.get("OPENAI_API_KEY"):
            if not json_out:
                print(_yellow(f"  skip  {prov} (no OPENAI_API_KEY)"))
            continue
        if prov == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY"):
            if not json_out:
                print(_yellow(f"  skip  {prov} (no ANTHROPIC_API_KEY)"))
            continue

        for fn in tests:
            if not json_out:
                sys.stdout.write(f"  {'...':<6} {fn.__name__[5:]}")
                sys.stdout.flush()

            try:
                r = fn(verbose)
            except Exception as exc:
                r = Result(fn.__name__[5:], False, error=str(exc))

            results.append(r)
            if r.cost:
                total_cost += r.cost

            if not json_out:
                tag = _green(" pass ") if r.passed else _red(" FAIL ")
                cost_s = f"${r.cost:.6f}" if r.cost else "-"
                ms_s = f"{r.latency_ms:.0f}ms" if r.latency_ms else "-"
                sys.stdout.write(f"\r  {tag} {r.name:<25} {cost_s:>12}  {ms_s:>8}")
                if r.error:
                    sys.stdout.write(f"  {_red(r.error)}")
                sys.stdout.write("\n")

                if verbose and r.details:
                    for k, v in r.details.items():
                        print(f"         {_dim(k)}: {v}")

    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)

    if json_out:
        out = {
            "passed": passed,
            "failed": failed,
            "total_cost_usd": total_cost,
            "results": [asdict(r) for r in results],
        }
        print(json.dumps(out, indent=2))
    else:
        print()
        print(f"  {_bold('Results')}: {_green(f'{passed} passed')}", end="")
        if failed:
            print(f", {_red(f'{failed} failed')}", end="")
        print()
        print(f"  {_bold('Cost')}:    ${total_cost:.6f}")
        print()

    return 1 if failed else 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="LLMKit smoke test - validate tracked() against live APIs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY to enable provider tests.",
    )
    parser.add_argument("--provider", "-p", choices=["openai", "anthropic", "pricing"], help="test one provider only")
    parser.add_argument("--json", "-j", action="store_true", dest="json_out", help="JSON output for CI")
    parser.add_argument("--verbose", "-v", action="store_true", help="show raw responses and details")
    args = parser.parse_args()

    if not args.json_out:
        print()
        print(f"  {_bold('LLMKit Smoke Test')}")
        print(f"  {_dim('validating tracked() against live APIs')}")
        print()

    sys.exit(run(args.provider, args.verbose, args.json_out))


if __name__ == "__main__":
    main()
