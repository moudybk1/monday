// Simulated world: prices, a thin order book, taker flow and smart-money trades.
// It stands in for Perpl and Nansen until real keys are configured, and it is
// built so the thing Monday claims to exploit is actually present: smart-money
// flow moves price over the following minutes.

import { randomUUID } from 'node:crypto';
import { mulberry32, type MarketSpec, type MarketSym, type QuoteTarget, type Side, type SmartTrade, MARKETS } from '@monday/core';
import {
  VenueError, type Candle, type MarketFeed, type MarketSnapshot, type Venue, type VenueAccount, type VenueCredentials,
  type VenueDriver, type VenueEvents, type VenueFill, type VenuePosition,
} from './types';

// Mirrors Perpl testnet's /pub/context at the time of writing.
const SPECS: Record<MarketSym, MarketSpec> = {
  BTC: { sym: 'BTC', marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15 },
  ETH: { sym: 'ETH', marketId: 32, priceTick: 0.01, sizeStep: 0.001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 12 },
  SOL: { sym: 'SOL', marketId: 48, priceTick: 0.01, sizeStep: 0.001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 10 },
};
const START: Record<MarketSym, number> = { BTC: 85_200, ETH: 2_690, SOL: 119.2 };
const VOL_1M_BPS: Record<MarketSym, number> = { BTC: 2.6, ETH: 3.4, SOL: 4.6 };
const FLOW_SCALE: Record<MarketSym, number> = { BTC: 1, ETH: 0.8, SOL: 0.6 };

const DAY = 86_400_000;
const HISTORY_MS = 7 * DAY;
const IMPACT_BPS_PER_USD = 24e-6; // $1M of net smart-money buying drifts price about +24 bps
const PRESSURE_HALF_LIFE_MIN = 8;
const TAKER_RATE = 0.05; // taker orders per second per market
const TAKER_MEDIAN_USD = 1_200;
const LABELS = ['Smart HL Perps Trader', 'Smart HL Perps Trader', 'Smart HL Perps Trader', 'Fund', '30D Smart Trader', '90D Smart Trader', '180D Smart Trader'];
const BUY_ACTIONS = ['Buy - Open Long', 'Buy - Open Long', 'Buy - Add Long', 'Buy - Close Short', 'Buy - Reduce Short'];
const SELL_ACTIONS = ['Sell - Open Short', 'Sell - Open Short', 'Sell - Add Short', 'Sell - Close Long', 'Sell - Reduce Long'];
export const SIM_BALANCE_USD = 1_000;

interface Coin {
  sym: MarketSym;
  price: number;
  pressure: number; // bps of drift still to be applied
  busy: boolean; // background activity regime
  burst: { dir: 1 | -1; until: number } | null;
  candles: Candle[];
  cur: Candle;
  trades: SmartTrade[];
  levels: { off: number; usd: number }[][]; // [bids, asks], offsets in bps from mid
  funding: number;
}

export class SimWorld implements VenueDriver, MarketFeed {
  kind = 'sim' as const;
  feed: MarketFeed = this;
  private rnd: () => number;
  private coins = {} as Record<MarketSym, Coin>;
  private traders: { address: string; label: string }[] = [];
  private venues = new Set<SimVenue>();
  private timer: NodeJS.Timeout | null = null;
  private now = 0;

  constructor(seed = 20261005, private store?: SimStore) {
    this.rnd = mulberry32(seed);
    for (let i = 0; i < 48; i++) this.traders.push({ address: this.hex(40), label: LABELS[Math.floor(this.rnd() * LABELS.length)] });
    const end = Math.floor(Date.now() / 60_000) * 60_000;
    for (const sym of MARKETS) {
      const c: Coin = {
        sym, price: START[sym] * (1 + this.gauss() * 0.02), pressure: 0, busy: false, burst: null, candles: [],
        cur: { t: end - HISTORY_MS, o: 0, h: 0, l: 0, c: 0 }, trades: [],
        levels: [0, 1].map(() => Array.from({ length: 14 }, (_, i) => ({ off: 2.2 + i * 1.25 + this.rnd() * 0.7, usd: this.levelUsd(i) }))),
        funding: 0.0000125,
      };
      c.cur.o = c.cur.h = c.cur.l = c.cur.c = c.price;
      this.coins[sym] = c;
      // 7 days of history at one-minute steps, so z-score baselines and the evidence page have data on boot.
      for (let t = end - HISTORY_MS; t < end; t += 60_000) this.step(c, t, 60);
    }
    this.now = end;
  }

