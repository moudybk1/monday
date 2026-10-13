import { ImageResponse } from 'next/og';

// The card a shared link shows on X, Discord, Telegram and the like. Drawn here so it stays in step with the site's copy.
export const alt = 'Monday, the AI trading terminal for Perpl';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const FG = '#e9ebee', FG2 = '#a3a9b2', ACCENT = '#ffa630', BG = '#060708';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: BG, color: FG, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 32, fontWeight: 700 }}>
          <div style={{ width: 30, height: 30, borderRadius: 999, background: ACCENT }} />
          <span>Monday</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 76, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
            <span>The AI trading terminal for&nbsp;</span>
            <span style={{ color: ACCENT }}>Perpl.</span>
          </div>
          <div style={{ display: 'flex', fontSize: 30, lineHeight: 1.35, color: FG2, maxWidth: 1000 }}>
            <span>Make markets, scalp a bias, or build a position in slices, from your own Perpl account and inside your limits. Kimi is the risk governor.</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, color: FG2 }}>
          <div style={{ display: 'flex', gap: 34 }}>
            <span>Market maker</span>
            <span>Agentic Trade</span>
            <span>TWAP</span>
            <span>Perpl analytics</span>
          </div>
          <span style={{ color: FG }}>mondaytrade.xyz</span>
        </div>
      </div>
    ),
    size,
  );
}
