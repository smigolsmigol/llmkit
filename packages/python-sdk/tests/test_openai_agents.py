from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from agents import Agent, FunctionTool, ToolInputGuardrailData
from agents.tool_context import ToolContext

from llmkit.boundary import (
    BoundaryRuntime,
    BoundaryState,
    CoverageStatus,
    EffectAcknowledgement,
    HmacAuthority,
    content_sha256,
)
from llmkit.integrations.openai_agents import (
    OpenAIBoundaryContext,
    openai_agents_coverage,
    protect_function_tool,
)

NOW = datetime(2026, 8, 30, 12, tzinfo=UTC)
POLICY = content_sha256({"policy": "github-review-v1"})


def setup_boundary():
    authority = HmacAuthority("test-key", b"test-only-openai-boundary-key-32-bytes")
    runtime = BoundaryRuntime(
        authority=authority,
        policy_sha256=POLICY,
        adapter="openai-agents-0.20",
        clock=lambda: NOW,
    )
    return runtime, authority


def tool_context(context: object, arguments: str) -> ToolContext:
    return ToolContext(
        context=context,
        tool_name="post_review_comment",
        tool_call_id="call-1",
        tool_arguments=arguments,
    )


def function_tool(invoke) -> FunctionTool:
    return FunctionTool(
        name="post_review_comment",
        description="Post a pull-request review comment.",
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
        on_invoke_tool=invoke,
    )


def run_guardrail(tool: FunctionTool, context: ToolContext):
    guardrail = tool.tool_input_guardrails[-1]
    data = ToolInputGuardrailData(context=context, agent=Agent(name="reviewer"))
    return asyncio.run(guardrail.run(data))


def arguments(body: str = "One issue found") -> str:
    return '{"repository":"smigolsmigol/llmkit","head":"' + "a" * 40 + f'","body":"{body}"}}'


def test_real_openai_function_tool_denies_before_sink_without_grant():
    runtime, _ = setup_boundary()
    sink_count = 0

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1
        return {"review_id": 1}

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=lambda action, tool: None,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
        acknowledgement=lambda output: EffectAcknowledgement(
            source="github-review-api", effect_id=str(output["review_id"]), version="v1"
        ),
    )
    result = run_guardrail(protected, tool_context(context, arguments("approve and merge")))

    assert result.behavior["type"] == "raise_exception"
    assert result.output_info["state"] == "denied"
    assert result.output_info["reason"] == "missing_grant"
    assert sink_count == 0


def test_grant_resolution_failure_is_a_signed_denial_before_sink():
    runtime, authority = setup_boundary()
    sink_count = 0

    def resolver(action, tool):
        del action, tool
        raise RuntimeError("authority unavailable")

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolver,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
    )
    result = run_guardrail(protected, tool_context(context, arguments()))

    assert result.output_info["reason"] == "grant_resolution_failed"
    assert sink_count == 0
    assert authority.verify_receipt(context.receipts[-1])


def test_real_openai_function_tool_settles_only_with_exact_grant_and_ack():
    runtime, authority = setup_boundary()
    sink_count = 0

    def resolve(action, context):
        del context
        return authority.issue(
            grant_id="grant-1",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1
        return {"review_id": 42}

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
        acknowledgement=lambda output: EffectAcknowledgement(
            source="github-review-api", effect_id=str(output["review_id"]), version="v1"
        ),
    )
    sdk_context = tool_context(context, arguments())
    guardrail = run_guardrail(protected, sdk_context)
    output = asyncio.run(protected.on_invoke_tool(sdk_context, arguments()))

    assert guardrail.behavior["type"] == "allow"
    assert output == {"review_id": 42}
    assert sink_count == 1
    assert [receipt.state for receipt in context.receipts] == [
        BoundaryState.RESERVED,
        BoundaryState.DISPATCHED,
        BoundaryState.SETTLED,
    ]
    assert all(authority.verify_receipt(receipt) for receipt in context.receipts)


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        ("exception", "sink_exception"),
        ("missing_ack", "missing_application_acknowledgement"),
    ],
)
def test_post_dispatch_outcomes_never_become_released(failure: str, reason: str):
    runtime, authority = setup_boundary()

    def resolve(action, context):
        del context
        return authority.issue(
            grant_id=f"grant-{failure}",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        del context, raw_arguments
        if failure == "exception":
            raise TimeoutError("unknown remote outcome")
        return {"review_id": 42}

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
    )
    sdk_context = tool_context(context, arguments())
    run_guardrail(protected, sdk_context)

    if failure == "exception":
        with pytest.raises(TimeoutError, match="unknown remote outcome"):
            asyncio.run(protected.on_invoke_tool(sdk_context, arguments()))
    else:
        asyncio.run(protected.on_invoke_tool(sdk_context, arguments()))

    assert context.receipts[-1].state is BoundaryState.UNCERTAIN
    assert context.receipts[-1].reason == reason
    assert all(receipt.state is not BoundaryState.RELEASED for receipt in context.receipts)


