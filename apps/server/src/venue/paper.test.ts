import { expect, it } from 'vitest';
import { createPaperDriver } from './paper';
import type { TapeTrade, VenueFill } from './types';

it('paper quotes wait their turn at their price, fill on a print beyond it, and never on the other side', async () => {
  let print: (t: TapeTrade) => void = () => {};
  const snap = { sym: 'BTC', mark: 100, oracle: 100, mid: 100, bestBid: 99.9, bestAsk: 100.1, bids: [{ price: 99, size: 2 }], asks: [], fundingRate: 0, openInterest: 0, updatedAt: Date.now() };
  const spec = { sym: 'BTC', marketId: 1, priceTick: 0.1, sizeStep: 0.001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 10 };
  const live = { kind: 'perpl', feed: { snapshot: () => snap, specs: () => ({ BTC: spec }), onTrade: (cb: typeof print) => (print = cb) } } as never;
  const v = createPaperDriver(live).open({ wallet: '0x1', accountId: 1, token: 't', secret: 's' });
  await v.connect();
  const fills: VenueFill[] = [];
  v.on('fill', (f) => fills.push(f));
  await v.setQuote('BTC', 'bid', { price: 99, size: 1 }, 1); // joins behind the 2 already resting at 99

  print({ sym: 'BTC', price: 99, size: 1.5, side: 'sell' }); // the queue ahead takes it
  print({ sym: 'BTC', price: 98.5, size: 5, side: 'buy' }); // a buy never hits a bid
  expect(fills).toHaveLength(0);

  print({ sym: 'BTC', price: 99, size: 1, side: 'sell' }); // 0.5 clears the queue, 0.5 reaches the paper bid
  expect(fills).toMatchObject([{ side: 'bid', price: 99, size: 0.5, isMaker: true }]);

  print({ sym: 'BTC', price: 98.9, size: 0.2, side: 'sell' }); // swept past it
  expect(fills[1]).toMatchObject({ side: 'bid', price: 99, size: 0.2 });
  expect(v.quote('BTC', 'bid')?.size).toBeCloseTo(0.3);
  expect(v.position('BTC').size).toBeCloseTo(0.7);
});

it('a paper quote inside the spread is first in line, and cutting its size keeps its place', async () => {
  let print: (t: TapeTrade) => void = () => {};
  const snap = { sym: 'ETH', mark: 2_500, oracle: 2_500, mid: 2_500, bestBid: 2_499.5, bestAsk: 2_500.5, bids: [{ price: 2_499.5, size: 4 }], asks: [{ price: 2_500.5, size: 4 }], fundingRate: 0, openInterest: 0, updatedAt: Date.now() };
  const spec = { sym: 'ETH', marketId: 2, priceTick: 0.01, sizeStep: 0.001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 10 };
  const live = { kind: 'perpl', feed: { snapshot: () => snap, specs: () => ({ ETH: spec }), onTrade: (cb: typeof print) => (print = cb) } } as never;
  const v = createPaperDriver(live).open({ wallet: '0x2', accountId: 1, token: 't', secret: 's' });
  await v.connect();
  const fills: VenueFill[] = [];
  v.on('fill', (f) => fills.push(f));
  await v.setQuote('ETH', 'ask', { price: 2_500.49, size: 0.1 }, 1); // a tick inside the best ask: nothing ahead
  await v.setQuote('ETH', 'ask', { price: 2_500.49, size: 0.05 }, 1); // smaller: still first
  print({ sym: 'ETH', price: 2_500.5, size: 0.02, side: 'buy' }); // a taker lifting the real best would have hit ours first
  expect(fills).toMatchObject([{ side: 'ask', price: 2_500.49, size: 0.02 }]);
});
