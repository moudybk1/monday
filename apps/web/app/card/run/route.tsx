import { ImageResponse } from 'next/og';
import { MARKETS } from '@monday/core';
import { DUSK_BARS, DUSK_SUN, LETTERS } from '@/components/ui';

// The shareable result card: the Run Summary popup shows this image, and Download, Copy and Share hand out the same
// PNG. Everything on it arrives preformatted in the query, so the card holds nothing the popup did not already show.

const W = 1200, H = 675;
const BG = '#090a0e', FG = '#e7e9ee', FG2 = '#a4abb9', FG3 = '#6b7280', ACCENT = '#a3b3ee', LINE = 'rgba(255,255,255,0.08)';
const UP = '#3fd29a', DOWN = '#f2657a';

const clip = (s: string | null, n: number) => (s ?? '').slice(0, n);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const sym = (MARKETS as readonly string[]).includes(q.get('sym') ?? '') ? q.get('sym')! : null;
  const title = clip(q.get('t'), 40);
  const tag = clip(q.get('tag'), 40);
  const side = q.get('side') === 'long' ? 'Long' : q.get('side') === 'short' ? 'Short' : null;
  const big = clip(q.get('big'), 16);
  const sub = clip(q.get('sub'), 48);
  const foot = clip(q.get('foot'), 80);
  const paper = q.get('paper') === '1';
  const dir = q.get('up'); // '1' up, '0' down, anything else flat
  const tone = dir === '1' ? UP : dir === '0' ? DOWN : FG;
  const stats = q.getAll('st').slice(0, 4).map((s) => {
    const [k, v] = s.split('|');
    return [clip(k, 18), clip(v, 18)] as const;
  });
  const glow = dir === '1' ? 'rgba(63,210,154,0.22)' : dir === '0' ? 'rgba(242,101,122,0.20)' : 'rgba(163,179,238,0.18)';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 64px',
          background: BG, color: FG, fontFamily: 'sans-serif',
          backgroundImage: `radial-gradient(circle at 85% 30%, ${glow} 0%, rgba(0,0,0,0) 55%), radial-gradient(circle at 0% 100%, rgba(163,179,238,0.10) 0%, rgba(0,0,0,0) 45%)`,
        }}
      >
        {/* The brand lockup, and the honest label when no real money moved. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <svg height={40} viewBox="0 -72.75 438.85 93.16" width={189}>
            <g fill={ACCENT} transform="translate(-15.65,-71.52) scale(1.5647)">
              <path d={DUSK_SUN} />
              {DUSK_BARS.map(([x, y, w, o]) => <rect key={y} x={x} y={y} width={w} height={4} rx={2} opacity={o} />)}
            </g>
            <path fill={FG} transform="translate(89.3,0)" d={LETTERS} />
          </svg>
          {paper && (
            <div style={{ display: 'flex', fontSize: 22, color: '#e8c56a', border: '2px solid rgba(232,197,106,0.5)', borderRadius: 8, padding: '6px 14px' }}>Paper Trading</div>
          )}
        </div>

        {/* What ran, and what it made. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {sym && <img src={`${url.origin}/coins/${sym}.png`} width={56} height={56} style={{ borderRadius: 28 }} />}
            <span style={{ display: 'flex', gap: 14, fontSize: 44, fontWeight: 700 }}>
              <span>{title}</span>
              {side && <span style={{ color: side === 'Long' ? UP : DOWN }}>{side}</span>}
            </span>
            {tag && <span style={{ display: 'flex', fontSize: 24, color: ACCENT, background: 'rgba(163,179,238,0.12)', border: '2px solid rgba(163,179,238,0.35)', borderRadius: 8, padding: '6px 14px' }}>{tag}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 28, marginTop: 22 }}>
            <span style={{ fontSize: 132, fontWeight: 800, letterSpacing: -4, lineHeight: 1, color: tone }}>{big}</span>
            {sub && <span style={{ fontSize: 34, color: FG2 }}>{sub}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {stats.length > 0 && (
            <div style={{ display: 'flex', borderTop: `2px solid ${LINE}`, borderBottom: `2px solid ${LINE}` }}>
              {stats.map(([k, v], i) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '18px 0 18px', paddingLeft: i ? 28 : 0, borderLeft: i ? `2px solid ${LINE}` : 'none' }}>
                  <span style={{ fontSize: 20, color: FG3, textTransform: 'uppercase', letterSpacing: 1.5 }}>{k}</span>
                  <span style={{ fontSize: 34, fontWeight: 600, marginTop: 6 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 22, color: FG2 }}>
            <span>{foot}</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <span>The AI trading terminal for Perpl</span>
              <span style={{ color: FG }}>mondaytrade.xyz</span>
            </span>
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  );
}