  // ---- random helpers ----
  private gauss(): number {
    const u = Math.max(this.rnd(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rnd());
  }
  private poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.rnd(); } while (p > L);
    return k - 1;
  }
  private hex(n: number): string {
    let s = '0x';
    for (let i = 0; i < n; i++) s += Math.floor(this.rnd() * 16).toString(16);
    return s;
  }
  private levelUsd(i: number): number {
    return (700 + this.rnd() * 2600) * (1 + i * 0.35);
  }

  // ---- world dynamics ----
  /** Advance one coin by dtSec ending at t + dtSec. */
  private step(c: Coin, t: number, dtSec: number) {
    const dtMin = dtSec / 60;
    const end = t + dtSec * 1000;

    // Activity regime and bursts
    if (this.rnd() < dtMin / (c.busy ? 25 : 45)) c.busy = !c.busy;
    if (c.burst && end >= c.burst.until) c.burst = null;
    if (!c.burst && this.rnd() < dtMin / 170) c.burst = { dir: this.rnd() < 0.5 ? 1 : -1, until: end + (3 + this.rnd() * 4) * 60_000 };

    // Smart-money trades
    const scale = FLOW_SCALE[c.sym];
    const n = this.poisson((c.burst ? 4.5 : 1.2) * dtMin);
    for (let i = 0; i < n; i++) {
      const dir: 1 | -1 = c.burst ? (this.rnd() < 0.86 ? c.burst.dir : (-c.burst.dir as 1 | -1)) : this.rnd() < 0.5 ? 1 : -1;
      const median = c.burst ? 46_000 : 9_000;
      const valueUsd = Math.round(Math.exp(Math.log(median * scale) + this.gauss() * (c.burst ? 0.75 : 0.55)));
      this.addTrade(c, dir, valueUsd, t + this.rnd() * dtSec * 1000);
    }

    // Price: delayed impact from flow plus noise. Bursts raise volatility.
    const decay = Math.pow(0.5, dtMin / PRESSURE_HALF_LIFE_MIN);
    const drift = c.pressure * (1 - decay);
    c.pressure *= decay;
    const sigma = VOL_1M_BPS[c.sym] * (c.burst ? 1.7 : c.busy ? 1.15 : 0.9);
    c.price *= 1 + (drift + sigma * Math.sqrt(dtMin) * this.gauss()) / 1e4;

    // Candle bookkeeping
    if (end - c.cur.t > 60_000) {
      c.candles.push(c.cur);
      if (c.candles.length > 8 * 1440) c.candles.shift();
      c.cur = { t: Math.floor((end - 1) / 60_000) * 60_000, o: c.cur.c, h: c.cur.c, l: c.cur.c, c: c.cur.c };
    }
    if (dtSec >= 60) {
      // History steps: the minute's range is the open-close path plus how far taker sweeps printed into the book.
      const pBuy = this.buyBias(c);
      c.cur.h = Math.max(c.cur.o, c.price) * (1 + this.minuteReach(dtSec * pBuy) / 1e4);
      c.cur.l = Math.min(c.cur.o, c.price) * (1 - this.minuteReach(dtSec * (1 - pBuy)) / 1e4);
    } else {
      c.cur.h = Math.max(c.cur.h, c.price);
      c.cur.l = Math.min(c.cur.l, c.price);
    }
    c.cur.c = c.price;
  }

  private addTrade(c: Coin, dir: 1 | -1, valueUsd: number, ts: number) {
    const who = this.traders[Math.floor(this.rnd() * this.traders.length)];
    const actions = dir === 1 ? BUY_ACTIONS : SELL_ACTIONS;
    const action = actions[Math.floor(this.rnd() * actions.length)];
    c.trades.push({
      hash: this.hex(64), sym: c.sym, action, side: action.includes('Long') ? 'Long' : 'Short', valueUsd, priceUsd: c.price,
      amount: valueUsd / c.price, type: this.rnd() < 0.7 ? 'Market' : 'Limit', trader: who.address, label: who.label, ts: Math.floor(ts), fetchedAt: Math.floor(ts),
    });
    c.pressure += dir * valueUsd * IMPACT_BPS_PER_USD / Math.sqrt(FLOW_SCALE[c.sym]);
  }

  /** Informed takers lean with smart-money pressure. */
  private buyBias(c: Coin): number {
    return 0.5 + 0.45 * Math.tanh(c.pressure / 4);
  }
  private takerUsd(): number {
    return Math.exp(Math.log(TAKER_MEDIAN_USD) + this.gauss() * 0.9);
  }
  /** How many bps from mid a taker order of this size prints through the typical ambient book. */
  private sweepReach(usd: number): number {
    let left = usd, reach = 0;
    for (let i = 0; i < 14 && left > 0; i++) {
      reach = 2.55 + i * 1.25;
      left -= 2_000 * (1 + i * 0.35);
    }
    return reach;
  }
  /** Deepest print on one side over `seconds` of taker flow. */
  private minuteReach(seconds: number): number {
    let reach = 0;
    for (let n = this.poisson(TAKER_RATE * seconds); n > 0; n--) reach = Math.max(reach, this.sweepReach(this.takerUsd()));
    return reach;
  }

  private tick() {
    const prev = this.now;
    this.now = Date.now();
    const dt = Math.min(5, Math.max(0.2, (this.now - prev) / 1000));
    for (const sym of MARKETS) {
      const c = this.coins[sym];
      this.step(c, this.now - dt * 1000, dt);
      // Resting depth leans with informed pressure: buyers stack the bid and thin the ask, which is what the book reflex reads.
      const bias = this.buyBias(c);
      c.levels.forEach((side, s) => { for (let i = 0; i < side.length; i++) if (this.rnd() < 0.12) side[i].usd = this.levelUsd(i) * 2 * (s ? 1 - bias : bias); });
      // The collector owns history; the world only needs to answer recent polls.
      if (c.trades.length && c.trades[0].ts < this.now - 130 * 60_000) c.trades = c.trades.filter((t) => t.ts > this.now - 120 * 60_000);
      this.takerFlow(c);
    }
  }

  /** Taker orders sweep the book. Informed takers lean with smart-money pressure. */
  private takerFlow(c: Coin) {
    const spec = SPECS[c.sym];
    for (const v of this.venues) {
      for (const side of ['bid', 'ask'] as const) {
        const q = v.quote(c.sym, side);
        if (!q) continue;
        // Price moved through the quote: it was picked off.
        if ((side === 'bid' && c.price <= q.price) || (side === 'ask' && c.price >= q.price)) v.fill(c.sym, side, q.price, q.size, true);
      }
    }
    if (this.rnd() > TAKER_RATE) return;
    const buy = this.rnd() < this.buyBias(c);
    let usd = this.takerUsd();
    const side: Side = buy ? 'ask' : 'bid'; // a taker buy hits asks
    const ambient = c.levels[buy ? 1 : 0];
    const queue: { dist: number; usd: number; venue?: SimVenue; q?: QuoteTarget }[] = ambient.map((l) => ({ dist: l.off, usd: l.usd }));
    for (const v of this.venues) {
      const q = v.quote(c.sym, side);
      if (q) queue.push({ dist: Math.abs(q.price / c.price - 1) * 1e4, usd: q.price * q.size, venue: v, q });
    }
    queue.sort((a, b) => a.dist - b.dist);
    for (const l of queue) {
      if (usd <= 0) break;
      const take = Math.min(usd, l.usd);
      usd -= take;
      // The print widens this minute's candle, exactly as it would on a real tape.
      if (buy) c.cur.h = Math.max(c.cur.h, c.price * (1 + l.dist / 1e4));
      else c.cur.l = Math.min(c.cur.l, c.price * (1 - l.dist / 1e4));
      if (l.venue && l.q) {
        const size = Math.floor(take / l.q.price / spec.sizeStep + 1e-9) * spec.sizeStep;
        if (size > 0) l.venue.fill(c.sym, side, l.q.price, Math.min(size, l.q.size), true);
      }
    }
  }

  // ---- extras the simulator offers beyond the driver interface ----
  smartTrades(sinceMs: number): SmartTrade[] {
    return MARKETS.flatMap((s) => this.coins[s].trades.filter((t) => t.ts > sinceMs));
  }
  /** Start a smart-money burst on demand, so the reflex can be demonstrated without waiting. */
  triggerBurst(sym: MarketSym, dir: 1 | -1) {
    const c = this.coins[sym];
    c.burst = { dir, until: Date.now() + 4 * 60_000 };
    for (let i = 0; i < 4; i++) this.addTrade(c, dir, Math.round((90_000 + this.rnd() * 160_000) * FLOW_SCALE[sym]), Date.now() - i * 900);
  }
  price(sym: MarketSym): number {
    return this.coins[sym].price;
  }

  // ---- MarketFeed ----
  async start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  specs() {
    return SPECS;
  }
  snapshot(sym: MarketSym): MarketSnapshot {
    const c = this.coins[sym];
    const spec = SPECS[sym];
    const tick = spec.priceTick;
    const lv = (side: 0 | 1) =>
      c.levels[side].map((l) => {
        const raw = c.price * (1 + ((side ? 1 : -1) * l.off) / 1e4);
        const price = Number(((side ? Math.ceil(raw / tick) : Math.floor(raw / tick)) * tick).toFixed(8));
        return { price, size: Number((l.usd / price).toFixed(6)) };
      });
    const bids = lv(0), asks = lv(1);
    const mid = (bids[0].price + asks[0].price) / 2;
    return {
      sym, mark: c.price * (1 + 0.000004), oracle: c.price, mid, bestBid: bids[0].price, bestAsk: asks[0].price, bids, asks,
      fundingRate: c.funding, openInterest: 180_000 / c.price, updatedAt: this.timer ? this.now : Date.now(),
    };
  }
  async candles(sym: MarketSym, fromMs: number, toMs: number): Promise<Candle[]> {
    return this.coins[sym].candles.filter((k) => k.t >= fromMs && k.t < toMs);
  }

  // ---- VenueDriver ----
  async detectAccount(wallet: string) {
    return { accountId: 1000 + (parseInt(wallet.slice(-4), 16) % 9000), balanceUsd: this.store?.load(wallet)?.balance ?? SIM_BALANCE_USD };
  }
  minDepositUsd() {
    return 100;
  }
  open(creds: VenueCredentials): Venue {
    const v = new SimVenue(this, creds, () => this.venues.delete(v), this.store);
    this.venues.add(v);
    return v;
  }
}

