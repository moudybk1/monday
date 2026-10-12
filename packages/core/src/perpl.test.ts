import { expect, it } from 'vitest';
import { marketIn, quickAsk } from './perpl';

it('reads a ticker that is also a word only when it means the market, and the first market named', () => {
  const M = ['BTC', 'ETH', 'NEAR', 'HYPE'];
  expect(marketIn('funding near zero', M)).toBeUndefined();
  expect(marketIn('whales near liquidation', M)).toBeUndefined();
  expect(marketIn('NEAR funding', M)).toBe('NEAR');
  expect(marketIn('near funding', M)).toBe('NEAR');
  expect(marketIn('$hype', M)).toBe('HYPE');
  expect(marketIn('show me near?', M)).toBe('NEAR');
  expect(marketIn('eth vs btc funding', M)).toBe('ETH');
});

it('binds the volume size to volume, with separators and suffixes', () => {
  const M = ['BTC'];
  expect(quickAsk('whales at least 50 closes over $100k volume', M)).toMatchObject({ minVolume: 100_000, minCloses: 50 });
  expect(quickAsk('whales over $1,000,000 volume', M)).toMatchObject({ minVolume: 1_000_000 });
  expect(quickAsk('makers with volume over 1.5m', M)).toMatchObject({ minVolume: 1_500_000 });
});
