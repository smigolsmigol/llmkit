'use client';

import { useState } from 'react';

const tabs = ['CLI', 'Python', 'MCP', 'curl'] as const;
type Tab = (typeof tabs)[number];

function CliOutput() {
  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/[0.04] p-4">
      <p>
        <span className="text-zinc-600">  claude-sonnet-4    </span>
        <span className="text-emerald-400 font-semibold">$0.0847</span>
        {'  '}
        <span className="text-zinc-500">1,204 in / 380 out</span>
        {'  '}
        <span className="text-violet-400">cache saved $0.31</span>
      </p>
      <p className="mt-0.5">
        <span className="text-zinc-600">  gpt-4.1-mini       </span>
        <span className="text-emerald-400 font-semibold">$0.0182</span>
        {'  '}
        <span className="text-zinc-500">890 in / 241 out</span>
      </p>
      <p className="mt-2 border-t border-white/[0.04] pt-2">
        <span className="text-zinc-400">  Session total:</span>{' '}
        <span className="text-white font-bold text-base">$4.12</span>
        <span className="text-zinc-600"> / $50.00 budget</span>
        {'  '}
        <span className="text-zinc-700">14 reqs in 38s</span>
      </p>
    </div>
  );
}

function PythonOutput() {
  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/[0.04] p-4">
      <p>
        <span className="text-emerald-400 font-semibold">$0.0847</span>
        {'  '}
        <span className="text-zinc-500">claude-sonnet-4</span>
        {'  '}
        <span className="text-zinc-600">1,204 in / 380 out</span>
        {'  '}
        <span className="text-violet-400">cache saved $0.31</span>
      </p>
      <p className="mt-2 border-t border-white/[0.04] pt-2">
        <span className="text-zinc-400">Session:</span>{' '}
        <span className="text-white font-bold text-base">$4.12</span>
        <span className="text-zinc-600"> / $50.00 budget</span>
      </p>
    </div>
  );
}

function McpOutput() {
  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/[0.04] p-4">
      <p>
        <span className="text-zinc-400">This session:</span>{' '}
        <span className="text-white font-bold text-base">$4.12</span>
        <span className="text-zinc-600"> across 47 messages</span>
      </p>
      <p className="mt-1">
        <span className="text-zinc-600">  claude-opus-4-6 (1M)</span>
        {'  '}
        <span className="text-emerald-400">$3.89</span>
        {'  '}
        <span className="text-violet-400">{'████████████████████'}</span>
        <span className="text-zinc-700">{'██'}</span>
        <span className="text-zinc-600"> 94%</span>
      </p>
      <p>
        <span className="text-zinc-600">  claude-sonnet-4</span>
        {'     '}
        <span className="text-emerald-400">$0.23</span>
        {'  '}
        <span className="text-violet-400">{'█'}</span>
        <span className="text-zinc-700">{'█████████████████████'}</span>
        <span className="text-zinc-600">  6%</span>
      </p>
    </div>
  );
}

function CurlOutput() {
  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/[0.04] p-4">
      <p>
        <span className="text-cyan-400">x-llmkit-cost:</span>{' '}
        <span className="text-emerald-400 font-semibold">0.084700</span>
      </p>
      <p>
        <span className="text-cyan-400">x-llmkit-tokens-in:</span>{' '}
        <span className="text-zinc-200">1204</span>
        {'  '}
        <span className="text-cyan-400">x-llmkit-tokens-out:</span>{' '}
        <span className="text-zinc-200">380</span>
      </p>
      <p>
        <span className="text-cyan-400">x-llmkit-cache-saved:</span>{' '}
        <span className="text-violet-400">0.310000</span>
      </p>
      <p>
        <span className="text-cyan-400">x-llmkit-budget-remaining:</span>{' '}
        <span className="text-zinc-200">45.88</span>
      </p>
    </div>
  );
}

const snippets: Record<Tab, React.ReactNode> = {
  CLI: (
    <>
      <div>
        <p className="text-zinc-500"># wrap any command</p>
        <p>
          <span className="text-emerald-400">$</span>{' '}
          <span className="text-zinc-300">npx @f3d1/llmkit-cli -- python agent.py</span>
        </p>
        <p className="text-zinc-600 text-xs mt-1">... agent runs normally ...</p>
      </div>
      <CliOutput />
    </>
  ),
  Python: (
    <>
      <div>
        <p className="text-zinc-500"># one-line integration</p>
        <p>
          <span className="text-violet-400">from</span>{' '}
          <span className="text-zinc-300">llmkit</span>{' '}
          <span className="text-violet-400">import</span>{' '}
          <span className="text-zinc-300">tracked</span>
        </p>
        <p>
          <span className="text-zinc-300">client</span>
          <span className="text-zinc-500"> = </span>
          <span className="text-amber-300">OpenAI</span>
          <span className="text-zinc-400">(</span>
          <span className="text-zinc-300">http_client</span>
          <span className="text-zinc-500">=</span>
          <span className="text-amber-300">tracked</span>
          <span className="text-zinc-400">())</span>
        </p>
        <p>
          <span className="text-zinc-300">resp</span>
          <span className="text-zinc-500"> = </span>
          <span className="text-zinc-300">client.chat.completions.</span>
          <span className="text-amber-300">create</span>
          <span className="text-zinc-400">(</span>
          <span className="text-zinc-500">...</span>
          <span className="text-zinc-400">)</span>
        </p>
      </div>
      <PythonOutput />
    </>
  ),
  MCP: (
    <>
      <div>
        <p className="text-zinc-500"># Claude Code / Cline / Cursor</p>
        <p className="text-zinc-400 italic">{"\""}How much did this session cost?{"\""}
        </p>
      </div>
      <McpOutput />
    </>
  ),
  curl: (
    <>
      <div>
        <p className="text-zinc-500"># swap base URL, keep your code</p>
        <p>
          <span className="text-emerald-400">$</span>{' '}
          <span className="text-zinc-300">curl https://proxy.llmkit.ai/v1/chat/completions \</span>
        </p>
        <p className="pl-4">
          <span className="text-zinc-300">-H </span>
          <span className="text-amber-300">{'"'}Authorization: Bearer lk_...{'"'}</span>
          <span className="text-zinc-300"> \</span>
        </p>
        <p className="pl-4">
          <span className="text-zinc-300">-H </span>
          <span className="text-amber-300">{'"'}x-llmkit-provider: anthropic{'"'}</span>
          <span className="text-zinc-300"> \</span>
        </p>
        <p className="pl-4">
          <span className="text-zinc-300">-d </span>
          <span className="text-amber-300">{"'{\"model\": \"claude-sonnet-4-20250514\", ...}'"}</span>
        </p>
      </div>
      <CurlOutput />
    </>
  ),
};

export function TerminalDemo() {
  const [active, setActive] = useState<Tab>('CLI');

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#111]">
      <div className="flex items-center border-b border-white/[0.06]">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          </div>
        </div>
        <div className="flex gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={`px-3 py-2 text-xs transition ${
                active === tab
                  ? 'text-zinc-200 bg-white/[0.04]'
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 p-5 font-mono text-sm">
        {snippets[active]}
      </div>
    </div>
  );
}
