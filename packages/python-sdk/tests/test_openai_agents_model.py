"""Real Runner proofs for the non-streaming OpenAI model-dispatch boundary."""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from agents import Agent, FunctionTool, ModelSettings, RunConfig, Runner
from agents.tool_context import ToolContext
from openai import APIConnectionError

from llmkit import (
    BoundaryRuntime,
    BoundaryState,
    EffectAcknowledgement,
    EffectAction,
    HmacAuthority,
    content_sha256,
)
from llmkit.boundary import ExactEffectGrant, canonical_arguments
from llmkit.integrations.openai_agents import (
    GatewayBoundaryProvider,
    ModelDispatchBoundaryError,
    OpenAIBoundaryContext,
    UnsupportedModelStreamingError,
    _current_model_attempt,
    _ModelAttempt,
    protect_function_tool,
)

POLICY = content_sha256({"name": "model-dispatch-test", "version": 1})
BUDGET_ID = "11111111-1111-4111-8111-111111111111"
MODEL = "gpt-4.1-mini"


class FakeGateway:
    def __init__(
        self,
        responses: list[dict[str, Any]],
        *,
        receipt_overrides: dict[str, Any] | None = None,
        block_dispatch: bool = False,
        block_receipt: bool = False,
    ) -> None:
        self.responses = list(responses)
        self.receipt_overrides = receipt_overrides or {}
        self.block_dispatch = block_dispatch
        self.block_receipt = block_receipt
        self.model_requests: list[httpx.Request] = []
        self.receipts: dict[str, dict[str, Any]] = {}
        self.dispatch_started = asyncio.Event()
        self.release_dispatch = asyncio.Event()
        self.receipt_lookup_started = asyncio.Event()
        self.release_receipt = asyncio.Event()

    async def model_request(self, request: httpx.Request) -> httpx.Response:
        self.model_requests.append(request)
        self.dispatch_started.set()
        if self.block_dispatch:
            await self.release_dispatch.wait()
        if not self.responses:
            raise AssertionError("unexpected model request")
        payload = self.responses.pop(0)
        content = json.dumps(payload, separators=(",", ":")).encode()
        request_body = json.loads(request.content)
        receipt_id = str(uuid.uuid4())
        provider_response_id = payload["id"]
        response_model = payload["model"]
        receipt = {
            "id": receipt_id,
            "customer_id": "smigolsmigol",
            "workflow_id": "pr-review",
            "agent_id": "reviewer",
            "session_id": "review-session",
            "end_user_id": "reviewer-user",
            "budget_id": BUDGET_ID,
            "budget_reservation_id": str(uuid.uuid4()),
            "requested_provider": "openai",
            "requested_model": request_body["model"],
            "last_dispatched_provider": "openai",
            "last_dispatched_model": request_body["model"],
            "provider_response_id": provider_response_id,
            "response_sha256": hashlib.sha256(content).hexdigest(),
            "provider": "openai",
            "model": response_model,
            "dispatch_status": "dispatched",
            "status": "success",
            "settlement_status": "settled_actual",
            "idempotency_key_hash": "a" * 64,
        }
        receipt.update(self.receipt_overrides)
        self.receipts[receipt_id] = receipt
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "x-llmkit-request-id": receipt_id,
                "x-llmkit-settlement-status": "pending",
                "x-request-id": receipt_id,
                "idempotency-key": request.headers["idempotency-key"],
            },
            content=content,
        )

    async def receipt_request(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer llmk_test"
        self.receipt_lookup_started.set()
        if self.block_receipt:
            await self.release_receipt.wait()
        receipt_id = request.url.path.rsplit("/", 1)[-1]
        receipt = self.receipts.get(receipt_id)
        if receipt is None:
            return httpx.Response(404, json={"error": "receipt not found"})
        return httpx.Response(200, json={"receipt": receipt})


class ReviewSink:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, context: ToolContext[Any], raw_arguments: str) -> dict[str, Any]:
        del context
        payload = canonical_arguments(raw_arguments)
        self.calls.append(payload)
        return {"review_id": len(self.calls)}


def completion(content: str) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
    }


