"""Real Pydantic AI integration tests with an in-process HTTP transport."""

import asyncio
import hashlib
import json
import secrets
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent, ModelSettings
from pydantic_ai.exceptions import ModelHTTPError

import llmkit.integrations.pydantic_ai as integration
from llmkit import (
    BoundaryRuntime,
    BoundaryState,
    CoverageStatus,
    EffectAction,
    HmacAuthority,
    content_sha256,
)
from llmkit.boundary import ExactEffectGrant
from llmkit.integrations.pydantic_ai import (
    LLMKitCostTracker,
    ModelDispatchBoundaryError,
    PydanticAIBoundaryContext,
    PydanticAIGatewayBoundaryModel,
    UnsupportedModelStreamingError,
    _extract_model,
    gateway_boundary_model,
    gateway_model,
    llmkit_hooks,
    pydantic_ai_coverage,
)

POLICY = content_sha256({"name": "pydantic-model-dispatch-test", "version": 1})
BUDGET_ID = "11111111-1111-4111-8111-111111111111"
MODEL = "gpt-4.1-mini"


class BoundaryGateway:
    def __init__(
        self,
        *,
        receipt_overrides: dict[str, Any] | None = None,
        omit_receipt: bool = False,
    ) -> None:
        self.receipt_overrides = receipt_overrides or {}
        self.omit_receipt = omit_receipt
        self.model_requests: list[httpx.Request] = []
        self.receipts: dict[str, dict[str, Any]] = {}

    async def model_request(self, request: httpx.Request) -> httpx.Response:
        self.model_requests.append(request)
        payload = _completion()
        content = json.dumps(payload, separators=(",", ":")).encode()
        request_body = json.loads(request.content)
        receipt_id = str(uuid.uuid4())
        receipt = {
            "id": receipt_id,
            "customer_id": "tenant-1",
            "workflow_id": "release-review",
            "agent_id": "reviewer",
            "session_id": "session-1",
            "end_user_id": "user@example.com",
            "budget_id": BUDGET_ID,
            "budget_reservation_id": str(uuid.uuid4()),
            "requested_provider": "openai",
            "requested_model": request_body["model"],
            "last_dispatched_provider": "openai",
            "last_dispatched_model": request_body["model"],
            "provider_response_id": payload["id"],
            "response_sha256": hashlib.sha256(content).hexdigest(),
            "provider": "openai",
            "model": payload["model"],
            "dispatch_status": "dispatched",
            "status": "success",
            "settlement_status": "settled_actual",
            "idempotency_key_hash": hashlib.sha256(
                request.headers["idempotency-key"].encode()
            ).hexdigest(),
        }
        receipt.update(self.receipt_overrides)
        self.receipts[receipt_id] = receipt
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "x-llmkit-request-id": receipt_id,
            },
            content=content,
        )

    async def receipt_request(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer llmk_test"
        receipt_id = request.url.path.rsplit("/", 1)[-1]
        receipt = self.receipts.get(receipt_id)
        if self.omit_receipt or receipt is None:
            return httpx.Response(404, json={"error": "receipt not found"})
        return httpx.Response(200, json={"receipt": receipt})


def _completion() -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": "gpt-4.1-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "pong"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 7, "completion_tokens": 2, "total_tokens": 9},
    }


def _runtime(authority: HmacAuthority) -> BoundaryRuntime:
    return BoundaryRuntime(
        authority=authority,
        policy_sha256=POLICY,
        adapter="pydantic-ai-2.31",
        require_trusted_provenance=True,
    )


def _boundary_context(
    authority: HmacAuthority,
    *,
    grant_mode: str = "valid",
    observed_actions: list[EffectAction] | None = None,
) -> PydanticAIBoundaryContext:
    def resolve_model(action: EffectAction) -> ExactEffectGrant | None:
        if observed_actions is not None:
            observed_actions.append(action)
        if grant_mode == "missing":
            return None
        grant_action = (
            replace(action, arguments_sha256=f"sha256:{'0' * 64}")
            if grant_mode == "changed"
            else action
        )
        return authority.issue(
            grant_id=f"pydantic-model:{action.call_id}",
            principal="user@example.com",
            tenant="tenant-1",
            workload="release-review",
            action=grant_action,
            policy_sha256=POLICY,
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            budget_scope=BUDGET_ID,
        )

    return PydanticAIBoundaryContext(
        principal="user@example.com",
        tenant="tenant-1",
        workload="release-review",
        budget_scope=BUDGET_ID,
        model_grant_resolver=resolve_model,
        provenance="trusted",
    )


def _boundary_model(
    gateway: BoundaryGateway,
    context: PydanticAIBoundaryContext,
    boundary_runtime: BoundaryRuntime,
    *,
    receipt_timeout_seconds: float = 0.2,
) -> PydanticAIGatewayBoundaryModel:
    return gateway_boundary_model(
        MODEL,
        context=context,
        runtime=boundary_runtime,
        provider="openai",
        api_key="llmk_test",
        base_url="https://gateway.invalid/v1",
        agent_id="reviewer",
        session_id="session-1",
        settings=ModelSettings(max_tokens=64),
        receipt_timeout_seconds=receipt_timeout_seconds,
        receipt_poll_interval_seconds=0.001,
        request_transport=httpx.MockTransport(gateway.model_request),
        receipt_transport=httpx.MockTransport(gateway.receipt_request),
        call_id_factory=lambda: "pydantic-call-1",
    )


