"""Exact-effect boundaries for explicitly enrolled OpenAI Agents paths."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from typing import Any, cast

import httpx
from openai import AsyncOpenAI
from openai.types.responses.response_prompt_param import ResponsePromptParam

try:
    from agents import (
        AgentOutputSchemaBase,
        FunctionTool,
        Handoff,
        Model,
        ModelProvider,
        ModelResponse,
        ModelSettings,
        ModelTracing,
        OpenAIProvider,
        Tool,
        ToolGuardrailFunctionOutput,
        ToolInputGuardrail,
        ToolInputGuardrailData,
    )
    from agents.items import TResponseInputItem, TResponseStreamEvent
    from agents.tool_context import ToolContext
except ImportError as error:
    raise ImportError(
        "openai-agents is required for this integration. "
        'Install it with: pip install "llmkit-sdk[openai-agents]"'
    ) from error

from llmkit._client import DEFAULT_BASE_URL, ENV_API_KEY, ENV_BASE_URL, _build_headers
from llmkit.boundary import (
    Admission,
    BoundaryDispatchError,
    BoundaryReceipt,
    BoundaryRuntime,
    CoverageEntry,
    CoverageReport,
    CoverageStatus,
    EffectAcknowledgement,
    EffectAction,
    ExactEffectGrant,
    canonical_arguments,
    coverage_report,
)

GrantResolution = ExactEffectGrant | None | Awaitable[ExactEffectGrant | None]
GrantResolver = Callable[[EffectAction, ToolContext[Any]], GrantResolution]
ModelGrantResolver = Callable[[EffectAction], GrantResolution]
Acknowledgement = Callable[[Any], EffectAcknowledgement | None]

_MODEL_EFFECT_CLASS = "model.dispatch"
_MODEL_RECEIPT_VERSION = "llmkit-gateway-receipt-v1"
_MODEL_PATHS = frozenset({"/v1/chat/completions", "/v1/responses"})


@dataclass(frozen=True)
class _PendingAdmission:
    runtime: BoundaryRuntime
    admission: Admission


_AdmissionKey = tuple[int, str, str]


@dataclass
class OpenAIBoundaryContext:
    principal: str
    tenant: str
    workload: str
    budget_scope: str | None
    grant_resolver: GrantResolver
    provenance: str | None = None
    receipts: list[BoundaryReceipt] = field(default_factory=list)
    model_grant_resolver: ModelGrantResolver | None = None
    _admissions: dict[_AdmissionKey, _PendingAdmission] = field(default_factory=dict, repr=False)
    _admission_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    _finalized: bool = field(default=False, repr=False)


def _admission_key(runtime: BoundaryRuntime, action: EffectAction) -> _AdmissionKey:
    return (id(runtime), action.call_id, action.sha256)


def _find_call_admission(
    context: OpenAIBoundaryContext,
    runtime: BoundaryRuntime,
    call_id: str,
) -> _AdmissionKey | None:
    runtime_id = id(runtime)
    return next(
        (key for key in context._admissions if key[0] == runtime_id and key[1] == call_id),
        None,
    )


def openai_agents_coverage(*, model_dispatch_enrolled: bool = False) -> CoverageReport:
    return coverage_report(
        "openai-agents",
        [
            CoverageEntry(
                "enrolled_function_tool",
                CoverageStatus.ENFORCED,
                "the explicit wrapper binds an input guardrail to the sink invocation",
            ),
            CoverageEntry(
                "unenrolled_function_tool",
                CoverageStatus.UNCOVERED,
                "function tools are not intercepted unless the application wraps them",
            ),
            CoverageEntry(
                "model_dispatch",
                CoverageStatus.ENFORCED if model_dispatch_enrolled else CoverageStatus.UNCOVERED,
                (
                    "the enrolled provider joins an exact serialized request to a terminal "
                    "LLMKit gateway receipt"
                    if model_dispatch_enrolled
                    else "requires an enrolled GatewayBoundaryProvider"
                ),
            ),
            CoverageEntry(
                "model_streaming",
                CoverageStatus.UNCOVERED,
                "stream finality requires a separate evidence contract",
            ),
            CoverageEntry(
                "hosted_tool",
                CoverageStatus.UNCOVERED,
                "hosted tools do not use the function-tool guardrail pipeline",
            ),
            CoverageEntry(
                "hosted_mcp",
                CoverageStatus.UNCOVERED,
                "hosted MCP does not use the function-tool guardrail pipeline",
            ),
            CoverageEntry(
                "local_mcp",
                CoverageStatus.UNCOVERED,
                "local MCP tools use a separate conversion and execution path",
            ),
            CoverageEntry(
                "computer_tool",
                CoverageStatus.UNCOVERED,
                "computer tools use a separate execution path",
            ),
            CoverageEntry(
                "shell_tool",
                CoverageStatus.UNCOVERED,
                "shell tools use a separate execution path",
            ),
            CoverageEntry(
                "apply_patch_tool",
                CoverageStatus.UNCOVERED,
                "apply-patch tools use a separate execution path",
            ),
            CoverageEntry(
                "approval_required_function_tool",
                CoverageStatus.UNCOVERED,
                "the wrapper rejects tools whose approval rejection cannot release a reservation",
            ),
            CoverageEntry(
                "handoff",
                CoverageStatus.UNCOVERED,
                "handoffs use a separate SDK pipeline",
            ),
            CoverageEntry(
                "agent_as_tool",
                CoverageStatus.UNCOVERED,
                "Agent.as_tool does not expose this tool guardrail directly",
            ),
            CoverageEntry(
                "direct_client",
                CoverageStatus.UNCOVERED,
                "direct provider clients bypass the enrolled tool",
            ),
            CoverageEntry(
                "realtime",
                CoverageStatus.UNCOVERED,
                "Realtime requires a separate adapter",
            ),
            CoverageEntry(
                "background_retry",
                CoverageStatus.UNCOVERED,
                "out-of-band retries require a durable grant and replay store",
            ),
        ],
    )


async def _resolve_grant(
    resolver: GrantResolver,
    action: EffectAction,
    context: ToolContext[Any],
) -> ExactEffectGrant | None:
    result = resolver(action, context)
    if isinstance(result, Awaitable):
        return await result
    return result


async def release_pending_admissions(
    context: OpenAIBoundaryContext,
    reason: str = "run_ended_before_dispatch",
) -> tuple[BoundaryReceipt, ...]:
    """Release admissions left pending when an Agents run ends before invocation."""
    released: list[BoundaryReceipt] = []
    async with context._admission_lock:
        context._finalized = True
        for key, pending in list(context._admissions.items()):
            receipt = pending.runtime.release(pending.admission, reason)
            del context._admissions[key]
            context.receipts.append(receipt)
            released.append(receipt)
    return tuple(released)


class ModelDispatchBoundaryError(RuntimeError):
    """A fail-closed model-dispatch boundary result safe to surface to Runner callers."""

    def __init__(self, reason: str, receipt: BoundaryReceipt | None = None) -> None:
        super().__init__(f"LLMKit model dispatch boundary: {reason}")
        self.reason = reason
        self.receipt = receipt


class UnsupportedModelStreamingError(ModelDispatchBoundaryError):
    """Raised before dispatch when the enrolled model is used through Runner.run_streamed."""


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
    "llmkit_openai_model_attempt",
    default=None,
)


class GatewayBoundaryProvider(ModelProvider):
    """Owned non-streaming Agents provider routed through the LLMKit gateway."""

    context: OpenAIBoundaryContext
    runtime: BoundaryRuntime
    provider: str
    agent_id: str | None
    session_id: str | None
    _gateway_url: httpx.URL
    _gateway_origin: tuple[str, str, int | None]
    _receipt_timeout_seconds: float
    _receipt_poll_interval_seconds: float
    _call_id_factory: Callable[[], str]
    _closed: bool
    _openai: AsyncOpenAI
    _delegate: OpenAIProvider
    _receipt_client: httpx.AsyncClient

    def __init__(
        self,
        *,
        context: OpenAIBoundaryContext,
        runtime: BoundaryRuntime,
        provider: str,
        api_key: str | None = None,
        base_url: str | None = None,
        provider_key: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        use_responses: bool = False,
        receipt_timeout_seconds: float = 5.0,
        receipt_poll_interval_seconds: float = 0.05,
        request_transport: httpx.AsyncBaseTransport | None = None,
        receipt_transport: httpx.AsyncBaseTransport | None = None,
        call_id_factory: Callable[[], str] | None = None,
    ) -> None:
        if not provider.strip():
            raise ValueError("provider is required")
        if context.model_grant_resolver is None:
            raise ValueError("model_grant_resolver is required")
        if not context.budget_scope:
            raise ValueError("budget_scope must identify the expected gateway budget")
        if receipt_timeout_seconds <= 0 or receipt_poll_interval_seconds <= 0:
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

        self.context = context
        self.runtime = runtime
        self.provider = provider
        self.agent_id = agent_id
        self.session_id = session_id
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
            customer_id=context.tenant,
            workflow_id=context.workload,
            agent_id=agent_id,
            end_user_id=context.principal,
        )
        request_client = httpx.AsyncClient(
            event_hooks={
                "request": [self._admit_before_send],
                "response": [self._capture_response],
            },
            follow_redirects=False,
            transport=request_transport,
        )
        self._openai = AsyncOpenAI(
            api_key=resolved_key,
            base_url=str(self._gateway_url),
            default_headers=headers,
            max_retries=0,
            http_client=request_client,
        )
        self._delegate = OpenAIProvider(
            openai_client=self._openai,
            use_responses=use_responses,
            use_responses_websocket=False,
        )
        self._receipt_client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {resolved_key}"},
            follow_redirects=False,
            transport=receipt_transport,
        )

    async def __aenter__(self) -> GatewayBoundaryProvider:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    def get_model(self, model_name: str | None) -> Model:
        if self._closed:
            raise RuntimeError("GatewayBoundaryProvider is closed")
        return GatewayBoundaryModel(self._delegate.get_model(model_name), self)

    def coverage(self) -> CoverageReport:
        return openai_agents_coverage(model_dispatch_enrolled=True)

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._delegate.aclose()
        await self._openai.close()
        await self._receipt_client.aclose()

    async def _append_receipt_locked(self, receipt: BoundaryReceipt) -> None:
        async with self.context._admission_lock:
            self.context.receipts.append(receipt)

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
            request.headers.get("x-llmkit-customer-id") != self.context.tenant
            or request.headers.get("x-llmkit-workflow-id") != self.context.workload
            or request.headers.get("x-llmkit-user-id") != self.context.principal
            or request.headers.get("x-llmkit-session-id") != self.session_id
            or (
                self.agent_id is not None
                and request.headers.get("x-llmkit-agent-id") != self.agent_id
            )
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
                "customer_id": self.context.tenant,
                "workflow_id": self.context.workload,
                "agent_id": self.agent_id,
                "session_id": self.session_id,
                "end_user_id": self.context.principal,
            },
        )

    async def _admit_before_send(self, request: httpx.Request) -> None:
        attempt = _current_model_attempt.get()
        if attempt is None or attempt.owner_id != id(self):
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
                    attempt, "unexpected_second_model_request", attempt.terminal
                )
            attempt.request_seen = True
            action = await self._action_from_request(attempt, request)
            attempt.action = action

            resolver = self.context.model_grant_resolver
            resolution_failed = False
            try:
                resolution = resolver(action) if resolver is not None else None
                grant = await resolution if isinstance(resolution, Awaitable) else resolution
            except Exception:
                grant = None
                resolution_failed = True

            async with self.context._admission_lock:
                if self.context._finalized:
                    admission = self.runtime.deny(
                        action=action,
                        reason="boundary_context_finalized",
                        principal=self.context.principal,
                        tenant=self.context.tenant,
                        workload=self.context.workload,
                    )
                elif resolution_failed:
                    admission = self.runtime.deny(
                        action=action,
                        reason="grant_resolution_failed",
                        principal=self.context.principal,
                        tenant=self.context.tenant,
                        workload=self.context.workload,
                    )
                else:
                    admission = self.runtime.admit(
                        action=action,
                        grant=grant,
                        principal=self.context.principal,
                        tenant=self.context.tenant,
                        workload=self.context.workload,
                        budget_scope=self.context.budget_scope,
                        provenance=self.context.provenance,
                    )
                self.context.receipts.append(admission.receipt)
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
        if attempt is None or attempt.owner_id != id(self):
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
            response = await self._receipt_client.get(url)
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
            "customer_id": self.context.tenant,
            "workflow_id": self.context.workload,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "end_user_id": self.context.principal,
            "budget_id": self.context.budget_scope,
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


class GatewayBoundaryModel(Model):
    """Non-streaming Model wrapper used unchanged by the Agents Runner."""

    def __init__(self, delegate: Model, owner: GatewayBoundaryProvider) -> None:
        self._delegate = delegate
        self._owner = owner

    async def get_response(
        self,
        system_instructions: str | None,
        input: str | list[TResponseInputItem],  # noqa: A002
        model_settings: ModelSettings,
        tools: list[Tool],
        output_schema: AgentOutputSchemaBase | None,
        handoffs: list[Handoff],
        tracing: ModelTracing,
        *,
        previous_response_id: str | None,
        conversation_id: str | None,
        prompt: ResponsePromptParam | None,
    ) -> ModelResponse:
        attempt = _ModelAttempt(
            owner_id=id(self._owner),
            call_id=self._owner._call_id_factory(),
        )
        extra_headers = dict(model_settings.extra_headers or {})
        extra_headers["Idempotency-Key"] = attempt.call_id
        dispatched_settings = replace(model_settings, extra_headers=extra_headers)
        token = _current_model_attempt.set(attempt)
        try:
            try:
                response = await self._delegate.get_response(
                    system_instructions,
                    input,
                    dispatched_settings,
                    tools,
                    output_schema,
                    handoffs,
                    tracing,
                    previous_response_id=previous_response_id,
                    conversation_id=conversation_id,
                    prompt=prompt,
                )
            except asyncio.CancelledError:
                await self._owner._mark_uncertain(attempt, "model_dispatch_canceled")
                raise
            except Exception as error:
                await self._owner._mark_uncertain(attempt, "model_dispatch_exception")
                if attempt.failure is not None and attempt.dispatched is None:
                    raise attempt.failure from error
                raise

            try:
                acknowledgement = await self._owner._verified_acknowledgement(attempt)
            except asyncio.CancelledError:
                await self._owner._mark_uncertain(attempt, "model_dispatch_canceled")
                raise
            except Exception as error:
                reason = (
                    error.reason
                    if isinstance(error, ModelDispatchBoundaryError)
                    else "gateway_receipt_error"
                )
                await self._owner._mark_uncertain(attempt, reason)
                raise ModelDispatchBoundaryError(reason, attempt.terminal) from error

            if attempt.admission is None or attempt.dispatched is None:
                raise ModelDispatchBoundaryError("model_dispatch_bypassed_boundary")
            terminal = self._owner.runtime.settle(
                attempt.admission,
                attempt.dispatched,
                acknowledgement,
            )
            attempt.terminal = terminal
            await self._owner._append_receipt(terminal)
            return response
        finally:
            _current_model_attempt.reset(token)

    async def stream_response(
        self,
        system_instructions: str | None,
        input: str | list[TResponseInputItem],  # noqa: A002
        model_settings: ModelSettings,
        tools: list[Tool],
        output_schema: AgentOutputSchemaBase | None,
        handoffs: list[Handoff],
        tracing: ModelTracing,
        *,
        previous_response_id: str | None,
        conversation_id: str | None,
        prompt: ResponsePromptParam | None,
    ) -> AsyncIterator[TResponseStreamEvent]:
        del (
            system_instructions,
            input,
            model_settings,
            tools,
            output_schema,
            handoffs,
            tracing,
            previous_response_id,
            conversation_id,
            prompt,
        )
        if False:
            yield cast(TResponseStreamEvent, None)
        raise UnsupportedModelStreamingError("model_streaming_uncovered")


def protect_function_tool(
    tool: FunctionTool,
    *,
    runtime: BoundaryRuntime,
    tool_version: str,
    effect_class: str,
    acknowledgement: Acknowledgement | None = None,
) -> FunctionTool:
    """Attach exact-effect admission and honest lifecycle receipts to one function tool."""

    if tool.needs_approval is not False:
        raise ValueError(
            "approval-required function tools are unsupported because the SDK "
            "does not expose a rejection release hook"
        )

    def finalized_output(
        context: OpenAIBoundaryContext,
        action: EffectAction,
    ) -> ToolGuardrailFunctionOutput:
        denial = runtime.deny(
            action=action,
            reason="boundary_context_finalized",
            principal=context.principal,
            tenant=context.tenant,
            workload=context.workload,
        )
        context.receipts.append(denial.receipt)
        return ToolGuardrailFunctionOutput.raise_exception(output_info=denial.receipt.as_dict())

    async def guard(data: ToolInputGuardrailData) -> ToolGuardrailFunctionOutput:
        context = data.context.context
        if not isinstance(context, OpenAIBoundaryContext):
            return ToolGuardrailFunctionOutput.raise_exception(
                output_info={"state": "uncovered", "reason": "missing_boundary_context"}
            )
        try:
            action = EffectAction.from_arguments(
                effect_class=effect_class,
                target=data.context.qualified_tool_name,
                version=tool_version,
                call_id=data.context.tool_call_id,
                arguments=data.context.tool_arguments,
            )
        except ValueError:
            async with context._admission_lock:
                existing_key = _find_call_admission(
                    context,
                    runtime,
                    data.context.tool_call_id,
                )
                if existing_key is not None:
                    invalidated = context._admissions.pop(existing_key)
                    context.receipts.append(
                        invalidated.runtime.release(
                            invalidated.admission,
                            "arguments_changed_after_admission",
                        )
                    )
            return ToolGuardrailFunctionOutput.raise_exception(
                output_info={"state": "denied", "reason": "invalid_tool_arguments"}
            )

        admission_key = _admission_key(runtime, action)
        async with context._admission_lock:
            if context._finalized:
                return finalized_output(context, action)
            cached = context._admissions.get(admission_key)
            if cached is not None:
                return ToolGuardrailFunctionOutput.allow(
                    output_info=cached.admission.receipt.as_dict()
                )

            changed_key = _find_call_admission(
                context,
                runtime,
                data.context.tool_call_id,
            )
            if changed_key is not None:
                changed = context._admissions.pop(changed_key)
                context.receipts.append(
                    changed.runtime.release(
                        changed.admission,
                        "arguments_changed_after_admission",
                    )
                )
                denial = runtime.deny(
                    action=action,
                    reason="action_changed_after_admission",
                    principal=context.principal,
                    tenant=context.tenant,
                    workload=context.workload,
                )
                context.receipts.append(denial.receipt)
                return ToolGuardrailFunctionOutput.raise_exception(
                    output_info=denial.receipt.as_dict()
                )

        resolution_failed = False
        try:
            grant = await _resolve_grant(context.grant_resolver, action, data.context)
        except Exception:
            grant = None
            resolution_failed = True

        async with context._admission_lock:
            if context._finalized:
                return finalized_output(context, action)
            cached = context._admissions.get(admission_key)
            if cached is not None:
                return ToolGuardrailFunctionOutput.allow(
                    output_info=cached.admission.receipt.as_dict()
                )

            changed_key = _find_call_admission(
                context,
                runtime,
                data.context.tool_call_id,
            )
            if changed_key is not None:
                changed = context._admissions.pop(changed_key)
                context.receipts.append(
                    changed.runtime.release(
                        changed.admission,
                        "arguments_changed_after_admission",
                    )
                )
                denial = runtime.deny(
                    action=action,
                    reason="action_changed_after_admission",
                    principal=context.principal,
                    tenant=context.tenant,
                    workload=context.workload,
                )
                context.receipts.append(denial.receipt)
                return ToolGuardrailFunctionOutput.raise_exception(
                    output_info=denial.receipt.as_dict()
                )

            if resolution_failed:
                admission = runtime.deny(
                    action=action,
                    reason="grant_resolution_failed",
                    principal=context.principal,
                    tenant=context.tenant,
                    workload=context.workload,
                )
            else:
                admission = runtime.admit(
                    action=action,
                    grant=grant,
                    principal=context.principal,
                    tenant=context.tenant,
                    workload=context.workload,
                    budget_scope=context.budget_scope,
                    provenance=context.provenance,
                )
            context.receipts.append(admission.receipt)
            if not admission.allowed:
                return ToolGuardrailFunctionOutput.raise_exception(
                    output_info=admission.receipt.as_dict()
                )
            context._admissions[admission_key] = _PendingAdmission(runtime, admission)
            return ToolGuardrailFunctionOutput.allow(output_info=admission.receipt.as_dict())

    input_guardrail: ToolInputGuardrail[Any] = ToolInputGuardrail(
        guardrail_function=guard,
        name="llmkit_boundary",
    )
    original_invoke = tool.on_invoke_tool

    async def invoke(context: ToolContext[Any], arguments: str) -> Any:
        boundary_context = context.context
        if not isinstance(boundary_context, OpenAIBoundaryContext):
            raise RuntimeError("LLMKit boundary context is missing")
        try:
            invoked_action = EffectAction.from_arguments(
                effect_class=effect_class,
                target=context.qualified_tool_name,
                version=tool_version,
                call_id=context.tool_call_id,
                arguments=arguments,
            )
        except ValueError as error:
            async with boundary_context._admission_lock:
                changed_key = _find_call_admission(
                    boundary_context,
                    runtime,
                    context.tool_call_id,
                )
                if changed_key is not None:
                    changed = boundary_context._admissions.pop(changed_key)
                    boundary_context.receipts.append(
                        changed.runtime.release(
                            changed.admission,
                            "arguments_changed_after_admission",
                        )
                    )
            raise RuntimeError("LLMKit tool arguments changed after admission") from error

        admission_key = _admission_key(runtime, invoked_action)
        async with boundary_context._admission_lock:
            pending = boundary_context._admissions.pop(admission_key, None)
            if pending is None:
                changed_key = _find_call_admission(
                    boundary_context,
                    runtime,
                    context.tool_call_id,
                )
                if changed_key is not None:
                    changed = boundary_context._admissions.pop(changed_key)
                    boundary_context.receipts.append(
                        changed.runtime.release(
                            changed.admission,
                            "arguments_changed_after_admission",
                        )
                    )
                    raise RuntimeError("LLMKit tool arguments changed after admission")
                raise RuntimeError("LLMKit admission was bypassed")
            admission = pending.admission
        if admission.action.sha256 != invoked_action.sha256:
            boundary_context.receipts.append(
                runtime.release(admission, "arguments_changed_after_admission")
            )
            raise RuntimeError("LLMKit tool arguments changed after admission")

        try:
            dispatched = runtime.dispatch(admission)
        except BoundaryDispatchError as error:
            boundary_context.receipts.append(error.receipt)
            raise RuntimeError("LLMKit grant expired before dispatch") from error
        boundary_context.receipts.append(dispatched)
        try:
            output = await original_invoke(context, arguments)
        except asyncio.CancelledError:
            boundary_context.receipts.append(
                runtime.uncertain(admission, dispatched, "sink_canceled")
            )
            raise
        except Exception:
            boundary_context.receipts.append(
                runtime.uncertain(admission, dispatched, "sink_exception")
            )
            raise

        try:
            application_ack = acknowledgement(output) if acknowledgement else None
        except Exception:
            terminal = runtime.uncertain(
                admission,
                dispatched,
                "acknowledgement_extraction_error",
            )
        else:
            if application_ack is None:
                terminal = runtime.uncertain(
                    admission,
                    dispatched,
                    "missing_application_acknowledgement",
                )
            elif not isinstance(application_ack, EffectAcknowledgement):
                terminal = runtime.uncertain(
                    admission,
                    dispatched,
                    "invalid_application_acknowledgement",
                )
            else:
                terminal = runtime.settle(admission, dispatched, application_ack)
        boundary_context.receipts.append(terminal)
        return output

    return replace(
        tool,
        on_invoke_tool=invoke,
        tool_input_guardrails=[*(tool.tool_input_guardrails or []), input_guardrail],
    )
