// Technical state on 1-minute closes: EMA, Wilder RSI and regular price/RSI divergence at confirmed swings.
// Pure and incremental, one step per closed minute, and never ahead of the data: a swing counts only once the bars
// after it have closed, so a live reading and a replay reading agree.

/** Exponential moving average step over `n` bars. A null `prev` seeds it with the first value. */
export const ema = (prev: number | null, x: number, n: number): number => (prev == null ? x : prev + (2 / (n + 1)) * (x - prev));

/** EMA spread as a trend reading: fast above slow is up, in bps of price. */
export const emaTrendBps = (fast: number, slow: number, price: number): number => ((fast - slow) / price) * 1e4;

export interface RsiState { gain: number; loss: number; n: number; last: number | null }
export const RSI0: RsiState = { gain: 0, loss: 0, n: 0, last: null };

/** Wilder's RSI over `period` changes: a simple average for the first `period`, then his smoothing. Null until then. */
export function rsiStep(s: RsiState, close: number, period = 14): { state: RsiState; rsi: number | null } {
  if (s.last == null) return { state: { ...s, last: close }, rsi: null };
  const d = close - s.last;
  const up = Math.max(d, 0), down = Math.max(-d, 0);
  const n = s.n + 1;
  const gain = n <= period ? s.gain + up / period : (s.gain * (period - 1) + up) / period;
  const loss = n <= period ? s.loss + down / period : (s.loss * (period - 1) + down) / period;
  const state = { gain, loss, n, last: close };
  if (n < period) return { state, rsi: null };
  return { state, rsi: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) };
}

export interface Pivot { i: number; price: number; rsi: number }
export interface DivState { i: number; win: { price: number; rsi: number }[]; highs: Pivot[]; lows: Pivot[]; signal: { dir: 1 | -1; at: number } | null }
export const DIV0: DivState = { i: 0, win: [], highs: [], lows: [], signal: null };

/**
 * Regular divergence between price and RSI. A swing high at bar k is the strictly highest close of the 2w+1 bars
 * around it, known w bars later (flat stretches make no swing). Bearish (-1): a higher price high with a lower RSI
 * high within `gap` bars of the previous swing high. Bullish (+1): a lower price low with a higher RSI low. The
 * reading holds for `hold` bars after the swing that confirms it.
 */
export function divergenceStep(s: DivState, price: number, rsi: number | null, o: { w?: number; gap?: number; hold?: number } = {}): { state: DivState; dir: 1 | -1 | 0 } {
  const { w = 3, gap = 60, hold = 15 } = o;
  const i = s.i + 1;
  const win = [...s.win, { price, rsi: rsi ?? NaN }].slice(-(2 * w + 1));
  let { highs, lows, signal } = s;
  if (win.length === 2 * w + 1 && Number.isFinite(win[w].rsi)) {
    const c = win[w];
    const k = i - w;
    if (win.every((b) => b === c || b.price < c.price)) {
      const prev = highs[highs.length - 1];
      highs = [...highs.slice(-1), { i: k, price: c.price, rsi: c.rsi }];
      if (prev && k - prev.i <= gap && c.price > prev.price && c.rsi < prev.rsi) signal = { dir: -1, at: i };
    }
    if (win.every((b) => b === c || b.price > c.price)) {
      const prev = lows[lows.length - 1];
      lows = [...lows.slice(-1), { i: k, price: c.price, rsi: c.rsi }];
      if (prev && k - prev.i <= gap && c.price < prev.price && c.rsi > prev.rsi) signal = { dir: 1, at: i };
    }
  }
  return { state: { i, win, highs, lows, signal }, dir: signal && i - signal.at < hold ? signal.dir : 0 };
}
