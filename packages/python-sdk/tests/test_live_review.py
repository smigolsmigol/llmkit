"""Pilot proof through native tool guardrails and bounded HTTP transports."""

import asyncio
import importlib
import json
import runpy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from agents import Agent, ToolInputGuardrailData, ToolInputGuardrailTripwireTriggered
from agents.tool_context import ToolContext

from llmkit.boundary import EffectAction
from llmkit.boundary_policy import BoundaryPolicy
from llmkit.integrations.openai_agents import GatewayBoundaryProvider, release_pending_admissions

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
sys.path.insert(0, str(EXAMPLES))
try:
    pilot_module = importlib.import_module("openai_agents_live_review")
    github_module = importlib.import_module("live_review_github")
    fixture = importlib.import_module("boundary_review_fixture")
finally:
    sys.path.pop(0)

REPO, HEAD, BASE, BODY = "example/repo", "a" * 40, "b" * 40, "Please test the empty-input case."


def arguments(**changes):
    return json.dumps({"repository": REPO, "pull_number": 7, "head": HEAD, "body": BODY, **changes})


class GitHubFixture:
    def __init__(self):
        self.requests = []
        self.head = HEAD
        self.base = BASE
        self.state = "open"
        self.private = False
        self.diff = b"diff --git a/a.py b/a.py\n+value = 1\n"
        self.review = None
        self.fail_post = False
        self.tamper = {}
        self.review_id = 42

    def __call__(self, request):
        self.requests.append(request)
        assert request.url.host == "api.github.com"
        if request.url.path == "/user":
            return httpx.Response(200, json={"login": "reviewer"})
        if request.url.path.endswith("/pulls/7"):
            return httpx.Response(
                200,
                json={
                    "number": 7,
                    "state": self.state,
                    "base": {
                        "sha": self.base,
                        "repo": {"full_name": REPO, "private": self.private},
                    },
                    "head": {"sha": self.head, "repo": {"private": False}},
                },
            )
        if "/compare/" in request.url.path:
            return httpx.Response(200, content=self.diff)
        if request.method == "POST":
            payload = json.loads(request.content)
            assert payload == {"commit_id": HEAD, "body": BODY, "event": "COMMENT"}
            self.review = {
                "id": self.review_id,
                "commit_id": HEAD,
                "body": BODY,
                "state": "COMMENTED",
                "user": {"login": "reviewer"},
                "pull_request_url": f"https://api.github.com/repos/{REPO}/pulls/7",
            }
            if self.fail_post:
                raise httpx.ReadTimeout("post outcome unknown")
            return httpx.Response(200, json=self.review)
        assert request.url.path.endswith("/reviews/42")
        return httpx.Response(200, json={**self.review, **self.tamper})


@pytest.fixture
def harness(tmp_path):
    remote = GitHubFixture()
    client = httpx.AsyncClient(transport=httpx.MockTransport(remote))
    github = github_module.GitHubReview(client, REPO, 7, HEAD)
    subject = asyncio.run(github.freeze())
    pilot = pilot_module.ReviewPilot(
        github, subject, "reviewer", fixture.BUDGET_ID, fixture.MODEL, tmp_path, allow_comment=True
    )
    return remote, github, pilot


@pytest.fixture
def policy_harness(harness):
    remote, github, original = harness
    policy = BoundaryPolicy.load(EXAMPLES / "pr_review_policy.json")
    pilot = pilot_module.ReviewPilot(
        github,
        original.subject,
        original.actor,
        fixture.BUDGET_ID,
        fixture.MODEL,
        original.output,
        allow_comment=True,
        policy=policy,
    )
    return remote, github, pilot


async def call_tool(pilot, raw, call_id="review-1", invoke=True):
    tool = pilot.tool()
    context = ToolContext(
        context=pilot.context, tool_name=tool.name, tool_call_id=call_id, tool_arguments=raw
    )
    result = await tool.tool_input_guardrails[-1].run(
        ToolInputGuardrailData(context=context, agent=Agent(name="reviewer"))
    )
    if invoke and pilot.context.receipts[-1].state.value == "reserved":
        return await tool.on_invoke_tool(context, raw)
    return result


