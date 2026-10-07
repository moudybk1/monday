import { expect, it } from 'vitest';
import { createPaperDriver } from './paper';
import type { TapeTrade, VenueFill } from './types';

it('paper quotes fill on a print beyond their price, never on one at it', async () => {
  let print: (t: TapeTrade) => void = () => {};
  const snap = { sym: 'BTC', mark: 100, oracle: 100, mid: 100, bestBid: 99.9, bestAsk: 100.1, bids: [], asks: [], fundingRate: 0, openInterest: 0, updatedAt: Date.now() };
  const spec = { sym: 'BTC', marketId: 1, priceTick: 0.1, sizeStep: 0.001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 10 };
  const live = { kind: 'perpl', feed: { snapshot: () => snap, specs: () => ({ BTC: spec }), onTrade: (cb: typeof print) => (print = cb) } } as never;
  const v = createPaperDriver(live).open({ wallet: '0x1', accountId: 1, token: 't', secret: 's' });
  await v.connect();
  const fills: VenueFill[] = [];
  v.on('fill', (f) => fills.push(f));
  await v.setQuote('BTC', 'bid', { price: 99, size: 1 }, 1);

  print({ sym: 'BTC', price: 99, size: 5, side: 'sell' }); // at the bid: the real orders queued there fill first
  print({ sym: 'BTC', price: 98.5, size: 5, side: 'buy' }); // a buy never hits a bid
  expect(fills).toHaveLength(0);

  print({ sym: 'BTC', price: 98.9, size: 0.4, side: 'sell' }); // swept past it
  expect(fills).toMatchObject([{ side: 'bid', price: 99, size: 0.4, isMaker: true }]);
  expect(v.quote('BTC', 'bid')?.size).toBeCloseTo(0.6);
  expect(v.position('BTC').size).toBeCloseTo(0.4);
});
