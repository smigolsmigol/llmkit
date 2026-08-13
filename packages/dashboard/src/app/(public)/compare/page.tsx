
import type { Metadata } from 'next';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';
import {
  getPublicPricingModels,
  getPublicPricingProviders,
  PRICING_SNAPSHOT_DATE,
} from '@/lib/public-pricing';
import { RECOVERY_PUBLIC_CTA } from '@/lib/public-recovery';
import { Calculator } from './calculator';

export function generateMetadata(): Metadata {
  const models = getPublicPricingModels();
  const providers = getPublicPricingProviders(models);
  const description = `Estimate list cost for independently verified token-billed models from ${models.length} snapshot entries across ${providers.length} populated provider tables. The source does not encode modality.`;

  return {
    title: 'LLM text-token cost calculator | LLMKit',
    description,
    openGraph: {
      title: 'LLM text-token cost calculator | LLMKit',
      description,
    },
  };
}

export default function ComparePage() {
  const models = getPublicPricingModels();
  const providers = getPublicPricingProviders(models);

  return (
    <PublicShell>
      <PublicPageHero
        eyebrow="Calculator / scenario model"
        title="Turn verified token volume into an operating estimate."
        description={<>Search {models.length} snapshot entries across {providers.length} populated provider tables, then estimate only models independently verified as token-billed. The source does not encode modality.</>}
      />
      <div className="mx-auto max-w-6xl px-6 pb-16">
        <Calculator models={models} providers={providers} pricingSnapshotDate={PRICING_SNAPSHOT_DATE} />

        <div className="public-panel mt-16 rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold">An estimate is a planning input, not a receipt</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Local tracking uses returned usage to estimate supported calls. Gateway evidence adds per-request identity,
            sessions, and budget enforcement for existing authenticated accounts.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <a href={RECOVERY_PUBLIC_CTA.href} className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
              {RECOVERY_PUBLIC_CTA.label}
            </a>
            <a href="/pricing" className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-5 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition">
              Full pricing table
            </a>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