def test_gateway_model_requires_api_key(monkeypatch):
    monkeypatch.delenv(integration.ENV_API_KEY, raising=False)

    with pytest.raises(ValueError, match="api_key required"):
        gateway_model("gpt-4.1-mini")


def test_gateway_model_runs_real_agent_with_attribution(monkeypatch):
    observed: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        observed["headers"] = dict(request.headers)
        observed["body"] = json.loads(request.content)
        return httpx.Response(200, json=_completion())

    transport = httpx.MockTransport(handler)
    original_client = AsyncOpenAI

    def client_factory(**kwargs):
        observed["client"] = kwargs
        return original_client(
            **kwargs,
            http_client=httpx.AsyncClient(transport=transport),
        )

    monkeypatch.setattr(integration, "AsyncOpenAI", client_factory)

    async def run():
        model = gateway_model(
            "gpt-4.1-mini",
            api_key="llmk_test",
            base_url="https://gateway.invalid/v1",
            provider="openai",
            fallback="anthropic",
            customer_id="tenant-1",
            workflow_id="release-review",
            agent_id="reviewer",
            session_id="session-1",
            end_user_id="user@example.com",
            settings=ModelSettings(max_tokens=64),
        )
        hooks, tracker = llmkit_hooks()
        try:
            result = await Agent(model, capabilities=[hooks]).run("ping")
        finally:
            await model.client.close()
        return result, tracker

    result, tracker = asyncio.run(run())

    assert result.output == "pong"
    assert observed["client"]["base_url"] == "https://gateway.invalid/v1"
    assert observed["client"]["max_retries"] == 0
    assert observed["body"]["max_completion_tokens"] == 64
    assert observed["headers"]["x-llmkit-customer-id"] == "tenant-1"
    assert observed["headers"]["x-llmkit-workflow-id"] == "release-review"
    assert observed["headers"]["x-llmkit-agent-id"] == "reviewer"
    assert observed["headers"]["x-llmkit-session-id"] == "session-1"
    assert observed["headers"]["x-llmkit-user-id"] == "user@example.com"
    assert tracker.request_count == 1
    assert tracker.input_tokens == 7
    assert tracker.output_tokens == 2


def test_gateway_transient_rejection_is_not_retried(monkeypatch):
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        del request
        attempts += 1
        return httpx.Response(
            503,
            json={"error": {"message": "provider unavailable", "type": "server_error"}},
        )

    transport = httpx.MockTransport(handler)
    original_client = AsyncOpenAI

    def client_factory(**kwargs):
        return original_client(
            **kwargs,
            http_client=httpx.AsyncClient(transport=transport),
        )

    monkeypatch.setattr(integration, "AsyncOpenAI", client_factory)

    async def run():
        model = gateway_model(
            "gpt-4.1-mini",
            api_key="llmk_test",
            base_url="https://gateway.invalid/v1",
            settings=ModelSettings(max_tokens=64),
        )
        try:
            with pytest.raises(ModelHTTPError, match="provider unavailable"):
                await Agent(model).run("ping")
        finally:
            await model.client.close()

    asyncio.run(run())
    assert attempts == 1


def test_boundary_model_real_agent_joins_exact_receipt() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        observed_actions: list[EffectAction] = []
        context = _boundary_context(authority, observed_actions=observed_actions)
        gateway = BoundaryGateway()
        model = _boundary_model(gateway, context, _runtime(authority))
        async with model as entered:
            assert entered is model
            result = await Agent(
                model,
                model_settings=ModelSettings(extra_headers={"Idempotency-Key": "caller-selected"}),
            ).run("ping")
        await model.aclose()
        with pytest.raises(RuntimeError, match="closed"):
            await Agent(model).run("must not dispatch")

        assert result.output == "pong"
        assert len(gateway.model_requests) == 1
        request = gateway.model_requests[0]
        assert request.headers["idempotency-key"] == "pydantic-call-1"
        assert len(observed_actions) == 1
        assert observed_actions[0].call_id == "pydantic-call-1"
        assert observed_actions[0].effect_class == "model.dispatch"
        assert observed_actions[0].target == f"llmkit-gateway:openai:{MODEL}"
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.SETTLED,
        ]
        assert all(authority.verify_receipt(receipt) for receipt in context.receipts)
        assert model.coverage().status_for("model_dispatch") is CoverageStatus.ENFORCED

    asyncio.run(exercise())


