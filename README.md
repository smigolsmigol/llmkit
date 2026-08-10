<p align="center">
  <img src=".github/logo-wordmark-animated.svg" width="280" alt="LLMKit" />
</p>

<h3 align="center">Know what your AI agents cost.</h3>

<p align="center">
  <a href="https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml"><img src="https://github.com/smigolsmigol/llmkit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/smigolsmigol/llmkit"><img src="https://api.scorecard.dev/projects/github.com/smigolsmigol/llmkit/badge" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.bestpractices.dev/projects/12288"><img src="https://www.bestpractices.dev/projects/12288/badge" alt="OpenSSF Best Practices" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/v/llmkit-sdk?label=PyPI&color=blue" alt="PyPI" /></a>
  <a href="https://www.npmjs.com/package/@f3d1/llmkit-sdk"><img src="https://img.shields.io/npm/v/%40f3d1/llmkit-sdk?label=npm&color=blue" alt="npm" /></a>
  <a href="https://github.com/smigolsmigol/llmkit/tree/main/packages/mcp-server"><img src="https://img.shields.io/badge/MCP-Registry-blue" alt="MCP" /></a>
  <a href="https://lobehub.com/mcp/smigolsmigol-llmkit"><img src="https://img.shields.io/badge/LobeHub-A_Grade-green" alt="LobeHub MCP" /></a>
  <a href="https://www.npmjs.com/package/@f3d1/llmkit-mcp-server"><img src="https://img.shields.io/npm/dw/@f3d1/llmkit-mcp-server?label=npm%20downloads" alt="npm downloads" /></a>
  <a href="https://pypi.org/project/llmkit-sdk/"><img src="https://img.shields.io/pypi/dm/llmkit-sdk?label=PyPI%20downloads" alt="PyPI downloads" /></a>
</p>

<p align="center">
  Open-source API gateway for AI providers. Logs every request with token counts and dollar costs.<br>
  Budget limits reject requests before they reach the provider, not after.
</p>

---

```
$ npx @f3d1/llmkit-cli -- python my_agent.py

  $0.0215 total  3 requests  4.2s  ~$18.43/hr

  claude-sonnet-4-20250514  1 req    $0.0156  ████████████████████
  gpt-4o                    2 reqs   $0.0059  ███████░░░░░░░░░░░░░
```

Works with Python, Ruby, Go, Rust - anything that calls the OpenAI or Anthropic API. One command, no code changes.

## Get started

1. **Create an account** at [llmkit.sh](https://llmkit.sh) (free while in beta)
2. **Create an API key** in the Keys tab
3. **Pick a method** below

## CLI

Wrap any command. The CLI intercepts API calls, forwards them through the proxy, and prints a cost summary when the process exits.

```bash
npx @f3d1/llmkit-cli -- python my_agent.py
```

Use `-v` for per-request costs as they happen, `--json` for machine-readable output.

## Python

```bash
pip install llmkit-sdk
```

**With the proxy** (budget enforcement, logging, dashboard):

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.llmkit.sh/v1",
    api_key="llmk_your_key_here",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
```

**Without the proxy** (local cost estimation, zero setup):

```python
from llmkit import tracked
from openai import OpenAI

client = OpenAI(http_client=tracked())

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
# costs estimated locally from bundled pricing table
```

`tracked()` wraps your HTTP client and estimates costs from token usage. No proxy needed. Works with any SDK that accepts `http_client`.

**Framework integrations** (LangChain, LlamaIndex, Pydantic AI):

```python
from llmkit.integrations.langchain import LLMKitCallbackHandler
handler = LLMKitCallbackHandler()
chain.invoke("...", config={"callbacks": [handler]})
print(f"${handler.total_cost:.4f}")
```

## TypeScript

```bash
npm install @f3d1/llmkit-sdk
```

```typescript
import { LLMKit } from '@f3d1/llmkit-sdk'

const kit = new LLMKit({ apiKey: process.env.LLMKIT_KEY })
const agent = kit.session()

const res = await agent.chat({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'summarize this document' }],
})

