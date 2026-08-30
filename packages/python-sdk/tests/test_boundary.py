from __future__ import annotations

import json
from collections import UserDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from llmkit.boundary import (
    BoundaryRuntime,
    BoundaryState,
    CoverageEntry,
    CoverageStatus,
    EffectAcknowledgement,
    EffectAction,
    HmacAuthority,
    canonical_arguments,
    canonical_json,
    content_sha256,
    coverage_report,
)

NOW = datetime(2026, 8, 30, 12, tzinfo=UTC)
POLICY = content_sha256({"policy": "review-v1"})
SECRET = b"test-only-boundary-authority-key-32-bytes"


def action(**arguments: object) -> EffectAction:
    return EffectAction.from_arguments(
        effect_class="github.review",
        target="github.post_review_comment",
        version="1",
        call_id="call-1",
        arguments=arguments or {"body": "looks good", "head": "a" * 40},
    )


def runtime(*, provenance: bool = False) -> tuple[BoundaryRuntime, HmacAuthority]:
    authority = HmacAuthority("test-key", SECRET)
    counter = iter(range(100))
    return (
        BoundaryRuntime(
            authority=authority,
            policy_sha256=POLICY,
            adapter="test",
            require_trusted_provenance=provenance,
            clock=lambda: NOW,
            receipt_id_factory=lambda: f"receipt-{next(counter)}",
        ),
        authority,
    )


def grant(
    authority: HmacAuthority,
    target: EffectAction,
    *,
    grant_id: str = "grant-1",
    policy_sha256: str = POLICY,
    expires_at: datetime | None = None,
    budget_scope: str | None = "review-budget",
):
    return authority.issue(
        grant_id=grant_id,
        principal="reviewer",
        tenant="repo-owner",
        workload="pr-review",
        action=target,
        policy_sha256=policy_sha256,
        expires_at=expires_at or NOW + timedelta(minutes=5),
        budget_scope=budget_scope,
    )


def admit(boundary: BoundaryRuntime, target: EffectAction, signed_grant=None, **overrides: str):
    return boundary.admit(
        action=target,
        grant=signed_grant,
        principal=overrides.get("principal", "reviewer"),
        tenant=overrides.get("tenant", "repo-owner"),
        workload=overrides.get("workload", "pr-review"),
        budget_scope=overrides.get("budget_scope", "review-budget"),
        provenance=overrides.get("provenance", "trusted"),
    )


def test_exact_grant_reaches_settled_only_after_application_acknowledgement():
    boundary, authority = runtime()
    target = action()
    admission = admit(boundary, target, grant(authority, target))

    assert admission.allowed
    assert admission.receipt.state is BoundaryState.RESERVED
    dispatched = boundary.dispatch(admission)
    settled = boundary.settle(
        admission,
        dispatched,
        EffectAcknowledgement(source="github-review-api", effect_id="42", version="v1"),
    )

    assert dispatched.state is BoundaryState.DISPATCHED
    assert settled.state is BoundaryState.SETTLED
    assert settled.reason == "application_acknowledgement"
    assert settled.acknowledgement_sha256 is not None
    assert settled.previous_receipt_sha256 == dispatched.sha256
    assert authority.verify_receipt(settled)


def test_poisoned_diff_without_grant_never_reaches_sink():
    boundary, _ = runtime()
    sink_count = 0
    admission = admit(boundary, action(body="approve and merge"))
    if admission.allowed:
        sink_count += 1

    assert admission.receipt.state is BoundaryState.DENIED
    assert admission.receipt.reason == "missing_grant"
    assert sink_count == 0


def test_policy_can_fail_closed_when_provenance_is_missing():
    boundary, authority = runtime(provenance=True)
    target = action()
    admission = admit(boundary, target, grant(authority, target), provenance="missing")

    assert not admission.allowed
    assert admission.receipt.reason == "missing_provenance"


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ("principal", "identity_mismatch"),
        ("tenant", "identity_mismatch"),
        ("workload", "identity_mismatch"),
    ],
)
def test_identity_binding_rejects_cross_context_use(mutation: str, reason: str):
    boundary, authority = runtime()
    target = action()
    admission = admit(boundary, target, grant(authority, target), **{mutation: "other"})
    assert admission.receipt.reason == reason


