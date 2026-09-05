"""Framework-neutral model dispatch admission and gateway receipt verification."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, TypeVar, cast

import httpx
from openai import AsyncOpenAI

from llmkit._client import DEFAULT_BASE_URL, ENV_API_KEY, ENV_BASE_URL, _build_headers
from llmkit.boundary import (
    Admission,
    BoundaryDispatchError,
    BoundaryReceipt,
    BoundaryRuntime,
    EffectAcknowledgement,
    EffectAction,
    ExactEffectGrant,
    canonical_arguments,
)

GrantResolution = ExactEffectGrant | None | Awaitable[ExactEffectGrant | None]
ModelGrantResolver = Callable[[EffectAction], GrantResolution]
ReceiptWriter = Callable[[BoundaryReceipt], None]

_MODEL_EFFECT_CLASS = "model.dispatch"
_MODEL_RECEIPT_VERSION = "llmkit-gateway-receipt-v1"
_MODEL_PATHS = frozenset({"/v1/chat/completions", "/v1/responses"})

_ResultT = TypeVar("_ResultT")


class ModelDispatchBoundaryError(RuntimeError):
    """A fail-closed model-dispatch result safe to surface to framework callers."""

    def __init__(self, reason: str, receipt: BoundaryReceipt | None = None) -> None:
        super().__init__(f"LLMKit model dispatch boundary: {reason}")
        self.reason = reason
        self.receipt = receipt


class UnsupportedModelStreamingError(ModelDispatchBoundaryError):
    """Raised before dispatch when an enrolled model is used through a streaming path."""


@dataclass
class _ModelAttempt:
    owner_id: int
    call_id: str
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    request_seen: bool = False
    action: EffectAction | None = None
    admission: Admission | None = None
    dispatched: BoundaryReceipt | None = None
    terminal: BoundaryReceipt | None = None
    failure: ModelDispatchBoundaryError | None = None
    receipt_id: str | None = None
    response_sha256: str | None = None
    provider_response_id: str | None = None
    response_model: str | None = None
    response_status: int | None = None
    requested_provider: str | None = None
    requested_model: str | None = None


_current_model_attempt: ContextVar[_ModelAttempt | None] = ContextVar(
    "llmkit_gateway_model_attempt",
    default=None,
)


class GatewayModelDispatch:
    """Own one exact non-streaming dispatch and its durable gateway receipt."""

    def __init__(
        self,
        *,
        runtime: BoundaryRuntime,
        principal: str,
        tenant: str,
        workload: str,
        budget_scope: str | None,
        provenance: str | None,
        model_grant_resolver: ModelGrantResolver | None,
        receipt_lock: asyncio.Lock,
        append_receipt: ReceiptWriter,
        provider: str,
        api_key: str | None = None,
        base_url: str | None = None,
        provider_key: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        receipt_timeout_seconds: float = 5.0,
        receipt_poll_interval_seconds: float = 0.05,
        request_transport: httpx.AsyncBaseTransport | None = None,
        receipt_transport: httpx.AsyncBaseTransport | None = None,
        call_id_factory: Callable[[], str] | None = None,
        context_is_finalized: Callable[[], bool] | None = None,
        owner_id: int | None = None,
    ) -> None:
        if not provider.strip():
            raise ValueError("provider is required")
        if model_grant_resolver is None:
            raise ValueError("model_grant_resolver is required")
        if not budget_scope:
            raise ValueError("budget_scope must identify the expected gateway budget")
        if (
            not math.isfinite(receipt_timeout_seconds)
            or not math.isfinite(receipt_poll_interval_seconds)
            or receipt_timeout_seconds <= 0
            or receipt_poll_interval_seconds <= 0
        ):
            raise ValueError("receipt polling bounds must be positive")

        resolved_key = api_key or os.environ.get(ENV_API_KEY)
        if not resolved_key:
            raise ValueError(f"api_key required: pass it directly or set {ENV_API_KEY}")
        resolved_base_url = base_url or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL
        gateway_url = httpx.URL(resolved_base_url)
        if (
            gateway_url.scheme != "https"
            or not gateway_url.host
            or gateway_url.username
            or gateway_url.password
            or gateway_url.query
            or gateway_url.fragment
            or gateway_url.path.rstrip("/") != "/v1"
        ):
            raise ValueError("base_url must be an HTTPS LLMKit /v1 endpoint")

        self.runtime = runtime
        self.principal = principal
        self.tenant = tenant
        self.workload = workload
        self.budget_scope = budget_scope
        self.provenance = provenance
        self.model_grant_resolver = model_grant_resolver
        self.provider = provider
        self.agent_id = agent_id
        self.session_id = session_id
        self._receipt_lock = receipt_lock
        self._append_receipt_writer = append_receipt
        self._context_is_finalized = context_is_finalized or (lambda: False)
        self._owner_id = owner_id if owner_id is not None else id(self)
        self._gateway_url = gateway_url.copy_with(path="/v1/")
        self._gateway_origin = (
            self._gateway_url.scheme,
            self._gateway_url.host,
            self._gateway_url.port,
        )
        self._receipt_timeout_seconds = receipt_timeout_seconds
        self._receipt_poll_interval_seconds = receipt_poll_interval_seconds
        self._call_id_factory = call_id_factory or (lambda: str(uuid.uuid4()))
        self._closed = False

        headers = _build_headers(
            provider_key,
            provider,
            session_id,
            None,
            customer_id=tenant,
            workflow_id=workload,
            agent_id=agent_id,
            end_user_id=principal,
        )
        request_client = httpx.AsyncClient(
            event_hooks={
                "request": [self._admit_before_send],
                "response": [self._capture_response],
            },
            follow_redirects=False,
            transport=request_transport,
        )
        self.openai_client = AsyncOpenAI(
            api_key=resolved_key,
            base_url=str(self._gateway_url),
            default_headers=headers,
            max_retries=0,
            http_client=request_client,
        )
        self._receipt_client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {resolved_key}"},
            follow_redirects=False,
            transport=receipt_transport,
        )

    async def aclose(self) -> None:
        if self._closed:
            return
        try:
            await self.openai_client.close()
        finally:
            await self._receipt_client.aclose()
        self._closed = True

    async def execute(self, operation: Callable[[str], Awaitable[_ResultT]]) -> _ResultT:
        """Run one adapter request and withhold its result until evidence settles."""
        if self._closed:
            raise RuntimeError("GatewayModelDispatch is closed")
        attempt = _ModelAttempt(
            owner_id=self._owner_id,
            call_id=self._call_id_factory(),
        )
        token = _current_model_attempt.set(attempt)
        try:
            try:
                response = await operation(attempt.call_id)
            except asyncio.CancelledError:
                await self._mark_uncertain(attempt, "model_dispatch_canceled")
                raise
            except Exception as error:
                await self._mark_uncertain(attempt, "model_dispatch_exception")
                if attempt.failure is not None and attempt.dispatched is None:
                    raise attempt.failure from error
                raise

            try:
                acknowledgement = await self._verified_acknowledgement(attempt)
            except asyncio.CancelledError:
                await self._mark_uncertain(attempt, "model_dispatch_canceled")
                raise
            except Exception as error:
                reason = (
                    error.reason
                    if isinstance(error, ModelDispatchBoundaryError)
                    else "gateway_receipt_error"
                )
                await self._mark_uncertain(attempt, reason)
                raise ModelDispatchBoundaryError(reason, attempt.terminal) from error

            if attempt.admission is None or attempt.dispatched is None:
                raise ModelDispatchBoundaryError("model_dispatch_bypassed_boundary")
            terminal = self.runtime.settle(
                attempt.admission,
                attempt.dispatched,
                acknowledgement,
            )
            attempt.terminal = terminal
            await self._append_receipt(terminal)
            return response
        finally:
            _current_model_attempt.reset(token)

    async def _append_receipt_locked(self, receipt: BoundaryReceipt) -> None:
        async with self._receipt_lock:
            self._append_receipt_writer(receipt)

    async def _append_receipt(self, receipt: BoundaryReceipt) -> None:
        append_task = asyncio.create_task(self._append_receipt_locked(receipt))
        try:
            await asyncio.shield(append_task)
        except asyncio.CancelledError:
            await append_task
            raise

    def _boundary_error(
        self,
        attempt: _ModelAttempt,
        reason: str,
        receipt: BoundaryReceipt | None = None,
    ) -> ModelDispatchBoundaryError:
        error = ModelDispatchBoundaryError(reason, receipt)
        attempt.failure = error
        return error

    async def _action_from_request(
        self,
        attempt: _ModelAttempt,
        request: httpx.Request,
    ) -> EffectAction:
        request_origin = (request.url.scheme, request.url.host, request.url.port)
        if request_origin != self._gateway_origin or request.url.path not in _MODEL_PATHS:
            raise self._boundary_error(attempt, "unexpected_gateway_endpoint")
        if request.method != "POST" or request.url.query:
            raise self._boundary_error(attempt, "unexpected_gateway_request")
        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            raise self._boundary_error(attempt, "non_json_model_request")

        raw_body = await request.aread()
        try:
            body = canonical_arguments(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as error:
            raise self._boundary_error(attempt, "invalid_model_request") from error
        if body.get("stream") is True:
            raise self._boundary_error(attempt, "model_streaming_uncovered")
        model = body.get("model")
        if not isinstance(model, str) or not model:
            raise self._boundary_error(attempt, "missing_model_snapshot")
        output_limit = (
            body.get("max_completion_tokens", body.get("max_tokens"))
            if request.url.path == "/v1/chat/completions"
            else body.get("max_output_tokens")
        )
        if not isinstance(output_limit, int) or isinstance(output_limit, bool) or output_limit <= 0:
            raise self._boundary_error(attempt, "missing_hard_budget_output_limit")

        provider = request.headers.get("x-llmkit-provider")
        if provider != self.provider or request.headers.get("x-llmkit-fallback") is not None:
            raise self._boundary_error(attempt, "gateway_route_changed")
        idempotency_key = request.headers.get("idempotency-key")
        if idempotency_key != attempt.call_id:
            raise self._boundary_error(attempt, "gateway_idempotency_changed")
        if (
            request.headers.get("x-llmkit-customer-id") != self.tenant
            or request.headers.get("x-llmkit-workflow-id") != self.workload
            or request.headers.get("x-llmkit-user-id") != self.principal
            or request.headers.get("x-llmkit-session-id") != self.session_id
            or request.headers.get("x-llmkit-agent-id") != self.agent_id
        ):
            raise self._boundary_error(attempt, "gateway_attribution_changed")

        attempt.requested_provider = provider
        attempt.requested_model = model
        return EffectAction.from_arguments(
            effect_class=_MODEL_EFFECT_CLASS,
            target=f"llmkit-gateway:{provider}:{model}",
            version=_MODEL_RECEIPT_VERSION,
            call_id=attempt.call_id,
            arguments={
                "method": request.method,
                "path": request.url.path,
                "body_sha256": hashlib.sha256(raw_body).hexdigest(),
                "idempotency_key": idempotency_key,
                "provider": provider,
                "model": model,
                "customer_id": self.tenant,
                "workflow_id": self.workload,
                "agent_id": self.agent_id,
                "session_id": self.session_id,
                "end_user_id": self.principal,
            },
        )

    async def _admit_before_send(self, request: httpx.Request) -> None:
        attempt = _current_model_attempt.get()
        if attempt is None or attempt.owner_id != self._owner_id:
            raise ModelDispatchBoundaryError("model_request_bypassed_boundary")

        async with attempt.lock:
            if attempt.request_seen:
                if attempt.admission is not None and attempt.dispatched is not None:
                    terminal = self.runtime.uncertain(
                        attempt.admission,
                        attempt.dispatched,
                        "unexpected_second_model_request",
                    )
                    attempt.terminal = terminal
                    await self._append_receipt(terminal)
                raise self._boundary_error(
                    attempt,
                    "unexpected_second_model_request",
                    attempt.terminal,
                )
            attempt.request_seen = True
            action = await self._action_from_request(attempt, request)
            attempt.action = action

            resolution_failed = False
            try:
                resolution = self.model_grant_resolver(action)
                grant = await resolution if isinstance(resolution, Awaitable) else resolution
            except Exception:
                grant = None
                resolution_failed = True

            async with self._receipt_lock:
                if self._context_is_finalized():
                    admission = self.runtime.deny(
                        action=action,
                        reason="boundary_context_finalized",
                        principal=self.principal,
                        tenant=self.tenant,
                        workload=self.workload,
                    )
                elif resolution_failed:
                    admission = self.runtime.deny(
                        action=action,
                        reason="grant_resolution_failed",
                        principal=self.principal,
                        tenant=self.tenant,
                        workload=self.workload,
                    )
                else:
                    admission = self.runtime.admit(
                        action=action,
                        grant=grant,
                        principal=self.principal,
                        tenant=self.tenant,
                        workload=self.workload,
                        budget_scope=self.budget_scope,
                        provenance=self.provenance,
                    )
                self._append_receipt_writer(admission.receipt)
            attempt.admission = admission
            if not admission.allowed:
                raise self._boundary_error(attempt, admission.receipt.reason, admission.receipt)

            try:
                dispatched = self.runtime.dispatch(admission)
            except BoundaryDispatchError as error:
                attempt.terminal = error.receipt
                await self._append_receipt(error.receipt)
                raise self._boundary_error(
                    attempt,
                    "grant_expired_before_dispatch",
                    error.receipt,
                ) from error
            attempt.dispatched = dispatched
            await self._append_receipt(dispatched)

    async def _capture_response(self, response: httpx.Response) -> None:
        attempt = _current_model_attempt.get()
        if attempt is None or attempt.owner_id != self._owner_id:
            raise ModelDispatchBoundaryError("model_response_bypassed_boundary")
        raw_body = await response.aread()
        async with attempt.lock:
            attempt.response_status = response.status_code
            attempt.receipt_id = response.headers.get("x-llmkit-request-id")
            attempt.response_sha256 = hashlib.sha256(raw_body).hexdigest()
            try:
                payload = json.loads(raw_body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return
            if isinstance(payload, dict):
                response_id = payload.get("id")
                response_model = payload.get("model")
                attempt.provider_response_id = response_id if isinstance(response_id, str) else None
                attempt.response_model = response_model if isinstance(response_model, str) else None

    async def _poll_terminal_receipt(self, receipt_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self._receipt_timeout_seconds
        url = f"{str(self._gateway_url).rstrip('/')}/analytics/receipts/{receipt_id}"
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ModelDispatchBoundaryError("gateway_receipt_timeout")
            try:
                async with asyncio.timeout(remaining):
                    response = await self._receipt_client.get(url, timeout=remaining)
            except (TimeoutError, httpx.TimeoutException) as error:
                raise ModelDispatchBoundaryError("gateway_receipt_timeout") from error
            if time.monotonic() >= deadline:
                raise ModelDispatchBoundaryError("gateway_receipt_timeout")
            if response.status_code == 200:
                payload = response.json()
                receipt = payload.get("receipt") if isinstance(payload, dict) else None
                if isinstance(receipt, dict):
                    settlement = receipt.get("settlement_status")
                    if (
                        receipt.get("status") != "pending"
                        and settlement != "pending"
                        and receipt.get("response_sha256") is not None
                    ):
                        if time.monotonic() >= deadline:
                            raise ModelDispatchBoundaryError("gateway_receipt_timeout")
                        return cast(dict[str, Any], receipt)
            elif response.status_code != 404:
                raise ModelDispatchBoundaryError("gateway_receipt_lookup_failed")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ModelDispatchBoundaryError("gateway_receipt_timeout")
            await asyncio.sleep(min(self._receipt_poll_interval_seconds, remaining))

    async def _verified_acknowledgement(
        self,
        attempt: _ModelAttempt,
    ) -> EffectAcknowledgement:
        receipt_id = attempt.receipt_id
        if receipt_id is None:
            raise ModelDispatchBoundaryError("invalid_gateway_receipt_id")
        try:
            canonical_receipt_id = str(uuid.UUID(receipt_id))
        except ValueError as error:
            raise ModelDispatchBoundaryError("invalid_gateway_receipt_id") from error
        if canonical_receipt_id != receipt_id:
            raise ModelDispatchBoundaryError("invalid_gateway_receipt_id")
        if attempt.response_status is None or not 200 <= attempt.response_status < 300:
            raise ModelDispatchBoundaryError("gateway_model_request_failed")
        if (
            attempt.response_sha256 is None
            or attempt.provider_response_id is None
            or attempt.response_model is None
            or attempt.requested_provider is None
            or attempt.requested_model is None
        ):
            raise ModelDispatchBoundaryError("incomplete_gateway_response_evidence")

        receipt = await self._poll_terminal_receipt(receipt_id)
        expected = {
            "id": receipt_id,
            "customer_id": self.tenant,
            "workflow_id": self.workload,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "end_user_id": self.principal,
            "budget_id": self.budget_scope,
            "requested_provider": attempt.requested_provider,
            "requested_model": attempt.requested_model,
            "last_dispatched_provider": attempt.requested_provider,
            "last_dispatched_model": attempt.requested_model,
            "provider_response_id": attempt.provider_response_id,
            "response_sha256": attempt.response_sha256,
            "provider": attempt.requested_provider,
            "model": attempt.response_model,
            "dispatch_status": "dispatched",
            "status": "success",
            "settlement_status": "settled_actual",
        }
        if any(name not in receipt or receipt[name] != value for name, value in expected.items()):
            raise ModelDispatchBoundaryError("gateway_receipt_mismatch")
        if not receipt.get("budget_reservation_id"):
            raise ModelDispatchBoundaryError("gateway_budget_reservation_missing")
        idempotency_key_hash = receipt.get("idempotency_key_hash")
        if (
            not isinstance(idempotency_key_hash, str)
            or len(idempotency_key_hash) != 64
            or any(character not in "0123456789abcdef" for character in idempotency_key_hash)
        ):
            raise ModelDispatchBoundaryError("gateway_idempotency_evidence_missing")
        expected_idempotency_key_hash = hashlib.sha256(attempt.call_id.encode()).hexdigest()
        if idempotency_key_hash != expected_idempotency_key_hash:
            raise ModelDispatchBoundaryError("gateway_idempotency_evidence_mismatch")
        return EffectAcknowledgement(
            source="llmkit-gateway-receipt",
            effect_id=receipt_id,
            version=_MODEL_RECEIPT_VERSION,
        )

    async def _mark_uncertain(self, attempt: _ModelAttempt, reason: str) -> None:
        async with attempt.lock:
            if attempt.terminal is not None:
                return
            if attempt.admission is None or attempt.dispatched is None:
                return
            terminal = self.runtime.uncertain(attempt.admission, attempt.dispatched, reason)
            attempt.terminal = terminal
            await self._append_receipt(terminal)
