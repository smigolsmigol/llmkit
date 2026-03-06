// Streaming with the LLMKit SDK - cost available after stream ends
// Run: npx tsx examples/streaming.ts

import { LLMKit } from '@llmkit/sdk'

const kit = new LLMKit({
  apiKey: process.env.LLMKIT_KEY!,
  // baseUrl: 'http://localhost:8787', // uncomment for local dev
})

const agent = kit.session()

const stream = await agent.chatStream({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'write a haiku about API costs' }],
})

for await (const chunk of stream) {
  process.stdout.write(chunk)
}

console.log('\n')
console.log('model:', stream.model)
console.log('provider:', stream.provider)
console.log('cost:', stream.cost)
console.log('tokens:', stream.usage)
