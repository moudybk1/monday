import { describe, expect, it } from 'vitest';
import { bucket, groupLevels, groupSteps } from './book';

describe('order book grouping', () => {
  it('steps follow the tick', () => {
    expect(groupSteps(0.1)).toEqual([0.1, 1, 10, 100]);
    expect(groupSteps(0.000001)).toEqual([0.000001, 0.00001, 0.0001, 0.001]);
  });

  it('bids round down, asks round up, exact prices stay put', () => {
    expect(bucket(65392.2, 0.1, 'bid')).toBe(65392.2);
    expect(bucket(65392.2, 0.1, 'ask')).toBe(65392.2);
    expect(bucket(65392.2, 10, 'bid')).toBe(65390);
    expect(bucket(65392.2, 10, 'ask')).toBe(65400);
    expect(bucket(0.031237, 0.0001, 'bid')).toBe(0.0312);
  });

  it('merges levels in one bucket and keeps best first', () => {
    const bids = [{ price: 65392.2, size: 1 }, { price: 65391.5, size: 2 }, { price: 65389.9, size: 4 }];
    expect(groupLevels(bids, 1, 'bid')).toEqual([{ price: 65392, size: 1 }, { price: 65391, size: 2 }, { price: 65389, size: 4 }]);
    expect(groupLevels(bids, 10, 'bid')).toEqual([{ price: 65390, size: 3 }, { price: 65380, size: 4 }]);
    const asks = [{ price: 65400.1, size: 1 }, { price: 65405, size: 2 }, { price: 65410.2, size: 3 }];
    expect(groupLevels(asks, 10, 'ask')).toEqual([{ price: 65410, size: 3 }, { price: 65420, size: 3 }]);
  });
});
