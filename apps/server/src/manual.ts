// Trading by hand from the Trade tab. Each order goes to the venue as a plan order would (never a quote, so a Stop and a
// restart leave it alone; a Kill sweeps it), and its fills are the user's own: in equity and the loss limit, never in
// the market maker's or a plan's results. Markets the market maker or a plan holds are theirs alone.

import { MARKETS, usd, type Fill, type ManualKind, type ManualOrderView, type ManualRole, type MarketSym, type Side } from '@monday/core';
import { db } from './db';
import { VenueError, type MarketFeed, type OrderSpec, type Venue, type VenueFill } from './venue/types';

export class ManualError extends Error {
  constructor(message: string, public field?: string, public status = 400) {
    super(message);
  }
}

export interface ManualInput {
  sym: MarketSym;
  side: Side;
  kind: ManualKind;
  /** Base units. */
  size: number;
  leverage: number;
  /** Required for a limit; optional for a stop (a stop-limit), absent for a market order. */
  price?: number;
  /** A limit only: rest on the book (post-only), or take what it can at once and drop the rest (IOC). */
  tif?: 'post' | 'ioc';
  /** Required for a stop: the mark price that sends it. */
  triggerPrice?: number;
  reduceOnly?: boolean;
  /** Market orders only: the reduce-only take profit and stop loss placed once the entry has filled. */
  tpPrice?: number;
  slPrice?: number;
  slippageBps?: number;
}

/** What the risk checks need from the runner at the moment of the order. */
export interface ManualContext {
  /** Collateral not given out to the market maker or a plan. */
  freeUsd: number;
  /** Markets the market maker or a running plan holds. */
  taken: MarketSym[];
  /** The operator's ceiling on one position's notional while trading real funds. */
  capNotionalUsd: number | null;
}

const DEFAULT_SLIPPAGE_BPS = 50;
const FILLS_KEPT = 60;
const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const clean = (x: number) => +x.toPrecision(12);

const insOrder = db.prepare('insert or replace into manual_orders (user_id, key, json, placed_at) values (?,?,?,?)');
const delOrder = db.prepare('delete from manual_orders where user_id = ? and key = ?');

export class ManualDesk {
  private orders = new Map<string, ManualOrderView>();
  /** Markets with a request in flight: an IOC can fill before the venue names its order. */
  private placing = new Set<MarketSym>();
  private fills: Fill[] = [];
  /** Every key placed since boot (and the ones loaded): a fill can arrive after its order is forgotten. */
  private keys = new Set<string>();
  /** The leverage of the last entry per market, for the margin of a position the venue does not report one for. */
  private lev = new Map<MarketSym, number>();

  constructor(
    private userId: number,
    private feed: MarketFeed,
    private venue: () => Venue | null,
    private alert: (severity: 'info' | 'warn' | 'critical', message: string) => void,
  ) {
    for (const r of db.prepare('select json from manual_orders where user_id = ? order by placed_at').all(userId) as { json: string }[]) {
      const o = JSON.parse(r.json) as ManualOrderView;
      this.orders.set(o.key, o);
      this.keys.add(o.key);
    }
    const rows = db.prepare("select * from fills where user_id = ? and json_extract(ctx, '$.manual') = 1 order by ts desc limit ?").all(userId, FILLS_KEPT) as Record<string, never>[];
    this.fills = rows.map((r) => ({
      id: r.id, sym: r.sym, side: r.side, price: r.price, size: r.size, feeUsd: r.fee, isMaker: r.is_maker === 1, ts: r.ts, regime: r.regime ?? 'calm',
      markout1sBps: null, markout5sBps: null, markout10sBps: null, markout1mBps: null, markout5mBps: null, realizedUsd: r.realized, external: true,
    }));
  }

  /** Is this fill one of the user's hand-placed orders? */
  owns(f: VenueFill): boolean {
    return (f.orderKey != null && this.keys.has(f.orderKey)) || this.placing.has(f.sym);
  }

  onFill(f: VenueFill, reduces: boolean) {
    this.fills.unshift({
      id: f.id, sym: f.sym, side: f.side, price: f.price, size: f.size, feeUsd: f.feeUsd, isMaker: f.isMaker, ts: f.ts, regime: 'calm',
      markout1sBps: null, markout5sBps: null, markout10sBps: null, markout1mBps: null, markout5mBps: null, realizedUsd: reduces ? f.realizedUsd : null, external: true,
    });
    if (this.fills.length > FILLS_KEPT) this.fills.pop();
  }

