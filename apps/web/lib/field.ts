import type { BookLevel, MarketState } from '@monday/core';

export interface Mine { col: number; side: 'bid' | 'ask' }

/**
 * Column heights, in rows: cumulative USD depth out from the mid, bids to the left and asks to the right. Each side is
 * spread over its own twelve levels so both reach the edge. Monday's own quotes mark the column they sit in.
 */
export function fieldTargets(m: Pick<MarketState, 'mid' | 'mark' | 'bids' | 'asks' | 'quotes'>, g: { L: number; R: number; rows: number }): { t: Float32Array; mine: Mine[] } {
  const mid = m.mid ?? m.mark;
  const t = new Float32Array(g.L + g.R);
  const mine: Mine[] = [];
  const side = (levels: BookLevel[], n: number, off: number, s: 'bid' | 'ask') => {
    const span = levels.length ? Math.abs(levels[levels.length - 1].price - mid) : 0;
    if (!span || !n) return 0;
    let acc = 0;
    let i = 0;
    for (let k = 0; k < n; k++) {
      const edge = ((k + 1) * span) / n + span * 1e-9;
      while (i < levels.length && Math.abs(levels[i].price - mid) <= edge) acc += levels[i].price * levels[i++].size;
      t[off + k] = acc;
    }
    const q = m.quotes[s];
    if (q) mine.push({ col: off + Math.min(n - 1, Math.floor((Math.abs(q.price - mid) / span) * n)), side: s });
    return acc;
  };
  const max = Math.max(side(m.bids, g.L, 0, 'bid'), side(m.asks, g.R, g.L, 'ask'), 1);
  for (let k = 0; k < t.length; k++) t[k] = (t[k] / max) * g.rows;
  return { t, mine };
}
