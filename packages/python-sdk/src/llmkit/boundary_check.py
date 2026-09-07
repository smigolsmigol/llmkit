"""Check a declared boundary policy without running an agent or contacting a service."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .boundary_policy import BoundaryPolicy


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("policy", type=Path, help="Versioned JSON route policy")
    args = parser.parse_args(argv)
    try:
        report = BoundaryPolicy.load(args.policy).check()
    except (OSError, ValueError):
        print(json.dumps({"ok": False, "error": "invalid_boundary_policy"}))
        return 2
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
