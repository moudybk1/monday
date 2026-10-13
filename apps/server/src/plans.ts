// Agentic Trade and TWAP for one account: the user's own trade, carried out on the runner's venue connection.
// Monday watches the entry, so a server that is down simply does not enter. Once a position exists its stop loss and
// take profit rest on the exchange, linked to the position: they hold whatever happens to Monday, and the exchange
// drops the other one as soon as either closes the position.

import {
  OUTCOME_LABEL, PLAN_RULES, planNumbers, planProblems, priceAway, usd,
  type MarketSym, type PlanInput, type PlanOutcome, type PlanStatus, type PlanView, type Side,
} from '@monday/core';
import { db, journal } from './db';
import { VenueError, type MarketFeed, type MarketSnapshot, type OrderSpec, type Venue, type VenueFill } from './venue/types';

/** A plan cannot go: the field and the words the setup page shows next to it. */
export class PlanError extends Error {
  constructor(message: string, public field?: string, public status = 400) {
    super(message);
  }
}

interface PlanState {
  /** The resting limit entry, or the TWAP slice working now. */
  entryKey: string | null;
  slKey: string | null;
  tpKey: string | null;
  /** Base units opened and closed, and the cost of the opening fills. */
  filled: number;
  cost: number;
  closed: number;
  realized: number;
  fees: number;
  makerSize: number;
  /** Which of the plan's exits filled last. */
  exitBy: 'sl' | 'tp' | null;
  /** Fixed at the first fill: from that fill's price, or from the TWAP's arrival price. */
  slPrice: number | null;
  tpPrice: number | null;
  /** Slippage for the stop's next placing: it widens each time a fired stop leaves part of the position open. */
  slSlipBps: number;
  slFailures: number;
  closing: boolean;
  /** When a market or breakout entry went out: with nothing filled a few seconds later, the book was too thin. */
  sentAt: number;
  /** TWAP: the mark at the start, the schedule and the slice working now. */
  arrival: number | null;
  slicesDone: number;
  nextAt: number | null;
  sliceEnds: number | null;
  sliceTarget: number;
  sliceFrom: number;
  slicePrice: number | null;
  chases: number;
  retryAt: number;
  note: string;
}

interface Plan {
  id: number;
  input: PlanInput;
  status: PlanStatus;
  outcome: PlanOutcome | null;
  createdAt: number;
  endedAt: number | null;
  targetSize: number;
  st: PlanState;
}

const insPlan = db.prepare('insert into plans (user_id, kind, sym, input, state, status, target_size, created_at) values (?,?,?,?,?,?,?,?)');
const savePlan = db.prepare('update plans set state = ?, status = ?, outcome = ?, ended_at = ? where id = ?');

/** Entries and the exits Monday sends itself: market orders taken at most this far from the mark. */
const ENTRY_SLIP_BPS = 50;
const EXIT_SLIP_BPS = 100;
/** A stop that fired and left part of the position open is placed again with this much more room, up to the cap. */
const SL_SLIP_STEP_BPS = 100;
const SL_SLIP_MAX_BPS = 500;
/** Perpl refuses an order more than 1% from its oracle price; a limit entry waits until it is inside 0.9%. */
const BAND = 0.009;

const fresh = (): PlanState => ({
  entryKey: null, slKey: null, tpKey: null, filled: 0, cost: 0, closed: 0, realized: 0, fees: 0, makerSize: 0, exitBy: null,
  slPrice: null, tpPrice: null, slSlipBps: EXIT_SLIP_BPS, slFailures: 0, closing: false, sentAt: 0,
  arrival: null, slicesDone: 0, nextAt: null, sliceEnds: null, sliceTarget: 0, sliceFrom: 0, slicePrice: null, chases: 0, retryAt: 0, note: '',
});

export class PlanBook {
  private plans = new Map<number, Plan>();
  /** Every order key a plan placed, so its fills (late ones too) are claimed. */
  private keys = new Map<string, number>();
  /** A request in flight per plan: one at a time, so a tick never sends the same order twice. */
  private busy = new Set<number>();
  /** Fills that land before the order that made them is named (an IOC fills at once) belong to the plan placing it. */
  private placing = new Map<MarketSym, number>();

