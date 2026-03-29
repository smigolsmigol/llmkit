import { PublicNav } from '@/components/public-nav';
import { PublicFooter } from '@/components/public-footer';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

const PROVIDERS = [
  'openai', 'anthropic', 'gemini', 'xai', 'groq', 'together',
  'fireworks', 'deepseek', 'mistral', 'ollama', 'openrouter',
] as const;

type ProviderSlug = (typeof PROVIDERS)[number];

const DISPLAY_NAMES: Record<ProviderSlug, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  xai: 'xAI (Grok)',
  groq: 'Groq',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

const DESCRIPTIONS: Record<ProviderSlug, string> = {
  openai: 'GPT-4o, GPT-4.1, o3, o4-mini and all OpenAI models',
  anthropic: 'Claude Opus, Sonnet, Haiku and all Anthropic models',
  gemini: 'Gemini 2.5 Pro, Flash, and all Google AI models',
  xai: 'Grok 3, Grok 3 Mini, and all xAI models',
  groq: 'LLaMA, Mixtral, Gemma on Groq inference hardware',
  together: 'Open-source models on Together AI infrastructure',
  fireworks: 'LLaMA, Mixtral, and open models on Fireworks AI',
  deepseek: 'DeepSeek V3, R1, and all DeepSeek models',
  mistral: 'Mistral Large, Medium, Small, and Codestral models',
  ollama: 'Local models via Ollama (free, self-hosted)',
  openrouter: 'Multi-provider routing with unified API',
};

interface ModelPrice {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
}

async function getProviderModels(provider: string): Promise<ModelPrice[]> {
  const { PRICING } = await import('@f3d1/llmkit-shared');
  const providerData = PRICING[provider as keyof typeof PRICING];
  if (!providerData) return [];

  const models: ModelPrice[] = [];
  for (const [model, p] of Object.entries(providerData)) {
    models.push({
      model,
      input: p.inputPerMillion,
      output: p.outputPerMillion,
      cacheRead: p.cacheReadPerMillion,
    });
  }
  models.sort((a, b) => a.input - b.input);
  return models;
}

export function generateStaticParams() {
  return PROVIDERS.map((name) => ({ name }));
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const slug = name as ProviderSlug;
  if (!PROVIDERS.includes(slug)) return {};

  const display = DISPLAY_NAMES[slug];
  const models = await getProviderModels(slug);
  const desc = DESCRIPTIONS[slug];

  return {
    title: `${display} API Pricing 2026 - All ${models.length} Models | LLMKit`,
    description: `${display} API pricing for ${models.length} models. ${desc}. Compare input, output, and cache token costs per 1M tokens.`,
    openGraph: {
      title: `${display} API Pricing 2026 - ${models.length} Models`,
      description: `Compare costs across all ${display} models. ${desc}.`,
    },
  };
}

export default async function ProviderPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const slug = name as ProviderSlug;

  if (!PROVIDERS.includes(slug)) notFound();

  const models = await getProviderModels(slug);
  const display = DISPLAY_NAMES[slug];
  const desc = DESCRIPTIONS[slug];

  const cheapest = models[0];
  const mostExpensive = models[models.length - 1];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <PublicNav />

      <div className="mx-auto max-w-6xl px-6 pt-12 pb-16">
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
          <Link href="/pricing" className="hover:text-zinc-300 transition">All providers</Link>
          <span>/</span>
          <span className="text-zinc-300">{display}</span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {display} API Pricing
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          {models.length} models. {desc}. Prices per 1M tokens in USD.
        </p>

        {models.length > 1 && cheapest && mostExpensive && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-xs text-zinc-500">Cheapest input</p>
              <p className="mt-1 text-lg font-semibold">${cheapest.input}<span className="text-sm text-zinc-500">/1M</span></p>
              <p className="text-xs text-zinc-400 font-mono truncate">{cheapest.model}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-xs text-zinc-500">Most expensive input</p>
              <p className="mt-1 text-lg font-semibold">${mostExpensive.input}<span className="text-sm text-zinc-500">/1M</span></p>
              <p className="text-xs text-zinc-400 font-mono truncate">{mostExpensive.model}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-xs text-zinc-500">Models with cache pricing</p>
              <p className="mt-1 text-lg font-semibold">{models.filter(m => m.cacheRead).length}<span className="text-sm text-zinc-500"> of {models.length}</span></p>
            </div>
          </div>
        )}

        <section className="mt-10">
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
                {models.map(m => (
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

        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link href="/pricing" className="text-violet-400 hover:text-violet-300 transition">
            View all providers
          </Link>
          <span className="text-zinc-600">|</span>
          <Link href="/compare" className="text-violet-400 hover:text-violet-300 transition">
            Cost calculator
          </Link>
          <span className="text-zinc-600">|</span>
          <a
            href="https://llmkit-proxy.smigolsmigol.workers.dev/v1/pricing/compare?input=1000&output=500"
            className="text-violet-400 hover:text-violet-300 transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            Pricing API
          </a>
        </div>

        <div className="mt-16 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
          <h2 className="text-lg font-semibold">Track {display} costs with LLMKit</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Proxy your {display} requests through LLMKit. Every call gets logged with token counts, dollar costs,
            and session attribution. Set budget limits that actually reject requests before they hit the provider.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <a href="/sign-up" className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
              Get started free
            </a>
            <a href="https://github.com/smigolsmigol/llmkit" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition" target="_blank" rel="noopener noreferrer">
              View source
            </a>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
