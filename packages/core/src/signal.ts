// Signal engine (PRD 10.1) and the statistics behind the evidence page (PRD 19.1).

import type { MarketSignal, MarketSym, SmartTrade, WindowSignal } from './types';

export const BUCKET_MS = 5 * 60_000;
export const BASELINE_BUCKETS = 7 * 24 * 12; // 7 days of 5-minute buckets

/**
 * +1 for a buy, -1 for a sell. Nansen sends action Open | Add | Reduce | Close with side Long | Short
 * (growing a long or shrinking a short buys); the simulator sends "Buy - Open Long" style actions.
 */
export function tradeSign(t: Pick<SmartTrade, 'action' | 'side'>): 1 | -1 | 0 {
  if (t.action.startsWith('Buy')) return 1;
  if (t.action.startsWith('Sell')) return -1;
  const grows = t.action === 'Open' || t.action === 'Add';
  if (!grows && t.action !== 'Reduce' && t.action !== 'Close') return 0;
  return grows === (t.side === 'Long') ? 1 : -1;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Sparse flow leaves a tiny scale, so one $600k close once scored -46 on the 60-minute window and alone held BTC
 * in "storm" for an hour (S = 0.2 x 46). Beyond 5 the size of the number says nothing more, so it stops there.
 */
export const Z_MAX = 5;

/** Robust z-score: median and MAD keep one whale trade from breaking the scale. Capped at +-Z_MAX. */
export function robustZ(value: number, baseline: number[]): number {
  if (baseline.length < 12) return 0;
  const { med, scale } = robustScale(baseline);
  return scale > 0 ? Math.max(-Z_MAX, Math.min(Z_MAX, (value - med) / scale)) : 0;
}

/** Median and robust sigma of a baseline. */
export function robustScale(baseline: number[]): { med: number; scale: number } {
  const med = median(baseline);
  const dev = baseline.map((x) => Math.abs(x - med));
  const mad = median(dev);
  // Smart-money flow is sparse: most 5-minute buckets are empty, so MAD is 0. Fall back to the
  // mean absolute deviation (Iglewicz-Hoaglin) rather than hiding the rare bucket that has flow.
  const scale = mad > 0 ? 1.4826 * mad : 1.2533 * (dev.reduce((a, b) => a + b, 0) / Math.max(dev.length, 1));
  return { med, scale };
}

/** Rolling sums over n consecutive buckets: the 7-day history of F_w at every bucket end. */
export function windowSums(buckets: number[], n: number): number[] {
  // Summed directly, not as a running add-and-subtract: float drift would turn empty windows into
  // 1e-10 residues, which makes the MAD tiny and z-scores explode.
  const out: number[] = [];
  for (let i = n - 1; i < buckets.length; i++) {
    let acc = 0;
    for (let j = i - n + 1; j <= i; j++) acc += buckets[j];
    out.push(acc);
  }
  return out;
}

export const compositeS = (z5: number, z15: number, z60: number) => 0.5 * z5 + 0.3 * z15 + 0.2 * z60;

function windowOf(trades: SmartTrade[], now: number, minutes: number, baseline: number[]): WindowSignal {
  const from = now - minutes * 60_000;
  let net = 0;
  let gross = 0;
  let n = 0;
  for (const t of trades) {
    if (t.ts <= from || t.ts > now) continue;
    net += tradeSign(t) * t.valueUsd;
    gross += t.valueUsd;
    n++;
  }
  return { netUsd: net, grossUsd: gross, imbalance: gross > 0 ? net / gross : 0, z: robustZ(net, baseline), n };
}

/**
 * @param trades   this coin's trades covering at least the last hour
 * @param buckets  this coin's net flow per closed 5-minute bucket, oldest first, up to 7 days
 */
export function computeSignal(sym: MarketSym, trades: SmartTrade[], buckets: number[], now: number, stale: boolean): MarketSignal {
  const w5 = windowOf(trades, now, 5, buckets);
  const w15 = windowOf(trades, now, 15, windowSums(buckets, 3));
  const w60 = windowOf(trades, now, 60, windowSums(buckets, 12));
  // PRD 10.1 stale rule: no successful poll for 15 minutes sets S = 0.
  const S = stale ? 0 : compositeS(w5.z, w15.z, w60.z);
  return { sym, at: now, stale, S, w5, w15, w60 };
}

/** Net flow per 5-minute bucket for [fromMs, toMs), oldest first. */
export function bucketFlows(trades: SmartTrade[], fromMs: number, toMs: number): number[] {
  const n = Math.max(0, Math.floor((toMs - fromMs) / BUCKET_MS));
  const out = new Array<number>(n).fill(0);
  for (const t of trades) {
    const i = Math.floor((t.ts - fromMs) / BUCKET_MS);
    if (i >= 0 && i < n) out[i] += tradeSign(t) * t.valueUsd;
  }
  return out;
}

// ---- statistics for the event study ----

function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

export const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

/** Deterministic PRNG so bootstrap intervals are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap 95% confidence interval for the Spearman correlation. */
export function spearmanCI(x: number[], y: number[], iterations = 300, seed = 7): [number, number] {
  const n = x.length;
  if (n < 10) return [0, 0];
  const rnd = mulberry32(seed);
  const stats: number[] = [];
  const bx = new Array<number>(n), by = new Array<number>(n);
  for (let b = 0; b < iterations; b++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rnd() * n);
      bx[i] = x[j]; by[i] = y[j];
    }
    stats.push(spearman(bx, by));
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(0.025 * iterations)], stats[Math.ceil(0.975 * iterations) - 1]];
}

/** Mean of y inside each decile of x, lowest x first. */
export function decileMeans(x: number[], y: number[]): { decile: number; meanX: number; meanY: number; n: number }[] {
  const order = x.map((v, i) => [v, y[i]] as const).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let d = 0; d < 10; d++) {
    const slice = order.slice(Math.floor((d * order.length) / 10), Math.floor(((d + 1) * order.length) / 10));
    const n = slice.length;
    out.push({
      decile: d + 1,
      meanX: n ? slice.reduce((s, p) => s + p[0], 0) / n : 0,
      meanY: n ? slice.reduce((s, p) => s + p[1], 0) / n : 0,
      n,
    });
  }
  return out;
}

/** Stable JSON: sorted keys, no whitespace. This is the byte string that gets keccak-hashed. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