  constructor(
    private userId: number,
    private feed: MarketFeed,
    private venue: () => Venue | null,
    private alert: (severity: 'info' | 'warn' | 'critical', message: string) => void,
  ) {
    const rows = db.prepare("select * from plans where user_id = ? and (status != 'done' or id in (select id from plans where user_id = ? order by id desc limit 12)) order by id")
      .all(userId, userId) as Record<string, never>[];
    for (const r of rows) {
      const p: Plan = { id: r.id, input: JSON.parse(r.input), status: r.status, outcome: r.outcome, createdAt: r.created_at, endedAt: r.ended_at, targetSize: r.target_size, st: { ...fresh(), ...JSON.parse(r.state) } };
      this.plans.set(p.id, p);
      for (const k of [p.st.entryKey, p.st.slKey, p.st.tpKey]) if (k) this.keys.set(k, p.id);
    }
  }

  running(): Plan[] {
    return [...this.plans.values()].filter((p) => p.status !== 'done');
  }
  markets(): MarketSym[] {
    return this.running().map((p) => p.input.sym);
  }

  /** Check and start a plan. Throws PlanError with the field to fix. */
  create(input: PlanInput, makerMarkets: MarketSym[]): PlanView {
    const v = this.venue();
    if (!v?.connected()) throw new PlanError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    const spec = this.feed.specs()[input.sym];
    const mark = this.feed.snapshot(input.sym)?.mark ?? null;
    const problems = planProblems(input, spec, { mark, balanceUsd: v.account().balanceUsd, makerMarkets, planMarkets: this.markets(), activePlans: this.running().length });
    const first = Object.entries(problems)[0];
    if (first) throw new PlanError(first[1], first[0]);
    // One position per market on Perpl: a plan in a market that already holds one would take it over.
    const held = v.position(input.sym).size;
    if (held) throw new PlanError(`This account already holds a ${input.sym} position (${+held.toFixed(6)}). Close it first, or pick another market.`, 'sym');
    const n = planNumbers(input, spec!, mark!);
    const now = Date.now();
    const st = fresh();
    if (input.kind === 'twap') Object.assign(st, { arrival: mark, nextAt: now });
    const status: PlanStatus = input.kind === 'twap' || input.entry === 'market' ? 'entering' : 'waiting';
    const id = Number(insPlan.run(this.userId, input.kind, input.sym, JSON.stringify(input), JSON.stringify(st), status, n.size, now).lastInsertRowid);
    const p: Plan = { id, input, status, outcome: null, createdAt: now, endedAt: null, targetSize: n.size, st };
    this.plans.set(id, p);
    journal(this.userId, 'plan_start', input.sym, n.notionalUsd, { plan: id, input, size: n.size, ref: n.ref, slPrice: n.slPrice, tpPrice: n.tpPrice, lossUsd: n.lossUsd });
    this.step(p, now); // a market entry goes out at once, not on the next tick
    return this.view(p);
  }

  /** Stop a plan. `close` also closes its position at market; without it a position keeps its stop loss and take profit. */
  async cancel(id: number, close: boolean): Promise<PlanView> {
    const p = this.plans.get(id);
    if (!p) throw new PlanError('No such plan.', undefined, 404);
    if (p.status === 'done') return this.view(p);
    const v = this.venue();
    if (!v?.connected()) throw new PlanError('Not connected to the exchange right now. Try again in a few seconds.', undefined, 409);
    if (p.st.entryKey && v.working(p.st.entryKey)) await v.cancelOrder(p.st.entryKey);
    p.st.entryKey = null;
    p.st.sliceEnds = null;
    const held = this.held(p, v);
    if (!held) {
      await this.cancelExits(p, v);
      this.end(p, p.st.filled ? 'closed' : 'cancelled', p.st.filled ? 'Closed.' : 'Cancelled before anything filled.');
    } else if (close) {
      // Close means all of it: entering stops too, and the plan finishes once the position is flat.
      this.stopEntering(p);
      p.st.closing = true;
      await this.closeNow(p, v, EXIT_SLIP_BPS * 2);
    } else {
      // Entering stops here; the position keeps its stop loss and take profit.
      this.stopEntering(p);
      this.save(p);
    }
    return this.view(p);
  }

  /** The plan that owns this fill, if any. Plan markets are a plan's alone, so any fill there is that plan's. */
  claim(f: VenueFill): number | null {
    const byKey = f.orderKey ? this.keys.get(f.orderKey) : undefined;
    if (byKey != null) return byKey;
    return this.running().find((p) => p.input.sym === f.sym)?.id ?? this.placing.get(f.sym) ?? null;
  }

