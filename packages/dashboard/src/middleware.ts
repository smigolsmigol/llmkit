import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const isStaticPublicRoute = createRouteMatcher(['/', '/mcp', '/docs', '/pricing', '/compare', '/providers(.*)', '/guides(.*)', '/opengraph-image(.*)']);

export default function middleware(req: NextRequest) {
  // static public routes skip Clerk entirely for faster TTFB
  if (isStaticPublicRoute(req)) return NextResponse.next();

  // auth routes (sign-in, sign-up, dashboard) go through Clerk
  return clerkMiddleware(async (auth, r) => {
    const isAuthPage = r.nextUrl.pathname.startsWith('/sign-in') || r.nextUrl.pathname.startsWith('/sign-up');
    if (!isAuthPage) {
      await auth.protect({ unauthenticatedUrl: new URL('/sign-in', r.url).toString() });
    }
  })(req, {} as never);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)',
    '/(api|trpc)(.*)',
  ],
};
