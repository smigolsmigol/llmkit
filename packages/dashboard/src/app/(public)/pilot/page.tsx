import type { Metadata } from 'next';
import { PublicFooter } from '@/components/public-footer';
import { PublicNavStatic } from '@/components/public-nav-static';

export const metadata: Metadata = {
  title: 'Agent Cost-Control Pilot | LLMKit',
  description: 'A 14-day implementation to attribute AI spend, find cost leaks, and install hard budget controls.',
};

const deliverables = [
  'Instrument one production AI workflow',
  'Attribute spend by customer, feature, agent, and session',
  'Identify retry, context, and model-selection waste',
  'Install hard limits and runaway-spend safeguards',
  'Deliver an economic-risk and savings report',
];

export default function PilotPage() {
  const subject = encodeURIComponent('LLMKit Agent Cost-Control Pilot');
  const body = encodeURIComponent('Company:\nAI product:\nApproximate monthly model spend:\nCurrent gateway/observability stack:\nBest contact method:');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <PublicNavStatic />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-sm font-medium text-violet-400">14-day paid implementation</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Find where your AI margin leaks before the next invoice.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
          LLMKit instruments one real workflow, shows which customers and agents generate each cost,
          and installs safeguards that stop runaway spending before provider calls execute.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold">What you receive</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-300">
              {deliverables.map((item) => <li key={item}>✓ {item}</li>)}
            </ul>
          </section>
          <section className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-6">
            <h2 className="text-lg font-semibold">Best fit</h2>
            <p className="mt-4 text-sm leading-relaxed text-zinc-300">
              AI SaaS teams spending $2k–$50k monthly on model APIs, especially teams that charge a
              flat subscription and cannot calculate model cost per customer or feature.
            </p>
            <p className="mt-4 text-sm text-zinc-400">
              Founding pilot pricing is scoped after a 20-minute technical call. Private deployment is available.
            </p>
          </section>
        </div>

        <div className="mt-10 rounded-xl border border-white/[0.08] bg-white/[0.02] p-7">
          <h2 className="text-xl font-semibold">Start with a 20-minute cost-control review</h2>
          <p className="mt-2 text-sm text-zinc-400">Send the five details below. No provider keys or sensitive traces are needed for the first call.</p>
          <a
            href={`mailto:smigolsmigol@protonmail.com?subject=${subject}&body=${body}`}
            className="mt-6 inline-flex rounded-lg bg-violet-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            Apply for a pilot
          </a>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
