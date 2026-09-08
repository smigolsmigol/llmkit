"""Exercise the installed wheel from the artifact gate's isolated consumer directory."""

import asyncio
import contextlib
import io
import json
import runpy
import subprocess
import sys
from pathlib import Path

import llmkit


def check(*arguments, status=0):
    result = subprocess.run(
        [sys.executable, "-I", "-m", "llmkit.boundary_check", *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != status:
        raise RuntimeError(f"Boundary Check expected {status}, got {result.returncode}")
    return json.loads(result.stdout)


def main():
    directory = Path(__file__).resolve().parent
    if not Path(llmkit.__file__).resolve().is_relative_to(Path(sys.prefix).resolve()):
        raise RuntimeError("SDK was not imported from the isolated installation")
    if Path.cwd().resolve() != directory or not sys.flags.isolated:
        raise RuntimeError("Consumer must run in isolation outside the checkout")
    unavailable = "--without-adapters" in sys.argv
    # Only the copied examples are importable here, never the source package.
    sys.path.insert(0, str(directory))
    for adapter, policy_name, example in (
        ("openai-agents", "pr_review_policy.json", "openai_agents_boundary_review.py"),
        ("pydantic-ai", "pydantic_review_policy.json", "pydantic_ai_boundary_review.py"),
    ):
        path = directory / (f"unavailable-{policy_name}" if unavailable else policy_name)
        assert check("--write-example", adapter, str(path)) == {"written": True}
        original = path.read_bytes()
        assert check("--write-example", adapter, str(path), status=2)["written"] is False
        assert path.read_bytes() == original
        report = check(str(path), status=1 if unavailable else 0)
        assert report["runtime_enforcement_verified"] is False
        if unavailable:
            assert {finding["reason"] for finding in report["findings"]} == {"adapter_unavailable"}
            continue
        payload = json.loads(original)
        payload["routes"][1]["enrolled"] = False
        path.write_text(json.dumps(payload), encoding="utf-8")
        assert check(str(path), status=1)["findings"] == [
            {"route": "post_review_comment", "reason": "unenrolled_route"}
        ]
        path.write_text("invalid-private-canary", encoding="utf-8")
        assert check(str(path), status=2) == {"ok": False, "error": "invalid_boundary_policy"}
        path.write_bytes(original)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            asyncio.run(runpy.run_path(str(directory / example))["main"]())
        result = json.loads(output.getvalue())
        denied, approved = result["poisoned_run"], result["approved_run"]
        assert denied["error"] is not None and denied["sink_calls"] == 0
        assert denied["receipt_states"] == ["reserved", "dispatched", "settled", "denied"]
        assert approved["model_requests"] == 2 and result["sink_calls"] == 1
        assert approved["final_output"] == "Review comment posted."
        assert approved["receipt_states"] == ["reserved", "dispatched", "settled"] * 3
        for run in (denied, approved):
            assert run["boundary_check"] == report
            assert run["receipt_policy_sha256s"] == [report["policy_sha256"]]
    print("BOUNDARY_WHEEL_UNAVAILABLE PASS" if unavailable else "BOUNDARY_WHEEL_NATIVE PASS")


if __name__ == "__main__":
    main()
