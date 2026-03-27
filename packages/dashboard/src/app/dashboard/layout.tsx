import { auth } from '@clerk/nextjs/server';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { SupportWidget } from '@/components/support-widget';
import { ensureAccount } from '@/lib/queries';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();

  const account = userId ? await ensureAccount(userId).catch(() => null) : null;
  const isAdmin = account?.plan === 'admin';

  return (
    <div className="noise-overlay flex min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <div className="ml-56 flex flex-1 flex-col">
        <Header />
        <main className="relative flex-1 px-3 py-2">
          <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[400px] w-[700px] bg-[radial-gradient(ellipse,_rgba(124,58,237,0.05),_transparent_70%)]" />
          <div className="relative">{children}</div>
        </main>
      </div>
      <SupportWidget />
    </div>
  );
}
