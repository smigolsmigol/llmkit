# Privacy Policy

Last updated: March 18, 2026

LLMKit is an open-source AI API gateway. This policy covers the LLMKit MCP server (`@f3d1/llmkit-mcp-server`) and the hosted proxy service.

## What data we collect

**Claude Code tools (llmkit_cc_*)**: These tools read local session files from `~/.claude/` on your machine. No data leaves your device. We never see, store, or transmit this data.

**Proxy tools (llmkit_*)**: When you use an API key to query the hosted proxy, we process:
- Your API key (for authentication)
- Request metadata: model name, provider, token counts, cost, timestamps, session ID
- We do NOT store prompt content, completions, or any message bodies

## How we use data

Request metadata is used to calculate costs, enforce budgets, and generate usage analytics visible in your dashboard. We do not sell, share, or transfer this data to third parties.

## Data retention

Request metadata is retained for as long as your account exists. You can request deletion of your account and all associated data by contacting us.

## Self-hosting

LLMKit is open source. You can self-host the proxy and dashboard, in which case no data is sent to our servers.

## Security

API keys are hashed before storage. Provider keys are encrypted with AES-GCM. All connections use HTTPS/TLS. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Contact

For privacy questions: [GitHub Issues](https://github.com/smigolsmigol/llmkit/issues) or email the maintainer through the GitHub profile.

## Changes

We may update this policy. Changes will be committed to this repository with a clear diff in git history.
