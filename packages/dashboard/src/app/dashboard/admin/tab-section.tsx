interface TabSectionProps {
  title: string;
  freshness?: string;
  children: React.ReactNode;
}

function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TabSection({ title, freshness, children }: TabSectionProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">{title}</h2>
        {freshness && (
          <span className="text-[10px] text-zinc-600">Updated {timeAgoShort(freshness)}</span>
        )}
      </div>
      {children}
    </div>
  );
}
