
import type { Metadata } from 'next';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';
import { TrackClick } from '@/components/track-event';
import {
  getPublicPricingModels,
  getPublicPricingProviders,
  PRICING_SNAPSHOT_DATE,
} from '@/lib/public-pricing';
import { RECOVERY_PUBLIC_CTA } from '@/lib/public-recovery';

export function generateMetadata(): Metadata {
  const models = getPublicPricingModels();
  const providers = getPublicPricingProviders(models);
  const description = `Reference input and output rates for ${models.length} model entries across ${providers.length} populated provider tables. Bundled snapshot dated ${PRICING_SNAPSHOT_DATE}; model modality is not encoded.`;

  return {
    title: `LLM API pricing reference - ${models.length} model entries | LLMKit`,
    description,
    openGraph: {
      title: 'LLM API pricing reference | LLMKit',
      description,
    },
  };
}

export default function PricingPage() {
  const models = getPublicPricingModels();
  const providers = getPublicPricingProviders(models);

  return (
    <PublicShell>
      <PublicPageHero
        eyebrow={`Pricing index / snapshot ${PRICING_SNAPSHOT_DATE}`}
        title="Provider pricing without the tab graveyard."
        description={<>{models.length} priced model entries across {providers.length} populated provider tables. The bundled schema exposes input and output rates but does not encode model modality.</>}
        aside={(
          <a href="https://api.llmkit.sh/v1/pricing/compare?input=1000&output=500" className="public-panel-soft block rounded-xl p-4 font-mono text-[10px] leading-5 text-zinc-500 transition hover:border-violet-300/25 hover:text-zinc-300">
            <span className="text-cyan-300">GET</span> /v1/pricing/compare<br />programmatic access
          </a>
        )}
      />

      <div className="mx-auto max-w-6xl px-6 pb-16">
        <div className="public-panel-soft rounded-lg px-4 py-3 text-xs leading-5 text-zinc-500">
          This is a bundled reference snapshot dated {PRICING_SNAPSHOT_DATE}, not a live quote. For text models, interpret the /1M columns as token rates only after verifying the provider's billing unit. Non-text modalities may use different units that this snapshot does not represent.
        </div>

        {providers.map(provider => {
          const providerModels = models.filter(m => m.provider === provider);
          return (
            <section key={provider} className="mt-10" id={provider}>
              <h2 className="text-xl font-semibold capitalize mb-3"><a href={`/providers/${provider}`} className="hover:text-violet-400 transition">{provider}</a></h2>
              <p className="text-xs text-zinc-500 mb-2">{providerModels.length} models</p>
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
                    {providerModels.map(m => (
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
          );
        })}

        <div className="public-panel mt-16 rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold">Move from list-price estimates to request evidence</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Local clients can estimate supported responses from returned usage. The gateway path adds request identity,
            persisted cost evidence, and pre-dispatch budget checks for existing authenticated accounts.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <TrackClick event="cta_click" properties={{ label: "local_setup", location: "pricing" }} href={RECOVERY_PUBLIC_CTA.href} className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
              {RECOVERY_PUBLIC_CTA.label}
            </TrackClick>
            <TrackClick event="cta_click" properties={{ label: "view_source", location: "pricing" }} href="https://github.com/smigolsmigol/llmkit" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition" target="_blank" rel="noopener noreferrer">
              View source
            </TrackClick>
          </div>
        </div>
      </div>

    </PublicShell>
  );
}
