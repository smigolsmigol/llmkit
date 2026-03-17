# @f3d1/llmkit-ai-sdk-provider

[Vercel AI SDK](https://sdk.vercel.ai) v6 custom provider for [LLMKit](https://github.com/smigolsmigol/llmkit). Routes requests through the LLMKit proxy with cost tracking, budget enforcement, and provider fallback.

## Install

```bash
npm install @f3d1/llmkit-ai-sdk-provider ai
```

## Usage

```ts
import { generateText } from 'ai';
import { createLLMKit } from '@f3d1/llmkit-ai-sdk-provider';

const llmkit = createLLMKit({ apiKey: 'lk_...' });

const { text, providerMetadata } = await generateText({
  model: llmkit.chat('claude-sonnet-4-6'),
  prompt: 'Explain quantum tunneling in one sentence.',
});

console.log(text);
console.log('Cost:', providerMetadata?.llmkit);
```

### Streaming

```ts
import { streamText } from 'ai';

const result = streamText({
  model: llmkit.chat('gpt-4.1'),
  prompt: 'Write a haiku about cost tracking.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Config options

```ts
createLLMKit({
  apiKey: 'lk_...',
  sessionId: 'my-session',      // group requests into sessions
  provider: 'anthropic',         // force a specific provider
  baseUrl: 'http://localhost:8787', // custom proxy URL
});
```

## Docs

Full documentation and provider setup: [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)

## License

MIT
