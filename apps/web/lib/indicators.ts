// Chart indicators over candles, oldest first. Each returns one value per candle, null while it warms up.

export interface Bar { t: number; h: number; l: number; c: number; v?: number }
type Series = (number | null)[];

export function sma(xs: number[], n: number): Series {
  let sum = 0;
  return xs.map((x, i) => {
    sum += x - (i >= n ? xs[i - n] : 0);
    return i >= n - 1 ? sum / n : null;
  });
}

/** Seeded with the SMA of the first n values, as most charting platforms do. */
export function ema(xs: number[], n: number): Series {
  const k = 2 / (n + 1);
  let prev: number | null = null;
  return xs.map((x, i) => {
    if (i < n - 1) return null;
    prev = prev == null ? xs.slice(0, n).reduce((a, b) => a + b, 0) / n : x * k + prev * (1 - k);
    return prev;
  });
}

export function bollinger(xs: number[], n = 20, width = 2): { mid: Series; upper: Series; lower: Series } {
  const mid = sma(xs, n);
  const sd = xs.map((_, i) => {
    const m = mid[i];
    if (m == null) return null;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (xs[j] - m) ** 2;
    return Math.sqrt(v / n);
  });
  return {
    mid,
    upper: mid.map((m, i) => (m == null ? null : m + width * sd[i]!)),
    lower: mid.map((m, i) => (m == null ? null : m - width * sd[i]!)),
  };
}

/** Wilder's RSI. */
export function rsi(xs: number[], n = 14): Series {
  let up = 0, down = 0;
  return xs.map((x, i) => {
    if (i === 0) return null;
    const d = x - xs[i - 1];
    if (i <= n) {
      up += Math.max(d, 0) / n;
      down += Math.max(-d, 0) / n;
      if (i < n) return null;
    } else {
      up = (up * (n - 1) + Math.max(d, 0)) / n;
      down = (down * (n - 1) + Math.max(-d, 0)) / n;
    }
    return down === 0 ? 100 : 100 - 100 / (1 + up / down);
  });
}

export function macd(xs: number[], fast = 12, slow = 26, signal = 9): { macd: Series; signal: Series; hist: Series } {
  const f = ema(xs, fast), s = ema(xs, slow);
  const line = xs.map((_, i) => (f[i] == null || s[i] == null ? null : f[i]! - s[i]!));
  const first = line.findIndex((x) => x != null);
  const sig: Series = first < 0 ? line.map(() => null) : [...line.slice(0, first).map(() => null), ...ema(line.slice(first) as number[], signal)];
  return { macd: line, signal: sig, hist: line.map((m, i) => (m == null || sig[i] == null ? null : m - sig[i]!)) };
}

/** Volume-weighted typical price, restarting at each UTC day. Bars without volume carry the running value. */
export function vwap(bars: Bar[]): Series {
  let day = -1, pv = 0, vol = 0;
  return bars.map((b) => {
    const d = Math.floor(b.t / 86_400_000);
    if (d !== day) (day = d), (pv = 0), (vol = 0);
    const v = b.v ?? 0;
    pv += ((b.h + b.l + b.c) / 3) * v;
    vol += v;
    return vol > 0 ? pv / vol : null;
  });
}
