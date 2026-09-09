# LLMKit documentation

Start with [local tracking](getting-started.md). It needs no LLMKit account.
Hosted calls require an existing key; new account creation and key management remain temporarily
unavailable. Experimental boundaries have separate version and enrollment requirements.

## Integrate

| Task | Guide |
| --- | --- |
| Track Python SDK calls; enroll OpenAI Agents or PydanticAI boundaries | [Python](integrations/python.md) |
| Use the TypeScript client or local CostTracker | [TypeScript](integrations/typescript.md) |
| Wrap a compatible OpenAI or Anthropic command | [CLI](integrations/cli.md) |
| Inspect supported coding-session data from an MCP client | [MCP server](integrations/mcp.md) |
| Route Vercel AI SDK 6 calls | [AI SDK provider](integrations/vercel-ai-sdk.md) |
| Use shared types and the bundled pricing catalog | [Shared package](integrations/shared.md) |
| Call the gateway directly | [API reference](api.md) |
| Try the opt-in public-PR reviewer | [Live review pilot](guides/live-review.md) |

## Understand the boundaries

- [Architecture](architecture.md): components, identity, state and failure paths.
- [Security requirements](../SECURITY.md) and [assurance case](security-assurance.md): guarantees,
  evidence and unresolved limits.
- [Accessibility](accessibility.md): current controls and verification gaps.
- [Roadmap](roadmap.md): intended and excluded work, not release promises.
- [Privacy](../PRIVACY.md) and [MCP privacy](../packages/mcp-server/MCP_PRIVACY.md).

## Develop and operate

Run repository commands from the repository root unless a guide explicitly names another directory.
Moving a guide does not change a command's working directory.

- [Contributing](../CONTRIBUTING.md), [governance](../GOVERNANCE.md) and [code of conduct](../CODE_OF_CONDUCT.md).
- [Quality gates](operations/quality.md): pinned tooling, tests and artifact checks.
- [Python releases](operations/python-releases.md): original artifacts, verification and recovery.
- [Staging proof](operations/staging-proof.md): isolated targets, explicit approval and cleanup.
- [Database workflow](operations/database.md): local proof and gated migrations.
- [Database recovery evidence](operations/database-recovery.md): historical snapshots, not migrations.
- [Changelog](../CHANGELOG.md).

The root and package READMEs are short entry points. These guides own the detailed instructions.
Source code, examples, migrations and recovery snapshots remain beside their implementation.
