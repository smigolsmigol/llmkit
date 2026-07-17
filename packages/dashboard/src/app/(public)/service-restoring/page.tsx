export const metadata = {
  title: 'Dashboard restoration in progress | LLMKit',
  robots: { index: false, follow: false },
};

export default function ServiceRestoringPage() {
  return (
    <main className="noise-overlay relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,_rgba(124,58,237,0.16),_transparent_68%)]" />
      <section className="relative w-full max-w-2xl rounded-2xl border border-violet-400/20 bg-card/90 p-8 shadow-2xl shadow-violet-950/30 backdrop-blur md:p-12">
        <div className="mb-7 flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300">
            Controlled restoration
          </span>
        </div>

        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          The public site is back. The dashboard is next.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
          We are moving LLMKit onto its new production stack. Authenticated data access stays closed
          until its tenant-isolation checks pass in the new runtime.
        </p>

        <div className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <div className="font-mono text-xs text-emerald-400">LIVE</div>
            <div className="mt-1 text-muted-foreground">Docs and product site</div>
          </div>
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <div className="font-mono text-xs text-emerald-400">LIVE</div>
            <div className="mt-1 text-muted-foreground">API proxy</div>
          </div>
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <div className="font-mono text-xs text-amber-300">VERIFYING</div>
            <div className="mt-1 text-muted-foreground">Dashboard and auth</div>
          </div>
        </div>

        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="/"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-0.5 hover:bg-primary/90"
          >
            Back to LLMKit
          </a>
          <a
            href="/docs"
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-violet-400/40 hover:bg-secondary"
          >
            Read the docs
          </a>
        </div>
      </section>
    </main>
  );
}
