"""Shared in-process gateway and review sink for the two native agent examples."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

import httpx
from llmkit.boundary import canonical_arguments, content_sha256

REPOSITORY = "smigolsmigol/llmkit"
HEAD = "a" * 40
BUDGET_ID = "11111111-1111-4111-8111-111111111111"
MODEL = "gpt-4.1-mini"
POLICY = content_sha256(
    {
        "name": "local-pr-review",
        "requires": ["exact-effect-grant", "trusted-reviewer-approval"],
        "version": 1,
    }
)


class FakeGateway:
    """Minimal terminal-receipt fixture; it does not prove hosted behavior."""

    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []
        self.receipts: dict[str, dict[str, Any]] = {}

    async def model_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.responses:
            raise RuntimeError("unexpected model request")
        payload = self.responses.pop(0)
        content = json.dumps(payload, separators=(",", ":")).encode()
        request_body = json.loads(request.content)
        receipt_id = str(uuid.uuid4())
        idempotency_key = request.headers["idempotency-key"]
        self.receipts[receipt_id] = {
            "id": receipt_id,
            "customer_id": request.headers["x-llmkit-customer-id"],
            "workflow_id": request.headers["x-llmkit-workflow-id"],
            "agent_id": request.headers["x-llmkit-agent-id"],
            "session_id": request.headers["x-llmkit-session-id"],
            "end_user_id": request.headers["x-llmkit-user-id"],
            "budget_id": BUDGET_ID,
            "budget_reservation_id": str(uuid.uuid4()),
            "idempotency_key_hash": hashlib.sha256(idempotency_key.encode()).hexdigest(),
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
        }
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "x-llmkit-request-id": receipt_id,
                "x-llmkit-settlement-status": "pending",
            },
            content=content,
        )

    async def receipt_request(self, request: httpx.Request) -> httpx.Response:
        receipt_id = request.url.path.rsplit("/", 1)[-1]
        receipt = self.receipts.get(receipt_id)
        if receipt is None:
            return httpx.Response(404, json={"error": "receipt not found"})
        return httpx.Response(200, json={"receipt": receipt})


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


def tool_completion(*, call_id: str, body: str) -> dict[str, Any]:
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
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": "post_review_comment",
                                "arguments": json.dumps(
                                    {
                                        "repository": REPOSITORY,
                                        "head": HEAD,
                                        "body": body,
                                    },
                                    separators=(",", ":"),
                                ),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
    }


class InMemoryReviewSink:
    def __init__(self) -> None:
        self.comments: list[dict[str, Any]] = []

    async def __call__(self, context: Any, raw_arguments: str) -> dict[str, Any]:
        del context
        payload = canonical_arguments(raw_arguments)
        review_id = len(self.comments) + 1
        self.comments.append(payload)
        return {"review_id": review_id, "head": payload["head"]}