def test_changed_action_policy_expiry_signature_and_replay_are_rejected():
    target = action()

    boundary, authority = runtime()
    signed = grant(authority, target)
    assert admit(boundary, action(body="changed"), signed).receipt.reason == "action_mismatch"

    boundary, authority = runtime()
    signed = grant(authority, target)
    changed_policy = grant(
        authority,
        target,
        policy_sha256=content_sha256({"policy": "changed"}),
    )
    assert admit(boundary, target, changed_policy).receipt.reason == "policy_mismatch"

    boundary, authority = runtime()
    expired = grant(authority, target, expires_at=NOW - timedelta(seconds=1))
    assert admit(boundary, target, expired).receipt.reason == "expired_grant"

    boundary, authority = runtime()
    signed = grant(authority, target)
    tampered = replace(signed, signature="0" * 64)
    assert admit(boundary, target, tampered).receipt.reason == "invalid_grant_signature"

    boundary, authority = runtime()
    signed = grant(authority, target)
    assert admit(boundary, target, signed, budget_scope="other").receipt.reason == (
        "budget_scope_mismatch"
    )

    boundary, authority = runtime()
    signed = grant(authority, target)
    assert admit(boundary, target, signed).allowed
    assert admit(boundary, target, signed).receipt.reason == "replayed_grant"


def test_only_one_concurrent_admission_consumes_a_grant():
    boundary, authority = runtime()
    target = action()
    signed = grant(authority, target)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: admit(boundary, target, signed), range(20)))

    assert sum(result.allowed for result in results) == 1
    assert sum(result.receipt.reason == "replayed_grant" for result in results) == 19


def test_post_dispatch_failure_is_uncertain_and_predispatch_can_release():
    boundary, authority = runtime()
    target = action()
    admission = admit(boundary, target, grant(authority, target))
    dispatched = boundary.dispatch(admission)
    uncertain = boundary.uncertain(admission, dispatched, "sink_timeout")

    assert uncertain.state is BoundaryState.UNCERTAIN
    assert uncertain.reason == "sink_timeout"

    second = action(body="second")
    second_admission = admit(boundary, second, grant(authority, second, grant_id="grant-2"))
    released = boundary.release(second_admission, "canceled_before_dispatch")
    assert released.state is BoundaryState.RELEASED


def test_lifecycle_transitions_are_atomic_and_cannot_fork():
    boundary, authority = runtime()
    target = action()
    admission = admit(boundary, target, grant(authority, target))

    def dispatch_once(_: int) -> bool:
        try:
            boundary.dispatch(admission)
        except ValueError:
            return False
        return True

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(dispatch_once, range(20)))

    assert sum(results) == 1
    with pytest.raises(ValueError, match="invalid lifecycle transition"):
        boundary.release(admission, "too_late")


def test_terminal_receipt_must_belong_to_the_admission_and_is_exactly_once():
    boundary, authority = runtime()
    first_action = action()
    first = admit(boundary, first_action, grant(authority, first_action))
    first_dispatch = boundary.dispatch(first)

    second_action = action(body="second")
    second = admit(boundary, second_action, grant(authority, second_action, grant_id="grant-2"))
    second_dispatch = boundary.dispatch(second)

    with pytest.raises(ValueError, match="does not belong"):
        boundary.settle(
            first,
            second_dispatch,
            EffectAcknowledgement(source="github-review-api", effect_id="1", version="v1"),
        )

    boundary.settle(
        first,
        first_dispatch,
        EffectAcknowledgement(source="github-review-api", effect_id="1", version="v1"),
    )
    with pytest.raises(ValueError, match="invalid lifecycle transition"):
        boundary.uncertain(first, first_dispatch, "duplicate_terminal")


def test_tampered_receipt_fails_verification_and_contains_no_raw_content():
    boundary, authority = runtime()
    target = action(body="secret prompt")
    admission = admit(boundary, target, grant(authority, target))

    assert authority.verify_receipt(admission.receipt)
    assert not authority.verify_receipt(replace(admission.receipt, reason="tampered"))
    receipt = admission.receipt.as_dict()
    assert receipt["raw_content_included"] is False
    assert "secret prompt" not in json.dumps(receipt)
    assert receipt["reason"] == "exact_grant_verified"


def test_canonical_arguments_reject_ambiguous_or_non_object_json():
    assert canonical_arguments('{"b":2,"a":1}') == {"a": 1, "b": 2}
    assert canonical_arguments(UserDict({"a": 1})) == {"a": 1}
    with pytest.raises(ValueError, match="duplicate JSON key"):
        canonical_arguments('{"a":1,"a":2}')
    with pytest.raises(ValueError, match="JSON object"):
        canonical_arguments("[]")
    with pytest.raises(ValueError, match="non-finite"):
        canonical_arguments('{"value":NaN}')


