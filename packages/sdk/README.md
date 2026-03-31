# @f3d1/llmkit-sdk

TypeScript client for [LLMKit](https://github.com/smigolsmigol/llmkit) - cost tracking, provider routing, and budget enforcement for LLM APIs.

## Install

```bash
npm install @f3d1/llmkit-sdk
# or
pnpm add @f3d1/llmkit-sdk
```

## Quick start

```ts
import { LLMKit } from '@f3d1/llmkit-sdk';

const llm = new LLMKit({ apiKey: process.env.LLMKIT_KEY! });

const res = await llm.chat({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Explain the CAP theorem in two sentences.' }],
});

console.log(res.content);
console.log(`$${res.cost.totalCost}`); // $0.0183
```

Every response includes token counts, cost breakdown, latency, and provider info. No extra calls needed.

## Chat completions

The `chat()` method sends a request through the LLMKit proxy and returns a typed `LLMResponse`. The proxy handles auth, logging, budget checks, and cost calculation before forwarding to the provider.

```ts
const res = await llm.chat({
  model: 'gpt-4.1',
  messages: [
    { role: 'system', content: 'You are a code reviewer.' },
    { role: 'user', content: 'Review this function for SQL injection risks.' },
  ],
  temperature: 0.3,
  maxTokens: 1024,
});

// res.content      - the model's text response
// res.usage        - { inputTokens, outputTokens, cacheReadTokens, totalTokens, ... }
// res.cost         - { inputCost, outputCost, totalCost, currency }
// res.latencyMs    - end-to-end latency
// res.provider     - which provider actually served the request
// res.model        - resolved model name
// res.cached       - whether the response came from cache
// res.id           - unique request ID
// res.sessionId    - session ID if set
```

### Specifying a provider

By default the proxy routes based on the model name. To force a specific provider:

```ts
const res = await llm.chat({
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'hello' }],
});
```

Provider names: `anthropic`, `openai`, `gemini`, `groq`, `together`, `fireworks`, `deepseek`, `mistral`, `xai`, `ollama`, `openrouter`.

## Streaming

`chatStream()` returns an async iterable that yields text chunks as they arrive. Token usage and cost are available after the stream finishes.

```ts
const stream = await llm.chatStream({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Write a haiku about distributed systems.' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// metadata available after iteration completes
console.log(stream.usage);    // { inputTokens: 24, outputTokens: 18, ... }
console.log(stream.cost);     // { inputCost: 0.0001, outputCost: 0.0009, totalCost: 0.001, ... }
console.log(stream.model);    // 'claude-sonnet-4-20250514'
console.log(stream.provider); // 'anthropic'
console.log(stream.id);       // request ID
```

The `ChatStream` class implements `AsyncIterable<string>`, so it works anywhere you'd use `for await...of`.

## Sessions

Sessions group related requests under a single ID for cost tracking and analytics. Useful for agent loops, multi-turn conversations, or anything where you want per-task cost visibility.

```ts
const agent = llm.session(); // auto-generates a UUID
// or
const agent = llm.session('my-task-123'); // your own ID

const plan = await agent.chat({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Plan the migration steps.' }],
});

const code = await agent.chat({
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'user', content: 'Plan the migration steps.' },
    { role: 'assistant', content: plan.content },
    { role: 'user', content: 'Now write the migration script.' },
  ],
});

// both requests tagged with the same session ID
// visible in dashboard under Sessions, queryable via MCP server
```

`session()` returns a new `LLMKit` instance that shares config but adds the session header to every request. The original client is unchanged.

## CostTracker (local, no proxy)

`CostTracker` estimates costs locally using the bundled pricing table (730+ models, 11 providers). No proxy or API key required. Useful for tracking spend across multiple SDK clients, or when you want cost data without routing through LLMKit.

### With OpenAI SDK responses

```ts
import { CostTracker } from '@f3d1/llmkit-sdk';
import OpenAI from 'openai';

const openai = new OpenAI();
const tracker = new CostTracker({ log: true });

const res = await openai.chat.completions.create({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'hello' }],
});

tracker.trackResponse('openai', res);
// [llmkit] openai/gpt-4.1: $0.0042 (128 in, 56 out)
```

### With Anthropic SDK responses

```ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const tracker = new CostTracker({ log: true });

const res = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hello' }],
});

tracker.trackResponse('anthropic', res);
```

`trackResponse()` detects whether the usage object uses OpenAI-style (`prompt_tokens`) or Anthropic-style (`input_tokens`) fields automatically. Cache tokens are picked up from both formats.

### Manual tracking

For cases where you have token counts but not an SDK response object:

```ts
tracker.track('anthropic', 'claude-sonnet-4-20250514', {
  inputTokens: 1500,
  outputTokens: 800,
  cacheReadTokens: 500,
});
```

### Aggregations

```ts
tracker.totalCents;   // 4.23
tracker.totalDollars;  // '0.0423'
tracker.requestCount;  // 12

tracker.byProvider();  // { anthropic: { cents, requests, inputTokens, outputTokens }, openai: { ... } }
tracker.byModel();     // { 'claude-sonnet-4-20250514': { ... }, 'gpt-4.1': { ... } }
tracker.bySession();   // grouped by sessionId passed to track()

tracker.summary();
// LLMKit Cost Summary
// ---
// Total: $0.0423 (12 requests)
//
// By provider:
//   anthropic: $0.0312 (8 reqs)
//   openai: $0.0111 (4 reqs)
//
// By model:
//   claude-sonnet-4-20250514: $0.0312 (8 reqs)
//   gpt-4.1: $0.0111 (4 reqs)

tracker.reset(); // clear all entries
```

### Event listener

React to each tracked request in real time:

```ts
const tracker = new CostTracker({
  onTrack: (entry) => {
    if (entry.costCents > 10) {
      console.warn(`Expensive request: ${entry.model} cost $${(entry.costCents / 100).toFixed(2)}`);
    }
  },
});

// or add listeners later
const unsub = tracker.on((entry) => {
  metrics.recordCost(entry.provider, entry.costCents);
});

// unsub() to remove the listener
```

## Configuration

```ts
const llm = new LLMKit({
  apiKey: 'llmk_...',                     // required - your LLMKit API key
  baseUrl: 'https://my-proxy.example.com', // default: LLMKit cloud proxy
  sessionId: 'agent-run-42',              // attach a session ID to all requests
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | (required) | LLMKit API key from the dashboard |
| `baseUrl` | `string` | `https://llmkit-proxy.smigolsmigol.workers.dev` | Proxy URL. Change for self-hosted deployments. |
| `sessionId` | `string` | `undefined` | Session ID sent with every request |

For self-hosted setups, point `baseUrl` at your own Cloudflare Workers deployment.

## Error handling

The SDK throws plain `Error` objects with the message from the proxy's error response. The proxy returns structured error codes you can match on.

```ts
try {
  await llm.chat({ model: 'gpt-4.1', messages });
} catch (err) {
  if (err instanceof Error) {
    // common error messages from the proxy:
    // 'Budget exceeded: $5.00 used of $5.00 limit...' (HTTP 402)
    // 'Rate limit exceeded' (HTTP 429)
    // 'Invalid or missing API key' (HTTP 401)
    // 'All providers failed: ...' (HTTP 503)
    console.error(err.message);
  }
}
```

Budget enforcement happens before the request reaches the provider. If a request would push spend over the limit, it's rejected with a 402 and the budget is not charged.

For streaming, errors on connection throw immediately. If the stream breaks mid-response, the async iterator throws on the next `read()`.

## TypeScript types

The SDK re-exports all types from `@f3d1/llmkit-shared`:

```ts
import type {
  LLMRequest,       // chat request shape (model, messages, temperature, maxTokens, ...)
  LLMResponse,      // full response (content, usage, cost, latencyMs, cached, ...)
  LLMKitConfig,     // constructor options
  TokenUsage,       // { inputTokens, outputTokens, cacheReadTokens, totalTokens, ... }
  CostBreakdown,    // { inputCost, outputCost, totalCost, currency, extraCosts? }
  ProviderName,     // 'anthropic' | 'openai' | 'gemini' | ... (11 providers)
  SessionSummary,   // session aggregate from the proxy
  CostEntry,        // single entry from CostTracker
} from '@f3d1/llmkit-sdk';
```

`ChatStream` is also exported as a class if you need to type a variable holding a stream reference.

## Related packages

| Package | What it does |
|---------|-------------|
| [@f3d1/llmkit-cli](https://github.com/smigolsmigol/llmkit/tree/main/packages/cli) | `npx @f3d1/llmkit-cli -- python agent.py` - zero-code cost tracking for any language |
| [@f3d1/llmkit-ai-sdk-provider](https://github.com/smigolsmigol/llmkit/tree/main/packages/ai-sdk-provider) | Vercel AI SDK v6 custom provider with cache token support |
| [@f3d1/llmkit-mcp-server](https://github.com/smigolsmigol/llmkit/tree/main/packages/mcp-server) | Query costs from Claude Code, Cline, Cursor (11 tools) |
| [llmkit-sdk](https://pypi.org/project/llmkit-sdk/) (PyPI) | Python SDK with `tracked()` transport and local cost estimation |

## License

MIT - [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)
