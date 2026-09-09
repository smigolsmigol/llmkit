# @f3d1/llmkit-shared

Shared types, constants and bundled pricing data for LLMKit packages.

```bash
npm install @f3d1/llmkit-shared
```

```ts
import { calculateCost, inferProvider } from '@f3d1/llmkit-shared';

console.log(inferProvider('gpt-4.1'));
console.log(calculateCost('anthropic', 'claude-sonnet-4-6', 1000, 500));
```

The [shared-package guide](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/shared.md) owns the pricing snapshot
description and API examples. Prices are estimates, not live quotes or provider invoices.
[pricing.json](https://github.com/smigolsmigol/llmkit/blob/main/packages/shared/pricing.json) is the catalog source.

## License

[MIT](https://github.com/smigolsmigol/llmkit/blob/main/LICENSE)
