import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pricingUrl = process.env.PRICING_API_URL;

  if (!pricingUrl) {
    return NextResponse.json({ error: 'pricing not configured' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const provider = searchParams.get('provider');
  const q = searchParams.get('q');

  let endpoint = `${pricingUrl}/api/pricing`;
  if (provider) {
    endpoint += `?provider=${encodeURIComponent(provider)}`;
  } else if (q) {
    endpoint += `?q=${encodeURIComponent(q)}`;
  }

  try {
    const res = await fetch(endpoint, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 3600 },
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
    return NextResponse.json({ error: 'pricing unavailable' }, { status: 502 });
  }
}
