"""Pydantic AI integration for LLMKit gateway control and local cost estimates.

Usage:
    from llmkit.integrations.pydantic_ai import gateway_model
    from pydantic_ai import Agent

    agent = Agent(gateway_model("gpt-4.1", session_id="release-review"))
    result = await agent.run("explain CQRS")

Requires: pip install "llmkit-sdk[pydantic-ai]"
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Self, cast

import httpx
from openai import AsyncOpenAI

try:
    from pydantic_ai import ModelRequestContext, ModelSettings, RunContext
    from pydantic_ai.capabilities import Hooks
    from pydantic_ai.messages import ModelMessage, ModelResponse
    from pydantic_ai.models import ModelRequestParameters, StreamedResponse
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.models.wrapper import WrapperModel
    from pydantic_ai.providers.openai import OpenAIProvider
    from pydantic_ai.usage import RequestUsage
except ImportError as e:
    raise ImportError(
        "pydantic-ai is required for this integration. "
        'Install it with: pip install "llmkit-sdk[pydantic-ai]"'
    ) from e

from llmkit._client import DEFAULT_BASE_URL, ENV_API_KEY, ENV_BASE_URL, _build_headers
from llmkit._pricing import calculate_cost
from llmkit.boundary import (
    BoundaryReceipt,
    BoundaryRuntime,
    CoverageEntry,
    CoverageReport,
    CoverageStatus,
    coverage_report,
)
from llmkit.integrations.model_dispatch import (
    GatewayModelDispatch,
    ModelGrantResolver,
    UnsupportedModelStreamingError,
)
from llmkit.integrations.model_dispatch import (
    ModelDispatchBoundaryError as ModelDispatchBoundaryError,
)


@dataclass
class PydanticAIBoundaryContext:
    """Identity, authority, and receipt state for enrolled Pydantic AI model calls."""

    principal: str
    tenant: str
    workload: str
    budget_scope: str | None
    model_grant_resolver: ModelGrantResolver
    provenance: str | None = None
    receipts: list[BoundaryReceipt] = field(default_factory=list)
    _receipt_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


def pydantic_ai_coverage(*, model_dispatch_enrolled: bool = False) -> CoverageReport:
    """Declare which Pydantic AI surfaces this integration actually controls."""
    return coverage_report(
        "pydantic-ai",
        [
            CoverageEntry(
                "model_dispatch",
                CoverageStatus.ENFORCED if model_dispatch_enrolled else CoverageStatus.UNCOVERED,
                (
                    "the enrolled model joins an exact serialized request to a terminal "
                    "LLMKit gateway receipt"
                    if model_dispatch_enrolled
                    else "requires an enrolled PydanticAIGatewayBoundaryModel"
                ),
            ),
            CoverageEntry(
                "model_streaming",
                CoverageStatus.UNCOVERED,
                "stream finality requires a separate evidence contract",
            ),
            CoverageEntry(
                "function_tool",
                CoverageStatus.UNCOVERED,
                "Pydantic AI tool execution requires a separate exact-effect adapter",
            ),
            CoverageEntry(
                "provider_managed_tool",
                CoverageStatus.UNCOVERED,
                "provider-managed tools execute outside the local function-tool lifecycle",
            ),
            CoverageEntry(
                "unenrolled_model",
                CoverageStatus.UNCOVERED,
                "gateway_model routes traffic but does not verify exact grants or receipts",
            ),
            CoverageEntry(
                "direct_client",
                CoverageStatus.UNCOVERED,
                "only calls through the enrolled model request method are intercepted",
            ),
        ],
    )


def gateway_model(
    model: str,
    api_key: str | None = None,
    *,
    base_url: str | None = None,
    provider_key: str | None = None,
    provider: str | None = None,
    fallback: str | None = None,
    customer_id: str | None = None,
    workflow_id: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    end_user_id: str | None = None,
    settings: ModelSettings | None = None,
) -> OpenAIChatModel:
    """Route Pydantic AI through LLMKit without local exact-receipt verification."""
    resolved_key = api_key or os.environ.get(ENV_API_KEY)
    if not resolved_key:
        raise ValueError(f"api_key required: pass it directly or set {ENV_API_KEY}")

    headers = _build_headers(
        provider_key,
        provider,
        session_id,
        fallback,
        customer_id=customer_id,
        workflow_id=workflow_id,
        agent_id=agent_id,
        end_user_id=end_user_id,
    )
    client = AsyncOpenAI(
        api_key=resolved_key,
        base_url=base_url or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL,
        default_headers=headers,
        max_retries=0,
    )
    return OpenAIChatModel(
        model,
        provider=OpenAIProvider(openai_client=client),
        settings=settings,
    )


class PydanticAIGatewayBoundaryModel(WrapperModel):
    """Opt-in non-streaming model with exact grant and receipt verification."""

    def __init__(self, wrapped: OpenAIChatModel, owner: GatewayModelDispatch) -> None:
        super().__init__(wrapped)
        self._owner = owner

    async def __aenter__(self) -> Self:
        try:
            await self.wrapped.__aenter__()
        except BaseException:
            await self._owner.aclose()
            raise
        return self

    async def __aexit__(self, *args: Any) -> bool | None:
        try:
            return await self.wrapped.__aexit__(*args)
        finally:
            await self._owner.aclose()

    async def aclose(self) -> None:
        """Close the owned gateway request and receipt clients."""
        await self._owner.aclose()

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        async def dispatch(call_id: str) -> ModelResponse:
            dispatched_settings = dict(model_settings or {})
            configured_headers = cast(
                dict[str, str] | None,
                dispatched_settings.get("extra_headers"),
            )
            extra_headers = dict(configured_headers or {})
            extra_headers["Idempotency-Key"] = call_id
            dispatched_settings["extra_headers"] = extra_headers
            return await self.wrapped.request(
                messages,
                cast(ModelSettings, dispatched_settings),
                model_request_parameters,
            )

        return await self._owner.execute(dispatch)

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: RunContext[Any] | None = None,
    ) -> AsyncGenerator[StreamedResponse]:
        del messages, model_settings, model_request_parameters, run_context
        if False:
            yield cast(StreamedResponse, None)
        raise UnsupportedModelStreamingError("model_streaming_uncovered")

    def coverage(self) -> CoverageReport:
        return pydantic_ai_coverage(model_dispatch_enrolled=True)


def gateway_boundary_model(
    model: str,
    *,
    context: PydanticAIBoundaryContext,
    runtime: BoundaryRuntime,
    provider: str,
    api_key: str | None = None,
    base_url: str | None = None,
    provider_key: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    settings: ModelSettings | None = None,
    receipt_timeout_seconds: float = 5.0,
    receipt_poll_interval_seconds: float = 0.05,
    request_transport: httpx.AsyncBaseTransport | None = None,
    receipt_transport: httpx.AsyncBaseTransport | None = None,
    call_id_factory: Callable[[], str] | None = None,
) -> PydanticAIGatewayBoundaryModel:
    """Build an enrolled Pydantic AI model with exact dispatch evidence."""
    owner = GatewayModelDispatch(
        runtime=runtime,
        principal=context.principal,
        tenant=context.tenant,
        workload=context.workload,
        budget_scope=context.budget_scope,
        provenance=context.provenance,
        model_grant_resolver=context.model_grant_resolver,
        receipt_lock=context._receipt_lock,
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
    )
    wrapped = OpenAIChatModel(
        model,
        provider=OpenAIProvider(openai_client=owner.openai_client),
        settings=settings,
    )
    return PydanticAIGatewayBoundaryModel(wrapped, owner)


class LLMKitCostTracker:
    """Tracks costs across Pydantic AI agent runs via Hooks capability."""

    def __init__(self, hooks: Hooks, on_cost: Callable[[float], Any] | None = None) -> None:
        self.on_cost = on_cost
        self.total_cost: float = 0.0
        self.total_tokens: int = 0
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.request_count: int = 0
        self._last_cost: float | None = None

        @hooks.on.after_model_request
        async def _track_cost(
            ctx: RunContext[Any],
            *,
            request_context: ModelRequestContext,
            response: ModelResponse,
        ) -> ModelResponse:
            del ctx, request_context
            self._record(response.usage, _extract_model(response.model_name))
            return response

    @property
    def last_cost(self) -> float | None:
        return self._last_cost

    def _record(self, usage: RequestUsage, model: str) -> None:
        input_tok = usage.input_tokens or 0
        output_tok = usage.output_tokens or 0

        if input_tok == 0 and output_tok == 0:
            return

        cost_value = calculate_cost(model, input_tok, output_tok)

        self.input_tokens += input_tok
        self.output_tokens += output_tok
        self.total_tokens += input_tok + output_tok
        self.request_count += 1
        if cost_value is not None:
            self.total_cost += cost_value

        self._last_cost = cost_value
        if self.on_cost and cost_value is not None:
            self.on_cost(cost_value)

    def __repr__(self) -> str:
        return (
            "LLMKitCostTracker("
            f"requests={self.request_count}, cost=${self.total_cost:.4f}, "
            f"tokens={self.total_tokens})"
        )


def _extract_model(model: Any) -> str:
    if model is None:
        return ""
    if isinstance(model, str):
        # pydantic-ai uses "provider:model" format, strip the provider prefix
        return model.split(":", 1)[-1] if ":" in model else model
    name = getattr(model, "model_name", None) or getattr(model, "name", None) or ""
    return name.split(":", 1)[-1] if ":" in name else name


def llmkit_hooks(
    on_cost: Callable[[float], Any] | None = None,
) -> tuple[Hooks, LLMKitCostTracker]:
    """Create a Hooks capability with LLMKit cost tracking.

    Returns (hooks, tracker) - pass hooks to Agent capabilities,
    read costs from tracker.
    """
    hooks = Hooks()
    tracker = LLMKitCostTracker(hooks, on_cost=on_cost)
    return hooks, tracker
