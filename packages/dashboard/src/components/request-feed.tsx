import Link from 'next/link';
import { type RequestRow } from '@/lib/queries';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatCost(cents: number) {
  return `$${(cents / 100).toFixed(4)}`;
}

export function RequestFeed({ requests }: { requests: RequestRow[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          <span className="font-mono text-xs text-muted-foreground">request.log</span>
        </div>
        <Link
          href="/dashboard/requests"
          className="text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          View all -&gt;
        </Link>
      </div>
      <div className="overflow-x-auto p-3 font-mono text-xs leading-6">
        {requests.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            No requests yet. Send your first request through LLMKit.
          </p>
        ) : (
          requests.map((req) => (
            <div key={req.id} className="flex gap-3 whitespace-nowrap">
              <span className="text-muted-foreground">[{formatTime(req.created_at)}]</span>
              <span className="text-foreground">{req.provider}/{req.model}</span>
              <span className="text-muted-foreground">
                {(req.input_tokens + req.output_tokens).toLocaleString()}tok
              </span>
              <span className="text-primary">{formatCost(Number(req.cost_cents))}</span>
              <span className="text-muted-foreground">{req.latency_ms}ms</span>
              <span className={req.status === 'error' ? 'text-destructive' : 'text-emerald-500'}>
                {req.status === 'error' ? 'ERR' : 'OK'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
