import json
import runpy
import sys
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from pathlib import Path

import pytest

from llmkit.boundary import BoundaryRuntime, EffectAction, EffectScope, HmacAuthority
from llmkit.boundary_check import main
from llmkit.boundary_policy import BoundaryPolicy, BoundaryRoute


def policy_payload():
    return {
        "version": "llmkit-boundary-policy-v1",
        "adapter": "openai-agents",
        "require_trusted_provenance": False,
        "routes": [
            {
                "id": "post_review_comment",
                "surface": "enrolled_function_tool",
                "effect_class": "github.review_comment",
                "target": "post_review_comment",
                "version": "1",
                "enrolled": True,
            }
        ],
    }


@pytest.mark.parametrize("empty_scope", [False, True])
def test_policy_check_and_runtime_use_the_same_scope(empty_scope):
    policy = BoundaryPolicy.parse(json.dumps(policy_payload()))
    assert policy.check()["ok"] is True
    authority = HmacAuthority("test-authority", b"a" * 32)
    runtime = policy.runtime(authority=authority)
    if empty_scope:
        runtime = BoundaryRuntime(
            authority=authority,
            policy_sha256=policy.sha256,
            adapter=policy.adapter,
            allowed_effects=(),
        )
    action = EffectAction.from_arguments(
        effect_class="github.review_comment",
        target="post_review_comment",
        version="1",
        call_id="comment-1",
        arguments={"body": "test the empty case"},
    )
    grant = authority.issue(
        grant_id="comment-1",
        principal="reviewer",
        tenant="example",
        workload="review",
        action=action,
        policy_sha256=policy.sha256,
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    admission = runtime.admit(
        action=action,
        grant=grant,
        principal="reviewer",
        tenant="example",
        workload="review",
        budget_scope=None,
        provenance="untrusted",
    )
    assert admission.allowed is not empty_scope
    if empty_scope:
        assert admission.receipt.reason == "action_outside_policy"
    assert admission.receipt.policy_sha256 == policy.check()["policy_sha256"]


def test_unenrolled_route_fails_check_and_runtime_construction():
    payload = policy_payload()
    payload["routes"][0]["enrolled"] = False
    policy = BoundaryPolicy.parse(json.dumps(payload))
    assert policy.check()["findings"] == [
        {"route": "post_review_comment", "reason": "unenrolled_route"}
    ]
    with pytest.raises(ValueError, match="boundary_policy_check_failed"):
        policy.runtime(authority=HmacAuthority("test-authority", b"a" * 32))


@pytest.mark.parametrize("adapter", ["openai-agents", "pydantic-ai"])
def test_both_native_adapters_use_the_same_policy_contract(adapter):
    payload = policy_payload()
    payload["adapter"] = adapter
    policy = BoundaryPolicy.parse(json.dumps(payload))
    assert policy.check()["ok"]
    assert policy.runtime(authority=HmacAuthority("test-authority", b"a" * 32)).adapter == adapter


@pytest.mark.parametrize("field,value", [("surface", "direct_client"), ("surface", "unknown")])
def test_uncontrolled_routes_are_never_green(field, value):
    payload = policy_payload()
    payload["routes"][0][field] = value
    policy = BoundaryPolicy.parse(json.dumps(payload))
    assert policy.check()["findings"] == [
        {"route": "post_review_comment", "reason": "unsupported_surface"}
    ]


@pytest.mark.parametrize(
    "change",
    [
        {"version": "future"},
        {"adapter": "arbitrary.module:factory"},
        {"require_trusted_provenance": "false"},
        {"routes": []},
        {"routes": None},
        {"routes": [None]},
        {"routes": [{"enrolled": True}]},
        {"routes": [{}] * 129},
        {"extra": True},
    ],
)
def test_invalid_policy_shapes_fail_closed(change):
    with pytest.raises(ValueError, match="invalid_boundary_policy"):
        BoundaryPolicy.parse(json.dumps({**policy_payload(), **change}))


@pytest.mark.parametrize(
    "source",
    ['{"version":1,"version":2}', "[]", "NaN", "{", "[" * 2000],
    ids=["duplicate-key", "array", "nonfinite", "truncated", "too-deep"],
)
def test_malformed_json_has_a_bounded_failure(source):
    with pytest.raises(ValueError, match="invalid_boundary_policy"):
        BoundaryPolicy.parse(source)


@pytest.mark.parametrize(
    "field,value", [("enrolled", 1), ("enrolled", None), ("id", "\x1b[2J"), ("target", 42)]
)
def test_route_types_and_terminal_controls_are_rejected(field, value):
    payload = policy_payload()
    payload["routes"][0][field] = value
    with pytest.raises(ValueError, match="invalid_boundary_policy"):
        BoundaryPolicy.parse(json.dumps(payload))


@pytest.mark.parametrize("same_id", [True, False])
def test_duplicate_routes_or_effects_are_rejected(same_id):
    payload = policy_payload()
    duplicate = dict(payload["routes"][0])
    if not same_id:
        duplicate["id"] = "different-id"
    payload["routes"].append(duplicate)
    with pytest.raises(ValueError, match="invalid_boundary_policy"):
        BoundaryPolicy.parse(json.dumps(payload))


def test_empty_or_mutable_route_collections_are_not_valid_policies():
    route = BoundaryRoute(**policy_payload()["routes"][0])
    for routes in ([], (), [route], ("bad",), (route,) * 129):
        with pytest.raises(ValueError, match="invalid_boundary_routes"):
            BoundaryPolicy("openai-agents", routes)


def test_policy_snapshot_and_digest_are_stable():
    payload = policy_payload()
    policy = BoundaryPolicy.parse(json.dumps(payload))
    digest = policy.sha256
    payload["routes"][0]["enrolled"] = False
    assert policy.sha256 == digest
    assert policy.sha256 == BoundaryPolicy.parse(json.dumps(policy.as_dict(), indent=4)).sha256
    with pytest.raises(AttributeError):
        policy.routes[0].enrolled = False


def test_optional_adapter_absence_fails_closed(monkeypatch):
    def unavailable(_):
        raise ImportError("optional SDK missing")

    monkeypatch.setattr("llmkit.boundary_policy._coverage", unavailable)
    policy = BoundaryPolicy.parse(json.dumps(policy_payload()))
    assert policy.check()["findings"][0]["reason"] == "adapter_unavailable"


@pytest.mark.parametrize(
    "change",
    [
        {"effect_class": "other"},
        {"version": "2"},
        {"target": "direct:openai:model"},
        {"target": "llmkit-gateway:openai"},
        {"target": "llmkit-gateway::model"},
    ],
)
def test_model_surface_requires_the_model_dispatch_contract(change):
    payload = json.loads(
        (Path(__file__).resolve().parents[3] / "examples" / "pr_review_policy.json").read_text()
    )
    payload["routes"][0].update(change)
    assert BoundaryPolicy.parse(json.dumps(payload)).check()["findings"] == [
        {"route": "review_model", "reason": "model_binding_mismatch"}
    ]


def test_model_dispatch_cannot_masquerade_as_a_function_tool():
    payload = policy_payload()
    payload["routes"][0]["effect_class"] = "model.dispatch"
    assert (
        BoundaryPolicy.parse(json.dumps(payload)).check()["findings"][0]["reason"]
        == "tool_binding_mismatch"
    )


@pytest.mark.parametrize(
    "change", ["version", "target", "effect_class", "arguments", "policy", "provenance"]
)
def test_policy_runtime_rejects_changed_effect_or_evidence(change):
    policy = BoundaryPolicy.parse(json.dumps(policy_payload()))
    authority = HmacAuthority("test-authority", b"a" * 32)
    action = EffectAction.from_arguments(
        effect_class="github.review_comment",
        target="post_review_comment",
        version="1",
        call_id="comment-1",
        arguments={"body": "approved"},
    )
    grant = authority.issue(
        grant_id="comment-1",
        principal="reviewer",
        tenant="example",
        workload="review",
        action=action,
        policy_sha256=policy.sha256,
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    expected = "action_outside_policy"
    if change in ("version", "target", "effect_class"):
        action = replace(action, **{change: "different"})
    elif change == "arguments":
        action = replace(action, arguments_sha256="sha256:" + "a" * 64)
        expected = "action_mismatch"
    elif change == "policy":
        policy = replace(policy, require_trusted_provenance=True)
        expected = "policy_mismatch"
    else:
        policy = replace(policy, require_trusted_provenance=True)
        expected = "missing_provenance"
    admission = policy.runtime(authority=authority).admit(
        action=action,
        grant=grant,
        principal="reviewer",
        tenant="example",
        workload="review",
        budget_scope=None,
        provenance="untrusted" if change == "provenance" else "trusted",
    )
    assert not admission.allowed
    assert admission.receipt.reason == expected
    assert authority.verify_receipt(admission.receipt)


def test_runtime_validates_effect_scope():
    policy = BoundaryPolicy.parse(json.dumps(policy_payload()))
    authority = HmacAuthority("test-authority", b"a" * 32)
    for scopes in ([], ("bad",)):
        with pytest.raises(TypeError, match="allowed effects"):
            BoundaryRuntime(
                authority=authority,
                policy_sha256=policy.sha256,
                adapter="test",
                allowed_effects=scopes,
            )
    with pytest.raises(ValueError):
        EffectScope("", "target", "1")


def test_cli_loads_policy_and_reports_only_bounded_evidence(tmp_path, capsys):
    path = tmp_path / "policy.json"
    path.write_text(json.dumps(policy_payload()), encoding="utf-8")
    assert main([str(path)]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["inventory_kind"] == "declared"
    assert report["runtime_enforcement_verified"] is False
    payload = policy_payload()
    payload["routes"][0]["enrolled"] = False
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert main([str(path)]) == 1
    assert json.loads(capsys.readouterr().out)["findings"][0]["reason"] == "unenrolled_route"


@pytest.mark.parametrize(
    "content",
    [b"not-json-private-canary", b"\xff", b"x" * 65537],
    ids=["malformed", "invalid-utf8", "oversized"],
)
def test_cli_rejects_bad_files_without_echoing_content(tmp_path, capsys, content):
    path = tmp_path / "policy.json"
    path.write_bytes(content)
    assert main([str(path)]) == 2
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "invalid_boundary_policy"}


def test_missing_policy_and_oversized_text_fail_closed(tmp_path, capsys):
    assert main([str(tmp_path / "absent.json")]) == 2
    assert "absent.json" not in capsys.readouterr().out
    with pytest.raises(ValueError, match="too_large"):
        BoundaryPolicy.parse(" " * 65537)


def test_real_module_entrypoint_checks_the_committed_example(monkeypatch, capsys):
    path = Path(__file__).resolve().parents[3] / "examples" / "pr_review_policy.json"
    monkeypatch.delitem(sys.modules, "llmkit.boundary_check")
    monkeypatch.setattr(sys, "argv", ["llmkit.boundary_check", str(path)])
    with pytest.raises(SystemExit) as result:
        runpy.run_module("llmkit.boundary_check", run_name="__main__")
    assert result.value.code == 0
    assert json.loads(capsys.readouterr().out)["ok"]


@pytest.mark.parametrize(
    "adapter,example",
    [("openai-agents", "pr_review_policy.json"), ("pydantic-ai", "pydantic_review_policy.json")],
)
def test_bundled_policy_export_matches_example_and_check(tmp_path, capsys, adapter, example):
    path = tmp_path / "policy.json"
    assert main(["--write-example", adapter, str(path)]) == 0
    assert json.loads(capsys.readouterr().out) == {"written": True}
    resource = files("llmkit").joinpath("policies", f"{adapter}.json")
    assert path.read_bytes() == resource.read_bytes()
    canonical = Path(__file__).resolve().parents[3] / "examples" / example
    assert json.loads(path.read_bytes()) == json.loads(canonical.read_bytes())
    assert main([str(path)]) == 0
    assert json.loads(capsys.readouterr().out) == BoundaryPolicy.load(canonical).check()


@pytest.mark.parametrize("existing", [True, False])
def test_policy_export_never_overwrites_or_creates_parent_directories(tmp_path, capsys, existing):
    path = tmp_path / "private-canary.json" if existing else tmp_path / "absent" / "policy.json"
    if existing:
        path.write_bytes(b"private-canary")
    assert main(["--write-example", "openai-agents", str(path)]) == 2
    assert json.loads(capsys.readouterr().out) == {
        "written": False,
        "error": "example_policy_write_failed",
    }
    if existing:
        assert path.read_bytes() == b"private-canary"
    else:
        assert not path.parent.exists()


def test_export_does_not_require_adapter_or_claim_enforcement(tmp_path, monkeypatch, capsys):
    def unexpected_check(_):
        pytest.fail("export tried to check runtime enrollment")

    monkeypatch.setattr(BoundaryPolicy, "check", unexpected_check)
    assert main(["--write-example", "pydantic-ai", str(tmp_path / "policy.json")]) == 0
    assert json.loads(capsys.readouterr().out) == {"written": True}


def test_export_rejects_invalid_resource_before_creating_destination(tmp_path, monkeypatch, capsys):
    resources = tmp_path / "policies"
    resources.mkdir()
    (resources / "openai-agents.json").write_bytes(b"private-invalid-resource")
    monkeypatch.setitem(main.__globals__, "files", lambda _: tmp_path)
    path = tmp_path / "policy.json"
    assert main(["--write-example", "openai-agents", str(path)]) == 2
    assert not path.exists()
    assert json.loads(capsys.readouterr().out) == {
        "written": False,
        "error": "example_policy_write_failed",
    }


def test_export_rejects_unknown_adapter_without_creating_file(tmp_path, capsys):
    path = tmp_path / "policy.json"
    with pytest.raises(SystemExit) as error:
        main(["--write-example", "../unknown", str(path)])
    assert error.value.code == 2
    assert not path.exists()
    capsys.readouterr()


def test_export_partial_write_fails_and_retry_preserves_the_file(tmp_path, monkeypatch, capsys):
    original_open = Path.open
    path = tmp_path / "policy.json"

    @contextmanager
    def failed_open(self, *args, **kwargs):
        with original_open(self, *args, **kwargs) as destination:
            if self != path:
                yield destination
                return

            class PartialWrite:
                def write(self, source):
                    destination.write(source[:8])
                    raise OSError("private-write-error")

            yield PartialWrite()

    with monkeypatch.context() as patch:
        patch.setattr(Path, "open", failed_open)
        assert main(["--write-example", "openai-agents", str(path)]) == 2
    assert json.loads(capsys.readouterr().out) == {
        "written": False,
        "error": "example_policy_write_failed",
    }
    partial = path.read_bytes()
    assert len(partial) == 8
    assert main(["--write-example", "openai-agents", str(path)]) == 2
    assert path.read_bytes() == partial
    assert json.loads(capsys.readouterr().out)["written"] is False
