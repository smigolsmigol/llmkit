import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'LLMKit - Track what your AI agents spend';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0a0a0a',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* purple glow */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 600,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(192,132,252,0.15), transparent 70%)',
          }}
        />

        {/* title */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '-2px',
            display: 'flex',
            gap: 16,
          }}
        >
          <span>LLM</span>
          <span style={{ color: '#c084fc' }}>Kit</span>
        </div>

        {/* subtitle */}
        <div
          style={{
            fontSize: 28,
            color: '#a1a1aa',
            marginTop: 16,
          }}
        >
          Track what your AI agents spend.
        </div>

        {/* badges */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 32,
          }}
        >
          {['11 providers', '730+ models', '11 MCP tools', 'MIT licensed'].map((t) => (
            <div
              key={t}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.03)',
                color: '#a1a1aa',
                fontSize: 16,
              }}
            >
              {t}
            </div>
          ))}
        </div>

        {/* bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            color: '#52525b',
            fontSize: 16,
          }}
        >
          github.com/smigolsmigol/llmkit
        </div>
      </div>
    ),
    { ...size },
  );
}
