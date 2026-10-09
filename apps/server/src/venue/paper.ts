// Paper trading: Perpl's real market data with simulated orders. Prices, the book and the candles
// are Perpl's own, so the chart matches Perpl's site. Orders never reach Perpl's trading API: they
// rest in a SimVenue and fill the way a real order at that price would, queue and all.

import { MARKETS, type MarketSym, type QuoteTarget, type Side } from '@monday/core';
import { SIM_BALANCE_USD, SimVenue, type SimMarket, type SimStore } from './sim';
import type { MarketFeed, Venue, VenueCredentials, VenueDriver } from './types';

const EPS = 1e-9;

/**
 * A paper order keeps its place in line like a real one: it joins behind whatever rests at its price when it is
 * placed, prints at that price work through that queue first, and cancellations ahead of it (the level shrinking by
 * more than the prints explain) move it forward. A print beyond its price, or the opposite best crossing it, fills it
 * outright. Before this the paper venue filled only when price traded through a quote, which is exactly the toxic
 * subset of real fills, and made a quote at the front of the book look as if it never filled.
 */
export class PaperVenue extends SimVenue {
  /** Per slot: the price the queue was joined at and the base units still ahead. */
  private line = new Map<string, { price: number; ahead: number }>();

  constructor(private feed: MarketFeed, creds: VenueCredentials, onClose: () => void, store?: SimStore) {
    super(marketOf(feed), creds, onClose, store);
  }

  override async setQuote(sym: MarketSym, side: Side, target: QuoteTarget | null): Promise<void> {
    const before = this.quote(sym, side);
    await super.setQuote(sym, side, target);
    const key = `${sym}:${side}`;
    if (!target) return void this.line.delete(key);
    // A change that only cuts size keeps the place in line; a new price, or more size, joins the back of the queue.
    if (before && Math.abs(before.price - target.price) <= EPS && target.size <= before.size + EPS) return;
    this.line.set(key, { price: target.price, ahead: this.restingAt(sym, side, target.price) });
  }

  /** What the real book shows at a price on one side: zero inside the spread or at an empty level. */
  private restingAt(sym: MarketSym, side: Side, price: number): number {
    const snap = this.feed.snapshot(sym);
    const tick = this.feed.specs()[sym]?.priceTick ?? 0;
    return (side === 'bid' ? snap?.bids : snap?.asks)?.find((l) => Math.abs(l.price - price) <= tick / 2 + EPS)?.size ?? 0;
  }

  /** Base units still ahead of the paper order on `side`, or null without one. For the dashboard. */
  ahead(sym: MarketSym, side: Side): number | null {
    return this.quote(sym, side) ? this.line.get(`${sym}:${side}`)?.ahead ?? 0 : null;
  }

  /** A real print that hit makers on `side` at `price`: whatever the queue ahead does not absorb reaches the paper order. */
  print(sym: MarketSym, side: Side, price: number, size: number): void {
    const q = this.quote(sym, side);
    if (!q) return;
    if (side === 'bid' ? price < q.price - EPS : price > q.price + EPS) return this.fill(sym, side, q.price, Math.min(q.size, size), true); // swept past it
    if (Math.abs(price - q.price) > EPS) return; // a print behind the order never reaches it
    const l = this.line.get(`${sym}:${side}`);
    const eaten = l ? Math.min(l.ahead, size) : 0;
    if (l) l.ahead -= eaten;
    const left = size - eaten;
    if (left > EPS) this.fill(sym, side, q.price, Math.min(q.size, left), true);
  }

  /** Between prints: the opposite best crossing an order fills it, and a level that shrank moves the order forward. */
  sweep(): void {
    for (const sym of MARKETS) {
      const snap = this.feed.snapshot(sym);
      if (!snap) continue;
      const bid = this.quote(sym, 'bid'), ask = this.quote(sym, 'ask');
      if (bid && snap.bestAsk != null && snap.bestAsk <= bid.price) this.fill(sym, 'bid', bid.price, bid.size, true);
      if (ask && snap.bestBid != null && snap.bestBid >= ask.price) this.fill(sym, 'ask', ask.price, ask.size, true);
      for (const side of ['bid', 'ask'] as const) {
        const l = this.line.get(`${sym}:${side}`);
        if (l) l.ahead = Math.min(l.ahead, this.restingAt(sym, side, l.price));
      }
    }
  }
}

const marketOf = (feed: MarketFeed): SimMarket => ({
  snapshot: (sym) => feed.snapshot(sym),
  specs: () => feed.specs(),
  price: (sym) => feed.snapshot(sym)?.mark ?? 0,
});

export function createPaperDriver(live: VenueDriver, store?: SimStore): VenueDriver {
  const venues = new Set<PaperVenue>();
  setInterval(() => {
    for (const v of venues) v.sweep();
  }, 250).unref();
  // A sell print hits bids, a buy print lifts asks.
  live.feed.onTrade?.((t) => {
    const side: Side = t.side === 'sell' ? 'bid' : 'ask';
    for (const v of venues) v.print(t.sym, side, t.price, t.size);
  });

  return {
    kind: 'paper',
    feed: live.feed,
    // Every wallet gets a paper account; nothing is deposited anywhere.
    detectAccount: async (wallet) => ({ accountId: 1000 + (parseInt(wallet.slice(-4), 16) % 9000), balanceUsd: store?.load(wallet)?.balance ?? SIM_BALANCE_USD }),
    minDepositUsd: () => 0,
    open(creds: VenueCredentials): Venue {
      const v = new PaperVenue(live.feed, creds, () => venues.delete(v), store);
      venues.add(v);
      return v;
    },
  };
}