  /** Markets with a working hand-placed order: the connection stays open while there is one. */
  active(): boolean {
    return this.orders.size > 0;
  }

  leverageOf(sym: MarketSym): number | undefined {
    return this.lev.get(sym);
  }

  views(): { orders: ManualOrderView[]; fills: Fill[] } {
    return { orders: [...this.orders.values()].sort((a, b) => b.placedAt - a.placedAt), fills: this.fills.slice(0, 40) };
  }

  /** Forget orders the venue no longer works (filled, cancelled, dropped). Only while connected: a dead socket knows nothing. */
  tick() {
    const v = this.venue();
    if (!v?.connected()) return;
    for (const key of this.orders.keys()) if (!v.working(key)) this.forget(key);
  }

  /** Check and send an order, then its take profit and stop loss. Throws ManualError or VenueError. */
  async place(input: ManualInput, ctx: ManualContext): Promise<ManualOrderView[]> {
    const v = this.venue();
    if (!v?.connected()) throw new ManualError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    const { sym, side, kind } = input;
    const spec = this.feed.specs()[sym];
    const snap = this.feed.snapshot(sym);
    if (!spec || !snap) throw new ManualError(`${sym} is not tradable right now.`, 'sym');
    if (ctx.taken.includes(sym)) throw new ManualError(`${sym} is traded by the market maker or a running plan. Pick another market, or stop that first.`, 'sym', 409);
    const long = side === 'bid';
    const pos = v.position(sym).size;

    const size = clean(roundTo(input.size, spec.sizeStep));
    if (!(size > 0)) throw new ManualError(`Too small: one ${sym} size step is ${spec.sizeStep}.`, 'size');
    if (!(input.leverage >= 1 && input.leverage <= spec.maxLeverage)) throw new ManualError(`Leverage is between 1x and ${spec.maxLeverage}x on ${sym}.`, 'leverage');
    const tick = (p: number | undefined) => (p == null ? undefined : clean(roundTo(p, spec.priceTick)));
    const price = tick(input.price), trigger = tick(input.triggerPrice), tp = tick(input.tpPrice), sl = tick(input.slPrice);

    if (kind === 'limit' && !(price! > 0)) throw new ManualError('A limit order needs a price.', 'price');
    if (kind === 'stop' && !(trigger! > 0)) throw new ManualError('A stop order needs a trigger price.', 'triggerPrice');
    // A stop buys once the price rises through its trigger and sells once it falls through it, so it must sit on that side.
    if (kind === 'stop' && (long ? trigger! <= snap.mark : trigger! >= snap.mark)) {
      throw new ManualError(`A stop ${long ? 'buy' : 'sell'} triggers ${long ? 'above' : 'below'} the mark (${snap.mark}). For the other side use a limit.`, 'triggerPrice');
    }
    // A limit that rests must not cross: Perpl rejects a post-only order that would take.
    if (kind === 'limit' && input.tif !== 'ioc') {
      if (long && snap.bestAsk != null && price! >= snap.bestAsk) throw new ManualError(`A resting buy must be under the best ask (${snap.bestAsk}). To take now, choose IOC or Market.`, 'price');
      if (!long && snap.bestBid != null && price! <= snap.bestBid) throw new ManualError(`A resting sell must be above the best bid (${snap.bestBid}). To take now, choose IOC or Market.`, 'price');
    }
    // The 1% band the market maker keeps around the oracle, wider for a limit: a typo of a zero should not reach the book.
    const ref = snap.oracle || snap.mark;
    for (const [p, field] of [[price, 'price'], [trigger, 'triggerPrice']] as const) {
      if (p != null && Math.abs(p / ref - 1) > 0.25) throw new ManualError(`More than 25% from the oracle price (${ref}). Check the price.`, field);
    }

    const reduceOnly = Boolean(input.reduceOnly);
    if (reduceOnly && !(pos !== 0 && (pos > 0) !== long)) throw new ManualError(`No ${sym} ${long ? 'short' : 'long'} position for a reduce-only ${long ? 'buy' : 'sell'} to close.`, 'reduceOnly');

    const at = price ?? trigger ?? (long ? snap.bestAsk : snap.bestBid) ?? snap.mark;
    const notional = size * at;
    if (!reduceOnly) {
      // An order against the position first closes it; only what is left opens new exposure and needs margin.
      const closing = pos !== 0 && (pos > 0) !== long ? Math.min(Math.abs(pos), size) : 0;
      const margin = ((size - closing) * at) / input.leverage;
      if (margin > ctx.freeUsd + 1e-9) throw new ManualError(`Needs ${usd(margin, 2)} of margin at ${input.leverage}x; ${usd(Math.max(0, ctx.freeUsd), 2)} is free.`, 'size');
      const after = Math.abs(pos + (long ? size : -size)) * at;
      if (ctx.capNotionalUsd != null && after > ctx.capNotionalUsd) throw new ManualError(`Position size is capped at ${usd(ctx.capNotionalUsd)} on this server while it trades real funds.`, 'size');
    }

    // The take profit and stop loss go in once the entry has filled, so they only come with a market order.
    if ((tp != null || sl != null) && kind !== 'market') throw new ManualError('Take profit and stop loss come with a market order. For a resting order, set them from the position once it fills.', 'tpPrice');
    const entryAt = (long ? snap.bestAsk : snap.bestBid) ?? snap.mark;
    if (tp != null && (long ? tp <= entryAt : tp >= entryAt)) throw new ManualError(`A take profit for a ${long ? 'long' : 'short'} sits ${long ? 'above' : 'below'} the entry (about ${entryAt}).`, 'tpPrice');
    if (sl != null && (long ? sl >= entryAt : sl <= entryAt)) throw new ManualError(`A stop loss for a ${long ? 'long' : 'short'} sits ${long ? 'below' : 'above'} the entry (about ${entryAt}).`, 'slPrice');

    const spec0: OrderSpec = {
      sym, side, size, leverage: input.leverage, close: reduceOnly || undefined,
      price: kind === 'market' ? undefined : price,
      postOnly: kind === 'limit' && input.tif !== 'ioc' ? true : undefined,
      slippageBps: kind === 'limit' && input.tif !== 'ioc' ? undefined : input.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
      trigger: kind === 'stop' ? { price: trigger!, when: long ? 'gte' : 'lte' } : undefined,
    };
    const placed: ManualOrderView[] = [];
    if (!reduceOnly) this.lev.set(sym, input.leverage);
    const entry = await this.send(v, spec0, { kind, role: reduceOnly ? 'close' : 'entry', price: price ?? null, triggerPrice: trigger ?? null });
    if (entry) placed.push(entry);
    if (tp == null && sl == null) return placed;

    // The market order has filled by now (or not at all): protect whatever it opened.
    const now = v.position(sym).size;
    if (now === 0 || (now > 0) !== long) {
      this.alert('warn', `The ${sym} market order did not fill, so no take profit or stop loss was placed.`);
      return placed;
    }
    const exit: Side = long ? 'ask' : 'bid';
    for (const [p, role] of [[tp, 'tp'], [sl, 'sl']] as const) {
      if (p == null) continue;
      try {
        const o = await this.send(v, {
          sym, side: exit, size: Math.abs(now), leverage: input.leverage, close: true, slippageBps: DEFAULT_SLIPPAGE_BPS,
          trigger: { price: p, when: (role === 'tp') === long ? 'gte' : 'lte' },
        }, { kind: 'stop', role, price: null, triggerPrice: p });
        if (o) placed.push(o);
      } catch (e) {
        this.alert('critical', `The ${sym} position is open but its ${role === 'tp' ? 'take profit' : 'stop loss'} was rejected: ${e instanceof Error ? e.message : e}. Set it again from Positions.`);
      }
    }
    return placed;
  }

