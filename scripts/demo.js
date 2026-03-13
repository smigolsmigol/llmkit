#!/usr/bin/env node
// Terminal demo for recording GIFs/SVGs. Simulates a real CLI session.
// Usage: node scripts/demo.js

const { printVerbose } = require('../packages/cli/dist/summary.js')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const tty = process.stderr.isTTY ?? false
const esc = (code, s) => tty ? `\x1b[${code}m${s}\x1b[0m` : s
const dim = (s) => esc('2', s)
const bold = (s) => esc('1', s)
const cyan = (s) => esc('36', s)
const magenta = (s) => esc('35', s)

const BRAND = 'llmkit'
const SPIN = '\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f'

function startSpinner(text) {
  let i = 0
  const timer = setInterval(() => {
    const frame = SPIN[i % SPIN.length]
    const lit = i % BRAND.length
    const name = [...BRAND].map((c, j) => j === lit ? bold(magenta(c.toUpperCase())) : dim(c)).join('')
    process.stderr.write(`\r  ${magenta(frame)} ${name} ${dim(text)}\x1b[K`)
    i++
  }, 80)
  return () => { clearInterval(timer); process.stderr.write('\r\x1b[K') }
}

function gradientBar(filled, width, color) {
  if (filled === 0) return dim('\u2591'.repeat(width))
  const body = Math.max(0, filled - 2)
  const tail = filled - body
  let r = color('\u2588'.repeat(body))
  if (tail >= 1) r += color('\u2593')
  if (tail >= 2) r += color('\u2592')
  r += dim('\u2591'.repeat(width - filled))
  return r
}

async function animatedBar(filled, width, color) {
  for (let i = 1; i <= filled; i++) {
    process.stderr.write('\r\x1b[K' + gradientBar(i, width, color))
    await sleep(25)
  }
  process.stderr.write(gradientBar(filled, width, color))
}

const requests = [
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 2400, outputTokens: 580, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0234, latencyMs: 1840 },
  { provider: 'openai', model: 'gpt-4o', inputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0089, latencyMs: 920 },
  { provider: 'anthropic', model: 'claude-haiku-3.5', inputTokens: 800, outputTokens: 120, cacheReadTokens: 400, cacheWriteTokens: 0, costUsd: 0.0004, latencyMs: 340 },
  { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 3200, outputTokens: 890, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0010, latencyMs: 680 },
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', inputTokens: 4800, outputTokens: 1200, cacheReadTokens: 2400, cacheWriteTokens: 0, costUsd: 0.0312, latencyMs: 2100 },
]

async function main() {
  // startup spinner
  process.stderr.write(dim('$ npx @f3d1/llmkit-cli -v -- python agent.py') + '\n')
  const stopSpin = startSpinner('intercepting...')
  await sleep(1500)
  stopSpin()
  process.stderr.write(`  ${dim('[llmkit]')} proxy on :49152\n`)
  await sleep(400)

  // simulated agent output with verbose cost lines
  process.stderr.write('\n' + dim('Analyzing repository structure...') + '\n')
  const s1 = startSpinner('claude-sonnet-4 generating...')
  await sleep(1800)
  s1()
  printVerbose(requests[0])
  await sleep(300)

  process.stderr.write(dim('Summarizing findings...') + '\n')
  const s2 = startSpinner('gpt-4o generating...')
  await sleep(900)
  s2()
  printVerbose(requests[1])
  await sleep(200)

  process.stderr.write(dim('Classifying issues...') + '\n')
  const s3 = startSpinner('claude-haiku-3.5 generating...')
  await sleep(500)
  s3()
  printVerbose(requests[2])
  await sleep(150)

  const s4 = startSpinner('gpt-4o-mini generating...')
  await sleep(700)
  s4()
  printVerbose(requests[3])
  await sleep(300)

  process.stderr.write(dim('Generating report...') + '\n')
  const s5 = startSpinner('claude-sonnet-4 generating...')
  await sleep(2000)
  s5()
  printVerbose(requests[4])
  await sleep(600)

  // logo - cascade in
  const m = magenta
  const logoLines = [
    `    ${m('\u2588\u2588\u2557     \u2588\u2588\u2557     \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557')}`,
    `    ${m('\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551 \u2588\u2588\u2554\u255d\u2588\u2588\u2551\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d')}`,
    `    ${m('\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2551   \u2588\u2588\u2551')}`,
    `    ${m('\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2551\u255a\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2588\u2588\u2557 \u2588\u2588\u2551   \u2588\u2588\u2551')}`,
    `    ${m('\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u255a\u2550\u255d \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551')}`,
    `    ${m('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d     \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d   \u255a\u2550\u255d')}`,
  ]
  process.stderr.write('\n')
  for (const line of logoLines) {
    process.stderr.write(line + '\n')
    await sleep(50)
  }

  const totalCost = requests.reduce((s, r) => s + r.costUsd, 0)
  const totalMs = requests.reduce((s, r) => s + r.latencyMs, 0) + 3200
  const elapsed = (totalMs / 1000).toFixed(1)
  const rate = (totalCost / (totalMs / 3600000)).toFixed(2)

  await sleep(300)
  process.stderr.write(`\n    ${bold(`$${totalCost.toFixed(4)}`)} ${dim('total')}  ${requests.length} requests  ${dim(elapsed + 's')}  ${dim(`~$${rate}/hr`)}\n\n`)
  await sleep(400)

  // aggregate by model
  const byModel = new Map()
  for (const r of requests) {
    const e = byModel.get(r.model)
    if (e) { e.requests++; e.cost += r.costUsd }
    else byModel.set(r.model, { requests: 1, cost: r.costUsd, provider: r.provider })
  }
  const sorted = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)
  const maxCost = sorted[0][1].cost
  const maxName = Math.max(...sorted.map(([m]) => m.length))
  const width = 20

  // animated gradient bars with provider colors
  for (const [model, stats] of sorted) {
    const name = model.padEnd(maxName + 2)
    const reqs = `${stats.requests} req${stats.requests === 1 ? '' : 's'}`.padEnd(8)
    const cost = `$${stats.cost.toFixed(4)}`.padStart(8)
    const filled = Math.round((stats.cost / maxCost) * width)
    const color = stats.provider === 'anthropic' ? magenta : cyan

    process.stderr.write(`    ${dim(name)}${reqs} ${cost}  `)
    await animatedBar(filled, width, color)
    process.stderr.write('\n')
    await sleep(150)
  }

  process.stderr.write('\n')
}

main()
