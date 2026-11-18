// Agentic Trade's scalper: the higher-timeframe read (D1 and H4), the low-timeframe trigger, and the exits of one scalp.
// Pure functions of closed candles, so the setup page, the server and the tests read the market the same way.

import { ema } from './indicators';
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

/**
 * A scalp aims three of the trigger bars' usual ranges out and stops three away. Measured on Perpl mainnet candles
 * (2026-11-16, five markets, 150 days) with the trigger below on 15m: about 0.75 scalps a market a day at +11 bps of
 * notional each after fees (+10 in the first half, +11 in the second; BTC alone lost). On 5m it was about -2.
 */
export const SCALP_TARGET_ATR = 3;
export const SCALP_STOP_ATR = 3;
/** A scalp still open after this many trigger bars is closed: a bounce that has not come by then is not coming. */
export const SCALP_MAX_BARS = 48;
/**
 * A close this many usual ranges under the 20-bar average is a dip (a long's setup); over it, a bounce (a short's).
 * A Keltner band. Shallower dips (RSI under 40, CCI, a 1.5-range band) came twice as often and made a third as much.
 */
export const SCALP_DIP_ATR = 2;
/** A scalp's target must clear its round trip's fees (taker in, taker out at worst) this many times over, or it is skipped. */
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

/** Follow when the user's side is the market's, counter when it is against it (it then waits); a mixed market has no mode. */
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
 * The trigger, read on the last closed bar of the trigger timeframe: a close stretched two usual ranges away from
 * its 20-bar average against the trade (under it for a long, over it for a short) while D1 and H4 point the trade's
 * way: a dip in an uptrend, a bounce in a downtrend. Only with the market (`follow`). On the same candles, entries
 * that chase the move (a pullback that resumed, a breakout, a MACD or average cross) and any entry against D1 and
 * H4 lost more than a random entry did, so a side against the market waits.
 */
export function scalpSignal(bars: Bar[], bias: Bias, mode: ScalpMode): ScalpSignal | null {
  if (mode !== 'follow' || bars.length < 55) return null;
  const range = atr(bars);
  if (!range) return null;
  const long = bias === 'long';
  const last = bars[bars.length - 1];
  const mean = emaSeries(bars.map((b) => b.c), 20)[bars.length - 1];
  const stretch = (long ? mean - last.c : last.c - mean) / range;
  if (stretch <= SCALP_DIP_ATR) return null;
  return { price: last.c, atr: range, barT: last.t, why: `${stretch.toFixed(1)} ranges ${long ? 'under' : 'over'} the 20-bar average: ${long ? 'a dip in an uptrend' : 'a bounce in a downtrend'}` };
}

/** One scalp's target and stop from its entry: ranges of the trigger timeframe, the stop never past `maxStop` away. */
export function scalpExits(bias: Bias, entry: number, range: number, maxStop = Infinity): { tp: number; sl: number } {
  const up = bias === 'long' ? 1 : -1;
  return { tp: entry + up * SCALP_TARGET_ATR * range, sl: entry - up * Math.min(SCALP_STOP_ATR * range, maxStop) };
}

export const TREND_LABEL: Record<Trend, string> = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' };
export const MODE_LABEL: Record<ScalpMode, string> = { follow: 'Follow', counter: 'Counter' };
