// Hyperliquid over one public WebSocket, no key. Two things come from it:
// - Mid prices for the blended reference (Tread's Blend mode): Perpl's book is thin, Hyperliquid is where BTC, ETH and
//   SOL perps are priced.
// - The trade tape. Every print names its buyer and seller, so the collector sees a wallet Nansen labels as smart money
//   trade within a second (Nansen's own feed arrives one to four minutes later).
// Never started on the simulator, whose prices are made up.

import { MARKETS, type MarketSym } from '@monday/core';
import { openLink } from './venue/perpl/socket';

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const STALE_MS = 5_000;
const mids: Partial<Record<MarketSym, { px: number; at: number }>> = {};
let lastFrameAt = 0;

export interface HlTrade {
  sym: MarketSym;
  px: number;
  sz: number; // base units
  time: number; // ms
  hash: string; // one order's fills share it
  /** Trade id. Hyperliquid's docs name (time, coin, tid) as a trade's identity; the hash alone repeats across fills. */
  tid: number;
  buyer: string; // lowercase address
  seller: string;
}

export function startHyperliquid(onTrade: (t: HlTrade) => void = () => {}) {
  let ping: ReturnType<typeof setInterval> | undefined;
  const link = openLink(WS_URL, {
    open: () => {
      link.send({ method: 'subscribe', subscription: { type: 'allMids' } });
      for (const coin of MARKETS) link.send({ method: 'subscribe', subscription: { type: 'trades', coin } });
      // The server drops a connection that has sent nothing for a minute.
      clearInterval(ping);
      ping = setInterval(() => link.send({ method: 'ping' }), 30_000);
      ping.unref();
    },
    frame: (m) => {
      link.ok();
      lastFrameAt = Date.now();
      if (m.channel === 'allMids') {
        const now = Date.now();
        for (const s of MARKETS) {
          const px = Number(m.data?.mids?.[s]);
          if (px > 0) mids[s] = { px, at: now };
        }
      } else if (m.channel === 'trades') {
        for (const t of m.data ?? []) {
          if (!(MARKETS as readonly string[]).includes(t.coin)) continue;
          onTrade({ sym: t.coin, px: Number(t.px), sz: Number(t.sz), time: t.time, hash: String(t.hash), tid: Number(t.tid), buyer: String(t.users?.[0] ?? '').toLowerCase(), seller: String(t.users?.[1] ?? '').toLowerCase() });
        }
      }
    },
    closed: () => true, // always reconnect; past STALE_MS the engine quotes off Perpl alone
  });
}

/** The latest Hyperliquid mid, or null when it is older than five seconds. */
export function hlMid(sym: MarketSym): number | null {
  const m = mids[sym];
  return m && Date.now() - m.at < STALE_MS ? m.px : null;
}

/** Milliseconds since the last frame from Hyperliquid, -1 before the first. */
export const hlAgeMs = () => (lastFrameAt ? Date.now() - lastFrameAt : -1);
