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

  it('with the market: a close stretched from its average on the last closed bar, a dip for a long and a spike for a short', () => {
    const dip = [...line(100, 0.5, 50), ...line(123.5, -1, 14)]; // rose, then fell 14 bars: far under the 20-bar average
    const signal = scalpSignal(bars(dip), 'long', 'follow');
    expect(signal).toMatchObject({ price: 110.5 });
    expect(signal!.atr).toBeGreaterThan(1);
    expect(scalpSignal(bars(dip), 'short', 'follow')).toBeNull(); // stretched down is no short
    expect(scalpSignal(bars(line(100, 0.5, 64)), 'long', 'follow')).toBeNull(); // no dip: nothing to buy
    expect(scalpSignal(bars(line(100, 0.5, 64)), 'short', 'follow')).toMatchObject({ price: 131.5 }); // a steady rise sits over its average
    expect(scalpSignal(bars(dip.slice(-40)), 'long', 'follow')).toBeNull(); // too few bars
  });

  it('against the market: no setup at all', () => {
    expect(scalpSignal(bars([...line(100, 0.5, 50), ...line(123.5, -1, 14)]), 'long', 'counter')).toBeNull();
  });

  it('places a scalp target three ranges away and the stop three the other way, capped', () => {
    expect(scalpExits('long', 100, 2)).toEqual({ tp: 106, sl: 94 });
    expect(scalpExits('short', 100, 2)).toEqual({ tp: 94, sl: 106 });
    expect(scalpExits('long', 100, 2, 0.5)).toEqual({ tp: 106, sl: 99.5 });
  });

  it('rolls minutes up and keeps only closed bars', () => {
    const five = rollUp(bars(line(100, 1, 10)), 300_000);
    expect(five.map((b) => [b.t, b.o, b.c])).toEqual([[0, 100, 104], [300_000, 104, 109]]);
    expect(closedBars(five, 300, 599_999)).toHaveLength(1);
  });
});