def approve(monkeypatch):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(pilot_module, "confirm_review", AsyncMock(return_value=True))


def test_freeze_uses_immutable_compare_and_rechecks(harness):
    remote, _, pilot = harness
    assert [r.method for r in remote.requests] == ["GET"] * 3
    assert remote.requests[1].url.path == f"/repos/{REPO}/compare/{BASE}...{HEAD}"
    assert pilot.subject.identity()["diff_sha256"]
    assert "diff" not in pilot.subject.identity()


@pytest.mark.parametrize(
    "field,value", [("head", "c" * 40), ("base", "c" * 40), ("state", "closed"), ("private", True)]
)
def test_changed_pr_denies_before_post(harness, monkeypatch, field, value):
    remote, github, pilot = harness
    approve(monkeypatch)
    setattr(remote, field, value)
    asyncio.run(call_tool(pilot, arguments()))
    assert pilot.context.receipts[-1].state.value == "denied"
    assert github.post_attempts == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"repository": "other/repo"},
        {"head": "c" * 40},
        {"pull_number": 8},
        {"pull_number": True},
        {"body": " "},
        {"body": "x" * 8001},
        {"body": 1},
        {"event": "APPROVE"},
    ],
)
def test_wrong_effect_denied_before_sink(harness, monkeypatch, changes):
    _, github, pilot = harness
    approve(monkeypatch)
    asyncio.run(call_tool(pilot, arguments(**changes)))
    assert pilot.context.receipts[-1].state.value == "denied"
    assert github.post_attempts == 0


@pytest.mark.parametrize("mode", ["default", "noninteractive", "declined"])
def test_missing_approval_has_zero_writes(harness, monkeypatch, mode):
    _, github, pilot = harness
    approve(monkeypatch)
    if mode == "default":
        pilot.allow_comment = False
    elif mode == "noninteractive":
        monkeypatch.setattr(sys.stdin, "isatty", lambda: False)
    else:
        monkeypatch.setattr(pilot_module, "confirm_review", AsyncMock(return_value=False))
    asyncio.run(call_tool(pilot, arguments()))
    assert pilot.context.receipts[-1].state.value == "denied"
    assert github.post_attempts == 0


def test_exact_approval_posts_once_and_requires_readback(harness, monkeypatch):
    remote, github, pilot = harness
    approve(monkeypatch)
    result = asyncio.run(call_tool(pilot, arguments()))
    assert result["review_id"] == 42
    assert github.post_attempts == github.acknowledged == 1
    assert [r.state.value for r in pilot.context.receipts] == ["reserved", "dispatched", "settled"]
    assert remote.requests[-1].url.path.endswith("/reviews/42")
    assert (pilot.output / "post-attempt.json").exists()
    asyncio.run(call_tool(pilot, arguments(), call_id="review-2"))
    assert pilot.context.receipts[-1].state.value == "denied"
    assert github.post_attempts == 1


@pytest.mark.parametrize(
    "tamper",
    [
        {"body": "different"},
        {"commit_id": "c" * 40},
        {"state": "APPROVED"},
        {"user": {"login": "other"}},
    ],
)
def test_readback_mismatch_is_uncertain(harness, monkeypatch, tamper):
    remote, github, pilot = harness
    approve(monkeypatch)
    remote.tamper = tamper
    with pytest.raises(github_module.PilotError):
        asyncio.run(call_tool(pilot, arguments()))
    assert github.post_attempts == 1 and github.acknowledged == 0
    assert pilot.context.receipts[-1].state.value == "uncertain"


def test_ambiguous_post_is_not_retried(harness, monkeypatch):
    remote, github, pilot = harness
    approve(monkeypatch)
    remote.fail_post = True
    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(call_tool(pilot, arguments()))
    assert pilot.context.receipts[-1].state.value == "uncertain"
    assert json.loads((pilot.output / "post-attempt.json").read_text())["state"] == "uncertain"
    with pytest.raises(github_module.PilotError, match="already_attempted"):
        asyncio.run(github.post(pilot.subject, BODY, "reviewer", pilot.output))
    assert github.post_attempts == 1


