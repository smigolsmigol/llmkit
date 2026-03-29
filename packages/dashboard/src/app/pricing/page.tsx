export const runtime = 'edge';

import { PublicNav } from '@/components/public-nav';
import { PublicFooter } from '@/components/public-footer';
import { TrackClick } from '@/components/track-event';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LLM API Pricing Comparison 2026 - 730+ Models, 11 Providers | LLMKit',
  description: 'Compare AI API pricing across OpenAI, Anthropic, Google Gemini, xAI Grok, DeepSeek, Mistral, Groq, and more. 730+ models with input, output, and cache token costs.',
  openGraph: {
    title: 'LLM API Pricing Comparison 2026 - All Models',
    description: 'Compare costs across 730+ AI models from 11 providers. Updated weekly.',
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

export default async function PricingPage() {
  const models = await getPricing();
  const providers = [...new Set(models.map(m => m.provider))].sort();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <PublicNav />

      <div className="mx-auto max-w-6xl px-6 pt-12 pb-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          LLM API Pricing Comparison
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          {models.length} models across {providers.length} providers. Prices per 1M tokens in USD. Updated weekly.
        </p>

        <p className="mt-2 text-sm text-zinc-500">
          Providers: {providers.join(', ')}. Data sourced from official pricing pages.
          Use the <a href="https://llmkit-proxy.smigolsmigol.workers.dev/v1/pricing/compare?input=1000&output=500" className="text-violet-400 hover:text-violet-300">free API</a> for programmatic access.
        </p>

        {providers.map(provider => {
          const providerModels = models.filter(m => m.provider === provider);
          return (
            <section key={provider} className="mt-10" id={provider}>
              <h2 className="text-xl font-semibold capitalize mb-3">{provider}</h2>
              <p className="text-xs text-zinc-500 mb-2">{providerModels.length} models</p>
              <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-xs text-zinc-500">
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium text-right">Input $/1M</th>
                      <th className="px-3 py-2 font-medium text-right">Output $/1M</th>
                      <th className="px-3 py-2 font-medium text-right">Cache $/1M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerModels.map(m => (
                      <tr key={m.model} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-3 py-1.5 font-mono text-xs">{m.model}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">${m.input}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-300">${m.output}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-500">{m.cacheRead ? `$${m.cacheRead}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        <div className="mt-16 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
          <h2 className="text-lg font-semibold">Track what your AI agents actually cost</h2>
          <p className="mt-2 text-sm text-zinc-400">
            LLMKit sits between your app and AI providers. Every request gets logged with token counts and dollar costs.
            Budget limits reject requests before they reach the provider.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <TrackClick event="cta_click" properties={{ label: "sign_up", location: "pricing" }} href="/sign-up" className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
              Get started free
            </TrackClick>
            <TrackClick event="cta_click" properties={{ label: "view_source", location: "pricing" }} href="https://github.com/smigolsmigol/llmkit" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition" target="_blank" rel="noopener noreferrer">
              View source
            </TrackClick>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