  /** Reduce-only take profit and/or stop loss for the position as it stands now. */
  async protect(sym: MarketSym, tpPrice: number | undefined, slPrice: number | undefined, taken: MarketSym[]): Promise<ManualOrderView[]> {
    const v = this.venue();
    if (!v?.connected()) throw new ManualError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    if (taken.includes(sym)) throw new ManualError(`${sym} is managed by the market maker or a running plan.`, 'sym', 409);
    const spec = this.feed.specs()[sym], snap = this.feed.snapshot(sym);
    if (!spec || !snap) throw new ManualError(`${sym} is not tradable right now.`, 'sym');
    const pos = v.position(sym).size;
    if (!pos) throw new ManualError(`No ${sym} position.`, 'sym');
    const long = pos > 0;
    const tp = tpPrice == null ? undefined : clean(roundTo(tpPrice, spec.priceTick));
    const sl = slPrice == null ? undefined : clean(roundTo(slPrice, spec.priceTick));
    if (tp == null && sl == null) throw new ManualError('Give a take profit, a stop loss, or both.', 'tpPrice');
    if (tp != null && (long ? tp <= snap.mark : tp >= snap.mark)) throw new ManualError(`A take profit for a ${long ? 'long' : 'short'} sits ${long ? 'above' : 'below'} the mark (${snap.mark}).`, 'tpPrice');
    if (sl != null && (long ? sl >= snap.mark : sl <= snap.mark)) throw new ManualError(`A stop loss for a ${long ? 'long' : 'short'} sits ${long ? 'below' : 'above'} the mark (${snap.mark}).`, 'slPrice');
    // A new level replaces the old one of the same kind.
    for (const o of [...this.orders.values()]) {
      if (o.sym === sym && ((o.role === 'tp' && tp != null) || (o.role === 'sl' && sl != null))) await this.cancel(o.key);
    }
    const out: ManualOrderView[] = [];
    for (const [p, role] of [[tp, 'tp'], [sl, 'sl']] as const) {
      if (p == null) continue;
      const o = await this.send(v, {
        sym, side: long ? 'ask' : 'bid', size: Math.abs(pos), leverage: 1, close: true, slippageBps: DEFAULT_SLIPPAGE_BPS,
        trigger: { price: p, when: (role === 'tp') === long ? 'gte' : 'lte' },
      }, { kind: 'stop', role, price: null, triggerPrice: p });
      if (o) out.push(o);
    }
    return out;
  }

