// Tread-style performance analytics over one account's fills. Pure: the server passes rows in, the page draws the result.

import type { MarketSym, Side } from './types';

export const MARKOUT_HORIZONS = ['1s', '5s', '10s', '1m', '5m'] as const;

export interface FillRow {
  sym: MarketSym;
  side: Side;
  price: number;
  size: number;
  fee: number;
  isMaker: boolean;
  ts: number;
  regime: string | null;
  realized: number | null; // before fees
  /** The fill reduced the position. Null on rows from before this was recorded: then a non-zero realized PnL stands in. */
  closes: boolean | null;
  halfBps: number | null; // distance from fair when it filled, in bps (older rows: the model's half-spread)
  markouts: (number | null)[]; // in MARKOUT_HORIZONS order
}

export interface Bucket {
  key: string;
  fills: number;
  volumeUsd: number;
  netUsd: number; // realised PnL minus fees
  netBps: number; // per dollar traded
  markout1mBps: number | null;
  winRate: number | null; // share of position-reducing fills that made money after fees
}

export interface Analytics {
  from: number;
  to: number;
  summary: Bucket & { makerPct: number; feesUsd: number; feeBps: number; realizedUsd: number; closes: number };
  markouts: { horizon: (typeof MARKOUT_HORIZONS)[number]; bps: number | null; n: number }[];
  byMarket: Bucket[];
  byRegime: Bucket[];
  bySpread: Bucket[];
  /** 7 x 24 cells, UTC. dow 0 is Sunday. */
  hourly: { dow: number; hour: number; fills: number; netBps: number }[];
  daily: { day: string; volumeUsd: number; netUsd: number }[];
}

const SPREADS: [string, number][] = [['<5', 5], ['5-10', 10], ['10-20', 20], ['20+', Infinity]];
const isClose = (r: FillRow) => r.closes ?? Boolean(r.realized);

function bucket(key: string, rows: FillRow[]): Bucket {
  let vol = 0, net = 0, m1 = 0, m1n = 0, closes = 0, wins = 0;
  for (const r of rows) {
    vol += r.price * r.size;
    const pnl = (r.realized ?? 0) - r.fee;
    net += pnl;
    if (r.isMaker && r.markouts[3] != null) {
      m1 += r.markouts[3];
      m1n++;
    }
    if (isClose(r)) {
      closes++;
      if (pnl > 0) wins++;
    }
  }
  return { key, fills: rows.length, volumeUsd: vol, netUsd: net, netBps: vol ? (net / vol) * 1e4 : 0, markout1mBps: m1n ? m1 / m1n : null, winRate: closes ? wins / closes : null };
}

function groups(rows: FillRow[], keyOf: (r: FillRow) => string, order?: string[]): Bucket[] {
  const by = new Map<string, FillRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const keys = order ? order.filter((k) => by.has(k)) : [...by.keys()].sort();
  return keys.map((k) => bucket(k, by.get(k)!));
}

export function analyticsOf(rows: FillRow[], from: number, to: number): Analytics {
  const all = bucket('all', rows);
  const fees = rows.reduce((s, r) => s + r.fee, 0);
  const realized = rows.reduce((s, r) => s + (r.realized ?? 0), 0);
  const makers = rows.filter((r) => r.isMaker);

  const cells = Array.from({ length: 7 * 24 }, () => [] as FillRow[]);
  for (const r of rows) {
    const d = new Date(r.ts);
    cells[d.getUTCDay() * 24 + d.getUTCHours()].push(r);
  }
  const days = new Map<string, { volumeUsd: number; netUsd: number }>();
  for (const r of rows) {
    const day = new Date(r.ts).toISOString().slice(0, 10);
    const d = days.get(day) ?? { volumeUsd: 0, netUsd: 0 };
    d.volumeUsd += r.price * r.size;
    d.netUsd += (r.realized ?? 0) - r.fee;
    days.set(day, d);
  }

  return {
    from, to,
    summary: { ...all, makerPct: rows.length ? makers.length / rows.length : 0, feesUsd: fees, feeBps: all.volumeUsd ? (fees / all.volumeUsd) * 1e4 : 0, realizedUsd: realized, closes: rows.filter(isClose).length },
    markouts: MARKOUT_HORIZONS.map((horizon, i) => {
      const xs = makers.map((r) => r.markouts[i]).filter((x): x is number => x != null);
      return { horizon, bps: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
    }),
    byMarket: groups(rows, (r) => r.sym),
    byRegime: groups(rows, (r) => r.regime ?? 'unknown', ['calm', 'active', 'storm', 'stale', 'unknown']),
    bySpread: groups(rows, (r) => (r.halfBps == null ? 'unknown' : SPREADS.find(([, hi]) => r.halfBps! < hi)![0]), [...SPREADS.map(([k]) => k), 'unknown']),
    hourly: cells.map((c, i) => ({ dow: Math.floor(i / 24), hour: i % 24, fills: c.length, netBps: bucket('', c).netBps })),
    daily: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, ...d })),
  };
}
