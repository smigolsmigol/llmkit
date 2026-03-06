// CostTracker - track costs locally without running the proxy
// Works with raw OpenAI/Anthropic SDK responses
// Run: npx tsx examples/cost-tracker.ts

import { CostTracker } from '@llmkit/sdk'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const tracker = new CostTracker({ log: true })

// track Anthropic calls
const anthropic = new Anthropic()
const msg = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'hello' }],
})
tracker.trackResponse('anthropic', msg)

// track OpenAI calls
const openai = new OpenAI()
const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hello' }],
})
tracker.trackResponse('openai', completion)

// aggregated cost data
console.log('\n' + tracker.summary())
console.log('\nby provider:', tracker.byProvider())
console.log('by model:', tracker.byModel())