  onFill(f: VenueFill, id: number) {
    const p = this.plans.get(id);
    if (!p) return;
    const st = p.st;
    const opening = (f.side === 'bid') === (p.input.bias === 'long');
    st.fees += f.feeUsd;
    st.realized += f.realizedUsd;
    if (opening) {
      st.filled += f.size;
      st.cost += f.price * f.size;
      if (f.isMaker) st.makerSize += f.size;
      if (st.slPrice == null) {
        // The levels are fixed once, at the first fill: from its price, or from the TWAP's arrival price.
        const ref = p.input.kind === 'twap' ? st.arrival ?? f.price : f.price;
        const tick = this.feed.specs()[p.input.sym]?.priceTick ?? 0;
        const round = (x: number) => (tick ? Number((Math.round(x / tick) * tick).toPrecision(12)) : x);
        st.slPrice = round(priceAway(p.input.bias, ref, p.input.stopLossPct, true));
        st.tpPrice = p.input.takeProfitPct ? round(priceAway(p.input.bias, ref, p.input.takeProfitPct, false)) : null;
      }
      if (p.status === 'waiting') p.status = 'entering';
    } else {
      st.closed += f.size;
      // By the order that filled; and by price, in case the venue gives a fired trigger's order a key of its own.
      const long = p.input.bias === 'long';
      const at = (level: number | null, beyond: boolean) => level != null && (beyond === long ? f.price >= level : f.price <= level);
      st.exitBy = (f.orderKey && f.orderKey === st.slKey) || at(st.slPrice, false) ? 'sl' : (f.orderKey && f.orderKey === st.tpKey) || at(st.tpPrice, true) ? 'tp' : null;
    }
    this.save(p);
  }

  /** Once a second, on a connected venue. */
  tick(now: number) {
    for (const p of this.running()) if (!this.busy.has(p.id) && now >= p.st.retryAt) this.step(p, now);
  }

  /** A kill closed everything: the plans it interrupted are over. */
  onKill() {
    for (const p of this.running()) this.end(p, 'killed', 'Kill cancelled its orders and closed the position.');
  }

  /**
   * The process is stopping: pull the entries Monday watches (a resting limit, a TWAP slice) so none fills with nobody
   * here to place its stop. The stop losses and take profits stay: they are what protects a position meanwhile.
   */
  async shutdown() {
    const v = this.venue();
    if (!v?.connected()) return;
    await Promise.allSettled(this.running().filter((p) => p.st.entryKey && v.working(p.st.entryKey)).map((p) => v.cancelOrder(p.st.entryKey!)));
  }

