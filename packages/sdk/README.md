# @f3d1/llmkit-sdk

TypeScript client and local cost tracker for LLMKit. Local estimates need no account or proxy.
Hosted requests require an existing LLMKit API key.

```bash
npm install @f3d1/llmkit-sdk
```

## Local cost tracking

```ts
import { CostTracker } from '@f3d1/llmkit-sdk';

const tracker = new CostTracker();
tracker.track('anthropic', 'claude-sonnet-4-20250514', {
  inputTokens: 1500,
  outputTokens: 800,
  cacheReadTokens: 500,
});
console.log(tracker.totalDollars);
```

This estimates the supplied usage from the bundled pricing snapshot. It makes no provider request
and does not enforce a budget.

The [TypeScript guide](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/typescript.md) covers provider responses,
sessions, streaming, hosted configuration and errors. Hosted account creation is temporarily unavailable.

## License

[MIT](https://github.com/smigolsmigol/llmkit/blob/main/LICENSE)
