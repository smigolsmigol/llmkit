import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';
import { getPublicProviderModels, PRICING_SNAPSHOT_DATE } from '@/lib/public-pricing';
import { RECOVERY_PUBLIC_CTA } from '@/lib/public-recovery';

const PROVIDERS = [
  'openai', 'anthropic', 'gemini', 'xai', 'groq', 'together',
  'fireworks', 'deepseek', 'mistral',
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
};

const DESCRIPTIONS: Record<ProviderSlug, string> = {
  openai: 'OpenAI entries in the bundled pricing snapshot',
  anthropic: 'Anthropic entries in the bundled pricing snapshot',
  gemini: 'Google Gemini entries in the bundled pricing snapshot',
  xai: 'xAI entries in the bundled pricing snapshot',
  groq: 'Groq-hosted entries in the bundled pricing snapshot',
  together: 'Together AI entries in the bundled pricing snapshot',
  fireworks: 'Fireworks AI entries in the bundled pricing snapshot',
  deepseek: 'DeepSeek entries in the bundled pricing snapshot',
  mistral: 'Mistral entries in the bundled pricing snapshot',
};

interface ModelPrice {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
}

function getProviderModels(provider: string): ModelPrice[] {
  return getPublicProviderModels(provider);
}

export function generateStaticParams() {
  return PROVIDERS.map((name) => ({ name }));
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const slug = name as ProviderSlug;
  if (!PROVIDERS.includes(slug)) return {};

  const display = DISPLAY_NAMES[slug];
  const models = getProviderModels(slug);
  const desc = DESCRIPTIONS[slug];

  return {
    title: `${display} API pricing reference - ${models.length} entries | LLMKit`,
    description: `${display} reference pricing for ${models.length} model entries. Snapshot dated ${PRICING_SNAPSHOT_DATE}. Source rate fields are shown as encoded; model modality is not encoded.`,
    openGraph: {
      title: `${display} API pricing reference | LLMKit`,
      description: `${desc}. Bundled snapshot dated ${PRICING_SNAPSHOT_DATE}.`,
    },
  };
}

export default async function ProviderPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const slug = name as ProviderSlug;

  if (!PROVIDERS.includes(slug)) notFound();

  const models = getProviderModels(slug);
  const display = DISPLAY_NAMES[slug];
  const desc = DESCRIPTIONS[slug];

  const cheapest = models[0];
  const mostExpensive = models[models.length - 1];

  return (
    <PublicShell>
      <PublicPageHero
        eyebrow={`Pricing / ${display}`}
        title={`${display} API pricing`}
        description={<>{models.length} model entries. {desc}. Source rate fields are shown as encoded in the snapshot dated {PRICING_SNAPSHOT_DATE}; model modality is not encoded.</>}
        aside={(
          <Link href="/pricing" className="public-panel-soft block rounded-xl p-4 font-mono text-[10px] leading-5 text-zinc-500 transition hover:border-violet-300/25 hover:text-zinc-300">
            pricing index<br /><span className="text-violet-300">all providers -&gt;</span>
          </Link>
        )}
      />

      <div className="mx-auto max-w-6xl px-6 pb-16">

        {models.length > 1 && cheapest && mostExpensive && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="public-panel-soft rounded-lg p-4">
              <p className="text-xs text-zinc-500">Lowest encoded input rate</p>
              <p className="mt-1 text-lg font-semibold">${cheapest.input}<span className="text-sm text-zinc-500">/1M</span></p>
              <p className="text-xs text-zinc-400 font-mono truncate">{cheapest.model}</p>
            </div>
            <div className="public-panel-soft rounded-lg p-4">
              <p className="text-xs text-zinc-500">Highest encoded input rate</p>
              <p className="mt-1 text-lg font-semibold">${mostExpensive.input}<span className="text-sm text-zinc-500">/1M</span></p>
              <p className="text-xs text-zinc-400 font-mono truncate">{mostExpensive.model}</p>
            </div>
            <div className="public-panel-soft rounded-lg p-4">
              <p className="text-xs text-zinc-500">Models with cache pricing</p>
              <p className="mt-1 text-lg font-semibold">{models.filter(m => m.cacheRead !== undefined).length}<span className="text-sm text-zinc-500"> of {models.length}</span></p>
            </div>
          </div>
        )}

        <section className="mt-10">
          <p className="mb-3 text-xs leading-5 text-zinc-500">
            Interpret the /1M columns as token rates only for models independently verified as token-billed. Non-text billing units are not represented in this snapshot schema.
          </p>
          <div className="public-panel-soft overflow-x-auto rounded-lg">
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
                    <td className="px-3 py-1.5 text-right text-zinc-500">{m.cacheRead !== undefined ? `$${m.cacheRead}` : '-'}</td>
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
            href="https://api.llmkit.sh/v1/pricing/compare?input=1000&output=500"
            className="text-violet-400 hover:text-violet-300 transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            Pricing API
          </a>
        </div>

        <div className="public-panel mt-16 rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold">Use the {display} snapshot as a reference, then measure the request</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Local tracking can estimate supported responses from provider usage fields. The authenticated gateway path adds
            request identity, persisted cost evidence, session attribution, and pre-dispatch budget checks.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href={RECOVERY_PUBLIC_CTA.href} className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
              {RECOVERY_PUBLIC_CTA.label}
            </Link>
            <a href="https://github.com/smigolsmigol/llmkit" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition" target="_blank" rel="noopener noreferrer">
              View source
            </a>
          </div>
        </div>
      </div>

    </PublicShell>
  );
}
