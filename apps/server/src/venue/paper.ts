// Paper trading: Perpl's real market data with simulated orders. Prices, the book and the candles
// are Perpl's own, so the chart matches Perpl's site. Orders never reach Perpl's trading API: they
// rest in a SimVenue and fill only when the real market trades through them.

import { MARKETS } from '@monday/core';
import { SIM_BALANCE_USD, SimVenue, type SimMarket, type SimStore } from './sim';
import type { Venue, VenueCredentials, VenueDriver } from './types';

export function createPaperDriver(live: VenueDriver, store?: SimStore): VenueDriver {
  const venues = new Set<SimVenue>();
  const market: SimMarket = {
    snapshot: (sym) => live.feed.snapshot(sym),
    specs: () => live.feed.specs(),
    price: (sym) => live.feed.snapshot(sym)?.mark ?? 0,
  };

  // A resting bid fills once the real best ask reaches it, an ask once the real best bid does.
  // Conservative on purpose: it ignores queue position and the prints that would hit a quote first.
  setInterval(() => {
    for (const v of venues) {
      for (const sym of MARKETS) {
        const snap = live.feed.snapshot(sym);
        if (!snap) continue;
        const bid = v.quote(sym, 'bid');
        if (bid && snap.bestAsk != null && snap.bestAsk <= bid.price) v.fill(sym, 'bid', bid.price, bid.size, true);
        const ask = v.quote(sym, 'ask');
        if (ask && snap.bestBid != null && snap.bestBid >= ask.price) v.fill(sym, 'ask', ask.price, ask.size, true);
      }
    }
  }, 250).unref();

  // A print beyond a resting quote means a taker swept past its price, between two book polls or within one: the
  // quote would have been hit first. Strictly beyond: at the same price, the real orders queued there come first.
  live.feed.onTrade?.((t) => {
    const side = t.side === 'sell' ? 'bid' : 'ask';
    for (const v of venues) {
      const q = v.quote(t.sym, side);
      if (q && (side === 'bid' ? t.price < q.price : t.price > q.price)) v.fill(t.sym, side, q.price, Math.min(q.size, t.size), true);
    }
  });

  return {
    kind: 'paper',
    feed: live.feed,
    // Every wallet gets a paper account; nothing is deposited anywhere.
    detectAccount: async (wallet) => ({ accountId: 1000 + (parseInt(wallet.slice(-4), 16) % 9000), balanceUsd: store?.load(wallet)?.balance ?? SIM_BALANCE_USD }),
    minDepositUsd: () => 0,
    open(creds: VenueCredentials): Venue {
      const v = new SimVenue(market, creds, () => venues.delete(v), store);
      venues.add(v);
      return v;
    },
  };
}