def test_head_change_after_approval_still_has_zero_posts(harness, monkeypatch):
    remote, github, pilot = harness
    approve(monkeypatch)
    asyncio.run(call_tool(pilot, arguments(), invoke=False))
    remote.head = "c" * 40
    tool = pilot.tool()
    context = ToolContext(
        context=pilot.context,
        tool_name=tool.name,
        tool_call_id="review-1",
        tool_arguments=arguments(),
    )
    with pytest.raises(github_module.PilotError):
        asyncio.run(tool.on_invoke_tool(context, arguments()))
    assert github.post_attempts == 0
    assert pilot.context.receipts[-1].state.value == "uncertain"


def test_concurrent_approval_offers_only_one_prompt(harness, monkeypatch):
    _, github, pilot = harness
    approve(monkeypatch)

    async def both():
        await asyncio.gather(
            call_tool(pilot, arguments(), "one"), call_tool(pilot, arguments(), "two")
        )

    asyncio.run(both())
    assert github.post_attempts == 1
    assert sum(r.state.value == "denied" for r in pilot.context.receipts) == 1


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(302, headers={"location": "https://other.invalid"}),
        httpx.Response(500),
        httpx.Response(200, json=[]),
        httpx.Response(200, content=b"x" * 256001),
    ],
)
def test_github_response_failures_are_bounded(response):
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response))
    github = github_module.GitHubReview(client, REPO, 7, HEAD)
    with pytest.raises(github_module.PilotError):
        asyncio.run(github.request("GET", github.path))


def test_oversized_diff_fails_without_model_or_post(harness):
    remote, github, _ = harness
    remote.diff = b"x" * 100001
    with pytest.raises(github_module.PilotError, match="too_large"):
        asyncio.run(github.freeze())
    assert github.post_attempts == 0


