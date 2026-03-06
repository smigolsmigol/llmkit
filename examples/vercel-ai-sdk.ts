// LLMKit as a Vercel AI SDK v6 provider
// Run: npx tsx examples/vercel-ai-sdk.ts

import { generateText, streamText } from 'ai'
import { createLLMKit } from '@f3d1/llmkit-ai-sdk-provider'

const llmkit = createLLMKit({
  apiKey: process.env.LLMKIT_KEY!,
  provider: 'anthropic',
  // baseUrl: 'http://localhost:8787', // uncomment for local dev
})

// non-streaming
const { text } = await generateText({
  model: llmkit.chat('claude-sonnet-4-20250514'),
  prompt: 'explain quicksort in one sentence',
})
console.log(text)

// streaming
const stream = streamText({
  model: llmkit.chat('gpt-4o'),
  prompt: 'count to 5, one number per line',
})

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk)
}
console.log()
