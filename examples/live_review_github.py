"""Bounded GitHub reads and one acknowledged COMMENT for the live review pilot."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx


class PilotError(RuntimeError):
    """A content-free failure safe to include in the pilot report."""


def write_record(path: Path, record: dict[str, Any]) -> None:
    with path.open("x", encoding="utf-8") as stream:
        json.dump(record, stream, sort_keys=True, indent=2)
        stream.flush()
        os.fsync(stream.fileno())


@dataclass(frozen=True)
class PullRequest:
    repository: str
    number: int
    head: str
    base: str
    diff_sha256: str
    diff: str

    def identity(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if key != "diff"}


class GitHubReview:
    def __init__(self, client: httpx.AsyncClient, repository: str, number: int, head: str):
        if not re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+", repository):
            raise PilotError("invalid_repository")
        if repository.split("/")[1] in {".", ".."} or type(number) is not int or number <= 0:
            raise PilotError("invalid_pull_request")
        if not re.fullmatch(r"[0-9a-f]{40}", head):
            raise PilotError("expected_head_must_be_full_sha")
        self.client = client
        self.repository = repository
        self.number = number
        self.head = head
        self.path = f"/repos/{repository}/pulls/{number}"
        self.post_attempts = 0
        self.acknowledged = 0
        self._post_started = False

    async def request(
        self, method: str, path: str, *, payload: dict[str, Any] | None = None, diff: bool = False
    ) -> Any:
        headers = {
            "Accept": "application/vnd.github.diff" if diff else "application/vnd.github+json"
        }
        async with asyncio.timeout(20):
            async with self.client.stream(
                method,
                f"https://api.github.com{path}",
                headers=headers,
                json=payload,
                follow_redirects=False,
            ) as response:
                if response.status_code not in {200, 201}:
                    raise PilotError(f"github_http_{response.status_code}")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > (100_000 if diff else 256_000):
                        raise PilotError("github_response_too_large")
        if diff:
            return bytes(content).decode("utf-8", errors="strict")
        value = json.loads(content)
        if not isinstance(value, dict):
            raise PilotError("invalid_github_response")
        return value

    async def check_head(self, base: str | None = None) -> dict[str, Any]:
        pr = await self.request("GET", self.path)
        base_ref, head_ref = pr.get("base"), pr.get("head")
        if not isinstance(base_ref, dict) or not isinstance(head_ref, dict):
            raise PilotError("invalid_github_response")
        base_repo, head_repo = base_ref.get("repo"), head_ref.get("repo")
        if not isinstance(base_repo, dict) or not isinstance(head_repo, dict):
            raise PilotError("invalid_github_response")
        base_sha = base_ref.get("sha")
        if (
            pr.get("number") != self.number
            or pr.get("state") != "open"
            or base_repo.get("full_name") != self.repository
            or base_repo.get("private") is not False
            or head_repo.get("private") is not False
            or head_ref.get("sha") != self.head
            or not isinstance(base_sha, str)
            or not re.fullmatch(r"[0-9a-f]{40}", base_sha)
            or (base is not None and base_sha != base)
        ):
            raise PilotError("pull_request_identity_changed_or_not_public_open")
        return pr

    async def freeze(self) -> PullRequest:
        pr = await self.check_head()
        base = pr["base"]["sha"]
        diff = await self.request(
            "GET", f"/repos/{self.repository}/compare/{base}...{self.head}", diff=True
        )
        await self.check_head(base)
        return PullRequest(
            self.repository,
            self.number,
            self.head,
            base,
            hashlib.sha256(diff.encode("utf-8")).hexdigest(),
            diff,
        )

    async def post(
        self, subject: PullRequest, body: str, actor: str, output: Path
    ) -> dict[str, Any]:
        if self._post_started:
            raise PilotError("review_already_attempted")
        self._post_started = True
        await self.check_head(subject.base)
        # A crash after this record is ambiguous. Never replay a POST from it.
        write_record(
            output / "post-attempt.json",
            {
                **subject.identity(),
                "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
                "state": "uncertain",
                "actor": actor,
            },
        )
        self.post_attempts += 1
        created = await self.request(
            "POST",
            f"{self.path}/reviews",
            payload={
                "commit_id": subject.head,
                "body": body,
                "event": "COMMENT",
            },
        )
        review_id = created.get("id")
        if type(review_id) is not int or review_id <= 0:
            raise PilotError("invalid_review_id")
        expected = {
            "id": review_id,
            "commit_id": subject.head,
            "body": body,
            "state": "COMMENTED",
            "pull_request_url": f"https://api.github.com{self.path}",
        }
        for review in (created, await self.request("GET", f"{self.path}/reviews/{review_id}")):
            if any(review.get(key) != value for key, value in expected.items()):
                raise PilotError("review_acknowledgement_mismatch")
            if review.get("user", {}).get("login") != actor:
                raise PilotError("review_actor_mismatch")
        self.acknowledged += 1
        return {
            "review_id": review_id,
            "url": f"https://github.com/{self.repository}/pull/{self.number}#pullrequestreview-{review_id}",
        }