console.log(res.content)
console.log(res.cost)   // { inputCost: 0.003, outputCost: 0.015, totalCost: 0.018, currency: 'USD' }
```

Streaming, CostTracker, and [Vercel AI SDK provider](packages/ai-sdk-provider) also available.

## MCP Server

<a href="https://glama.ai/mcp/servers/smigolsmigol/llmkit-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/smigolsmigol/llmkit-mcp-server/badge" alt="llmkit-mcp-server MCP server" />
</a>

Query AI costs from Claude Code, Cline, or Cursor:

```json
{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["@f3d1/llmkit-mcp-server"],
      "env": { "LLMKIT_API_KEY": "llmk_your_key_here" }
    }
  }
}
```

**11 tools** - 6 proxy (need API key), 5 local (no key, auto-detect Claude Code + Cline + Cursor):

`llmkit_usage_stats` `llmkit_cost_query` `llmkit_budget_status` `llmkit_session_summary` `llmkit_list_keys` `llmkit_health` `llmkit_local_session` `llmkit_local_projects` `llmkit_local_cache` `llmkit_local_forecast` `llmkit_local_agents`

**SessionEnd hook** - auto-log session costs when Claude Code exits. Add to `settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "type": "command",
        "command": "npx @f3d1/llmkit-mcp-server --hook"
      }
    ]
  }
}
```

Parses the session transcript and prints cost summary. No API key needed.

## GitHub Action

Cap AI spend in CI. The action runs your command through the CLI, tracks cost, and fails the job if it exceeds the budget.

```yaml
- uses: smigolsmigol/llmkit/.github/actions/llmkit-budget@main
  with:
    command: python agent.py
    budget-usd: '5.00'
    post-comment: 'true'
```

Posts a cost report as a PR comment. Outputs `total-cost`, `total-requests`, `budget-exceeded`, and `summary-json` for downstream steps.

## Why LLMKit

Most cost tracking tools give you "soft limits" that agents blow past in the first hour. LLMKit runs cost estimation before every request. If it would exceed the budget, the request gets rejected before reaching the provider. Per-key or per-session scope.

Tag requests with a session ID or end-user ID to track costs per agent, per conversation, per user. The dashboard and MCP server surface this data in real time. Cost anomaly detection alerts when a single request costs 3x the recent median.

11 providers through one interface: Anthropic, OpenAI, Google Gemini, Groq, Together, Fireworks, DeepSeek, Mistral, xAI, Ollama, OpenRouter. Fallback chains with one header (`x-llmkit-fallback: anthropic,openai,gemini`).

Runs on Cloudflare Workers at the edge. Cache-aware pricing across 7 providers with prompt caching. 730+ models priced across all providers.

**Automatic prompt caching** for Anthropic: the proxy injects cache breakpoints on system prompts and conversation history. Second request with the same system prompt costs 90% less. Zero config, zero code changes.

**Framework integrations**: drop-in cost tracking for LangChain, LlamaIndex, and Pydantic AI via callback handlers. Works alongside the httpx transport for direct SDK use.

**470+ tests**, ClusterFuzzLite fuzzing, 6-stage security pipeline (gitleaks, semgrep, CodeQL, bandit, pip-audit, pnpm audit). [OpenSSF Scorecard 8.3](https://scorecard.dev/viewer/?uri=github.com/smigolsmigol/llmkit) - higher than React, Django, Kubernetes, and every AI gateway competitor.

**Public API endpoints** (no auth required):

- [`/v1/pricing/compare`](https://api.llmkit.sh/v1/pricing/compare?input=1000&output=1000) - compare cost across all 730+ models for a given token count

## Security

LLMKit handles your API keys. We take that seriously.

| Layer | What |
|-------|------|
| Encryption | Provider keys: AES-256-GCM, random IV, context-bound AAD |
| Hashing | User API keys: SHA-256, never stored in plaintext |
| Runtime | Cloudflare Workers: no filesystem, no .env, nothing to exfiltrate |
| Supply chain | All CI actions pinned to commit SHAs, explicit least-privilege permissions |
| Provenance | npm packages published with [Sigstore provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC |
| Pre-commit | 19 secret patterns + credential file blocking + gitleaks |
| CI pipeline | gitleaks, semgrep, pnpm audit, pip-audit, bandit, [KeyGuard](https://github.com/smigolsmigol/keyguard) |
| AI exclusion | .cursorignore + .claudeignore block AI tools from reading secrets |

Full details in [SECURITY.md](SECURITY.md).

<details>
<summary><strong>Packages</strong></summary>

| Package | Description |
|---------|-------------|
| [llmkit-sdk](https://pypi.org/project/llmkit-sdk/) (PyPI) | Python SDK: `tracked()` transport, cost estimation, streaming, sessions |
| [@f3d1/llmkit-sdk](packages/sdk) (npm) | TypeScript client, CostTracker, streaming |
| [@f3d1/llmkit-cli](packages/cli) | `npx @f3d1/llmkit-cli -- <cmd>`: zero-code cost tracking for any language |
| [@f3d1/llmkit-proxy](packages/proxy) | Hono-based CF Workers proxy: auth, budgets, routing, logging |
| [@f3d1/llmkit-ai-sdk-provider](packages/ai-sdk-provider) | Vercel AI SDK v6 custom provider |
| [@f3d1/llmkit-mcp-server](packages/mcp-server) | 11 tools: proxy analytics, local costs (Claude Code + Cline + Cursor) |
| [@f3d1/llmkit-shared](packages/shared) | Types, pricing table (11 providers, 730+ models), cost calculation |

</details>

<details>
<summary><strong>Self-host</strong></summary>

```bash
git clone https://github.com/smigolsmigol/llmkit
cd llmkit && pnpm install && pnpm build