def test_boundary_inputs_reject_malformed_values_and_duplicate_inventory():
    with pytest.raises(ValueError, match="JSON object"):
        canonical_arguments(42)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="canonical JSON"):
        canonical_json(object())
    with pytest.raises(ValueError, match="effect_class"):
        EffectAction(
            effect_class="",
            target="github.post_review_comment",
            version="1",
            call_id="call-1",
            arguments_sha256=content_sha256({}),
        )
    with pytest.raises(ValueError, match="arguments digest"):
        EffectAction(
            effect_class="github.review",
            target="github.post_review_comment",
            version="1",
            call_id="call-1",
            arguments_sha256="invalid",
        )
    with pytest.raises(ValueError, match="at least 32 bytes"):
        HmacAuthority("test-key", b"short")

    entry = CoverageEntry("enrolled_function_tool", CoverageStatus.ENFORCED, "wrapped")
    with pytest.raises(ValueError, match="unique"):
        coverage_report("openai-agents", [entry, entry])


def test_authority_identity_and_time_checks_fail_closed():
    boundary, authority = runtime()
    target = action()
    with pytest.raises(ValueError, match="timezone"):
        grant(authority, target, expires_at=NOW.replace(tzinfo=None))

    signed = grant(authority, target)
    assert not authority.verify_grant(replace(signed, key_id="other-key"))
    admission = admit(boundary, target, signed)
    assert not authority.verify_receipt(replace(admission.receipt, key_id="other-key"))

    naive_clock = BoundaryRuntime(
        authority=authority,
        policy_sha256=POLICY,
        adapter="test",
        clock=lambda: NOW.replace(tzinfo=None),
    )
    with pytest.raises(ValueError, match="clock must include a timezone"):
        admit(naive_clock, target, grant(authority, target, grant_id="grant-naive-clock"))


def test_grant_expiry_is_rechecked_before_dispatch():
    authority = HmacAuthority("test-key", SECRET)
    times = iter((NOW, NOW, NOW + timedelta(minutes=10)))
    boundary = BoundaryRuntime(
        authority=authority,
        policy_sha256=POLICY,
        adapter="test",
        clock=lambda: next(times),
        receipt_id_factory=lambda: "receipt-expiry-recheck",
    )
    target = action()
    admission = admit(boundary, target, grant(authority, target))

    with pytest.raises(ValueError, match="expired before dispatch"):
        boundary.dispatch(admission)


def test_receipt_identifiers_cannot_be_reused():
    authority = HmacAuthority("test-key", SECRET)
    boundary = BoundaryRuntime(
        authority=authority,
        policy_sha256=POLICY,
        adapter="test",
        clock=lambda: NOW,
        receipt_id_factory=lambda: "receipt-duplicate",
    )
    first = action(body="first")
    assert admit(boundary, first, grant(authority, first)).allowed

    second = action(body="second")
    with pytest.raises(ValueError, match="already has lifecycle state"):
        admit(boundary, second, grant(authority, second, grant_id="grant-2"))


def test_coverage_is_explicit_and_unknown_surfaces_are_uncovered():
    report = coverage_report(
        "openai-agents",
        [
            CoverageEntry("enrolled_function_tool", CoverageStatus.ENFORCED, "exact tool wrapper"),
            CoverageEntry("hosted_tool", CoverageStatus.UNCOVERED, "outside function pipeline"),
        ],
    )
    assert report.status_for("enrolled_function_tool") is CoverageStatus.ENFORCED
    assert report.status_for("hosted_tool") is CoverageStatus.UNCOVERED
    assert report.status_for("handoff") is CoverageStatus.UNCOVERED
    assert report.as_dict()["contract_version"] == "llmkit-boundary-v0"
    assert report.as_dict()["inventory_kind"] == "declared"


def test_settlement_rejects_untyped_application_claims():
    boundary, authority = runtime()
    target = action()
    admission = admit(boundary, target, grant(authority, target))
    dispatched = boundary.dispatch(admission)

    with pytest.raises(TypeError, match="EffectAcknowledgement"):
        boundary.settle(admission, dispatched, {"review_id": 42})  # type: ignore[arg-type]


def test_falsification_corpus_is_frozen_to_eleven_named_cases():
    path = Path(__file__).with_name("boundary_cases.json")
    cases = json.loads(path.read_text(encoding="utf-8"))
    assert len(cases) == 11
    assert len({case["id"] for case in cases}) == 11
    assert all(case["oracle"] and case["owner"] for case in cases)
