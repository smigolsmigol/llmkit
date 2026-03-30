'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-lg font-medium text-destructive">Something went wrong</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
