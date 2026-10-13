// Agentic Trade's scalper: the higher-timeframe read (D1 and H4), the low-timeframe trigger, and the exits of one scalp.
// Pure functions of closed candles, so the setup page, the server and the tests read the market the same way.

import { RSI0, ema, rsiStep } from './indicators';
import type { Bias } from './plan';
import type { MarketSym } from './types';

export interface Bar { t: number; o: number; h: number; l: number; c: number; v?: number }
export type Trend = 'bullish' | 'bearish' | 'neutral';
/** D1 and H4 together: they agree, or the market is mixed. */
export type MarketRead = 'bullish' | 'bearish' | 'mixed';
/** The user's side against the market: with it, or against it. */
export type ScalpMode = 'follow' | 'counter';
export type ScalpFrame = '1m' | '5m' | '15m';
export const FRAME_SEC: Record<ScalpFrame, number> = { '1m': 60, '5m': 300, '15m': 900 };
export const D1_SEC = 86_400;
export const H4_SEC = 14_400;
export const H1_SEC = 3_600;
/** Bars each read asks for: enough for a 20-period EMA and its slope, with room to spare. */
export const READ_BARS = 60;

/** A follow scalp aims for one and a half bars' usual range, a counter scalp for one; both stop one range away. */
export const SCALP_TARGET_ATR: Record<ScalpMode, number> = { follow: 1.5, counter: 1 };
export const SCALP_STOP_ATR = 1;
/** A scalp still open after this many trigger bars is closed: a scalp that has not worked by then is not a scalp. */
export const SCALP_MAX_BARS = 12;
/** An entry order still unfilled this many bars after its signal has missed its moment. */
export const SCALP_ENTRY_BARS = 2;
/** A scalp's target must clear its round trip's fees (maker in, taker out at worst) this many times over, or it is skipped. */
export const SCALP_MIN_TARGET_FEES = 3;

/** Merge candles into `spanMs` buckets aligned to UTC. A no-op on candles that already have that width. */
export function rollUp<T extends Bar>(cs: T[], spanMs: number): T[] {
  const out: T[] = [];
  for (const k of cs) {
    const t = Math.floor(k.t / spanMs) * spanMs;
    const last = out[out.length - 1];
    if (last?.t !== t) out.push({ ...k, t });
    else Object.assign(last, { h: Math.max(last.h, k.h), l: Math.min(last.l, k.l), c: k.c, v: last.v == null && k.v == null ? undefined : (last.v ?? 0) + (k.v ?? 0) });
  }
  return out;
}

/** The bars that have closed by `now`; the last one a feed returns is often still forming. */
export const closedBars = <T extends Bar>(bars: T[], spanSec: number, now: number): T[] => bars.filter((b) => b.t + spanSec * 1000 <= now);

const emaSeries = (xs: number[], n: number): number[] => {
  let e: number | null = null;
  return xs.map((x) => (e = ema(e, x, n)));
};

/**
 * One timeframe's trend: a close above a rising 20-period EMA is bullish, below a falling one bearish, anything else
 * neutral. A short history (a young market, the simulator) shortens the EMA rather than giving up.
 */
export function trendOf(bars: Bar[]): Trend {
  if (bars.length < 6) return 'neutral';
  const n = Math.min(20, Math.floor(bars.length / 2));
  const slope = Math.min(5, Math.floor(bars.length / 4));
  const e = emaSeries(bars.map((b) => b.c), n);
  const last = bars[bars.length - 1].c, now = e[e.length - 1], before = e[e.length - 1 - slope];
  if (last > now && now >= before) return 'bullish';
  if (last < now && now <= before) return 'bearish';
  return 'neutral';
}

/** The market as the scalper reads it: D1 and H4 must agree, or it waits. */
export const marketRead = (d1: Trend, h4: Trend): MarketRead => (d1 === h4 && d1 !== 'neutral' ? d1 : 'mixed');

/**
 * The setup pages' market read before a trade is set up: D1, H4 and H1 by the same trend rule, and a few sentences on
 * them from the model (`source: 'model'`) or from a rule when the model is off, late or over its budget.
 */