/** What a simulated account needs from its market: the simulator's own, or Perpl's real feed (paper trading). */
export interface SimMarket {
  snapshot(sym: MarketSym): MarketSnapshot | null;
  specs(): Partial<Record<MarketSym, MarketSpec>>;
  price(sym: MarketSym): number;
}

/** Where simulated accounts live between restarts. Keyed by wallet; the server backs it with SQLite (db.ts). */
export interface SimStore {
  load(wallet: string): { balance: number; positions: Partial<Record<MarketSym, VenuePosition>> } | null;
  save(wallet: string, balance: number, positions: Partial<Record<MarketSym, VenuePosition>>): void;
}

export class SimVenue implements Venue {
  private up = false;
  private balance = SIM_BALANCE_USD;
  private pos = {} as Record<MarketSym, VenuePosition>;
  private quotes = new Map<string, QuoteTarget>();
  private handlers: { [E in keyof VenueEvents]?: VenueEvents[E][] } = {};

  constructor(private world: SimMarket, private creds: VenueCredentials, private onClose: () => void, private store?: SimStore) {
    // A restart picks the account up where it was: same balance, same positions. Resting quotes are not kept.
    const saved = store?.load(creds.wallet);
    if (saved) {
      this.balance = saved.balance;
      this.pos = saved.positions as Record<MarketSym, VenuePosition>;
    }
  }

