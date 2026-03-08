import { auth } from '@clerk/nextjs/server';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { ensureAccount } from '@/lib/queries';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const adminIds = process.env.ADMIN_USER_ID?.split(',') ?? [];
  const isAdmin = !!userId && adminIds.includes(userId);

  if (userId) {
    try {
      await ensureAccount(userId);
    } catch {
      // supabase might be down - don't block the dashboard
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <div className="ml-56 flex flex-1 flex-col">
        <Header />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