def tool_completion(arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call-review-1",
                            "type": "function",
                            "function": {
                                "name": "post_review_comment",
                                "arguments": json.dumps(arguments, separators=(",", ":")),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
    }


def runtime(authority: HmacAuthority) -> BoundaryRuntime:
    return BoundaryRuntime(
        authority=authority,
        policy_sha256=POLICY,
        adapter="openai-agents-0.20",
        require_trusted_provenance=True,
    )


def boundary_context(
    authority: HmacAuthority,
    *,
    model_grant_mode: str = "valid",
) -> OpenAIBoundaryContext:
    def issue(action: EffectAction, *, prefix: str) -> ExactEffectGrant:
        grant_action = (
            replace(action, arguments_sha256=f"sha256:{'0' * 64}")
            if model_grant_mode == "changed"
            else action
        )
        expiry = (
            datetime.now(UTC) - timedelta(seconds=1)
            if model_grant_mode == "expired"
            else datetime.now(UTC) + timedelta(minutes=5)
        )
        return authority.issue(
            grant_id=f"{prefix}:{action.call_id}",
            principal="reviewer-user",
            tenant="smigolsmigol",
            workload="pr-review",
            action=grant_action,
            policy_sha256=POLICY,
            expires_at=expiry,
            budget_scope=BUDGET_ID,
        )

    def resolve_tool(action: EffectAction, context: ToolContext[Any]) -> ExactEffectGrant:
        del context
        return issue(action, prefix="tool")

    def resolve_model(action: EffectAction) -> ExactEffectGrant | None:
        if model_grant_mode == "missing":
            return None
        return issue(action, prefix="model")

    return OpenAIBoundaryContext(
        principal="reviewer-user",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope=BUDGET_ID,
        grant_resolver=resolve_tool,
        model_grant_resolver=resolve_model,
        provenance="trusted",
    )


def review_tool(sink: ReviewSink) -> FunctionTool:
    return FunctionTool(
        name="post_review_comment",
        description="Post one comment against an exact pull-request head.",
        params_json_schema={
            "type": "object",
            "properties": {
                "repository": {"type": "string"},
                "head": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["repository", "head", "body"],
            "additionalProperties": False,
        },
        on_invoke_tool=sink,
    )


def provider(
    gateway: FakeGateway,
    context: OpenAIBoundaryContext,
    boundary_runtime: BoundaryRuntime,
    *,
    call_id_factory: Callable[[], str] | None = None,
) -> GatewayBoundaryProvider:
    return GatewayBoundaryProvider(
        context=context,
        runtime=boundary_runtime,
        provider="openai",
        api_key="llmk_test",
        base_url="https://gateway.invalid/v1",
        agent_id="reviewer",
        session_id="review-session",
        receipt_timeout_seconds=0.2,
        receipt_poll_interval_seconds=0.001,
        request_transport=httpx.MockTransport(gateway.model_request),
        receipt_transport=httpx.MockTransport(gateway.receipt_request),
        call_id_factory=call_id_factory,
    )


async def run_agent(
    model_provider: GatewayBoundaryProvider,
    context: OpenAIBoundaryContext,
    *,
    tools: list[FunctionTool] | None = None,
    max_tokens: int | None = 64,
    extra_headers: dict[str, str] | None = None,
) -> Any:
    agent = Agent(
        name="reviewer",
        model=MODEL,
        model_settings=ModelSettings(max_tokens=max_tokens, extra_headers=extra_headers),
        tools=tools or [],
    )
    return await Runner.run(
        agent,
        "Review the exact pull-request head.",
        context=context,
        run_config=RunConfig(model_provider=model_provider),
    )


def test_real_runner_joins_model_and_tool_receipts() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        sink = ReviewSink()
        protected = protect_function_tool(
            review_tool(sink),
            runtime=boundary_runtime,
            tool_version="1",
            effect_class="github.review_comment",
            acknowledgement=lambda output: EffectAcknowledgement(
                source="review-sink",
                effect_id=str(output["review_id"]),
                version="v1",
            ),
        )
        gateway = FakeGateway(
            [
                tool_completion(
                    {
                        "repository": "smigolsmigol/llmkit",
                        "head": "a" * 40,
                        "body": "Add a boundary regression test.",
                    }
                ),
                completion("Review comment posted."),
            ]
        )
        model_provider = provider(gateway, context, boundary_runtime)
        try:
            result = await run_agent(model_provider, context, tools=[protected])
        finally:
            await model_provider.aclose()

        assert result.final_output == "Review comment posted."
        assert len(gateway.model_requests) == 2
        assert len(sink.calls) == 1
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.SETTLED,
        ] * 3
        assert all(authority.verify_receipt(receipt) for receipt in context.receipts)
        assert model_provider.coverage().status_for("model_dispatch").value == "enforced"

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("mode", "reason"),
    [("missing", "missing_grant"), ("expired", "expired_grant"), ("changed", "action_mismatch")],
)
def test_invalid_model_grant_stops_before_network(mode: str, reason: str) -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority, model_grant_mode=mode)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([completion("must not run")])
        model_provider = provider(gateway, context, boundary_runtime)
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await run_agent(model_provider, context)
        finally:
            await model_provider.aclose()

        assert raised.value.reason == reason
        assert gateway.model_requests == []
        assert [receipt.state for receipt in context.receipts] == [BoundaryState.DENIED]
        assert context.receipts[0].reason == reason

    asyncio.run(exercise())


