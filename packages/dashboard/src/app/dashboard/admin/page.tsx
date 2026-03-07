import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getAllAccounts } from '@/lib/queries';
import { AccountTable } from './account-table';

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId || userId !== process.env.ADMIN_USER_ID) {
    redirect('/dashboard');
  }

  const accounts = await getAllAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {accounts.length} account{accounts.length !== 1 ? 's' : ''}
        </p>
      </div>
      <AccountTable accounts={accounts} />
    </div>
  );
}
