'use client';

import { useMemo, useState } from 'react';

interface ModelPrice {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
}

interface Props {
  models: ModelPrice[];
  providers: string[];
  pricingSnapshotDate: string;
}

function fmt(n: number): string {
  if (n < 0.001) return '<$0.001';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

const PRESETS = [
  { label: 'Chat message', input: 500, output: 200 },
  { label: 'Code review', input: 4000, output: 1500 },
  { label: 'Long doc summary', input: 30000, output: 2000 },
  { label: 'Agent session (10 turns)', input: 50000, output: 15000 },
  { label: 'RAG pipeline (100 queries)', input: 500000, output: 100000 },
];

export function Calculator({ models, providers, pricingSnapshotDate }: Props) {
  const [inputTokens, setInputTokens] = useState(1000);
  const [outputTokens, setOutputTokens] = useState(500);
  const [monthlyRequests, setMonthlyRequests] = useState(1000);
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set(providers));
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'total' | 'input' | 'output'>('total');

  const results = useMemo(() => {
    const modelSearch = search.trim().toLowerCase();
    if (!modelSearch) return [];

    const perM = 1_000_000;
    return models
      .filter(m => selectedProviders.has(m.provider))
      .filter(m => m.model.toLowerCase().includes(modelSearch))
      .map(m => {
        const inputCost = (inputTokens / perM) * m.input;
        const outputCost = (outputTokens / perM) * m.output;
        const perRequest = inputCost + outputCost;
        const monthly = perRequest * monthlyRequests;
        return { ...m, inputCost, outputCost, perRequest, monthly };
      })
      .sort((a, b) => sortBy === 'input' ? a.inputCost - b.inputCost : sortBy === 'output' ? a.outputCost - b.outputCost : a.perRequest - b.perRequest)
      .slice(0, 50);
  }, [models, inputTokens, outputTokens, monthlyRequests, selectedProviders, search, sortBy]);

  const toggleProvider = (p: string) => {
    const next = new Set(selectedProviders);
    if (next.has(p)) next.delete(p); else next.add(p);
    setSelectedProviders(next);
  };

  return (
    <div className="public-panel mt-2 space-y-6 rounded-xl p-5 sm:p-7">
      {/* Token inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="calculator-input-tokens" className="block text-xs text-zinc-400 mb-1">Input tokens per request</label>
          <input
            id="calculator-input-tokens"
            type="number"
            value={inputTokens}
            onChange={e => setInputTokens(Math.max(0, Number(e.target.value) || 0))}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="calculator-output-tokens" className="block text-xs text-zinc-400 mb-1">Output tokens per request</label>
          <input
            id="calculator-output-tokens"
            type="number"
            value={outputTokens}
            onChange={e => setOutputTokens(Math.max(0, Number(e.target.value) || 0))}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="calculator-monthly-requests" className="block text-xs text-zinc-400 mb-1">Requests per month</label>
          <input
            id="calculator-monthly-requests"
            type="number"
            value={monthlyRequests}
            onChange={e => setMonthlyRequests(Math.max(0, Number(e.target.value) || 0))}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => { setInputTokens(p.input); setOutputTokens(p.output); }}
            className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-1 text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-white transition"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          placeholder="Search a verified token-billed model..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {providers.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => toggleProvider(p)}
              className={`rounded-md px-2 py-1 text-xs transition capitalize ${
                selectedProviders.has(p)
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                  : 'bg-white/[0.02] text-zinc-400 border border-white/[0.04]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-xs leading-5 text-amber-100/70">
        The source snapshot has no modality field. Use these estimates only for models you have independently verified are billed per input and output token. The sorted rows are not a cross-modality cheapest-model ranking.
      </div>

      {/* Results table */}
      <div className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/25">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs text-zinc-400">
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium text-right cursor-pointer hover:text-white" onClick={() => setSortBy('input')}>
                Input{sortBy === 'input' ? ' ^' : ''}
              </th>
              <th className="px-3 py-2 font-medium text-right cursor-pointer hover:text-white" onClick={() => setSortBy('output')}>
                Output{sortBy === 'output' ? ' ^' : ''}
              </th>
              <th className="px-3 py-2 font-medium text-right cursor-pointer hover:text-white" onClick={() => setSortBy('total')}>
                Per request{sortBy === 'total' ? ' ^' : ''}
              </th>
              <th className="px-3 py-2 font-medium text-right">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-zinc-400">
                  {search.trim()
                    ? 'No model entries match the current provider and model filters.'
                    : 'Search for a specific model you have verified as token-billed to calculate an estimate.'}
                </td>
              </tr>
            )}
            {results.map((r) => (
              <tr key={`${r.provider}-${r.model}`} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-1.5 text-xs text-zinc-400 capitalize">{r.provider}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.model}</td>
                <td className="px-3 py-1.5 text-right text-zinc-400">{fmt(r.inputCost)}</td>
                <td className="px-3 py-1.5 text-right text-zinc-400">{fmt(r.outputCost)}</td>
                <td className="px-3 py-1.5 text-right text-white font-medium">{fmt(r.perRequest)}</td>
                <td className="px-3 py-1.5 text-right text-zinc-300">{fmt(r.monthly)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400 text-center">
        Search-gated estimates cover up to 50 matching rows from {models.length} model entries across {providers.length} populated provider tables.
        {' '}Bundled snapshot: {pricingSnapshotDate}. For verified token-billed models, estimates exclude cache tiers, tools, media, batch discounts, taxes, and negotiated rates.
        {' '}<a href="/pricing" className="text-violet-400 hover:text-violet-300">Full table</a>
        {' | '}<a href="https://api.llmkit.sh/v1/pricing/compare?mode=text-token&models=anthropic%2Fclaude-sonnet-4-6%2Copenai%2Fgpt-4o&input=1000&output=500&cacheRead=0&cacheWrite=0" className="text-violet-400 hover:text-violet-300">API</a>
      </p>
    </div>
  );
}
