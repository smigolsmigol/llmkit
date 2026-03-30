export const runtime = 'edge';

import { PublicNavStatic } from '@/components/public-nav-static';
import { PublicFooter } from '@/components/public-footer';
import { Calculator } from './calculator';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LLM Cost Calculator - Compare AI API Costs Across Models | LLMKit',
  description: 'Calculate and compare AI API costs across 730+ models from 11 providers. Enter your token usage, pick models, see the real cost. Free, no signup.',
  openGraph: {
    title: 'LLM Cost Calculator - Compare AI Model Costs',
    description: 'Enter tokens, compare costs across OpenAI, Anthropic, Google Gemini, xAI Grok, DeepSeek, and more.',
  },
};

interface ModelPrice {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
}

async function getPricing(): Promise<ModelPrice[]> {
  const { PRICING } = await import('@f3d1/llmkit-shared');

  const models: ModelPrice[] = [];
  for (const [provider, providerModels] of Object.entries(PRICING)) {
    for (const [model, p] of Object.entries(providerModels)) {
      models.push({
        provider,
        model,
        input: p.inputPerMillion,
        output: p.outputPerMillion,
        cacheRead: p.cacheReadPerMillion,
      });
    }
  }
  models.sort((a, b) => a.input - b.input);
  return models;
}

export default async function ComparePage() {
  const models = await getPricing();
  const providers = [...new Set(models.map(m => m.provider))].sort();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <PublicNavStatic />
      <div className="mx-auto max-w-6xl px-6 pt-12 pb-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          LLM Cost Calculator
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          Enter your expected token usage. See what it costs across {models.length} models from {providers.length} providers.
        </p>
        <Calculator models={models} providers={providers} />

        <div className="mt-16 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
          <h2 className="text-lg font-semibold">Stop guessing, start tracking</h2>
          <p className="mt-2 text-sm text-zinc-400">
            LLMKit tracks actual costs per request, per session, per user.
            Budget limits reject requests before they reach the provider.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <a href="/sign-up" className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
              Get started free
            </a>
            <a href="/pricing" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition">
              Full pricing table
            </a>
          </div>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
