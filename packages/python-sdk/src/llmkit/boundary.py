from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import threading
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal, DecimalException
from enum import StrEnum
from typing import Any

CONTRACT_VERSION = "llmkit-boundary-v0"
_DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")


class BoundaryState(StrEnum):
    DENIED = "denied"
    RESERVED = "reserved"
    DISPATCHED = "dispatched"
    SETTLED = "settled"
    RELEASED = "released"
    UNCERTAIN = "uncertain"
    UNCOVERED = "uncovered"


class CoverageStatus(StrEnum):
    ENFORCED = "enforced"
    UNCOVERED = "uncovered"


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number: {value}")


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _parse_lossless_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("JSON number loses precision")
    try:
        lossless = Decimal(value) == Decimal(str(parsed))
    except DecimalException as error:
        raise ValueError("JSON number loses precision") from error
    if not lossless:
        raise ValueError("JSON number loses precision")
    return parsed


def canonical_arguments(value: Mapping[str, Any] | str) -> dict[str, Any]:
    """Return the exact JSON object used to bind a tool action."""
    parsed: Any = value
    if isinstance(value, str):
        parsed = json.loads(
            value,
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
            parse_float=_parse_lossless_float,
        )
    elif isinstance(value, Mapping):
        parsed = dict(value)
    if not isinstance(parsed, dict):
        raise ValueError("tool arguments must be a JSON object")
    canonical_json(parsed)
    return parsed


def canonical_json(value: Any) -> bytes:
    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise ValueError("value is not canonical JSON") from error
    return encoded.encode("utf-8")


def content_sha256(value: Any) -> str:
    return f"sha256:{hashlib.sha256(canonical_json(value)).hexdigest()}"


def _require_digest(name: str, value: str) -> None:
    if not _DIGEST_PATTERN.fullmatch(value):
        raise ValueError(f"invalid {name}")


def _require_text(name: str, value: str) -> None:
    if not value or value.strip() != value:
        raise ValueError(f"invalid {name}")