  /** Close one market's position at the market, and drop the take profit and stop loss that guarded it. */
  async close(sym: MarketSym, taken: MarketSym[]): Promise<void> {
    const v = this.venue();
    if (!v?.connected()) throw new ManualError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    if (taken.includes(sym)) throw new ManualError(`${sym} is managed by the market maker or a running plan; close it from there.`, 'sym', 409);
    const pos = v.position(sym).size;
    if (pos) {
      await this.send(v, { sym, side: pos > 0 ? 'ask' : 'bid', size: Math.abs(pos), leverage: 1, close: true, slippageBps: DEFAULT_SLIPPAGE_BPS }, { kind: 'market', role: 'close', price: null, triggerPrice: null });
    }
    for (const o of [...this.orders.values()]) if (o.sym === sym && o.reduceOnly) await this.cancel(o.key).catch(() => {});
  }

  /** Every market with a position that the market maker and the plans do not hold. */
  async closeAll(taken: MarketSym[]): Promise<MarketSym[]> {
    const v = this.venue();
    if (!v?.connected()) throw new ManualError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    const syms = MARKETS.filter((s) => !taken.includes(s) && v.position(s).size !== 0);
    for (const s of syms) await this.close(s, taken);
    return syms;
  }

  async cancel(key: string): Promise<void> {
    if (!this.orders.has(key)) throw new ManualError('No such order, or it is already done.', undefined, 404);
    const v = this.venue();
    if (!v?.connected()) throw new ManualError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    await v.cancelOrder(key);
    this.forget(key);
  }

  async cancelAll(): Promise<number> {
    const keys = [...this.orders.keys()];
    for (const k of keys) await this.cancel(k).catch(() => {});
    return keys.length;
  }

  private async send(v: Venue, o: OrderSpec, view: { kind: ManualKind; role: ManualRole; price: number | null; triggerPrice: number | null }): Promise<ManualOrderView | null> {
    this.placing.add(o.sym);
    let key: string;
    try {
      key = await v.placeOrder(o);
    } catch (e) {
      if (e instanceof VenueError && e.code === 'crosses_book') throw new ManualError('The price would cross the book. Use IOC or a market order to take.', 'price');
      throw e;
    } finally {
      this.placing.delete(o.sym);
    }
    const ov: ManualOrderView = {
      key, sym: o.sym, side: o.side, kind: view.kind, role: view.role, size: o.size, price: view.price, triggerPrice: view.triggerPrice,
      reduceOnly: Boolean(o.close), leverage: o.leverage, placedAt: Date.now(),
    };
    if (key) this.keys.add(key);
    // An IOC or a market order is done by the time it is acknowledged: nothing left to show or watch.
    if (!key || !v.working(key)) return null;
    this.orders.set(key, ov);
    insOrder.run(this.userId, key, JSON.stringify(ov), ov.placedAt);
    return ov;
  }

  private forget(key: string) {
    this.orders.delete(key);
    delOrder.run(this.userId, key);
  }
}
