import { expect, it } from 'vitest';
import { marketIn, quickAsk, rankPct, walletPerformance, type PxTrade } from './perpl';

it('reads a ticker that is also a word only when it means the market, and the first market named', () => {
  const M = ['BTC', 'ETH', 'NEAR', 'HYPE'];
  expect(marketIn('funding near zero', M)).toBeUndefined();
  expect(marketIn('whales near liquidation', M)).toBeUndefined();
  expect(marketIn('NEAR funding', M)).toBe('NEAR');
  expect(marketIn('near funding', M)).toBe('NEAR');
  expect(marketIn('$hype', M)).toBe('HYPE');
  expect(marketIn('show me near?', M)).toBe('NEAR');
  expect(marketIn('eth vs btc funding', M)).toBe('ETH');
  const W = ['MON', 'HYPE', 'NEAR'];
  for (const [q, sym] of [['mon long short', 'MON'], ['mon long-short', 'MON'], ['mon longs shorts', 'MON'], ['hype skew', 'HYPE'], ['funding on mon', 'MON'],
    ['what is the funding on mon', 'MON'], ['skew mon?', 'MON'], ["hype's funding", 'HYPE'], ['show me hype!', 'HYPE'], ['show me near.', 'NEAR']]) expect(marketIn(q, W), q).toBe(sym);
  expect(marketIn('is funding near zero?', W)).toBeUndefined();
  expect(marketIn('traders near liquidation', W)).toBeUndefined();
});

it('reads a window as a window, not an account to compare', () => {
  expect(quickAsk('compare 123 vs 456 over 30 days', [])).toEqual({ kind: 'compare', wallets: ['123', '456'] });
});

it('binds the volume size to volume, with separators and suffixes', () => {
  const M = ['BTC'];
  expect(quickAsk('whales at least 50 closes over $100k volume', M)).toMatchObject({ minVolume: 100_000, minCloses: 50 });
  expect(quickAsk('whales over $1,000,000 volume', M)).toMatchObject({ minVolume: 1_000_000 });
  expect(quickAsk('makers with volume over 1.5m', M)).toMatchObject({ minVolume: 1_500_000 });
  expect(quickAsk('whales with volume over 2 million', M)).toMatchObject({ minVolume: 2_000_000 });
  expect(quickAsk('whales over 1bn volume', M)).toMatchObject({ minVolume: 1e9 });
});

it("an invert's result belongs to the side it closed, not the side it opened", () => {
  const t = (ts: number, kind: PxTrade['kind'], long: boolean, pnl: number): PxTrade => ({ ts, block: ts, idx: 0, sym: 'BTC', role: 'taker', kind, side: 'sell', long, price: 100, size: 1, usd: 100, fee: 0, pnl, funding: 0 });
  const p = walletPerformance([t(1, 'open', true, 0), t(2, 'invert', false, -5)]); // the long is flipped to a short at a loss
  expect(p.sides.long).toMatchObject({ closes: 1, wins: 0, netUsd: -5 });
  expect(p.sides.short).toMatchObject({ closes: 0, netUsd: 0 });
  expect(rankPct(0)).toBe(99);
  expect(rankPct(0.0019)).toBe(99);
  expect(rankPct(0.5)).toBe(50);
});
