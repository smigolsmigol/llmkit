import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isDashboard = createRouteMatcher(['/dashboard(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isDashboard(req)) {
    await auth.protect({
      unauthenticatedUrl: new URL('/sign-in', req.url).toString(),
    });
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)',
    '/(api|trpc)(.*)',
  ],
};
