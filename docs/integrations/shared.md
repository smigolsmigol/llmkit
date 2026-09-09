# @f3d1/llmkit-shared

Shared types, constants, and pricing data for [LLMKit](https://github.com/smigolsmigol/llmkit) packages.

## What's in it

- **TypeScript types**: `LLMRequest`, `LLMResponse`, `CostBreakdown`, `TokenUsage`, `ProviderName`, `Budget`, and more
- **Pricing snapshot**: 886 model entries across 9 populated provider tables, dated 2026-08-31,
  with cache read/write rates where available. The snapshot does not encode model modality. Values
  are token rates only for models independently verified as token-billed. `ProviderName` reserves
  Ollama and OpenRouter identifiers, but the snapshot contains no priced entries for them.
- **Cost calculation**: `calculateCost()`, `calculateCostBreakdown()`, `getModelPricing()`
- **Provider inference**: `inferProvider()` resolves a model name to its provider
- **Error types**: shared error definitions across LLMKit packages

## Install

```bash
npm install @f3d1/llmkit-shared
```

## Usage

```ts
import { calculateCost, inferProvider, getModelPricing } from '@f3d1/llmkit-shared';

const cost = calculateCost('anthropic', 'claude-sonnet-4-6', 1000, 500);
// -> 0.0105 (USD)

const provider = inferProvider('gpt-4.1');
// -> 'openai'

const pricing = getModelPricing('openai', 'gpt-4.1');
// -> { inputPerMillion: 2.0, outputPerMillion: 8.0 }
```

## Docs

See the [LLMKit repository](https://github.com/smigolsmigol/llmkit) for the gateway and package docs.

## License

MIT
