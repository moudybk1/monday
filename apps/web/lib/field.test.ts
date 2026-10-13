import { expect, it } from 'vitest';
import { fieldTargets } from './field';

const lv = (p: number[]) => p.map((price) => ({ price, size: 1 }));
// Heights are float32: compare at four decimals.
const r4 = (xs: ArrayLike<number>) => Array.from(xs, (x) => Math.round(x * 1e4) / 1e4);

it('draws cumulative depth out from the mid, each side reaching its edge, and marks Monday\'s quotes', () => {
  const m = { mid: 100, mark: 100, bids: lv([99, 98, 96]), asks: lv([101, 102]), quotes: { bid: { price: 97.5, size: 1 }, ask: null } };
  const { t, mine } = fieldTargets(m, { L: 4, R: 2, rows: 50 });
  // Bids span 4 (100 to 96) over 4 columns: 99 | 98 | none | 96. Depth only grows outward.
  expect(r4(t.slice(0, 4))).toEqual(r4([99, 197, 197, 293].map((d) => (d / 293) * 50)));
  // Asks: 101 | 102. The deeper side sets the scale, so the asks stay below it.
  expect(r4(t.slice(4))).toEqual(r4([101, 203].map((d) => (d / 293) * 50)));
  // 97.5 is 2.5 from the mid: the third bid column (index 2). No ask quote, no mark.
  expect(mine).toEqual([{ col: 2, side: 'bid' }]);
});

it('stays flat on an empty book instead of dividing by zero', () => {
  const { t, mine } = fieldTargets({ mid: null, mark: 50, bids: [], asks: [], quotes: { bid: null, ask: null } }, { L: 3, R: 3, rows: 10 });
  expect(Array.from(t)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(mine).toEqual([]);
});
