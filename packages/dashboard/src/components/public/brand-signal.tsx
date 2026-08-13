import { AnimatedLogo } from '@/components/animated-logo';

const states = [
  ['01', 'identify', 'request bound'],
  ['02', 'reserve', 'budget held'],
  ['03', 'dispatch', 'provider called'],
  ['04', 'settle', 'receipt sealed'],
] as const;

export function BrandSignal() {
  return (
    <div className="signal-stage public-panel relative overflow-hidden rounded-2xl px-5 pb-5 pt-3 sm:px-7 sm:pb-7">
      <div className="signal-scan" aria-hidden="true" />
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-400">request signal</span>
        <span className="flex items-center gap-2 font-mono text-[9px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_9px_rgba(110,231,183,.6)]" />
          active
        </span>
      </div>

      <AnimatedLogo className="mx-auto my-4 h-auto w-full max-w-[300px] sm:my-5" motion="signal" />

      <div className="px-1">
        <div className="signal-track" aria-hidden="true" />
        <ol className="mt-3 grid grid-cols-4 gap-2">
          {states.map(([index, label, state]) => (
            <li key={label} className="signal-node min-w-0">
              <span className="font-mono text-[9px] text-zinc-500">{index}</span>
              <p className="mt-1 truncate font-mono text-[10px] text-zinc-300 sm:text-[11px]">{label}</p>
              <p className="mt-1 hidden text-[10px] text-zinc-400 sm:block">{state}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2.5 font-mono text-[10px]">
        <span className="text-zinc-400">decision</span>
        <span className="text-emerald-300">ALLOWED / BUDGET RESERVED</span>
      </div>
    </div>
  );
}
