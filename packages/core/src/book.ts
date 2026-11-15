import type { BookLevel, Side } from './types';

/** Grouping steps for a market's book: its own tick, then 10x, 100x and 1000x it (BTC: 0.1, 1, 10, 100). */
export const groupSteps = (tick: number) => [1, 10, 100, 1000].map((k) => Number((tick * k).toPrecision(12)));

/** The bucket a price falls in. Bids round down and asks up, so a bucket never shows a better price than any order in it. */
export function bucket(price: number, step: number, side: Side): number {
  let q = price / step;
  const r = Math.round(q);
  if (Math.abs(q - r) < 1e-6) q = r; // 65392.2 / 0.1 is 653921.9999…, not 653922
  return Number(((side === 'bid' ? Math.floor(q) : Math.ceil(q)) * step).toPrecision(12));
}

/** One side of the book, best first, merged into buckets of `step`. */
export function groupLevels(levels: BookLevel[], step: number, side: Side): BookLevel[] {
  const out: BookLevel[] = [];
  for (const l of levels) {
    const price = bucket(l.price, step, side);
    const last = out.at(-1);
    if (last?.price === price) last.size += l.size;
    else out.push({ price, size: l.size });
  }
  return out;
}