cd packages/proxy
echo 'DEV_MODE=true' > .dev.vars
pnpm dev
# proxy running at http://localhost:8787
```

Validate the isolated staging Worker bundle locally:

```bash
pnpm --filter @f3d1/llmkit-proxy build
```

Generic Wrangler deploy and secret commands are intentionally not documented because omitting an
environment can target production. Live staging and production deployments use the guarded
`deploy:staging` and `deploy:production` scripts, require an explicit target confirmation and
approval environment value, and refuse a dirty worktree.

### Isolated hosted budget proof

This proof may mutate only `llmkit-proxy-staging.<account>.workers.dev` and a separate staging
Supabase project. It requires a clean committed worktree and separate approval for the live staging
deployment and proof run. Production is not a valid target.

For the first staging deployment, create an external `.env` or JSON file containing exactly these
secret names. Keep the file outside the repository:

```text
ENCRYPTION_KEY
STAGING_PROOF_TOKEN
STAGING_SUPABASE_PROJECT_REF
SUPABASE_KEY
SUPABASE_URL
```

The deploy guard pins the exact Cloudflare account, verifies the authenticated identity, and permits
bootstrap only when Wrangler returns a recognized Worker-not-found code. Auth, account, network, or
unrecognized secret-readback failures stop the deployment.

Create or select a disposable Supabase project, record both its ref and the production project ref,
and stop if they match. After separate approval for the staging schema mutation, use the pinned CLI
to inspect and apply only the repository's three migrations. Do not use the dashboard SQL editor.

```powershell
$stagingRef = 'abcdefghijklmnopqrst'
$productionRef = 'zyxwvutsrqponmlkjihg'
if ($stagingRef -eq $productionRef) { throw 'staging database matches production' }
node node_modules/supabase/dist/supabase.js link --project-ref $stagingRef
node node_modules/supabase/dist/supabase.js migration list --linked
node node_modules/supabase/dist/supabase.js db push --linked --dry-run
# Stop unless the pending set is exactly the three files in supabase/migrations.
# After explicit approval for this database mutation:
node node_modules/supabase/dist/supabase.js db push --linked
node node_modules/supabase/dist/supabase.js test db --linked supabase/tests/database
node node_modules/supabase/dist/supabase.js db lint --linked --schema public --level warning --fail-on warning
node node_modules/supabase/dist/supabase.js migration list --linked
node node_modules/supabase/dist/supabase.js unlink
```

After approval, the guarded bootstrap command is:

```powershell
$accountId = '0123456789abcdef0123456789abcdef'
$deployApproval = "staging:llmkit-proxy-staging:account:$accountId:db:$stagingRef"
$env:LLMKIT_DEPLOY_APPROVED = $deployApproval
pnpm --filter @f3d1/llmkit-proxy deploy:staging -- `
  --confirm $deployApproval `
  --account-id $accountId `
  --database-project-ref $stagingRef `
  --production-database-project-ref $productionRef `
  --bootstrap `
  --secrets-file C:\secure\llmkit-staging.env
