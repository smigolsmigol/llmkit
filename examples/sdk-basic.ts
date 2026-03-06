// Basic LLMKit SDK usage - chat with cost tracking
// Run: npx tsx examples/sdk-basic.ts

import { LLMKit } from '@llmkit/sdk'

const kit = new LLMKit({
  apiKey: process.env.LLMKIT_KEY!,
  // baseUrl: 'http://localhost:8787', // uncomment for local dev
})

// sessions group requests for per-agent cost tracking
const agent = kit.session()

const res = await agent.chat({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'what is 2+2?' }],
})

console.log(res.content)
console.log('cost:', res.cost)
console.log('tokens:', res.usage)

// second request on the same session
const follow = await agent.chat({
  provider: 'openai',
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'what is 2+2?' },
    { role: 'assistant', content: res.content },
    { role: 'user', content: 'now multiply that by 10' },
  ],
})

console.log(follow.content)
console.log('cost:', follow.cost)