export interface MarketInsight {
  sym: MarketSym;
  at: number;
  price: number;
  d1: Trend;
  h4: Trend;
  h1: Trend;
  /** D1 and H4 together, as the scalper reads them. */
  market: MarketRead;
  /** H1 points the same way as D1 and H4. */
  aligned: boolean;
  summary: string;
  source: 'model' | 'rules';
  model: string | null;
  /** What the page draws for each timeframe. */
  frames: Record<'d1' | 'h4' | 'h1', FrameRead>;
}

/** One timeframe of a market read: its recent closes, where the close sits against the 20 EMA, and its 20-bar range. */
export interface FrameRead {
  closes: number[];
  ema: number;
  /** Close against the 20 EMA, in percent. */
  distPct: number;
  /** The 20 EMA's move over its last 5 bars, in percent. */
  slopePct: number;
  high: number;
  low: number;
}

/** Follow when the user's side is the market's, counter when it is against it; a mixed market has no mode. */
export const scalpMode = (bias: Bias, market: MarketRead): ScalpMode | null =>
  market === 'mixed' ? null : (market === 'bullish') === (bias === 'long') ? 'follow' : 'counter';

/** Average true range over the last `n` bars: one bar's usual move, gaps included. */
export function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1].c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev));
  }
  return sum / n;
}

export interface ScalpSignal {
  /** Where to enter: the close of the bar that triggered. */
  price: number;
  atr: number;
  /** The bar that triggered, so the same bar never triggers twice. */
  barT: number;
  why: string;
}

/**
 * The trigger, read on the last closed bar of the trigger timeframe.
 * Follow: the 20 EMA beyond the 50 EMA in the trade's direction, price dipped to the 20 EMA within the last 3 bars, and
 * this bar closed back beyond it, in the trade's direction and within one range of it: a pullback that resumed.
 * Counter: RSI(14) stretched against the trade within the last 3 bars (under 30 for a long, over 70 for a short) and this
 * bar closed past the previous bar's extreme the trade's way: a turn from an extreme.
 */
export function scalpSignal(bars: Bar[], bias: Bias, mode: ScalpMode): ScalpSignal | null {
  if (bars.length < 55) return null;
  const range = atr(bars);
  if (!range) return null;
  const long = bias === 'long';
  const last = bars[bars.length - 1], prev = bars[bars.length - 2];
  const dir = (a: number, b: number) => (long ? a > b : a < b); // a beyond b in the trade's direction
  const closes = bars.map((b) => b.c);
  if (mode === 'follow') {
    const fast = emaSeries(closes, 20), slow = emaSeries(closes, 50);
    const f = fast[fast.length - 1];
    if (!dir(f, slow[slow.length - 1])) return null;
    const dipped = bars.slice(-3).some((b, i) => (long ? b.l <= fast[fast.length - 3 + i] : b.h >= fast[fast.length - 3 + i]));
    const resumed = dir(last.c, f) && dir(last.c, last.o) && Math.abs(last.c - f) <= range;
    return dipped && resumed ? { price: last.c, atr: range, barT: last.t, why: `Pullback to the 20 EMA resumed ${long ? 'up' : 'down'}` } : null;
  }
  let s = RSI0;
  const rsi: (number | null)[] = closes.map((c) => {
    const r = rsiStep(s, c);
    s = r.state;
    return r.rsi;
  });
  const stretched = rsi.slice(-3).some((r) => r != null && (long ? r < 30 : r > 70));
  const turned = long ? last.c > prev.h && last.c > last.o : last.c < prev.l && last.c < last.o;
  return stretched && turned ? { price: last.c, atr: range, barT: last.t, why: `RSI ${long ? 'under 30' : 'over 70'} turned ${long ? 'up' : 'down'}` } : null;
}

/** One scalp's target and stop from its entry: ranges of the trigger timeframe, the stop never past `maxStop` away. */
export function scalpExits(bias: Bias, mode: ScalpMode, entry: number, range: number, maxStop = Infinity): { tp: number; sl: number } {
  const up = bias === 'long' ? 1 : -1;
  const stop = Math.min(SCALP_STOP_ATR * range, maxStop);
  return { tp: entry + up * SCALP_TARGET_ATR[mode] * range, sl: entry - up * stop };
}

export const TREND_LABEL: Record<Trend, string> = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' };
export const MODE_LABEL: Record<ScalpMode, string> = { follow: 'Follow', counter: 'Counter' };
