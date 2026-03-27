# @f3d1/llmkit-shared

Shared types, constants, and pricing data for [LLMKit](https://github.com/smigolsmigol/llmkit) packages.

## What's in it

- **TypeScript types**: `LLMRequest`, `LLMResponse`, `CostBreakdown`, `TokenUsage`, `ProviderName`, `Budget`, and more
- **Pricing table**: per-token costs for 11 providers (OpenAI, Anthropic, Gemini, Groq, Together, Fireworks, DeepSeek, Mistral, xAI, Ollama, OpenRouter) and 700+ models, including cache read/write rates where applicable
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

Full documentation: [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)

## License

MIT