  views(): PlanView[] {
    return [...this.plans.values()].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.id - a.id).slice(0, 12).map((p) => this.view(p));
  }

  // ---- one step of one plan ----
  private step(p: Plan, now: number) {
    const v = this.venue();
    const snap = this.feed.snapshot(p.input.sym);
    if (!v?.connected() || !snap) return;
    // Perpl reports a fill and its position separately: decide nothing about the position until both are in.
    if (v.settling?.()) return;
    const st = p.st;
    const held = this.held(p, v);
    const input = p.input;

    if (input.kind === 'trade' && p.status === 'waiting') {
      if (now > p.createdAt + input.expiryHours * 3_600_000) {
        if (st.entryKey && v.working(st.entryKey)) return this.run(p, v.cancelOrder(st.entryKey).then(() => this.end(p, 'expired', `Not entered in ${input.expiryHours} h: given up.`)));
        return this.end(p, 'expired', `Not entered in ${input.expiryHours} h: given up.`);
      }
      return this.enter(p, v, snap, now);
    }
    const entryOpen = st.entryKey !== null && st.entryKey !== '' && v.working(st.entryKey);
    // An exit filled while still entering (the stop loss hit mid-TWAP, or before a limit filled in full): stop entering.
    if (st.exitBy && p.status === 'entering') {
      this.stopEntering(p);
      if (entryOpen) return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
    }
    // A limit that filled in part and then ran out of time: the rest is given up, the position stays protected.
    if (input.kind === 'trade' && input.entry === 'limit' && p.status === 'entering' && entryOpen && now > p.createdAt + input.expiryHours * 3_600_000) {
      return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
    }
    if (input.kind === 'twap' && p.status === 'entering' && !st.closing) this.slice(p, v, snap, now);
    if (!held) {
      if (st.filled > 0) {
        // Flat after filling: the stop loss, the take profit or the user closed it.
        const twapLeft = input.kind === 'twap' && p.status === 'entering';
        if (!entryOpen && !twapLeft) this.run(p, this.cancelExits(p, v).then(() => this.finish(p)));
        return;
      }
      if (input.kind === 'trade' && p.status === 'entering' && input.entry !== 'limit') {
        if (!st.sentAt) return this.enter(p, v, snap, now);
        if (now - st.sentAt > 5_000) this.end(p, 'failed', `Nothing filled within ${ENTRY_SLIP_BPS / 100}% of the price: the book was too thin, or the price ran away.`);
      }
      return;
    }
    if (p.status === 'entering' && input.kind === 'trade' && !entryOpen) p.status = 'open';
    if (st.closing) return void (st.retryAt = now + 3_000, this.run(p, this.closeNow(p, v, EXIT_SLIP_BPS * 2)));
    this.protect(p, v, snap, now);
  }

  /** Watch the entry: a market entry goes now, a stop once the mark breaks the level, a limit rests at its price. */
  private enter(p: Plan, v: Venue, snap: MarketSnapshot, now: number) {
    const input = p.input;
    if (input.kind !== 'trade') return;
    const st = p.st;
    const side: Side = input.bias === 'long' ? 'bid' : 'ask';
    const size = Math.max(0, p.targetSize - st.filled);
    const lev = input.leverage;
    if (input.entry === 'market') {
      if (st.sentAt) return;
      st.sentAt = now;
      return this.place(p, v, { sym: input.sym, side, size, leverage: lev, slippageBps: ENTRY_SLIP_BPS }, 'entry', (err) => this.end(p, 'failed', `The entry did not fill: ${err}`));
    }
    const e = input.entryPrice!;
    if (input.entry === 'stop') {
      const broke = input.bias === 'long' ? snap.mark >= e : snap.mark <= e;
      st.note = broke ? 'Level broken: entering.' : `Waiting for the mark to break ${e}.`;
      if (!broke) return;
      p.status = 'entering';
      st.sentAt = now;
      return this.place(p, v, { sym: input.sym, side, size, leverage: lev, slippageBps: ENTRY_SLIP_BPS }, 'entry', (err) => this.end(p, 'failed', `The breakout entry did not fill: ${err}`));
    }
    // Limit: rest on the book once the price is close enough for Perpl to take the order.
    if (st.entryKey && v.working(st.entryKey)) return void (st.note = `Resting at ${e}.`);
    if (Math.abs(e / snap.oracle - 1) > BAND) return void (st.note = `Waiting for the price to come within 1% of ${e}. Perpl takes orders only that close to its price.`);
    st.note = `Placing the limit at ${e}.`;
    this.place(p, v, { sym: input.sym, side, size, leverage: lev, price: e, postOnly: true }, 'entry', (err, code) => {
      // Already through the price: take it there instead (never worse than the limit).
      st.retryAt = Date.now() + 3_000;
      if (code === 'crosses_book') return void this.place(p, v, { sym: input.sym, side, size, leverage: lev, price: e }, 'entry', (e2) => (st.note = `Could not enter at the limit: ${e2}`));
      st.note = `The exchange refused the limit: ${err}. Trying again shortly.`;
      st.retryAt = Date.now() + 10_000;
    });
  }

  /** TWAP: one slice at a time on the schedule; maker first, the rest taken at the slice's end if the style says so. */
  private slice(p: Plan, v: Venue, snap: MarketSnapshot, now: number) {
    const input = p.input;
    if (input.kind !== 'twap') return;
    const st = p.st;
    const spec = this.feed.specs()[input.sym]!;
    const long = input.bias === 'long';
    const side: Side = long ? 'bid' : 'ask';
    const interval = (input.durationMin * 60_000) / input.slices;
    const working = st.entryKey !== null && v.working(st.entryKey);
    const sliceLeft = () => Math.max(0, st.sliceTarget - (st.filled - st.sliceFrom));
    const within = (px: number) => input.limitPrice == null || (long ? px <= input.limitPrice : px >= input.limitPrice);
    const nextSlice = () => {
      st.slicesDone++;
      st.sliceEnds = null;
      st.entryKey = null;
      st.chases = 0;
      st.nextAt = Math.max(Date.now(), p.createdAt + st.slicesDone * interval + (Math.random() - 0.5) * 0.3 * interval);
      this.save(p);
    };

    if (st.sliceEnds !== null) {
      const left = sliceLeft();
      if (working && now < st.sliceEnds) {
        // Chase: the best price moved away by a tick or more; requote at the new touch, a few times per slice.
        const best = long ? snap.bestBid : snap.bestAsk;
        if (best != null && st.slicePrice != null && st.chases < 3 && (long ? best > st.slicePrice + spec.priceTick / 2 : best < st.slicePrice - spec.priceTick / 2)) {
          st.chases++;
          return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
        }
        return;
      }
      if (working) return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
      if (left >= spec.sizeStep && now < st.sliceEnds) return this.postMaker(p, v, snap, left);
      if (left >= spec.sizeStep && input.style === 'balanced') {
        const touch = long ? snap.bestAsk : snap.bestBid;
        if (touch != null && within(touch)) {
          st.entryKey = '';
          return this.place(p, v, { sym: input.sym, side, size: left, leverage: input.leverage, slippageBps: ENTRY_SLIP_BPS, ...(input.limitPrice != null && { price: input.limitPrice }) }, 'entry', () => nextSlice(), () => nextSlice());
        }
      }
      return nextSlice();
    }
    if (st.slicesDone >= input.slices) {
      p.status = st.filled > 0 ? 'open' : 'done';
      if (p.status === 'done') this.end(p, 'failed', 'Nothing filled: the price stayed outside your limit.');
      else this.save(p);
      return;
    }
    if (st.nextAt != null && now < st.nextAt) return;
    // This slice: what is left, spread over the slices left, give or take a fifth so the pattern is not exact.
    const remaining = Math.max(0, p.targetSize - st.filled);
    const slicesLeft = input.slices - st.slicesDone;
    const jitter = slicesLeft > 1 ? 1 + (Math.random() - 0.5) * 0.4 : 1;
    const size = Math.min(remaining, Math.floor((remaining / slicesLeft) * jitter / spec.sizeStep + 1e-9) * spec.sizeStep);
    if (!(size >= spec.sizeStep)) {
      st.slicesDone = input.slices;
      return void this.save(p);
    }
    const touch = long ? snap.bestAsk : snap.bestBid;
    const maker = long ? snap.bestBid : snap.bestAsk;
    if (input.limitPrice != null && !within(input.style === 'aggressive' ? touch ?? Infinity : maker ?? Infinity)) {
      st.note = `Slice ${st.slicesDone + 1} skipped: the price is past your limit of ${input.limitPrice}.`;
      return nextSlice();
    }
    Object.assign(st, { sliceTarget: size, sliceFrom: st.filled, chases: 0 });
    if (input.style === 'aggressive') {
      st.sliceEnds = now;
      st.entryKey = '';
      return this.place(p, v, { sym: input.sym, side, size, leverage: input.leverage, slippageBps: ENTRY_SLIP_BPS, ...(input.limitPrice != null && { price: input.limitPrice }) }, 'entry', () => nextSlice(), () => nextSlice());
    }
    st.sliceEnds = now + Math.max(10_000, interval * 0.7);
    st.note = `Slice ${st.slicesDone + 1} of ${input.slices}.`;
    this.postMaker(p, v, snap, size);
  }

  /** A PostOnly order at the touch, one tick better when the spread leaves room. */
  private postMaker(p: Plan, v: Venue, snap: MarketSnapshot, size: number) {
    const input = p.input;
    const spec = this.feed.specs()[input.sym]!;
    const long = input.bias === 'long';
    const best = long ? snap.bestBid : snap.bestAsk;
    const other = long ? snap.bestAsk : snap.bestBid;
    if (best == null || other == null) return;
    const room = Math.abs(other - best) > spec.priceTick * 1.5;
    let price = Number((room ? best + (long ? spec.priceTick : -spec.priceTick) : best).toPrecision(12));
    const limit = input.kind === 'twap' ? input.limitPrice : null;
    if (limit != null) price = long ? Math.min(price, limit) : Math.max(price, limit);
    p.st.slicePrice = price;
    p.st.entryKey = '';
    this.place(p, v, { sym: input.sym, side: long ? 'bid' : 'ask', size, leverage: input.leverage, price, postOnly: true }, 'entry', () => {
      p.st.entryKey = null; // crossed in the meantime: the next tick quotes the new touch
    });
  }

  /** Every position a plan holds has its stop loss resting on the exchange, and its take profit when it has one. */
  private protect(p: Plan, v: Venue, snap: MarketSnapshot, now: number) {
    const st = p.st;
    const input = p.input;
    if (st.slPrice == null) return;
    const long = input.bias === 'long';
    const exit: Side = long ? 'ask' : 'bid';
    // Sized to the whole plan: a close is clamped to the position, so later entry fills are covered too.
    const size = p.targetSize;
    if (!st.slKey || !v.working(st.slKey)) {
      const fired = long ? snap.mark <= st.slPrice : snap.mark >= st.slPrice;
      if (st.slKey && fired) {
        // The stop fired and the book was too thin to close it all: place it again with more room.
        st.slSlipBps = Math.min(SL_SLIP_MAX_BPS, st.slSlipBps + SL_SLIP_STEP_BPS);
        this.alert('critical', `${input.sym} stop loss fired but part of the position is still open. Closing the rest with up to ${st.slSlipBps / 100}% slippage.`);
      }
      st.slKey = null;
      return this.place(p, v, { sym: input.sym, side: exit, size, leverage: input.leverage, close: true, slippageBps: st.slSlipBps, trigger: { price: st.slPrice, when: long ? 'lte' : 'gte' } }, 'sl', (err) => {
        st.slFailures++;
        st.retryAt = Date.now() + 3_000;
        if (st.slFailures === 2) this.alert('warn', `${input.sym} stop loss could not be placed yet (${err}). Retrying.`);
        // Fail closed: a position never stays without its stop for long.
        if (st.slFailures >= 5) {
          this.alert('critical', `${input.sym} stop loss could not be placed (${err}). Closing the position instead.`);
          st.closing = true;
        }
      });
    }
    st.slFailures = 0;
    if (st.tpPrice != null && (!st.tpKey || !v.working(st.tpKey))) {
      st.tpKey = null;
      return this.place(p, v, { sym: input.sym, side: exit, size, leverage: input.leverage, close: true, slippageBps: EXIT_SLIP_BPS, trigger: { price: st.tpPrice, when: long ? 'gte' : 'lte' } }, 'tp', (err) => {
        st.retryAt = Date.now() + 5_000;
        st.note = `Take profit not placed yet (${err}). Retrying.`;
      });
    }
    if (p.status === 'open') st.note = '';
    void now;
  }

  /** No more entry orders: a TWAP has no slices left, a trade is in its position (or about to be flat). */
  private stopEntering(p: Plan) {
    if (p.status === 'entering' || p.status === 'waiting') p.status = 'open';
    if (p.input.kind === 'twap') p.st.slicesDone = p.input.slices;
    p.st.sliceEnds = null;
  }

  private async closeNow(p: Plan, v: Venue, slippageBps: number) {
    const held = this.held(p, v);
    if (!held) return;
    const side: Side = p.input.bias === 'long' ? 'ask' : 'bid';
    this.placing.set(p.input.sym, p.id);
    try {
      await v.placeOrder({ sym: p.input.sym, side, size: held, leverage: p.input.leverage, close: true, slippageBps });
    } catch (e) {
      p.st.note = `Closing: ${e instanceof Error ? e.message : e}. Retrying.`;
    } finally {
      setTimeout(() => this.placing.delete(p.input.sym), 5_000).unref?.();
    }
  }

  private async cancelExits(p: Plan, v: Venue) {
    for (const k of [p.st.slKey, p.st.tpKey, p.st.entryKey]) if (k && v.working(k)) await v.cancelOrder(k).catch(() => {});
  }

  /** The position closed: say how, and keep the numbers. */
  private finish(p: Plan) {
    const st = p.st;
    const pnl = st.realized - st.fees;
    const how: PlanOutcome = st.exitBy === 'sl' ? 'stop_loss' : st.exitBy === 'tp' ? 'take_profit' : 'closed';
    this.end(p, how, `${OUTCOME_LABEL[how]}: ${pnl >= 0 ? '+' : '-'}${usd(Math.abs(pnl), 2)} after fees.`);
  }

  private end(p: Plan, outcome: PlanOutcome, note: string) {
    if (p.status === 'done') return;
    Object.assign(p, { status: 'done', outcome, endedAt: Date.now() });
    p.st.note = note;
    this.save(p);
    journal(this.userId, 'plan_end', p.input.sym, p.st.realized - p.st.fees, { plan: p.id, outcome, filled: p.st.filled, realized: p.st.realized, fees: p.st.fees });
    this.alert(outcome === 'failed' || outcome === 'stop_loss' ? 'warn' : 'info', `${p.input.kind === 'twap' ? 'TWAP' : 'Agentic Trade'} ${p.input.bias} ${p.input.sym}: ${note}`);
  }

  /** Send one order and remember it. `onError` gets the venue's reason; `onDone` runs once the venue has the order. */
  private place(p: Plan, v: Venue, o: OrderSpec, role: 'entry' | 'sl' | 'tp', onError: (message: string, code?: string) => void, onDone?: () => void) {
    this.placing.set(o.sym, p.id);
    this.run(p, v.placeOrder(o).then((key) => {
      if (key) this.keys.set(key, p.id);
      // An order the venue finished without naming (an IOC) holds nothing to watch.
      const working = key && v.working(key) ? key : null;
      if (role === 'entry') p.st.entryKey = working;
      else if (role === 'sl') p.st.slKey = working ?? key;
      else p.st.tpKey = working ?? key;
      onDone?.();
    }, (e: unknown) => {
      if (role === 'entry') p.st.entryKey = null;
      onError(e instanceof Error ? e.message : String(e), e instanceof VenueError ? e.code : undefined);
    }).finally(() => setTimeout(() => this.placing.get(o.sym) === p.id && this.placing.delete(o.sym), 5_000).unref?.()));
  }

  /** One request per plan at a time; the state is saved when it settles. */
  private run(p: Plan, work: Promise<unknown>) {
    this.busy.add(p.id);
    void work.catch((e) => {
      p.st.note = `${e instanceof Error ? e.message : e}`;
      p.st.retryAt = Date.now() + 5_000;
    }).finally(() => {
      this.busy.delete(p.id);
      this.save(p);
    });
  }

  /** Base units of this plan's position: the account's position in its market, on the plan's side. */
  private held(p: Plan, v: Venue): number {
    const size = v.position(p.input.sym).size;
    return (p.input.bias === 'long' ? size > 0 : size < 0) ? Math.abs(size) : 0;
  }

  private save(p: Plan) {
    savePlan.run(JSON.stringify(p.st), p.status, p.outcome, p.endedAt, p.id);
  }

  private view(p: Plan): PlanView {
    const st = p.st;
    const v = this.venue();
    const snap = this.feed.snapshot(p.input.sym);
    const pos = p.status !== 'done' && v ? v.position(p.input.sym) : null;
    const held = pos && (p.input.bias === 'long' ? pos.size > 0 : pos.size < 0) ? pos : null;
    return {
      id: p.id, input: p.input, status: p.status, outcome: p.outcome, note: st.note || this.describe(p), createdAt: p.createdAt, endedAt: p.endedAt,
      targetSize: p.targetSize, filledSize: st.filled, avgEntry: st.filled ? st.cost / st.filled : null, slPrice: st.slPrice, tpPrice: st.tpPrice,
      stopOnVenue: Boolean(st.slKey && v?.working(st.slKey)), takeOnVenue: Boolean(st.tpKey && v?.working(st.tpKey)),
      realizedUsd: st.realized, feesUsd: st.fees, unrealizedUsd: held && snap ? held.size * (snap.mark - held.entryPrice) : 0,
      twap: p.input.kind === 'twap'
        ? { slicesDone: Math.min(st.slicesDone, p.input.slices), slices: p.input.slices, nextAt: p.status === 'entering' ? st.nextAt : null, arrival: st.arrival ?? 0, makerPct: st.filled ? (st.makerSize / st.filled) * 100 : null }
        : null,
    };
  }

  private describe(p: Plan): string {
    const input = p.input;
    if (p.status === 'done') return p.outcome ? OUTCOME_LABEL[p.outcome] : 'Done.';
    if (p.status === 'open') return p.st.slKey ? `Open. Its stop loss${p.st.tpKey ? ' and take profit' : ''} rest on the exchange.` : 'Open. Placing its stop loss.';
    if (input.kind === 'twap') return `Slice ${Math.min(p.st.slicesDone + 1, input.slices)} of ${input.slices}.`;
    if (input.entry === 'market') return 'Entering at market.';
    return input.entry === 'stop' ? `Waiting for the mark to break ${input.entryPrice}.` : `Waiting to ${input.bias === 'long' ? 'buy' : 'sell'} at ${input.entryPrice}.`;
  }
}

export { PLAN_RULES };
