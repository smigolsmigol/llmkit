"""Check a declared boundary policy without running an agent or contacting a service."""

from __future__ import annotations

import argparse
import json
from importlib.resources import files
from pathlib import Path

from .boundary_policy import BoundaryPolicy


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("policy", type=Path, help="Versioned JSON route policy")
    parser.add_argument(
        "--write-example",
        choices=("openai-agents", "pydantic-ai"),
        help="Write a bundled example to a new policy file instead of checking it",
    )
    args = parser.parse_args(argv)
    if args.write_example:
        try:
            source = files("llmkit").joinpath("policies", f"{args.write_example}.json").read_bytes()
            BoundaryPolicy.parse(source.decode("utf-8"))
            with args.policy.open("xb") as destination:
                destination.write(source)
        except (OSError, ValueError):
            print(json.dumps({"written": False, "error": "example_policy_write_failed"}))
            return 2
        print(json.dumps({"written": True}))
        return 0
    try:
        report = BoundaryPolicy.load(args.policy).check()
    except (OSError, ValueError):
        print(json.dumps({"ok": False, "error": "invalid_boundary_policy"}))
        return 2
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
