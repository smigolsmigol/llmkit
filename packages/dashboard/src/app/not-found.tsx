export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <a href="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
