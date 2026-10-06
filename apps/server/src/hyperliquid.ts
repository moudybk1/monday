// Hyperliquid mid prices for the blended reference (Tread's Blend mode): Perpl's book is thin, Hyperliquid is where
// BTC, ETH and SOL perps are priced. Public endpoint, no key. Never started on the simulator, whose prices are made up.
// ponytail: 1 s REST poll; move to the allMids WebSocket if a second of lag starts to matter.

import { MARKETS, type MarketSym } from '@monday/core';

const URL = 'https://api.hyperliquid.xyz/info';
const STALE_MS = 5_000;
const mids: Partial<Record<MarketSym, { px: number; at: number }>> = {};

export function startHyperliquid() {
  const poll = async () => {
    try {
      const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(3_000) });
      if (res.ok) {
        const d = (await res.json()) as Record<string, string>;
        const now = Date.now();
        for (const s of MARKETS) {
          const px = Number(d[s]);
          if (px > 0) mids[s] = { px, at: now };
        }
      }
    } catch {
      // A missed poll only ages the price; past STALE_MS the engine quotes off Perpl alone.
    }
    setTimeout(poll, 1_000).unref();
  };
  void poll();
}

/** The latest Hyperliquid mid, or null when it is older than five seconds. */
export function hlMid(sym: MarketSym): number | null {
  const m = mids[sym];
  return m && Date.now() - m.at < STALE_MS ? m.px : null;
}
