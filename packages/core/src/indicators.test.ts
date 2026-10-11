import { describe, expect, it } from 'vitest';
import { DIV0, RSI0, divergenceStep, ema, emaTrendBps, rsiStep } from './indicators';

const rsiOf = (closes: number[], period = 14) => {
  let s = RSI0, r: number | null = null;
  for (const c of closes) ({ state: s, rsi: r } = rsiStep(s, c, period));
  return r;
};
const divergences = (price: number[], rsi: number[], o?: Parameters<typeof divergenceStep>[3]) => {
  let s = DIV0;
  return price.map((p, i) => {
    const r = divergenceStep(s, p, rsi[i], o);
    s = r.state;
    return r.dir;
  });
};

describe('indicators', () => {
  it('ema seeds with the first value and leans toward new values by 2/(n+1)', () => {
    expect(ema(null, 10, 9)).toBe(10);
    expect(ema(10, 20, 9)).toBeCloseTo(12);
    expect(emaTrendBps(101, 100, 100)).toBeCloseTo(100);
  });

  it('rsi is null until a full period, 100 on only gains, near 50 on balanced moves', () => {
    const up = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(rsiOf(up.slice(0, 14))).toBeNull();
    expect(rsiOf(up)).toBe(100);
    const flat = Array.from({ length: 40 }, (_, i) => 100 + (i % 2));
    expect(rsiOf(flat)).toBeGreaterThan(45);
    expect(rsiOf(flat)).toBeLessThan(55);
    // Wilder's own series: the first RSI after 14 changes is 70.46.
    const wilder = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsiOf(wilder)).toBeCloseTo(70.46, 1);
  });

  it('flags a bearish divergence when price makes a higher high on a lower RSI, then lets it go', () => {
    // Two swing highs 11 bars apart; the second is higher in price but reached with a weaker RSI.
    const price = [100, 101, 102, 103, 102, 101, 100, 99, 98, 99, 100, 101, 102, 103, 104, 103, 102, 101, 100, 99, 98, 97, 96];
    const rsi = [50, 60, 70, 80, 70, 60, 50, 40, 35, 40, 45, 50, 55, 60, 62, 55, 50, 45, 40, 35, 30, 28, 25];
    const seen = divergences(price, rsi, { w: 3, hold: 4 });
    expect(seen.slice(0, 17)).toEqual(new Array(17).fill(0)); // the second high (bar 14) is confirmed 3 bars later
    expect(seen[17]).toBe(-1);
    expect(seen[20]).toBe(-1); // held for 4 bars
    expect(seen[21]).toBe(0);
  });

  it('flags a bullish divergence on a lower low with a higher RSI low, and none on a flat stretch', () => {
    const price = [100, 99, 98, 97, 98, 99, 100, 101, 102, 101, 100, 99, 98, 97, 96, 97, 98, 99, 100];
    const rsi = [50, 40, 30, 20, 30, 40, 50, 60, 65, 60, 55, 50, 45, 40, 35, 40, 45, 50, 55];
    expect(divergences(price, rsi)[17]).toBe(1);
    const flat = divergences(new Array(30).fill(100), new Array(30).fill(50));
    expect(flat.every((d) => d === 0)).toBe(true);
  });
});