@pytest.mark.parametrize("tool_count", [1, 2])
def test_native_runner_joins_real_pilot_tool_and_gateway_contract(
    policy_harness, monkeypatch, tool_count
):
    _, github, pilot = policy_harness
    approve(monkeypatch)
    first = fixture.tool_completion(call_id="native-review", body=BODY)
    first["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = arguments()
    if tool_count == 2:
        extra = fixture.tool_completion(call_id="extra-review", body=BODY)
        extra["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = arguments()
        first["choices"][0]["message"]["tool_calls"].extend(
            extra["choices"][0]["message"]["tool_calls"]
        )
    gateway = fixture.FakeGateway([first, fixture.completion("Done.")])

    async def run():
        async with GatewayBoundaryProvider(
            context=pilot.context,
            runtime=pilot.runtime,
            provider="openai",
            api_key="llmk_local_demo",
            base_url="https://gateway.invalid/v1",
            agent_id="pr-review-pilot",
            session_id="test-session",
            request_transport=httpx.MockTransport(gateway.model_request),
            receipt_transport=httpx.MockTransport(gateway.receipt_request),
        ) as provider:
            try:
                await pilot_module.run_agent(pilot, provider)
            finally:
                await release_pending_admissions(pilot.context)

    if tool_count == 2:
        with pytest.raises(ToolInputGuardrailTripwireTriggered):
            asyncio.run(run())
    else:
        asyncio.run(run())
    assert len(gateway.requests) == (2 if tool_count == 1 else 1)
    for request in gateway.requests:
        payload = json.loads(request.content)
        assert "parallel_tool_calls" not in payload
        assert payload["max_tokens"] == 1024
    assert github.post_attempts == github.acknowledged == (1 if tool_count == 1 else 0)
    pilot_module.confirm_review.assert_awaited_once()
    report = pilot.report(1, None)
    assert report["receipts_verified_in_process"]
    assert report["boundary_check"]["ok"]
    assert {receipt["policy_sha256"] for receipt in report["receipts"]} == {
        report["boundary_check"]["policy_sha256"]
    }
    states = [r["state"] for r in report["receipts"]]
    if tool_count == 1:
        assert states == ["reserved", "dispatched", "settled"] * 3
    else:
        assert states == ["reserved", "dispatched", "settled", "reserved", "denied", "released"]
    assert BODY not in json.dumps(report) and "untrusted_diff" not in json.dumps(report)


def test_policy_does_not_replace_exact_human_approval(policy_harness, monkeypatch):
    _, github, pilot = policy_harness
    approve(monkeypatch)
    pilot.allow_comment = False
    asyncio.run(call_tool(pilot, arguments()))
    assert pilot.context.receipts[-1].reason == "missing_grant"
    assert github.post_attempts == 0


def test_changed_policy_tool_binding_denies_before_post(harness, monkeypatch):
    _, github, original = harness
    payload = json.loads((EXAMPLES / "pr_review_policy.json").read_text())
    payload["routes"][1]["version"] = "2"
    policy = BoundaryPolicy.parse(json.dumps(payload))
    assert policy.check()["ok"]
    pilot = pilot_module.ReviewPilot(
        github,
        original.subject,
        original.actor,
        fixture.BUDGET_ID,
        fixture.MODEL,
        original.output,
        allow_comment=True,
        policy=policy,
    )
    approve(monkeypatch)
    asyncio.run(call_tool(pilot, arguments()))
    assert pilot.context.receipts[-1].reason == "action_outside_policy"
    assert github.post_attempts == 0


def test_pilot_rejects_another_framework_policy(harness):
    _, github, original = harness
    payload = json.loads((EXAMPLES / "pr_review_policy.json").read_text())
    payload["adapter"] = "pydantic-ai"
    with pytest.raises(github_module.PilotError, match="boundary_policy_adapter_mismatch"):
        pilot_module.ReviewPilot(
            github,
            original.subject,
            original.actor,
            fixture.BUDGET_ID,
            fixture.MODEL,
            original.output,
            policy=BoundaryPolicy.parse(json.dumps(payload)),
        )


@pytest.mark.parametrize("mode", ["unenrolled", "adapter"])
def test_policy_failure_stops_before_github_reads(tmp_path, monkeypatch, mode):
    payload = json.loads((EXAMPLES / "pr_review_policy.json").read_text())
    if mode == "unenrolled":
        payload["routes"][1]["enrolled"] = False
    else:
        payload["adapter"] = "pydantic-ai"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(json.dumps(payload))
    freeze = AsyncMock(side_effect=AssertionError("GitHub must not be contacted"))
    monkeypatch.setattr(github_module.GitHubReview, "freeze", freeze)
    with pytest.raises(github_module.PilotError, match="boundary_policy_check_failed"):
        asyncio.run(
            pilot_module.main(
                ["--repo", REPO, "--pr", "7", "--head", HEAD, "--policy", str(policy_file)]
            )
        )
    freeze.assert_not_awaited()


@pytest.mark.parametrize("run_model", [False, True])
@pytest.mark.parametrize("mismatch", ["model", "provider", "missing", "tool-only"])
def test_model_policy_mismatch_stops_before_credentials_or_io(
    tmp_path, monkeypatch, run_model, mismatch
):
    payload = json.loads((EXAMPLES / "pr_review_policy.json").read_text())
    model = fixture.MODEL
    if mismatch == "model":
        model = "another-model"
    elif mismatch == "provider":
        payload["routes"][0]["target"] = f"llmkit-gateway:anthropic:{model}"
    elif mismatch == "missing":
        del payload["routes"][0]
    else:
        payload["routes"][0]["surface"] = "enrolled_function_tool"
        payload["routes"][0]["effect_class"] = "example.tool"
    assert BoundaryPolicy.parse(json.dumps(payload)).check()["ok"]
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(json.dumps(payload))
    output = tmp_path / "run"
    argv = [
        "--repo",
        REPO,
        "--pr",
        "7",
        "--head",
        HEAD,
        "--policy",
        str(policy_file),
        "--model",
        model,
    ]
    if run_model:
        argv += [
            "--run-model",
            "--gateway",
            "https://gateway.invalid/v1",
            "--budget-id",
            fixture.BUDGET_ID,
            "--output",
            str(output),
        ]
    monkeypatch.delenv("LLMKIT_API_KEY", raising=False)
    monkeypatch.setattr(
        pilot_module.httpx, "AsyncClient", lambda **kw: pytest.fail("HTTP client created")
    )
    with pytest.raises(github_module.PilotError, match="boundary_policy_model_mismatch"):
        asyncio.run(pilot_module.main(argv))
    assert not output.exists()


def test_model_grants_bound_model_and_request_count(harness):
    _, _, pilot = harness

    def action(model, call):
        return EffectAction.from_arguments(
            effect_class="model.dispatch",
            target=f"llmkit-gateway:openai:{model}",
            version="1",
            call_id=call,
            arguments={},
        )

    assert pilot.resolve_model(action("other", "wrong")) is None
    assert pilot.resolve_model(action(pilot.model, "one"))
    assert pilot.resolve_model(action(pilot.model, "two"))
    assert pilot.resolve_model(action(pilot.model, "three")) is None


def test_existing_post_record_is_preserved(harness, monkeypatch):
    _, github, pilot = harness
    approve(monkeypatch)
    record = pilot.output / "post-attempt.json"
    record.write_text("previous attempt")
    with pytest.raises(FileExistsError):
        asyncio.run(call_tool(pilot, arguments()))
    assert github.post_attempts == 0 and record.read_text() == "previous attempt"


@pytest.mark.parametrize("extra", [["--allow-comment"], ["--run-model"]])
def test_live_flags_require_explicit_configuration(extra):
    with pytest.raises(SystemExit):
        pilot_module.parse_args(["--repo", REPO, "--pr", "7", "--head", HEAD, *extra])


@pytest.mark.parametrize("policy_mode", ["legacy", "policy-only", "model-matched"])
def test_default_cli_only_reads_public_pr(monkeypatch, capsys, policy_mode):
    remote = GitHubFixture()
    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        pilot_module.httpx,
        "AsyncClient",
        lambda **kw: client_type(transport=httpx.MockTransport(remote), **kw),
    )
    monkeypatch.delenv("GH_TOKEN", raising=False)
    argv = ["--repo", REPO, "--pr", "7", "--head", HEAD]
    if policy_mode != "legacy":
        argv += ["--policy", str(EXAMPLES / "pr_review_policy.json")]
    if policy_mode == "model-matched":
        argv += ["--model", fixture.MODEL]
    result = asyncio.run(pilot_module.main(argv))
    report = json.loads(capsys.readouterr().out)
    assert result == 0 and report["mode"] == "dry-run"
    assert report["model_requests"] == report["github_post_attempts"] == 0
    assert all(request.method == "GET" for request in remote.requests)


@pytest.mark.parametrize("post", [False, True])
@pytest.mark.parametrize("policy_mode", ["legacy", "enrolled", "multiple-models", "model-mismatch"])
def test_live_cli_runs_native_consumer_and_writes_content_minimal_report(
    tmp_path, monkeypatch, capsys, post, policy_mode
):
    remote = GitHubFixture()
    client_type, provider_type = httpx.AsyncClient, GatewayBoundaryProvider
    first = fixture.tool_completion(call_id="native-cli-review", body=BODY)
    first["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = arguments()
    gateway = fixture.FakeGateway([first, fixture.completion("Done.")])
    monkeypatch.setattr(
        pilot_module,
        "httpx",
        SimpleNamespace(
            AsyncClient=lambda **kw: client_type(**{"transport": httpx.MockTransport(remote), **kw})
        ),
    )
    monkeypatch.setattr(
        pilot_module,
        "GatewayBoundaryProvider",
        lambda **kw: provider_type(
            **kw,
            request_transport=httpx.MockTransport(gateway.model_request),
            receipt_transport=httpx.MockTransport(gateway.receipt_request),
        ),
    )
    monkeypatch.setenv("LLMKIT_API_KEY", "llmk_local_demo")
    monkeypatch.setenv("GH_TOKEN", "test-only-token")
    approve(monkeypatch)
    output = tmp_path / "run"
    argv = [
        "--repo",
        REPO,
        "--pr",
        "7",
        "--head",
        HEAD,
        "--run-model",
        "--gateway",
        "https://gateway.invalid/v1",
        "--budget-id",
        fixture.BUDGET_ID,
        "--model",
        fixture.MODEL,
        "--output",
        str(output),
    ]
    if post:
        argv += ["--allow-comment", "--actor", "reviewer"]
    if policy_mode != "legacy":
        policy_file = EXAMPLES / "pr_review_policy.json"
        if policy_mode in ("multiple-models", "model-mismatch"):
            payload = json.loads(policy_file.read_text())
            if policy_mode == "multiple-models":
                payload["routes"][0]["id"] = "selected_model"
                payload["routes"].insert(
                    0,
                    {
                        **payload["routes"][0],
                        "id": "other_model",
                        "target": "llmkit-gateway:openai:another-model",
                    },
                )
            else:
                payload["routes"][0]["target"] = "llmkit-gateway:openai:another-model"
            policy_file = tmp_path / "policy.json"
            policy_file.write_text(json.dumps(payload))
        argv += ["--policy", str(policy_file)]
    if policy_mode == "model-mismatch":
        with pytest.raises(github_module.PilotError, match="boundary_policy_model_mismatch"):
            asyncio.run(pilot_module.main(argv))
        assert not remote.requests
        assert not gateway.requests
        assert not output.exists()
        pilot_module.confirm_review.assert_not_awaited()
        return
    result = asyncio.run(pilot_module.main(argv))
    report = json.loads((output / "receipt.json").read_text())
    expected_post = int(post)
    assert report["github_post_attempts"] == report["github_acknowledged_reviews"] == expected_post
    assert result == int(not expected_post)
    assert report["receipts_verified_in_process"]
    if policy_mode != "legacy":
        assert report["boundary_check"]["ok"]
        assert {receipt["policy_sha256"] for receipt in report["receipts"]} == {
            report["boundary_check"]["policy_sha256"]
        }
    else:
        assert report["boundary_check"] is None
    assert "test-only-token" not in json.dumps(report)
    assert BODY not in json.dumps(report)
    with pytest.raises(FileExistsError):
        asyncio.run(pilot_module.main(argv))
    assert len(gateway.requests) == (2 if post else 1)
    capsys.readouterr()


def test_cli_missing_credentials_fails_before_network(monkeypatch):
    monkeypatch.delenv("LLMKIT_API_KEY", raising=False)
    with pytest.raises(github_module.PilotError, match="missing_llmkit"):
        asyncio.run(
            pilot_module.main(
                [
                    "--repo",
                    REPO,
                    "--pr",
                    "7",
                    "--head",
                    HEAD,
                    "--run-model",
                    "--gateway",
                    "https://gateway.invalid/v1",
                    "--budget-id",
                    fixture.BUDGET_ID,
                    "--model",
                    fixture.MODEL,
                    "--output",
                    "unused",
                ]
            )
        )


@pytest.mark.parametrize(
    "repository,number,head",
    [("../repo", 7, HEAD), ("a/..", 7, HEAD), (REPO, 0, HEAD), (REPO, 7, "short")],
)
def test_invalid_target_fails_before_network(repository, number, head):
    with pytest.raises(github_module.PilotError):
        github_module.GitHubReview(None, repository, number, head)


@pytest.mark.parametrize("review_id", [None, True, -1, "42"])
def test_invalid_review_id_cannot_acknowledge(harness, monkeypatch, review_id):
    remote, github, pilot = harness
    approve(monkeypatch)
    remote.review_id = review_id
    with pytest.raises(github_module.PilotError, match="invalid_review_id"):
        asyncio.run(call_tool(pilot, arguments()))
    assert github.post_attempts == 1 and github.acknowledged == 0
    assert pilot.context.receipts[-1].state.value == "uncertain"


def test_removed_exact_approval_cannot_reach_sink(harness, monkeypatch):
    _, github, pilot = harness
    approve(monkeypatch)
    asyncio.run(call_tool(pilot, arguments(), invoke=False))
    pilot.approved_action = None
    tool = pilot.tool()
    context = ToolContext(
        context=pilot.context,
        tool_name=tool.name,
        tool_call_id="review-1",
        tool_arguments=arguments(),
    )
    with pytest.raises(github_module.PilotError, match="not_approved"):
        asyncio.run(tool.on_invoke_tool(context, arguments()))
    assert github.post_attempts == 0


@pytest.mark.parametrize("failure", ["identity", "noninteractive", "cancel", "timeout"])
def test_cli_failure_and_cancellation_keep_honest_report(tmp_path, monkeypatch, failure):
    remote = GitHubFixture()
    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        pilot_module,
        "httpx",
        SimpleNamespace(
            AsyncClient=lambda **kw: client_type(transport=httpx.MockTransport(remote), **kw),
        ),
    )
    monkeypatch.setenv("LLMKIT_API_KEY", "llmk_local_demo")
    monkeypatch.setenv("GH_TOKEN", "test-only-token")
    approve(monkeypatch)
    output = tmp_path / "run"
    argv = [
        "--repo",
        REPO,
        "--pr",
        "7",
        "--head",
        HEAD,
        "--run-model",
        "--gateway",
        "https://gateway.invalid/v1",
        "--budget-id",
        fixture.BUDGET_ID,
        "--model",
        fixture.MODEL,
        "--output",
        str(output),
        "--allow-comment",
        "--actor",
        "reviewer",
    ]
    if failure == "identity":
        argv[-1] = "other"
    if failure == "noninteractive":
        monkeypatch.setattr(sys.stdin, "isatty", lambda: False)

    async def fail(*_):
        if failure == "cancel":
            raise asyncio.CancelledError
        raise TimeoutError

    monkeypatch.setattr(pilot_module, "run_agent", fail)
    if failure in {"identity", "noninteractive"}:
        with pytest.raises(github_module.PilotError):
            asyncio.run(pilot_module.main(argv))
        assert not output.exists()
    else:
        if failure == "cancel":
            with pytest.raises(asyncio.CancelledError):
                asyncio.run(pilot_module.main(argv))
        else:
            assert asyncio.run(pilot_module.main(argv)) == 1
        report = json.loads((output / "receipt.json").read_text())
        assert report["error"] == ("CancelledError" if failure == "cancel" else "TimeoutError")
        assert report["github_post_attempts"] == 0
        assert report["receipts_verified_in_process"] is False


def test_terminal_entry_point_rejects_invalid_target(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["pilot", "--repo", "../bad", "--pr", "7", "--head", HEAD])
    with pytest.raises(SystemExit) as stopped:
        runpy.run_path(str(EXAMPLES / "openai_agents_live_review.py"), run_name="__main__")
    assert stopped.value.code == 1
    assert json.loads(capsys.readouterr().err) == {"error": "PilotError"}


def test_approval_display_escapes_terminal_controls(harness, monkeypatch, capsys):
    _, github, pilot = harness
    approve(monkeypatch)
    asyncio.run(call_tool(pilot, arguments(body="Review\u001b[2Jhidden"), invoke=False))
    display = capsys.readouterr().out
    assert "\u001b" not in display and "\\u001b" in display
    assert github.post_attempts == 0
    asyncio.run(release_pending_admissions(pilot.context))
    assert pilot.context.receipts[-1].state.value == "released"


@pytest.mark.parametrize("path", [("base",), ("head",), ("base", "repo"), ("head", "repo")])
@pytest.mark.parametrize("value", [None, [], "unavailable", 1, ...])
def test_malformed_pr_shape_is_rejected_before_diff(path, value):
    remote = GitHubFixture()

    def malformed(request):
        data = remote(request).json()
        parent = data if len(path) == 1 else data[path[0]]
        if value is ...:
            del parent[path[-1]]
        else:
            parent[path[-1]] = value
        return httpx.Response(200, json=data)

    client = httpx.AsyncClient(transport=httpx.MockTransport(malformed))
    github = github_module.GitHubReview(client, REPO, 7, HEAD)
    with pytest.raises(github_module.PilotError, match="invalid_github_response"):
        asyncio.run(github.freeze())
    assert len(remote.requests) == 1
    assert remote.requests[0].method == "GET"
    assert github.post_attempts == 0


@pytest.mark.parametrize("value", [None, 42, [], "short"])
def test_invalid_base_sha_is_a_content_free_failure(harness, value):
    remote, github, _ = harness
    remote.base = value
    with pytest.raises(github_module.PilotError, match="identity_changed"):
        asyncio.run(github.freeze())
    assert github.post_attempts == 0


def test_terminal_entry_point_rejects_null_head_repo(monkeypatch, capsys):
    remote = GitHubFixture()
    client_type = httpx.AsyncClient

    def missing_repo(request):
        data = remote(request).json()
        data["head"]["repo"] = None
        return httpx.Response(200, json=data)

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: client_type(transport=httpx.MockTransport(missing_repo), **kw),
    )
    monkeypatch.setattr(sys, "argv", ["pilot", "--repo", REPO, "--pr", "7", "--head", HEAD])
    with pytest.raises(SystemExit) as stopped:
        runpy.run_path(str(EXAMPLES / "openai_agents_live_review.py"), run_name="__main__")
    assert stopped.value.code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err) == {"error": "PilotError"}
    assert len(remote.requests) == 1 and remote.requests[0].method == "GET"


