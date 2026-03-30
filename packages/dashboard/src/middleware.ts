import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/', '/mcp', '/docs', '/pricing', '/compare', '/providers(.*)', '/guides(.*)', '/opengraph-image(.*)']);

export default function middleware(req: NextRequest) {
  // public routes skip Clerk entirely for faster TTFB
  if (isPublicRoute(req)) return NextResponse.next();

  // auth routes go through Clerk
  return clerkMiddleware(async (auth, r) => {
    await auth.protect({ unauthenticatedUrl: new URL('/sign-in', r.url).toString() });
  })(req, {} as never);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)',
    '/(api|trpc)(.*)',
  ],
};