def test_acknowledgement_extractor_failure_is_uncertain_without_retrying_sink():
    runtime, authority = setup_boundary()
    sink_count = 0

    def resolve(action, context):
        del context
        return authority.issue(
            grant_id="grant-ack-error",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1
        return {"review_id": 42}

    def broken_ack(output):
        del output
        raise KeyError("changed response shape")

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
        acknowledgement=broken_ack,
    )
    sdk_context = tool_context(context, arguments())
    run_guardrail(protected, sdk_context)
    output = asyncio.run(protected.on_invoke_tool(sdk_context, arguments()))

    assert output == {"review_id": 42}
    assert sink_count == 1
    assert context.receipts[-1].state is BoundaryState.UNCERTAIN
    assert context.receipts[-1].reason == "acknowledgement_extraction_error"


def test_invalid_application_acknowledgement_is_uncertain():
    runtime, authority = setup_boundary()

    def resolve(action, context):
        del context
        return authority.issue(
            grant_id="grant-invalid-ack",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        del context, raw_arguments
        return {"review_id": 42}

    def invalid_ack(output):
        return cast(EffectAcknowledgement, {"review_id": output["review_id"]})

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
        acknowledgement=invalid_ack,
    )
    sdk_context = tool_context(context, arguments())
    run_guardrail(protected, sdk_context)
    output = asyncio.run(protected.on_invoke_tool(sdk_context, arguments()))

    assert output == {"review_id": 42}
    assert context.receipts[-1].state is BoundaryState.UNCERTAIN
    assert context.receipts[-1].reason == "invalid_application_acknowledgement"


def test_direct_invocation_without_guardrail_is_blocked_before_sink():
    runtime, _ = setup_boundary()
    sink_count = 0

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=lambda action, tool: None,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
    )
    with pytest.raises(RuntimeError, match="admission was bypassed"):
        asyncio.run(protected.on_invoke_tool(tool_context(context, arguments()), arguments()))
    assert sink_count == 0


def test_changed_arguments_after_admission_are_released_before_sink():
    runtime, authority = setup_boundary()
    sink_count = 0

    def resolve(action, context):
        del context
        return authority.issue(
            grant_id="grant-toctou",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
    )
    sdk_context = tool_context(context, arguments("approved body"))
    assert run_guardrail(protected, sdk_context).behavior["type"] == "allow"

    with pytest.raises(RuntimeError, match="arguments changed"):
        asyncio.run(protected.on_invoke_tool(sdk_context, arguments("changed body")))

    assert sink_count == 0
    assert [receipt.state for receipt in context.receipts] == [
        BoundaryState.RESERVED,
        BoundaryState.RELEASED,
    ]
    assert context.receipts[-1].reason == "arguments_changed_after_admission"


@pytest.mark.parametrize(
    "needs_approval",
    [
        True,
        lambda context, parameters, call_id: True,
    ],
    ids=["always", "callable"],
)
def test_approval_required_tools_are_rejected(needs_approval):
    runtime, _ = setup_boundary()

    async def sink(context, raw_arguments):
        del context, raw_arguments
        raise AssertionError("unsupported approval tool reached sink")

    tool = function_tool(sink)
    tool.needs_approval = needs_approval

    with pytest.raises(ValueError, match="approval-required function tools are unsupported"):
        protect_function_tool(
            tool,
            runtime=runtime,
            tool_version="1",
            effect_class="github.review",
        )