def test_replayed_model_grant_stops_second_dispatch() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        sink = ReviewSink()
        protected = protect_function_tool(
            review_tool(sink),
            runtime=boundary_runtime,
            tool_version="1",
            effect_class="github.review_comment",
            acknowledgement=lambda output: EffectAcknowledgement(
                source="review-sink",
                effect_id=str(output["review_id"]),
                version="v1",
            ),
        )
        gateway = FakeGateway(
            [
                tool_completion(
                    {"repository": "smigolsmigol/llmkit", "head": "a" * 40, "body": "test"}
                ),
                completion("must not dispatch"),
            ]
        )
        model_provider = provider(
            gateway,
            context,
            boundary_runtime,
            call_id_factory=lambda: "fixed-model-call",
        )
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await run_agent(model_provider, context, tools=[protected])
        finally:
            await model_provider.aclose()

        assert raised.value.reason == "replayed_grant"
        assert len(gateway.model_requests) == 1
        assert len(sink.calls) == 1
        assert context.receipts[-1].state is BoundaryState.DENIED
        assert context.receipts[-1].reason == "replayed_grant"

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("receipt_overrides", "reason"),
    [
        ({"provider_response_id": "wrong-response"}, "gateway_receipt_mismatch"),
        ({"budget_reservation_id": None}, "gateway_budget_reservation_missing"),
        ({"idempotency_key_hash": None}, "gateway_idempotency_evidence_missing"),
    ],
)
def test_invalid_terminal_receipt_is_uncertain_and_withheld(
    receipt_overrides: dict[str, Any],
    reason: str,
) -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway(
            [completion("must be withheld")],
            receipt_overrides=receipt_overrides,
        )
        model_provider = provider(gateway, context, boundary_runtime)
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await run_agent(model_provider, context)
        finally:
            await model_provider.aclose()

        assert raised.value.reason == reason
        assert len(gateway.model_requests) == 1
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.UNCERTAIN,
        ]

    asyncio.run(exercise())


def test_provider_transport_failure_after_dispatch_is_uncertain() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([])
        model_provider = provider(gateway, context, boundary_runtime)
        try:
            with pytest.raises(APIConnectionError):
                await run_agent(model_provider, context)
        finally:
            await model_provider.aclose()

        assert len(gateway.model_requests) == 1
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.UNCERTAIN,
        ]
        assert context.receipts[-1].reason == "model_dispatch_exception"

    asyncio.run(exercise())


def test_cancellation_after_dispatch_is_uncertain() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([completion("never returned")], block_dispatch=True)
        model_provider = provider(gateway, context, boundary_runtime)
        task = asyncio.create_task(run_agent(model_provider, context))
        await gateway.dispatch_started.wait()
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            await model_provider.aclose()

        assert len(gateway.model_requests) == 1
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.UNCERTAIN,
        ]
        assert context.receipts[-1].reason == "model_dispatch_canceled"

    asyncio.run(exercise())


def test_cancellation_during_receipt_poll_is_uncertain() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([completion("must be withheld")], block_receipt=True)
        model_provider = provider(gateway, context, boundary_runtime)
        task = asyncio.create_task(run_agent(model_provider, context))
        await gateway.receipt_lookup_started.wait()
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            await model_provider.aclose()

        assert len(gateway.model_requests) == 1
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.UNCERTAIN,
        ]
        assert context.receipts[-1].reason == "model_dispatch_canceled"

    asyncio.run(exercise())


def test_changed_session_header_stops_before_admission() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([completion("must not run")])
        model_provider = provider(gateway, context, boundary_runtime)
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await run_agent(
                    model_provider,
                    context,
                    extra_headers={"x-llmkit-session-id": "changed-session"},
                )
        finally:
            await model_provider.aclose()

        assert raised.value.reason == "gateway_attribution_changed"
        assert gateway.model_requests == []
        assert context.receipts == []

    asyncio.run(exercise())


