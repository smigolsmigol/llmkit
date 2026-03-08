import { auth } from '@clerk/nextjs/server';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { ensureAccount, getAccountPlan } from '@/lib/queries';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();

  if (userId) {
    try {
      await ensureAccount(userId);
    } catch {
      // supabase might be down - don't block the dashboard
    }
  }

  const plan = userId ? await getAccountPlan(userId) : null;
  const isAdmin = plan === 'admin';

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <div className="ml-56 flex flex-1 flex-col">
        <Header />
        <main className="flex-1 px-3 py-2">{children}</main>
      </div>
    </div>
  );
}
