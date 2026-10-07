import { expect, it } from 'vitest';
import { bollinger, ema, macd, rsi, sma, vwap } from './indicators';

it('computes the chart indicators', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(sma(xs, 3)).toEqual([null, null, 2, 3, 4, 5, 6, 7, 8, 9]);
  const e = ema(xs, 3);
  expect(e[2]).toBe(2); // seeded with the SMA
  expect(e[3]).toBeCloseTo(3); // k = 0.5: 4 * 0.5 + 2 * 0.5

  // A flat series has zero-width bands; RSI is 100 when nothing ever falls and 0 when nothing rises.
  const flat = bollinger(Array(25).fill(5), 20);
  expect([flat.upper[24], flat.lower[24]]).toEqual([5, 5]);
  expect(rsi(xs, 5).at(-1)).toBe(100);
  expect(rsi([...xs].reverse(), 5).at(-1)).toBe(0);
  expect(rsi(xs, 5).slice(0, 5)).toEqual([null, null, null, null, null]);

  // On a straight line the fast EMA leads the slow one by a constant, so the histogram settles at 0.
  const m = macd(Array.from({ length: 80 }, (_, i) => i), 12, 26, 9);
  expect(m.macd[24]).toBeNull();
  expect(m.signal.at(-1)).toBeCloseTo(m.macd.at(-1)!, 6);
  expect(m.hist.at(-1)).toBeCloseTo(0, 6);

  // VWAP weights by volume and restarts at the UTC day.
  const day = 86_400_000;
  expect(vwap([{ t: 0, h: 10, l: 10, c: 10, v: 1 }, { t: 60_000, h: 20, l: 20, c: 20, v: 3 }, { t: day, h: 7, l: 7, c: 7, v: 2 }])).toEqual([10, 17.5, 7]);
});