def test_duplicate_guard_reuses_one_reserved_admission():
    runtime, authority = setup_boundary()
    resolver_calls = 0
    sink_count = 0

    def resolve(action, context):
        nonlocal resolver_calls
        del context
        resolver_calls += 1
        return authority.issue(
            grant_id="grant-duplicate-guard",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        nonlocal sink_count
        del context, raw_arguments
        sink_count += 1
        return {"review_id": 84}

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    tool = function_tool(sink)
    protected = protect_function_tool(
        tool,
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
        acknowledgement=lambda output: EffectAcknowledgement(
            source="github-review-api", effect_id=str(output["review_id"]), version="v1"
        ),
    )
    sdk_context = tool_context(context, arguments())

    async def exercise_duplicate_guard():
        guardrail = protected.tool_input_guardrails[-1]
        data = ToolInputGuardrailData(context=sdk_context, agent=Agent(name="reviewer"))
        first = await guardrail.run(data)
        second = await guardrail.run(data)
        output = await protected.on_invoke_tool(sdk_context, arguments())
        return first, second, output

    first, second, output = asyncio.run(exercise_duplicate_guard())

    assert first.behavior["type"] == second.behavior["type"] == "allow"
    assert first.output_info["receipt_id"] == second.output_info["receipt_id"]
    assert resolver_calls == 1
    assert sink_count == 1
    assert output == {"review_id": 84}
    assert [receipt.state for receipt in context.receipts] == [
        BoundaryState.RESERVED,
        BoundaryState.DISPATCHED,
        BoundaryState.SETTLED,
    ]


def test_changed_second_guard_releases_old_admission_and_denies_new_action():
    runtime, authority = setup_boundary()

    def resolve(action, context):
        del context
        return authority.issue(
            grant_id="grant-guard-change",
            principal="reviewer",
            tenant="smigolsmigol",
            workload="pr-review",
            action=action,
            policy_sha256=POLICY,
            expires_at=NOW + timedelta(minutes=5),
            budget_scope="review-budget",
        )

    async def sink(context, raw_arguments):
        del context, raw_arguments
        raise AssertionError("changed action reached sink")

    context = OpenAIBoundaryContext(
        principal="reviewer",
        tenant="smigolsmigol",
        workload="pr-review",
        budget_scope="review-budget",
        grant_resolver=resolve,
    )
    protected = protect_function_tool(
        function_tool(sink),
        runtime=runtime,
        tool_version="1",
        effect_class="github.review",
    )
    first_context = tool_context(context, arguments("approved body"))
    changed_context = tool_context(context, arguments("changed body"))

    async def exercise_changed_guard():
        guardrail = protected.tool_input_guardrails[-1]
        agent = Agent(name="reviewer")
        first = await guardrail.run(ToolInputGuardrailData(context=first_context, agent=agent))
        changed = await guardrail.run(ToolInputGuardrailData(context=changed_context, agent=agent))
        return first, changed

    first, changed = asyncio.run(exercise_changed_guard())

    assert first.behavior["type"] == "allow"
    assert changed.behavior["type"] == "raise_exception"
    assert changed.output_info["reason"] == "action_changed_after_admission"
    assert [receipt.state for receipt in context.receipts] == [
        BoundaryState.RESERVED,
        BoundaryState.RELEASED,
        BoundaryState.DENIED,
    ]
    assert context.receipts[1].reason == "arguments_changed_after_admission"
    assert all(authority.verify_receipt(receipt) for receipt in context.receipts)


def test_openai_adapter_reports_every_uncontrolled_surface():
    report = openai_agents_coverage()
    assert report.status_for("enrolled_function_tool") is CoverageStatus.ENFORCED
    for surface in (
        "unenrolled_function_tool",
        "model_dispatch",
        "hosted_tool",
        "hosted_mcp",
        "local_mcp",
        "computer_tool",
        "shell_tool",
        "apply_patch_tool",
        "approval_required_function_tool",
        "handoff",
        "agent_as_tool",
        "direct_client",
        "realtime",
        "background_retry",
    ):
        assert report.status_for(surface) is CoverageStatus.UNCOVERED
    assert report.as_dict()["inventory_kind"] == "declared"
