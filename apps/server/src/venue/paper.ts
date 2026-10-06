// Paper trading: Perpl's real market data with simulated orders. Prices, the book and the candles
// are Perpl's own, so the chart matches Perpl's site. Orders never reach Perpl's trading API: they
// rest in a SimVenue and fill only when the real book trades through them.

import { MARKETS } from '@monday/core';
import { SIM_BALANCE_USD, SimVenue, type SimMarket } from './sim';
import type { Venue, VenueCredentials, VenueDriver } from './types';

export function createPaperDriver(live: VenueDriver): VenueDriver {
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

  return {
    kind: 'paper',
    feed: live.feed,
    // Every wallet gets a paper account; nothing is deposited anywhere.
    detectAccount: async (wallet) => ({ accountId: 1000 + (parseInt(wallet.slice(-4), 16) % 9000), balanceUsd: SIM_BALANCE_USD }),
    minDepositUsd: () => 0,
    open(creds: VenueCredentials): Venue {
      const v = new SimVenue(market, creds, () => venues.delete(v));
      venues.add(v);
      return v;
    },
  };
}
