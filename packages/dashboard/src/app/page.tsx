import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();
  redirect(userId ? '/dashboard' : '/sign-in');
}
