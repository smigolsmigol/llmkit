# LLMKit MCP data boundary

The five `llmkit_local_*` tools read supported Claude Code session files and Cline task data on the
user's machine. Parsing and pricing happen inside the local MCP server process. These tools do not
upload prompts, responses, file contents, or session data.

The six gateway tools remain inactive without `LLMKIT_API_KEY`. When a user provides an existing
key, those tools make authenticated, read-only requests to `https://api.llmkit.sh` for account spend,
budgets, keys, sessions, and service health. They do not send local session or task files.

The MCP server does not send usage telemetry. Its source and issue tracker are public at
https://github.com/smigolsmigol/llmkit. Security reports follow the repository's `SECURITY.md`.