def _parse_expiry(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("invalid grant expiry") from error
    if parsed.tzinfo is None:
        raise ValueError("grant expiry must include a timezone")
    return parsed.astimezone(UTC)


@dataclass(frozen=True)
class EffectAction:
    effect_class: str
    target: str
    version: str
    call_id: str
    arguments_sha256: str

    @classmethod
    def from_arguments(
        cls,
        *,
        effect_class: str,
        target: str,
        version: str,
        call_id: str,
        arguments: Mapping[str, Any] | str,
    ) -> EffectAction:
        parsed = canonical_arguments(arguments)
        return cls(
            effect_class=effect_class,
            target=target,
            version=version,
            call_id=call_id,
            arguments_sha256=content_sha256(parsed),
        )

    def __post_init__(self) -> None:
        for name in ("effect_class", "target", "version", "call_id"):
            _require_text(name, getattr(self, name))
        _require_digest("arguments digest", self.arguments_sha256)

    @property
    def sha256(self) -> str:
        return content_sha256(asdict(self))


@dataclass(frozen=True)
class EffectAcknowledgement:
    source: str
    effect_id: str
    version: str

    def __post_init__(self) -> None:
        for name in ("source", "effect_id", "version"):
            _require_text(name, getattr(self, name))

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class ExactEffectGrant:
    grant_id: str
    principal: str
    tenant: str
    workload: str
    action_sha256: str
    policy_sha256: str
    expires_at: str
    budget_scope: str | None
    key_id: str
    signature: str

    def unsigned_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("signature")
        payload["contract_version"] = CONTRACT_VERSION
        return payload


@dataclass(frozen=True)
class BoundaryReceipt:
    receipt_id: str
    state: BoundaryState
    reason: str
    principal: str
    tenant: str
    workload: str
    policy_sha256: str
    action_sha256: str
    grant_id: str | None
    adapter: str
    occurred_at: str
    previous_receipt_sha256: str | None = None
    acknowledgement_sha256: str | None = None
    raw_content_included: bool = False
    key_id: str = ""
    signature: str = ""

    def unsigned_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["state"] = self.state.value
        payload.pop("signature")
        payload["contract_version"] = CONTRACT_VERSION
        return payload

    def as_dict(self) -> dict[str, Any]:
        payload = self.unsigned_payload()
        payload["signature"] = self.signature
        return payload

    @property
    def sha256(self) -> str:
        return content_sha256(self.as_dict())


class BoundaryDispatchError(ValueError):
    """A pre-dispatch failure that carries its terminal boundary receipt."""

    def __init__(self, message: str, receipt: BoundaryReceipt) -> None:
        super().__init__(message)
        self.receipt = receipt


@dataclass(frozen=True)
class CoverageEntry:
    surface: str
    status: CoverageStatus
    reason: str


@dataclass(frozen=True)
class CoverageReport:
    adapter: str
    entries: tuple[CoverageEntry, ...]

    def __post_init__(self) -> None:
        names = [entry.surface for entry in self.entries]
        if len(names) != len(set(names)):
            raise ValueError("coverage surfaces must be unique")

    def status_for(self, surface: str) -> CoverageStatus:
        for entry in self.entries:
            if entry.surface == surface:
                return entry.status
        return CoverageStatus.UNCOVERED

    def as_dict(self) -> dict[str, Any]:
        return {
            "adapter": self.adapter,
            "contract_version": CONTRACT_VERSION,
            "inventory_kind": "declared",
            "entries": [
                {
                    "surface": entry.surface,
                    "status": entry.status.value,
                    "reason": entry.reason,
                }
                for entry in self.entries
            ],
        }


class HmacAuthority:
    """Small local authority for the falsification kernel, not a hosted key service."""

    def __init__(self, key_id: str, secret: bytes) -> None:
        _require_text("key ID", key_id)
        if len(secret) < 32:
            raise ValueError("authority secret must contain at least 32 bytes")
        self.key_id = key_id
        self._secret = secret

    def _sign(self, label: str, payload: Any) -> str:
        message = label.encode("ascii") + b"\0" + canonical_json(payload)
        return hmac.new(self._secret, message, hashlib.sha256).hexdigest()

    def issue(
        self,
        *,
        grant_id: str,
        principal: str,
        tenant: str,
        workload: str,
        action: EffectAction,
        policy_sha256: str,
        expires_at: datetime,
        budget_scope: str | None = None,
    ) -> ExactEffectGrant:
        for name, value in (
            ("grant ID", grant_id),
            ("principal", principal),
            ("tenant", tenant),
            ("workload", workload),
        ):
            _require_text(name, value)
        _require_digest("policy digest", policy_sha256)
        if expires_at.tzinfo is None:
            raise ValueError("grant expiry must include a timezone")
        expiry = expires_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
        grant = ExactEffectGrant(
            grant_id=grant_id,
            principal=principal,
            tenant=tenant,
            workload=workload,
            action_sha256=action.sha256,
            policy_sha256=policy_sha256,
            expires_at=expiry,
            budget_scope=budget_scope,
            key_id=self.key_id,
            signature="",
        )
        return replace(grant, signature=self._sign("grant", grant.unsigned_payload()))

    def verify_grant(self, grant: ExactEffectGrant) -> bool:
        if grant.key_id != self.key_id:
            return False
        expected = self._sign("grant", grant.unsigned_payload())
        return hmac.compare_digest(grant.signature, expected)

    def sign_receipt(self, receipt: BoundaryReceipt) -> BoundaryReceipt:
        unsigned = replace(receipt, key_id=self.key_id, signature="")
        return replace(
            unsigned,
            signature=self._sign("receipt", unsigned.unsigned_payload()),
        )

    def verify_receipt(self, receipt: BoundaryReceipt) -> bool:
        if receipt.key_id != self.key_id:
            return False
        expected = self._sign("receipt", receipt.unsigned_payload())
        return hmac.compare_digest(receipt.signature, expected)


class MemoryReplayStore:
    def __init__(self) -> None:
        self._consumed: set[str] = set()
        self._lock = threading.Lock()

    def consume(
        self,
        grant_id: str,
        *,
        commit: Callable[[], None] | None = None,
    ) -> bool:
        with self._lock:
            if grant_id in self._consumed:
                return False
            if commit is not None:
                commit()
            self._consumed.add(grant_id)
            return True


class _MemoryLifecycleStore:
    def __init__(self) -> None:
        self._states: dict[str, BoundaryState] = {}
        self._lock = threading.Lock()

    def reserve(self, receipt_id: str) -> None:
        with self._lock:
            if receipt_id in self._states:
                raise ValueError("receipt ID already has lifecycle state")
            self._states[receipt_id] = BoundaryState.RESERVED

    def transition(
        self,
        receipt_id: str,
        *,
        expected: BoundaryState,
        target: BoundaryState,
    ) -> None:
        with self._lock:
            current = self._states.get(receipt_id)
            if current is not expected:
                current_name = current.value if current is not None else "missing"
                raise ValueError(
                    f"invalid lifecycle transition: expected {expected.value}, found {current_name}"
                )
            self._states[receipt_id] = target


@dataclass(frozen=True)
class Admission:
    action: EffectAction
    grant: ExactEffectGrant | None
    receipt: BoundaryReceipt

    @property
    def allowed(self) -> bool:
        return self.receipt.state is BoundaryState.RESERVED


class BoundaryRuntime:
    def __init__(
        self,
        *,
        authority: HmacAuthority,
        policy_sha256: str,
        adapter: str,
        replay_store: MemoryReplayStore | None = None,
        require_trusted_provenance: bool = False,
        clock: Callable[[], datetime] | None = None,
        receipt_id_factory: Callable[[], str] | None = None,
    ) -> None:
        _require_digest("policy digest", policy_sha256)
        _require_text("adapter", adapter)
        self.authority = authority
        self.policy_sha256 = policy_sha256
        self.adapter = adapter
        self.replay_store = replay_store or MemoryReplayStore()
        self._lifecycle = _MemoryLifecycleStore()
        self.require_trusted_provenance = require_trusted_provenance
        self._clock = clock or (lambda: datetime.now(UTC))
        self._receipt_id_factory = receipt_id_factory or (lambda: str(uuid.uuid4()))

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("boundary clock must include a timezone")
        return now.astimezone(UTC)

    def _receipt(
        self,
        *,
        state: BoundaryState,
        reason: str,
        principal: str,
        tenant: str,
        workload: str,
        action: EffectAction,
        grant: ExactEffectGrant | None,
        previous: BoundaryReceipt | None = None,
        acknowledgement_sha256: str | None = None,
    ) -> BoundaryReceipt:
        receipt = BoundaryReceipt(
            receipt_id=self._receipt_id_factory(),
            state=state,
            reason=reason,
            principal=principal,
            tenant=tenant,
            workload=workload,
            policy_sha256=self.policy_sha256,
            action_sha256=action.sha256,
            grant_id=grant.grant_id if grant else None,
            adapter=self.adapter,
            occurred_at=self._now().isoformat().replace("+00:00", "Z"),
            previous_receipt_sha256=previous.sha256 if previous else None,
            acknowledgement_sha256=acknowledgement_sha256,
        )
        return self.authority.sign_receipt(receipt)

    def deny(
        self,
        *,
        action: EffectAction,
        reason: str,
        principal: str,
        tenant: str,
        workload: str,
        grant: ExactEffectGrant | None = None,
    ) -> Admission:
        _require_text("denial reason", reason)
        return Admission(
            action=action,
            grant=grant,
            receipt=self._receipt(
                state=BoundaryState.DENIED,
                reason=reason,
                principal=principal,
                tenant=tenant,
                workload=workload,
                action=action,
                grant=grant,
            ),
        )

    def _require_admission(self, admission: Admission) -> None:
        grant = admission.grant
        receipt = admission.receipt
        if not admission.allowed or grant is None:
            raise ValueError("only a reserved admission can transition")
        if not self.authority.verify_grant(grant) or not self.authority.verify_receipt(receipt):
            raise ValueError("admission signature verification failed")
        if (
            receipt.grant_id != grant.grant_id
            or receipt.action_sha256 != admission.action.sha256
            or receipt.policy_sha256 != self.policy_sha256
            or receipt.adapter != self.adapter
            or (receipt.principal, receipt.tenant, receipt.workload)
            != (grant.principal, grant.tenant, grant.workload)
            or grant.action_sha256 != admission.action.sha256
            or grant.policy_sha256 != self.policy_sha256
        ):
            raise ValueError("admission receipt does not match its grant and action")

    def _require_dispatched(
        self,
        admission: Admission,
        dispatched: BoundaryReceipt,
    ) -> None:
        self._require_admission(admission)
        receipt = admission.receipt
        if not self.authority.verify_receipt(dispatched):
            raise ValueError("dispatch receipt signature verification failed")
        if (
            dispatched.state is not BoundaryState.DISPATCHED
            or dispatched.previous_receipt_sha256 != receipt.sha256
            or dispatched.grant_id != receipt.grant_id
            or dispatched.action_sha256 != receipt.action_sha256
            or dispatched.policy_sha256 != receipt.policy_sha256
            or dispatched.adapter != receipt.adapter
            or (dispatched.principal, dispatched.tenant, dispatched.workload)
            != (receipt.principal, receipt.tenant, receipt.workload)
        ):
            raise ValueError("dispatch receipt does not belong to the admission")

    def admit(
        self,
        *,
        action: EffectAction,
        grant: ExactEffectGrant | None,
        principal: str,
        tenant: str,
        workload: str,
        budget_scope: str | None,
        provenance: str | None,
    ) -> Admission:
        reason: str | None = None
        now = self._now()
        if grant is None:
            reason = "missing_grant"
        elif self.require_trusted_provenance and provenance != "trusted":
            reason = "missing_provenance"
        elif not self.authority.verify_grant(grant):
            reason = "invalid_grant_signature"
        elif _parse_expiry(grant.expires_at) <= now:
            reason = "expired_grant"
        elif (grant.principal, grant.tenant, grant.workload) != (
            principal,
            tenant,
            workload,
        ):
            reason = "identity_mismatch"
        elif grant.action_sha256 != action.sha256:
            reason = "action_mismatch"
        elif grant.policy_sha256 != self.policy_sha256:
            reason = "policy_mismatch"
        elif grant.budget_scope != budget_scope:
            reason = "budget_scope_mismatch"

        if reason is not None:
            return self.deny(
                action=action,
                grant=grant,
                reason=reason,
                principal=principal,
                tenant=tenant,
                workload=workload,
            )
        if grant is None:
            raise RuntimeError("admission invariant lost its verified grant")
        receipt = self._receipt(
            state=BoundaryState.RESERVED,
            reason="exact_grant_verified",
            principal=principal,
            tenant=tenant,
            workload=workload,
            action=action,
            grant=grant,
        )
        if not self.replay_store.consume(
            grant.grant_id,
            commit=lambda: self._lifecycle.reserve(receipt.receipt_id),
        ):
            return self.deny(
                action=action,
                grant=grant,
                reason="replayed_grant",
                principal=principal,
                tenant=tenant,
                workload=workload,
            )
        return Admission(action=action, grant=grant, receipt=receipt)

    def dispatch(self, admission: Admission) -> BoundaryReceipt:
        self._require_admission(admission)
        grant = admission.grant
        if grant is None:
            raise ValueError("reserved admission is missing its grant")
        if _parse_expiry(grant.expires_at) <= self._now():
            released = self.release(admission, "grant_expired_before_dispatch")
            raise BoundaryDispatchError("grant expired before dispatch", released)
        receipt = admission.receipt
        dispatched = self._receipt(
            state=BoundaryState.DISPATCHED,
            reason="dispatch_attempted",
            principal=receipt.principal,
            tenant=receipt.tenant,
            workload=receipt.workload,
            action=admission.action,
            grant=admission.grant,
            previous=receipt,
        )
        self._lifecycle.transition(
            receipt.receipt_id,
            expected=BoundaryState.RESERVED,
            target=BoundaryState.DISPATCHED,
        )
        return dispatched

    def settle(
        self,
        admission: Admission,
        dispatched: BoundaryReceipt,
        acknowledgement: EffectAcknowledgement,
    ) -> BoundaryReceipt:
        if not isinstance(acknowledgement, EffectAcknowledgement):
            raise TypeError("settlement requires an EffectAcknowledgement")
        self._require_dispatched(admission, dispatched)
        settled = self._receipt(
            state=BoundaryState.SETTLED,
            reason="application_acknowledgement",
            principal=dispatched.principal,
            tenant=dispatched.tenant,
            workload=dispatched.workload,
            action=admission.action,
            grant=admission.grant,
            previous=dispatched,
            acknowledgement_sha256=content_sha256(acknowledgement.as_dict()),
        )
        self._lifecycle.transition(
            admission.receipt.receipt_id,
            expected=BoundaryState.DISPATCHED,
            target=BoundaryState.SETTLED,
        )
        return settled

    def uncertain(
        self,
        admission: Admission,
        dispatched: BoundaryReceipt,
        reason: str,
    ) -> BoundaryReceipt:
        self._require_dispatched(admission, dispatched)
        _require_text("uncertainty reason", reason)
        uncertain = self._receipt(
            state=BoundaryState.UNCERTAIN,
            reason=reason,
            principal=dispatched.principal,
            tenant=dispatched.tenant,
            workload=dispatched.workload,
            action=admission.action,
            grant=admission.grant,
            previous=dispatched,
        )
        self._lifecycle.transition(
            admission.receipt.receipt_id,
            expected=BoundaryState.DISPATCHED,
            target=BoundaryState.UNCERTAIN,
        )
        return uncertain

    def release(self, admission: Admission, reason: str) -> BoundaryReceipt:
        self._require_admission(admission)
        _require_text("release reason", reason)
        receipt = admission.receipt
        released = self._receipt(
            state=BoundaryState.RELEASED,
            reason=reason,
            principal=receipt.principal,
            tenant=receipt.tenant,
            workload=receipt.workload,
            action=admission.action,
            grant=admission.grant,
            previous=receipt,
        )
        self._lifecycle.transition(
            receipt.receipt_id,
            expected=BoundaryState.RESERVED,
            target=BoundaryState.RELEASED,
        )
        return released


def coverage_report(adapter: str, entries: Sequence[CoverageEntry]) -> CoverageReport:
    return CoverageReport(adapter=adapter, entries=tuple(entries))