def test_streaming_fails_before_dispatch() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([completion("must not run")])
        model_provider = provider(gateway, context, boundary_runtime)
        agent = Agent(
            name="reviewer",
            model=MODEL,
            model_settings=ModelSettings(max_tokens=64),
        )
        streamed = Runner.run_streamed(
            agent,
            "Review the exact pull-request head.",
            context=context,
            run_config=RunConfig(model_provider=model_provider),
        )
        try:
            with pytest.raises(UnsupportedModelStreamingError):
                async for _ in streamed.stream_events():
                    pass
        finally:
            await model_provider.aclose()

        assert gateway.model_requests == []
        assert context.receipts == []

    asyncio.run(exercise())


def test_missing_output_limit_fails_before_admission() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        boundary_runtime = runtime(authority)
        gateway = FakeGateway([completion("must not run")])
        model_provider = provider(gateway, context, boundary_runtime)
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await run_agent(model_provider, context, max_tokens=None)
        finally:
            await model_provider.aclose()

        assert raised.value.reason == "missing_hard_budget_output_limit"
        assert gateway.model_requests == []
        assert context.receipts == []

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("provider", "provider is required"),
        ("resolver", "model_grant_resolver is required"),
        ("budget", "budget_scope must identify"),
        ("polling", "receipt polling bounds must be positive"),
        ("api_key", "api_key required"),
        ("base_url", "base_url must be an HTTPS"),
    ],
)
def test_provider_rejects_incomplete_enrollment(
    case: str,
    message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authority = HmacAuthority("test", secrets.token_bytes(32))
    context = boundary_context(authority)
    boundary_runtime = runtime(authority)
    kwargs: dict[str, Any] = {
        "context": context,
        "runtime": boundary_runtime,
        "provider": "openai",
        "api_key": "llmk_test",
        "base_url": "https://gateway.invalid/v1",
    }
    if case == "provider":
        kwargs["provider"] = " "
    elif case == "resolver":
        context.model_grant_resolver = None
    elif case == "budget":
        context.budget_scope = None
    elif case == "polling":
        kwargs["receipt_timeout_seconds"] = 0
    elif case == "api_key":
        monkeypatch.delenv("LLMKIT_API_KEY", raising=False)
        kwargs["api_key"] = None
    else:
        kwargs["base_url"] = "http://gateway.invalid/v1"

    with pytest.raises(ValueError, match=message):
        GatewayBoundaryProvider(**kwargs)


def test_provider_context_manager_closes_once() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        gateway = FakeGateway([])
        model_provider = provider(gateway, context, runtime(authority))
        async with model_provider as entered:
            assert entered is model_provider
        await model_provider.aclose()
        with pytest.raises(RuntimeError, match="closed"):
            model_provider.get_model(MODEL)

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("endpoint", "unexpected_gateway_endpoint"),
        ("method", "unexpected_gateway_request"),
        ("content_type", "non_json_model_request"),
        ("invalid_json", "invalid_model_request"),
        ("stream", "model_streaming_uncovered"),
        ("model", "missing_model_snapshot"),
        ("provider", "gateway_route_changed"),
        ("fallback", "gateway_route_changed"),
        ("idempotency", "gateway_idempotency_changed"),
    ],
)
def test_serialized_request_tampering_is_rejected(case: str, reason: str) -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        gateway = FakeGateway([])
        model_provider = provider(gateway, context, runtime(authority))
        attempt = _ModelAttempt(owner_id=id(model_provider), call_id="edge-call")
        url = "https://gateway.invalid/v1/chat/completions"
        method = "POST"
        headers = {
            "content-type": "application/json",
            "idempotency-key": attempt.call_id,
            "x-llmkit-provider": "openai",
            "x-llmkit-customer-id": "smigolsmigol",
            "x-llmkit-workflow-id": "pr-review",
            "x-llmkit-agent-id": "reviewer",
            "x-llmkit-session-id": "review-session",
            "x-llmkit-user-id": "reviewer-user",
        }
        body: dict[str, Any] = {"model": MODEL, "messages": [], "max_tokens": 64}
        if case == "endpoint":
            url = "https://other.invalid/v1/chat/completions"
        elif case == "method":
            method = "GET"
        elif case == "content_type":
            headers["content-type"] = "text/plain"
        elif case == "stream":
            body["stream"] = True
        elif case == "model":
            body.pop("model")
        elif case == "provider":
            headers["x-llmkit-provider"] = "anthropic"
        elif case == "fallback":
            headers["x-llmkit-fallback"] = "anthropic"
        elif case == "idempotency":
            headers["idempotency-key"] = "changed-call"
        content = b"\xff" if case == "invalid_json" else json.dumps(body).encode()
        request = httpx.Request(method, url, headers=headers, content=content)
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await model_provider._action_from_request(attempt, request)
        finally:
            await model_provider.aclose()
        assert raised.value.reason == reason

    asyncio.run(exercise())