@pytest.mark.parametrize("answer", ["exact", "yes", "wrong-hash", "eof"])
def test_prompt_process_requires_exact_answer(monkeypatch, answer):
    start_process = asyncio.create_subprocess_exec
    readers = []
    action_hash = "e" * 64

    async def with_pipe(*args, **kwargs):
        reader = await start_process(
            *args, **kwargs, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
        )
        readers.append(reader)
        if answer != "eof":
            text = f"post {action_hash}" if answer == "exact" else answer
            reader.stdin.write((text + "\n").encode())
            await reader.stdin.drain()
        reader.stdin.close()
        return reader

    monkeypatch.setattr(asyncio, "create_subprocess_exec", with_pipe)

    async def run():
        async with asyncio.timeout(10):
            result = await pilot_module.confirm_review(action_hash)
        prompt = (await readers[0].stdout.read()).decode()
        assert f"Type post {action_hash}" in prompt
        assert result is (answer == "exact")
        assert readers[0].returncode is not None

    asyncio.run(run())


@pytest.mark.parametrize("stop", ["timeout", "cancel"])
def test_unanswered_prompt_is_reaped_without_post(harness, monkeypatch, stop):
    _, github, pilot = harness
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    start_process = asyncio.create_subprocess_exec
    readers = []

    async def with_pipe(*args, **kwargs):
        reader = await start_process(
            *args, **kwargs, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
        )
        readers.append(reader)
        return reader

    monkeypatch.setattr(asyncio, "create_subprocess_exec", with_pipe)

    async def stop_at_prompt(task, deadline):
        while not readers:
            await asyncio.sleep(0)
        await readers[0].stdout.readuntil(b"anything else denies): ")
        if stop == "timeout":
            deadline.reschedule(asyncio.get_running_loop().time())
        else:
            task.cancel()

    async def run():
        async with asyncio.timeout(10) as deadline:
            stopper = asyncio.create_task(stop_at_prompt(asyncio.current_task(), deadline))
            try:
                await call_tool(pilot, arguments())
            finally:
                stopper.cancel()
                await asyncio.gather(stopper, return_exceptions=True)
                await release_pending_admissions(pilot.context)
                for reader in readers:
                    reader.stdin.close()
                    await reader.stdin.wait_closed()

    with pytest.raises(TimeoutError if stop == "timeout" else asyncio.CancelledError):
        asyncio.run(run())
    assert len(readers) == 1 and readers[0].returncode is not None
    assert pilot.approved_action is None
    assert github.post_attempts == 0
    assert not (pilot.output / "post-attempt.json").exists()
