import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
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

  const apiUrl = process.env.ANALYTICS_API_URL;
  const apiKey = process.env.ANALYTICS_API_KEY;

  if (!apiUrl) {
    return NextResponse.json({ error: 'analytics not configured' }, { status: 503 });
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${apiUrl}/api/analytics/overview`, {
      headers,
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 502 });
  }
}
