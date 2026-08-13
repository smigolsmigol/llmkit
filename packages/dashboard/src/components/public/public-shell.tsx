import { PublicFooter } from '@/components/public-footer';
import { PublicNavStatic } from '@/components/public-nav-static';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell selection:bg-violet-400/25">
      <div aria-hidden="true" className="public-grid" />
      <a href="#main-content" className="public-skip-link">
        Skip to main content
      </a>
      <PublicNavStatic />
      <main id="main-content" tabIndex={-1} className="relative">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