def test_boundary_model_route_tampering_stops_before_network() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = _boundary_context(authority)
        gateway = BoundaryGateway()
        model = _boundary_model(gateway, context, _runtime(authority))
        agent = Agent(
            model,
            model_settings=ModelSettings(extra_headers={"x-llmkit-provider": "anthropic"}),
        )
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await agent.run("ping")
        finally:
            await model.aclose()

        assert raised.value.reason == "gateway_route_changed"
        assert gateway.model_requests == []
        assert context.receipts == []

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("grant_mode", "reason"),
    [("missing", "missing_grant"), ("changed", "action_mismatch")],
)
def test_boundary_model_invalid_grant_stops_before_network(
    grant_mode: str,
    reason: str,
) -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = _boundary_context(authority, grant_mode=grant_mode)
        gateway = BoundaryGateway()
        model = _boundary_model(gateway, context, _runtime(authority))
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await Agent(model).run("ping")
        finally:
            await model.aclose()

        assert raised.value.reason == reason
        assert gateway.model_requests == []
        assert [receipt.state for receipt in context.receipts] == [BoundaryState.DENIED]
        assert context.receipts[0].reason == reason

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("gateway_kwargs", "timeout_seconds", "reason"),
    [
        (
            {"receipt_overrides": {"provider_response_id": "wrong-response"}},
            0.2,
            "gateway_receipt_mismatch",
        ),
        ({"omit_receipt": True}, 0.005, "gateway_receipt_timeout"),
    ],
)
def test_boundary_model_invalid_receipt_is_uncertain_and_withheld(
    gateway_kwargs: dict[str, Any],
    timeout_seconds: float,
    reason: str,
) -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = _boundary_context(authority)
        gateway = BoundaryGateway(**gateway_kwargs)
        model = _boundary_model(
            gateway,
            context,
            _runtime(authority),
            receipt_timeout_seconds=timeout_seconds,
        )
        try:
            with pytest.raises(ModelDispatchBoundaryError) as raised:
                await Agent(model).run("ping")
        finally:
            await model.aclose()

        assert raised.value.reason == reason
        assert len(gateway.model_requests) == 1
        assert [receipt.state for receipt in context.receipts] == [
            BoundaryState.RESERVED,
            BoundaryState.DISPATCHED,
            BoundaryState.UNCERTAIN,
        ]

    asyncio.run(exercise())


def test_boundary_model_streaming_fails_before_network() -> None:
    async def exercise() -> None:
        authority = HmacAuthority("test", secrets.token_bytes(32))
        context = _boundary_context(authority)
        gateway = BoundaryGateway()
        model = _boundary_model(gateway, context, _runtime(authority))
        try:
            with pytest.raises(UnsupportedModelStreamingError) as raised:
                async with Agent(model).run_stream("ping"):
                    pass
        finally:
            await model.aclose()

        assert raised.value.reason == "model_streaming_uncovered"
        assert gateway.model_requests == []
        assert context.receipts == []

    asyncio.run(exercise())


def test_pydantic_ai_coverage_keeps_tools_and_streaming_uncovered() -> None:
    unenrolled = pydantic_ai_coverage()
    enrolled = pydantic_ai_coverage(model_dispatch_enrolled=True)

    assert unenrolled.status_for("model_dispatch") is CoverageStatus.UNCOVERED
    assert enrolled.status_for("model_dispatch") is CoverageStatus.ENFORCED
    assert enrolled.status_for("model_streaming") is CoverageStatus.UNCOVERED
    assert enrolled.status_for("function_tool") is CoverageStatus.UNCOVERED
    assert enrolled.status_for("provider_managed_tool") is CoverageStatus.UNCOVERED
    assert enrolled.status_for("direct_client") is CoverageStatus.UNCOVERED


def test_local_tracker_accumulates_known_usage():
    observed_costs: list[float] = []
    hooks, tracker = llmkit_hooks(observed_costs.append)
    assert isinstance(tracker, LLMKitCostTracker)
    assert hooks is not None

    tracker._record(SimpleNamespace(input_tokens=0, output_tokens=0), "gpt-4.1-mini")
    tracker._record(SimpleNamespace(input_tokens=100, output_tokens=50), "gpt-4.1-mini")
    tracker._record(SimpleNamespace(input_tokens=100, output_tokens=50), "gpt-4.1-mini")

    assert tracker.request_count == 2
    assert tracker.total_tokens == 300
    assert tracker.total_cost > 0
    assert tracker.last_cost is not None
    assert observed_costs == [tracker.last_cost, tracker.last_cost]
    assert "requests=2" in repr(tracker)
    assert "tokens=300" in repr(tracker)


def test_unknown_model_keeps_usage_without_inventing_cost():
    _, tracker = llmkit_hooks()
    tracker._record(SimpleNamespace(input_tokens=10, output_tokens=5), "unknown-model")

    assert tracker.request_count == 1
    assert tracker.total_tokens == 15
    assert tracker.last_cost is None


def test_model_prefix_stripping():
    assert _extract_model("openai:gpt-4.1-mini") == "gpt-4.1-mini"
    assert _extract_model("anthropic:claude-sonnet-4") == "claude-sonnet-4"
    assert _extract_model("gpt-4.1-mini") == "gpt-4.1-mini"
    assert _extract_model(SimpleNamespace(model_name="openai:gpt-4.1-mini")) == "gpt-4.1-mini"
    assert _extract_model(SimpleNamespace(name="openai:gpt-4.1-mini")) == "gpt-4.1-mini"
    assert _extract_model(None) == ""
