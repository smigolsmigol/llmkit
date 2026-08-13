
type S = React.CSSProperties;
type LogoMotion = 'intro' | 'signal';

const NEON = '#c084fc';
const CYAN = '#22d3ee';

const draw = (len: number, dur: number, delay: number, motion: LogoMotion): S => {
  if (motion === 'signal') {
    return {
      '--logo-path-length': len,
      strokeDasharray: len,
      strokeDashoffset: len,
      animation: `logo-signal-draw 8.8s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s infinite`,
    } as S;
  }

  return {
    strokeDasharray: len,
    strokeDashoffset: len,
    animation: `logo-draw ${dur}s ease-out ${delay}s forwards`,
  };
};

const node = (delay: number, motion: LogoMotion): S => {
  if (motion === 'signal') {
    return {
      opacity: 0,
      animation: `logo-signal-node 8.8s ease-in-out ${delay}s infinite`,
    };
  }

  return {
    opacity: 0,
    animation: `logo-fade 0.15s ease-out ${delay}s forwards, logo-pulse 3s ease-in-out ${delay + 0.8}s infinite`,
  };
};

export function AnimatedLogo({ className, motion = 'intro' }: { className?: string; motion?: LogoMotion }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="LLMKit"
      viewBox="0 0 290 115"
      fill="none"
      className={className}
      data-logo-motion={motion}
      style={{
        filter: 'drop-shadow(0 0 0px rgba(192,132,252,0))',
        animation: motion === 'signal'
          ? 'logo-signal-shell 8.8s ease-in-out infinite'
          : 'logo-surge 0.8s ease-out 1.9s forwards, logo-breathe 4s ease-in-out 3.5s infinite',
      }}
    >
      <defs>
        <filter id="neon" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <style>{`
        @keyframes logo-draw { to { stroke-dashoffset: 0 } }
        @keyframes logo-fade { to { opacity: 1 } }
        @keyframes logo-surge {
          0% { filter: drop-shadow(0 0 2px rgba(192,132,252,0.15)); }
          30% {
            filter: drop-shadow(0 0 8px rgba(192,132,252,0.5))
                    drop-shadow(0 0 18px rgba(34,211,238,0.2));
          }
          100% {
            filter: drop-shadow(0 0 4px rgba(192,132,252,0.25))
                    drop-shadow(0 0 10px rgba(34,211,238,0.06));
          }
        }
        @keyframes logo-breathe {
          0%, 100% {
            filter: drop-shadow(0 0 4px rgba(192,132,252,0.25))
                    drop-shadow(0 0 10px rgba(34,211,238,0.06));
          }
          50% {
            filter: drop-shadow(0 0 6px rgba(192,132,252,0.35))
                    drop-shadow(0 0 14px rgba(34,211,238,0.1));
          }
        }
        @keyframes logo-pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @keyframes logo-signal-draw {
          0%, 3% {
            stroke-dashoffset: var(--logo-path-length);
            opacity: 0.12;
          }
          14%, 72% {
            stroke-dashoffset: 0;
            opacity: 1;
          }
          74% { opacity: 0.42; }
          75.5%, 84% {
            stroke-dashoffset: 0;
            opacity: 1;
          }
          94%, 100% {
            stroke-dashoffset: var(--logo-path-length);
            opacity: 0.12;
          }
        }
        @keyframes logo-signal-node {
          0%, 10% { opacity: 0; }
          16%, 70% { opacity: 1; }
          72% { opacity: 0.25; }
          74%, 84% { opacity: 1; }
          92%, 100% { opacity: 0; }
        }
        @keyframes logo-signal-shell {
          0%, 100% {
            opacity: 0.68;
            filter: drop-shadow(0 0 2px rgba(192,132,252,0.12));
            transform: translateX(0);
          }
          14%, 72% {
            opacity: 1;
            filter: drop-shadow(0 0 5px rgba(192,132,252,0.32))
                    drop-shadow(0 0 13px rgba(34,211,238,0.1));
            transform: translateX(0);
          }
          73% { transform: translateX(-0.6px) skewX(-0.45deg); }
          74% { transform: translateX(0.8px) skewX(0.35deg); }
          75% { transform: translateX(0); }
          84% {
            opacity: 1;
            filter: drop-shadow(0 0 7px rgba(192,132,252,0.42))
                    drop-shadow(0 0 17px rgba(34,211,238,0.14));
          }
        }
        @media (prefers-reduced-motion: reduce) {
          svg { animation: none !important; }
          svg * { animation: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important; }
        }
      `}</style>

      <g filter="url(#neon)">
        {/* L1 */}
        <path d="M15 15 L15 78" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(63, 0.4, 0, motion)} />
        <path d="M15 78 L8 86" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(11, 0.15, 0.35, motion)} />
        <path d="M15 78 L38 78" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(23, 0.2, 0.35, motion)} />
        <circle cx="8" cy="86" r="2.5" fill={CYAN} style={node(0.45, motion)} />

        {/* L2 */}
        <path d="M38 15 L38 78" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(63, 0.4, 0.1, motion)} />
        <path d="M38 78 L31 86" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(11, 0.15, 0.45, motion)} />
        <path d="M38 78 L62 78" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(24, 0.2, 0.45, motion)} />
        <circle cx="31" cy="86" r="2.5" fill={CYAN} style={node(0.55, motion)} />

        {/* M */}
        <path d="M72 82 L72 15 L92 48 L112 15 L112 82" stroke={NEON} strokeWidth="5.5"
          strokeLinecap="square" strokeLinejoin="miter" fill="none"
          style={draw(212, 0.6, 0.65, motion)} />
        <path d="M72 82 L66 90" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(10, 0.15, 1.15, motion)} />
        <path d="M112 82 L118 90" stroke={NEON} strokeWidth="5.5" strokeLinecap="square"
          style={draw(10, 0.15, 1.15, motion)} />
        <circle cx="66" cy="90" r="2.5" fill={CYAN} style={node(1.25, motion)} />
        <circle cx="118" cy="90" r="2.5" fill={CYAN} style={node(1.25, motion)} />

        {/* K - hero, bolder */}
        <path d="M140 8 L140 92" stroke={NEON} strokeWidth="7.5" strokeLinecap="square"
          style={draw(84, 0.45, 1.3, motion)} />
        <path d="M140 50 L128 50" stroke={NEON} strokeWidth="4" strokeLinecap="square"
          style={draw(12, 0.15, 1.5, motion)} />
        <circle cx="126" cy="50" r="4" fill={CYAN} style={node(1.6, motion)} />
        <path d="M140 50 L182 5" stroke={NEON} strokeWidth="7.5" strokeLinecap="square"
          style={draw(62, 0.35, 1.6, motion)} />
        <path d="M140 50 L185 95" stroke={NEON} strokeWidth="7.5" strokeLinecap="square"
          style={draw(64, 0.35, 1.6, motion)} />

        {/* it - tilted */}
        <g transform="rotate(-45, 210, 70)">
          <rect x="195" y="22.5" width="6" height="6" rx="1" fill={CYAN} style={node(2.0, motion)} />
          <path d="M198 35 L198 70" stroke={NEON} strokeWidth="4.5" strokeLinecap="square"
            style={draw(35, 0.25, 2.05, motion)} />
          <path d="M218 17 L218 70" stroke={NEON} strokeWidth="4.5" strokeLinecap="square"
            style={draw(53, 0.3, 2.15, motion)} />
          <path d="M207 33 L229 33" stroke={NEON} strokeWidth="4.5" strokeLinecap="square"
            style={draw(22, 0.15, 2.25, motion)} />
        </g>
      </g>
    </svg>
  );
}