  /** Write balance and positions. The runner calls this inside the transaction that records the fill. */
  persist() {
    this.store?.save(this.creds.wallet, this.balance, this.pos);
  }

  async connect(): Promise<VenueAccount> {
    // Magic values so every onboarding error state can be exercised without a real key.
    if (!this.creds.token || !this.creds.secret) throw new VenueError('bad_signature', 'Token or secret is empty.');
    if (/^bad/i.test(this.creds.secret)) throw new VenueError('bad_signature', 'Signature rejected. Check that the secret matches the token.');
    if (/^read/i.test(this.creds.token)) throw new VenueError('read_only_key', 'This key cannot trade. Create a key with trade scope.');
    this.up = true;
    return this.account();
  }
  close() {
    this.up = false;
    this.quotes.clear();
    this.onClose();
  }
  connected() {
    return this.up;
  }
  account(): VenueAccount {
    return { accountId: this.creds.accountId, balanceUsd: this.balance, canTrade: true };
  }
  position(sym: MarketSym): VenuePosition {
    return this.pos[sym] ?? { size: 0, entryPrice: 0 };
  }
  quote(sym: MarketSym, side: Side): QuoteTarget | null {
    return this.quotes.get(`${sym}:${side}`) ?? null;
  }
  async setQuote(sym: MarketSym, side: Side, target: QuoteTarget | null): Promise<void> {
    if (!this.up) throw new VenueError('disconnected', 'Not connected.');
    const key = `${sym}:${side}`;
    if (!target) return void this.quotes.delete(key);
    const snap = this.world.snapshot(sym);
    if (!snap?.bestBid || !snap.bestAsk) throw new VenueError('rejected', 'No market data for this market yet.');
    if ((side === 'bid' && target.price >= snap.bestAsk) || (side === 'ask' && target.price <= snap.bestBid)) {
      throw new VenueError('crosses_book', 'PostOnly order would cross the book.');
    }
    this.quotes.set(key, { ...target });
  }
  async cancelAll() {
    this.quotes.clear();
  }
  async flatten() {
    for (const sym of MARKETS) {
      const p = this.position(sym);
      if (p.size === 0) continue;
      const side: Side = p.size > 0 ? 'ask' : 'bid';
      const px = this.world.price(sym) * (1 + (side === 'ask' ? -2 : 2) / 1e4); // exit slippage
      this.fill(sym, side, px, Math.abs(p.size), false);
    }
  }
  on<E extends keyof VenueEvents>(event: E, cb: VenueEvents[E]) {
    (this.handlers[event] ??= [] as never[]).push(cb as never);
  }

