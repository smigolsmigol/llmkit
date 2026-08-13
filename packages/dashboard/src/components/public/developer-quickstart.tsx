'use client';

import Link from 'next/link';
import { useState } from 'react';

const options = [
  {
    id: 'mcp',
    label: 'MCP',
    title: 'Add local cost tools to your coding agent',
    command: 'npx @f3d1/llmkit-mcp-server',
    note: 'Runs locally. No LLMKit account or provider proxy required.',
  },
  {
    id: 'cli',
    label: 'CLI',
    title: 'Wrap an existing agent command',
    command: 'npx @f3d1/llmkit-cli -- python agent.py',
    note: 'Tracks OpenAI and Anthropic clients that honor their standard base-URL environment variables.',
  },
  {
    id: 'python',
    label: 'Python',
    title: 'Install the in-process SDK',
    command: 'pip install llmkit-sdk',
    note: 'Use tracked() with supported httpx clients for local response-based cost estimates.',
  },
] as const;

type OptionId = (typeof options)[number]['id'];

export function DeveloperQuickstart() {
  const [activeId, setActiveId] = useState<OptionId>('mcp');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const active = options.find((option) => option.id === activeId) ?? options[0];

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(active.command);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div className="public-panel overflow-hidden rounded-xl">
      <div className="flex flex-col border-b border-white/[0.07] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.55)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">Run the first signal locally</span>
        </div>
        <div role="tablist" aria-label="Installation method" className="flex border-t border-white/[0.07] px-2 sm:border-l sm:border-t-0">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={activeId === option.id}
              onClick={() => {
                setActiveId(option.id);
                setCopyState('idle');
              }}
              className={`border-b px-4 py-3 font-mono text-xs transition ${
                activeId === option.id
                  ? 'border-violet-400 text-zinc-100'
                  : 'border-transparent text-zinc-600 hover:text-zinc-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
        <div>
          <p className="mb-3 text-sm font-medium text-zinc-300">{active.title}</p>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border border-violet-300/10 bg-black/45 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <span className="shrink-0 font-mono text-sm text-emerald-400">$</span>
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-zinc-200">
              {active.command}
            </code>
            <button
              type="button"
              onClick={copyCommand}
              className="col-span-2 justify-self-end rounded border border-zinc-800 px-2.5 py-1 font-mono text-[11px] text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-200 sm:col-span-1"
            >
              {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="border-l-0 border-white/[0.07] lg:border-l lg:pl-7">
          <p className="text-sm leading-6 text-zinc-500">{active.note}</p>
          <Link href="/docs#local-setup" className="mt-3 inline-flex font-mono text-xs text-violet-300 transition hover:text-violet-200">
            Full setup -&gt;
          </Link>
          <p className="sr-only" aria-live="polite">
            {copyState === 'copied' ? 'Command copied to clipboard.' : copyState === 'failed' ? 'Command could not be copied.' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
