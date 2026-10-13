import { describe, expect, it } from 'vitest';
import { atr, closedBars, marketRead, rollUp, scalpExits, scalpMode, scalpSignal, trendOf, type Bar } from './scalp';

/** One-minute bars from closes: each opens at the previous close and wicks 0.3 past both ends. */
const bars = (closes: number[]): Bar[] =>
  closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { t: i * 60_000, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c };
  });
const line = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + step * i);

describe('market read', () => {
  it('reads a trend from the close against a sloping 20 EMA', () => {
    expect(trendOf(bars(line(100, 0.5, 60)))).toBe('bullish');
    expect(trendOf(bars(line(130, -0.5, 60)))).toBe('bearish');
    expect(trendOf(bars(line(100, 0, 60)))).toBe('neutral');
    expect(trendOf(bars(line(100, 0.5, 4)))).toBe('neutral'); // too little history to say
  });

  it('needs D1 and H4 to agree, then calls the side follow or counter', () => {
    expect(marketRead('bullish', 'bullish')).toBe('bullish');
    expect(marketRead('bullish', 'bearish')).toBe('mixed');
    expect(marketRead('neutral', 'neutral')).toBe('mixed');
    expect(scalpMode('long', 'bullish')).toBe('follow');
    expect(scalpMode('short', 'bullish')).toBe('counter');
    expect(scalpMode('short', 'bearish')).toBe('follow');
    expect(scalpMode('long', 'mixed')).toBeNull();
  });
});

describe('trigger and exits', () => {
  it('measures the usual range of a bar', () => {
    expect(atr(bars(line(100, 0.5, 30)))).toBeCloseTo(1.1, 9); // 0.5 move + 0.3 wick each side
    expect(atr(bars(line(100, 0.5, 10)))).toBeNull();
  });

  it('follow: a pullback to the 20 EMA in an uptrend that closes back above it', () => {
    const up = line(100, 0.5, 60); // ends at 129.5 with the 20 EMA about 4.75 under it
    const signal = scalpSignal(bars([...up, 124.5, 125.3]), 'long', 'follow');
    expect(signal).toMatchObject({ price: 125.3 });
    expect(signal!.atr).toBeGreaterThan(1);
    expect(scalpSignal(bars([...up, 130, 130.5]), 'long', 'follow')).toBeNull(); // no dip: nothing to buy
    expect(scalpSignal(bars([...up, 124.5, 124.4]), 'long', 'follow')).toBeNull(); // dipped and kept falling
    expect(scalpSignal(bars([...up, 124.5, 125.3]), 'short', 'follow')).toBeNull(); // the EMAs point up
  });

  it('counter: a stretched RSI that turns past the previous bar', () => {
    const down = line(130, -0.5, 60); // RSI pinned near 0
    expect(scalpSignal(bars([...down, 101.5]), 'long', 'counter')).toMatchObject({ price: 101.5 }); // above the last bar's 101.3 high
    expect(scalpSignal(bars([...down, 100]), 'long', 'counter')).toBeNull(); // still falling
    expect(scalpSignal(bars([...line(100, 0.5, 60), 129]), 'long', 'counter')).toBeNull(); // RSI never stretched down
  });

  it('places a scalp target a range or a range and a half away, the stop one range the other way, capped', () => {
    expect(scalpExits('long', 'follow', 100, 2)).toEqual({ tp: 103, sl: 98 });
    expect(scalpExits('short', 'counter', 100, 2)).toEqual({ tp: 98, sl: 102 });
    expect(scalpExits('long', 'follow', 100, 2, 0.5)).toEqual({ tp: 103, sl: 99.5 });
  });

  it('rolls minutes up and keeps only closed bars', () => {
    const five = rollUp(bars(line(100, 1, 10)), 300_000);
    expect(five.map((b) => [b.t, b.o, b.c])).toEqual([[0, 100, 104], [300_000, 104, 109]]);
    expect(closedBars(five, 300, 599_999)).toHaveLength(1);
  });
});