```

On later deployments, use the same account, database refs, and external secret file, and omit
`--bootstrap`. The guard reads back the existing secret names, refuses missing or unexpected names,
verifies the file's non-secret database binding, and reapplies that verified binding while deploying.

Read back the deployed revision and secret names without printing secret values:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = $accountId
node packages/proxy/node_modules/wrangler/bin/wrangler.js deployments list --config packages/proxy/wrangler.staging.toml --name llmkit-proxy-staging --json
node packages/proxy/node_modules/wrangler/bin/wrangler.js secret list --config packages/proxy/wrangler.staging.toml --name llmkit-proxy-staging --format json
```

The proof runner requires the `LLMKIT_STAGING_*` values listed in `.env.example`, plus two matching
approval values. It verifies the deployed source commit, creates unique proof identities, joins HTTP
receipt IDs to database rows, and tests concurrency, retries, attribution, settlement, real Durable
Object alarm crash recovery, real PostgREST outbox recovery, hosted coordination latency, and full
cleanup. The server-side coordination kill thresholds are 50 ms median and 150 ms p95 over 40
post-warmup samples. It writes the ignored proof receipt to
`audits/llmkit-hosted-staging-budget-proof.json`.

```powershell
$host = 'llmkit-proxy-staging.<account>.workers.dev'
$hostApproval = "staging:$host:db:$stagingRef"
$env:LLMKIT_HOSTED_PROOF_APPROVED = $hostApproval
pnpm --filter @f3d1/llmkit-proxy proof:hosted:staging -- --confirm $hostApproval
```

Before the first external mutation, the runner writes the non-secret fixture identities to
`audits/llmkit-hosted-staging-recovery.json`. An unresolved journal blocks a new run. After an
interruption, use the same approved target and database credentials to remove only those recorded
fixtures; provider credentials are not required for recovery:

```powershell
pnpm --filter @f3d1/llmkit-proxy proof:hosted:staging -- --recover --confirm $hostApproval
```

A clean result requires zero proof database rows, API keys, and budgets; zero Budget Durable Object
reservations, settlements, evidence, and outbox entries; zero RateLimit entries; and zero Idempotency
entries or alarms. Deleting the staging Worker or rotating its proof token remains a separately
approved operation.


</details>

<details>
<summary><strong>Testing</strong></summary>

470+ tests across TypeScript and Python: cost calculation, budget enforcement, crypto, reservations, pricing accuracy, streaming, transport hooks, contract tests, and integration tests. CI runs on every push with a 6-stage security pipeline.

</details>

<details>
<summary><strong>Audit logging</strong></summary>

Per-request logging with timestamps, model attribution, cost tracking, per-end-user attribution (`x-llmkit-user-id`), tool invocation logging, CSV export with sha256 integrity hash. This data can support record-keeping requirements but does not constitute regulatory compliance.

</details>

<details>
<summary><strong>Listed on</strong></summary>

- [LobeHub](https://lobehub.com/mcp/smigolsmigol-llmkit)
- [Glama](https://glama.ai/mcp/servers/smigolsmigol/llmkit)
- [MCP Registry](https://registry.modelcontextprotocol.io) - official
- [Smithery](https://smithery.ai/server/@smigolsmigol/llmkit)
- [AgentHotspot](https://agenthotspot.com/connectors/oss/llmkit)
- [TensorBlock awesome-mcp-servers](https://github.com/TensorBlock/awesome-mcp-servers)
- [awesome-cloudflare](https://github.com/zhuima/awesome-cloudflare)
- [Pricing comparison](https://llmkit.sh/pricing) - 730+ models
- [Cost calculator](https://llmkit.sh/compare)

</details>

<p align="center">
  <a href="https://github.com/smigolsmigol/llmkit">Star this repo</a> if you find it useful.
</p>