def test_response_hook_rejects_bypass_and_ignores_unusable_json() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        gateway = FakeGateway([])
        model_provider = provider(gateway, context, runtime(authority))
        try:
            with pytest.raises(ModelDispatchBoundaryError, match="bypassed"):
                await model_provider._capture_response(httpx.Response(200, json={}))

            attempt = _ModelAttempt(owner_id=id(model_provider), call_id="capture-call")
            token = _current_model_attempt.set(attempt)
            try:
                await model_provider._capture_response(httpx.Response(200, content=b"\xff"))
                await model_provider._capture_response(httpx.Response(200, json=[]))
            finally:
                _current_model_attempt.reset(token)
            assert attempt.response_status == 200
            assert attempt.provider_response_id is None
            assert attempt.response_model is None
        finally:
            await model_provider.aclose()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("server_error", "gateway_receipt_lookup_failed"),
        ("not_found", "gateway_receipt_timeout"),
        ("non_object_payload", "gateway_receipt_timeout"),
        ("non_object_receipt", "gateway_receipt_timeout"),
        ("pending", "gateway_receipt_timeout"),
    ],
)
def test_terminal_receipt_polling_fails_closed(case: str, reason: str) -> None:
    async def exercise() -> None:
        async def receipt_handler(_request: httpx.Request) -> httpx.Response:
            if case == "server_error":
                return httpx.Response(500)
            if case == "not_found":
                return httpx.Response(404)
            if case == "non_object_payload":
                return httpx.Response(200, json=[])
            if case == "non_object_receipt":
                return httpx.Response(200, json={"receipt": []})
            return httpx.Response(
                200,
                json={
                    "receipt": {
                        "status": "pending",
                        "settlement_status": "pending",
                        "response_sha256": None,
                    }
                },
            )

        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        model_provider = GatewayBoundaryProvider(
            context=context,
            runtime=runtime(authority),
            provider="openai",
            api_key="llmk_test",
            base_url="https://gateway.invalid/v1",
            receipt_timeout_seconds=0.005,
            receipt_poll_interval_seconds=0.001,
            request_transport=httpx.MockTransport(FakeGateway([]).model_request),
            receipt_transport=httpx.MockTransport(receipt_handler),
        )
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await model_provider._poll_terminal_receipt(str(uuid.uuid4()))
        finally:
            await model_provider.aclose()
        assert raised.value.reason == reason

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("missing_id", "invalid_gateway_receipt_id"),
        ("malformed_id", "invalid_gateway_receipt_id"),
        ("noncanonical_id", "invalid_gateway_receipt_id"),
        ("failed_status", "gateway_model_request_failed"),
        ("incomplete", "incomplete_gateway_response_evidence"),
    ],
)
def test_gateway_response_preflight_rejects_incomplete_evidence(case: str, reason: str) -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = boundary_context(authority)
        gateway = FakeGateway([])
        model_provider = provider(gateway, context, runtime(authority))
        attempt = _ModelAttempt(owner_id=id(model_provider), call_id="preflight-call")
        attempt.receipt_id = "abcdefab-cdef-4abc-8def-abcdefabcdef"
        attempt.response_status = 200
        attempt.response_sha256 = "a" * 64
        attempt.provider_response_id = "chatcmpl-preflight"
        attempt.response_model = MODEL
        attempt.requested_provider = "openai"
        attempt.requested_model = MODEL
        if case == "missing_id":
            attempt.receipt_id = None
        elif case == "malformed_id":
            attempt.receipt_id = "not-a-uuid"
        elif case == "noncanonical_id":
            attempt.receipt_id = attempt.receipt_id.upper()
        elif case == "failed_status":
            attempt.response_status = 500
        else:
            attempt.response_sha256 = None
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await model_provider._verified_acknowledgement(attempt)
        finally:
            await model_provider.aclose()
        assert raised.value.reason == reason

    asyncio.run(exercise())
