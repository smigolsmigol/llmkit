# @f3d1/llmkit-sdk

TypeScript client for [LLMKit](https://github.com/smigolsmigol/llmkit): cost tracking, provider routing, and budget enforcement for LLM APIs.

## Install

```bash
npm install @f3d1/llmkit-sdk
```

## Usage

```ts
import { LLMKit } from '@f3d1/llmkit-sdk';

const llm = new LLMKit({ apiKey: 'llmk_...' });

const res = await llm.chat({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello' }],
});

console.log(res.content);
console.log(`Cost: $${res.cost.totalCost}`);
```

### Streaming

```ts
const stream = await llm.chatStream({
  model: 'gpt-4.1',
  messages: [{ role: 'user', content: 'Hello' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}

console.log(`Tokens: ${stream.usage?.inputTokens} in, ${stream.usage?.outputTokens} out`);
```

### Local cost tracking (no proxy)

```ts
import { CostTracker } from '@f3d1/llmkit-sdk';

const tracker = new CostTracker({ log: true });
tracker.trackResponse('openai', response); // pass any OpenAI/Anthropic SDK response
console.log(tracker.summary());
```

## Docs

Full documentation, examples, and provider setup: [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)

## License

MIT
