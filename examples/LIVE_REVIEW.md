# Opt-in PR review pilot

Read one public GitHub PR at an explicit head, then optionally run the OpenAI Agents reviewer
through an existing LLMKit gateway. Dry-run is the default: no model request and no GitHub write.
The runner never checks out, imports, builds, or executes code from the reviewed PR.

This is a pilot, not a hosted service or an autonomous reviewer. Use SDK 0.1.12 or newer for the
shared-policy option below; see the [release-candidate install](../packages/python-sdk/README.md#boundary-check-experimental).
It does not provision a gateway, key, or budget.

## Start with the read-only check

Use a Python 3.11+ environment and this repository checkout. From the repository root:

```console
python -m pip install -e "./packages/python-sdk[openai-agents]"
python examples/openai_agents_live_review.py --help
```

Choose a public, open PR you own or have permission to review. Read its current full head SHA in
GitHub, then supply that exact value. Replace the example repository, number, and SHA below:

```console
python examples/openai_agents_live_review.py --repo your-org/your-repo --pr 123 --head FULL_40_CHARACTER_SHA
```

Success reports `mode: dry-run`, the repository, PR, base/head, diff hash, zero model requests, and
zero POST attempts. Closed/private PRs, a moved base or head, redirects, and diffs over 100 KB stop
the run. Optional `GH_TOKEN` authenticates the GitHub reads; it is sent only to api.github.com.

## Check the same policy before running

The Boundary Check command needs no credentials or network access:

```console
python -m llmkit.boundary_check examples/pr_review_policy.json
```

It checks the declared routes, not application code or live enrollment. Exit 0 means the declared
configuration passes, 1 identifies a route finding, and 2 rejects an unreadable or malformed policy.
For the first failure, set `post_review_comment.enrolled` to `false` in the JSON routes array,
rerun to see `unenrolled_route`, then restore it. See the [SDK policy contract](../packages/python-sdk/README.md#boundary-check-experimental)
for the runtime binding and limitations.

Add `--policy examples/pr_review_policy.json` to the pilot command to use the checked policy.
It is checked before GitHub reads, and the model and tool boundaries use its hash and permitted
effects. The example model target is `llmkit-gateway:openai:gpt-4.1-mini`; set `--model` to match
the reviewed policy, or edit and recheck the policy for your gateway-supported model. When supplied,
`--model` must match an enrolled model route, even in a dry-run; a mismatch stops before credential
checks, GitHub reads, or output creation. A dry-run without `--model` leaves this comparison unchecked.
A policy does not configure a gateway budget or grant permission to post. Omitting `--policy` retains
the pilot's original fixed policy. The published 0.1.11 wheel does not support this option.

## Run the model without posting

Before opting in, provision a supported HTTPS gateway with a key linked to a **hard budget** and
confirm its limit and identity with the gateway operator. Set `LLMKIT_API_KEY` through your normal
secret manager. If the gateway does not already own a provider key, also set `OPENAI_API_KEY`.
Never put either key in the command, PR, report, or repository.

Add `--run-model --gateway YOUR_HTTPS_V1_ENDPOINT --budget-id YOUR_BUDGET_ID --model YOUR_MODEL
--output NEW_LOCAL_DIRECTORY` to the read-only command. This sends the public diff to your selected
gateway and provider and can incur charges. There is no default model, endpoint, or budget.

The runner grants at most two non-streaming requests, each with a 1,024-token output bound, and
uses the existing terminal gateway receipt verification. These bounds are not a dollar cap. The
configured gateway hard budget owns cost admission; supplying a budget ID does not configure or
prove that key's budget before the first request. No claim covers a misconfigured gateway.

Without `--allow-comment`, a proposed tool action is denied before any GitHub POST. That deliberate
denial returns a nonzero exit status and a receipt; it is a useful negative pilot result.

## Approve one exact comment

Posting additionally requires `--allow-comment --actor YOUR_GITHUB_LOGIN`, `GH_TOKEN` for that
actor with Pull requests write permission on the one target repository, and an interactive terminal.
Use a narrowly scoped token. The script offers at most one approval prompt per run.
The agent run's 120-second timeout includes this approval wait. Timeout or cancellation stops the
prompt reader without approving or posting the pending comment.

The terminal displays JSON-escaped repository, PR, head, actor, and exact comment text. Inspect the
text for correctness and private content. Type the displayed `post` plus full action hash only if
you approve those exact bytes. A generic `yes`, EOF, or non-interactive input cannot approve it.

The sink rechecks both PR revisions and sends only a `COMMENT` review with explicit `commit_id`.
It cannot approve, request changes, merge, push, or modify a branch. It verifies GitHub's response
and reads the review back before acknowledging the effect. GitHub does not provide an atomic
"head still current" condition on this endpoint; a later push may make the explicitly bound review
outdated. See [GitHub's review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request).

## Evidence and recovery

The output directory must not already exist. It contains a start record, a pre-POST attempt marker
when applicable, and a final receipt report with elapsed run time and request/effect counts. It does
not store the diff, comment body, provider response, or credentials. Approval text is visible in the
terminal and may enter terminal logs. Gateway/provider retention follows their own configuration.

The HMAC authority is ephemeral and verifies receipts inside the run only. Saved local receipts
cannot be independently signature-verified after exit. They are not third-party attestations or a
durable authority service. PR content remains marked untrusted even after a human approves a comment.

A crash, timeout, cancellation, failed POST, or mismatched readback can leave an uncertain outcome.
Never replay from `post-attempt.json`, and do not delete it to retry. Inspect the exact PR reviews
first. A new output directory is a new run, not cross-run deduplication. There is no automatic retry
or rollback; removing a published review is a separate, explicitly authorized GitHub operation.

Record setup time separately from `elapsed_seconds`, which measures only the agent run. Keep the
receipt, one sentence describing the useful blocked or confirmed action, and any integration
friction. A passing local transport fixture is not a completed live pilot or retained-use proof.
