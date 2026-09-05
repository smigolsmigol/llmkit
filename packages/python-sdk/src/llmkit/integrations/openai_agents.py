"""Exact-effect boundaries for explicitly enrolled OpenAI Agents paths."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any, cast

import httpx
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
    coverage_report,
)
from llmkit.integrations.model_dispatch import (
    GatewayModelDispatch,
    ModelGrantResolver,
    UnsupportedModelStreamingError,
    _ModelAttempt,
)
from llmkit.integrations.model_dispatch import (
    ModelDispatchBoundaryError as ModelDispatchBoundaryError,
)
from llmkit.integrations.model_dispatch import (
    _current_model_attempt as _current_model_attempt,
)

GrantResolution = ExactEffectGrant | None | Awaitable[ExactEffectGrant | None]
GrantResolver = Callable[[EffectAction, ToolContext[Any]], GrantResolution]
Acknowledgement = Callable[[Any], EffectAcknowledgement | None]


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


class GatewayBoundaryProvider(ModelProvider):
    """Owned non-streaming Agents provider routed through the LLMKit gateway."""

    context: OpenAIBoundaryContext
    runtime: BoundaryRuntime
    provider: str
    agent_id: str | None
    session_id: str | None
    _closed: bool
    _delegate: OpenAIProvider
    _model_dispatch: GatewayModelDispatch

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
        self.context = context
        self.runtime = runtime
        self.provider = provider
        self.agent_id = agent_id
        self.session_id = session_id
        self._closed = False
        self._model_dispatch = GatewayModelDispatch(
            runtime=runtime,
            principal=context.principal,
            tenant=context.tenant,
            workload=context.workload,
            budget_scope=context.budget_scope,
            provenance=context.provenance,
            model_grant_resolver=context.model_grant_resolver,
            receipt_lock=context._admission_lock,
            append_receipt=context.receipts.append,
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            provider_key=provider_key,
            agent_id=agent_id,
            session_id=session_id,
            receipt_timeout_seconds=receipt_timeout_seconds,
            receipt_poll_interval_seconds=receipt_poll_interval_seconds,
            request_transport=request_transport,
            receipt_transport=receipt_transport,
            call_id_factory=call_id_factory,
            context_is_finalized=lambda: self.context._finalized,
            owner_id=id(self),
        )
        self._delegate = OpenAIProvider(
            openai_client=self._model_dispatch.openai_client,
            use_responses=use_responses,
            use_responses_websocket=False,
        )

    async def __aenter__(self) -> GatewayBoundaryProvider:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    def get_model(self, model_name: str | None) -> Model:
        if self._closed:
            raise RuntimeError("GatewayBoundaryProvider is closed")
        return GatewayBoundaryModel(
            self._delegate.get_model(model_name),
            self._model_dispatch,
        )

    def coverage(self) -> CoverageReport:
        return openai_agents_coverage(model_dispatch_enrolled=True)

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._delegate.aclose()
        await self._model_dispatch.aclose()

    async def _action_from_request(
        self,
        attempt: _ModelAttempt,
        request: httpx.Request,
    ) -> EffectAction:
        return await self._model_dispatch._action_from_request(attempt, request)

    async def _capture_response(self, response: httpx.Response) -> None:
        await self._model_dispatch._capture_response(response)

    async def _poll_terminal_receipt(self, receipt_id: str) -> dict[str, Any]:
        return await self._model_dispatch._poll_terminal_receipt(receipt_id)

    async def _verified_acknowledgement(
        self,
        attempt: _ModelAttempt,
    ) -> EffectAcknowledgement:
        return await self._model_dispatch._verified_acknowledgement(attempt)


class GatewayBoundaryModel(Model):
    """Non-streaming Model wrapper used unchanged by the Agents Runner."""

    def __init__(self, delegate: Model, owner: GatewayModelDispatch) -> None:
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
        async def dispatch(call_id: str) -> ModelResponse:
            extra_headers = dict(model_settings.extra_headers or {})
            extra_headers["Idempotency-Key"] = call_id
            dispatched_settings = replace(model_settings, extra_headers=extra_headers)
            return await self._delegate.get_response(
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

        return await self._owner.execute(dispatch)

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
