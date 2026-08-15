import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { collectEcosystemAnalytics } from '@/lib/ecosystem-analytics';
import { getAccountPlan } from '@/lib/queries';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const plan = await getAccountPlan(userId);
  if (plan !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json(await collectEcosystemAnalytics());
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 502 });
  }
}