  /** Called by the world when a taker hits this account's quote. */
  fill(sym: MarketSym, side: Side, price: number, size: number, isMaker: boolean) {
    const spec = this.world.specs()[sym]!;
    const p = this.position(sym);
    const signed = side === 'bid' ? size : -size;
    const reducing = p.size !== 0 && Math.sign(p.size) !== Math.sign(signed) ? Math.min(Math.abs(p.size), size) : 0;
    const opening = size - reducing;
    const realizedUsd = reducing * (price - p.entryPrice) * Math.sign(p.size);
    // Perpl charges the fee on every fill that changes position size, closes included.
    const feeUsd = (size * price * (isMaker ? spec.makerFeeBps : spec.takerFeeBps)) / 1e4;
    const newSize = Number((p.size + signed).toFixed(8));
    let entry = p.entryPrice;
    if (newSize === 0) entry = 0;
    else if (reducing === 0) entry = (Math.abs(p.size) * p.entryPrice + size * price) / (Math.abs(p.size) + size);
    else if (opening > 0) entry = price; // flipped through zero
    this.pos[sym] = { size: newSize, entryPrice: entry };
    this.balance += realizedUsd - feeUsd;

    if (isMaker) {
      const key = `${sym}:${side}`;
      const q = this.quotes.get(key);
      if (q) {
        const left = Number((q.size - size).toFixed(8));
        if (left < spec.sizeStep) this.quotes.delete(key);
        else this.quotes.set(key, { price: q.price, size: left });
      }
    }
    // Unique across accounts and restarts: the wallet plus a random event id.
    const f: VenueFill = { id: `sim:${this.creds.wallet.toLowerCase()}:${randomUUID()}`, sym, side, price, size, feeUsd, realizedUsd, isMaker, ts: Date.now() };
    for (const cb of this.handlers.fill ?? []) cb(f);
  }
}
