// Agentic Trade (a scalping session) and TWAP for one account, carried out on the runner's venue connection.
// Monday watches every entry, so a server that is down simply does not enter. Once a position exists its stop loss and
// take profit rest on the exchange, linked to the position: they hold whatever happens to Monday, and the exchange
// drops the other one as soon as either closes the position.

import {
  D1_SEC, FRAME_SEC, H4_SEC, OUTCOME_LABEL, READ_BARS, SCALP_ENTRY_BARS, SCALP_MAX_BARS, SCALP_MIN_TARGET_FEES, TREND_LABEL,
  closedBars, liquidationAt, marketRead, planNumbers, planProblems, priceAway, rollUp, scalpExits, scalpMode, scalpSignal, sizeFor, toTick, trendOf, usd,
  type Bar, type MarketRead, type MarketSym, type PlanInput, type PlanOutcome, type PlanStatus, type PlanView, type ScalpMode, type Side, type TradeInput, type Trend, type TwapInput,
} from '@monday/core';
import { db, journal } from './db';
import { VenueError, type MarketFeed, type MarketSnapshot, type OrderSpec, type Venue, type VenueFill } from './venue/types';

/** A plan cannot go: the field and the words the setup page shows next to it. */
export class PlanError extends Error {
  constructor(message: string, public field?: string, public status = 400) {
    super(message);
  }
}

/** One scalp: from its signal until its position is flat again. */
interface Scalp {
  entry: number;
  tp: number;
  sl: number;
  size: number;
  why: string;
  signalAt: number;
  filledAt: number | null;
  /** The session's totals when it began, so its own result is the difference. */
  from: { realized: number; fees: number };
}

interface PlanState {
  /** The resting entry: a scalp's limit, or the TWAP slice working now. */
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
  /** The stop and target resting now: the TWAP position's, or the scalp's. */
  slPrice: number | null;
  tpPrice: number | null;
  /** Slippage for the stop's next placing: it widens each time a fired stop leaves part of the position open. */
  slSlipBps: number;
  slFailures: number;
  closing: boolean;
  /** TWAP: the mark at the start, the schedule and the slice working now. */
  arrival: number | null;
  slicesDone: number;
  nextAt: number | null;
  sliceEnds: number | null;
  sliceTarget: number;
  sliceFrom: number;
  slicePrice: number | null;
  chases: number;
  /** Agentic Trade: the higher timeframes as last read, the trigger bar last looked at, and the session's scalps. */
  d1: Trend;
  h4: Trend;
  readAt: number;
  lastBarT: number;
  scalp: Scalp | null;
  lastAtr: number | null;
  scalps: number;
  wins: number;
  losses: number;
  cooldownUntil: number;
  /** The session is over: how it ends, and whether a position still open is closed (a user's plain Stop lets it run out). */
  ending: PlanOutcome | null;
  endClose: boolean;
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
/** The higher timeframes are read again this often; their bars close every four hours at the quickest. */
const READ_EVERY_MS = 15 * 60_000;
/** A scalp's stop never sits further than this share of the way to liquidation. */
const STOP_SHARE_OF_LIQ = 0.8;

const fresh = (): PlanState => ({
  entryKey: null, slKey: null, tpKey: null, filled: 0, cost: 0, closed: 0, realized: 0, fees: 0, makerSize: 0, exitBy: null,
  slPrice: null, tpPrice: null, slSlipBps: EXIT_SLIP_BPS, slFailures: 0, closing: false,
  arrival: null, slicesDone: 0, nextAt: null, sliceEnds: null, sliceTarget: 0, sliceFrom: 0, slicePrice: null, chases: 0,
  d1: 'neutral', h4: 'neutral', readAt: 0, lastBarT: 0, scalp: null, lastAtr: null, scalps: 0, wins: 0, losses: 0, cooldownUntil: 0,
  ending: null, endClose: true, retryAt: 0, note: '',
});

// ---- candles, shared by every account on a feed: one request per market and width, however many plans read it ----
const barCache = new WeakMap<MarketFeed, Map<string, { at: number; data: Promise<Bar[]> }>>();
/** The last `n` closed bars of `resSec` width. Fresh for `ttlMs`; a feed that only keeps minutes is rolled up. */
export function barsOf(feed: MarketFeed, sym: MarketSym, resSec: number, n: number, ttlMs: number): Promise<Bar[]> {
  let cache = barCache.get(feed);
  if (!cache) barCache.set(feed, (cache = new Map()));
  const key = `${sym}:${resSec}`;
  const now = Date.now();
  let hit = cache.get(key);
  if (!hit || now - hit.at > ttlMs) {
    const data = feed.candles(sym, now - (n + 1) * resSec * 1000, now, resSec).then((cs) => closedBars(rollUp(cs, resSec * 1000), resSec, Date.now()).slice(-n));
    cache.set(key, (hit = { at: now, data }));
    data.catch(() => cache.delete(key));
  }
  return hit.data;
}

/** D1 and H4 as the scalper reads them; also what the setup page shows before a session starts. */
export async function readMarket(feed: MarketFeed, sym: MarketSym): Promise<{ d1: Trend; h4: Trend; market: MarketRead }> {
  const [d1, h4] = await Promise.all([barsOf(feed, sym, D1_SEC, READ_BARS, READ_EVERY_MS), barsOf(feed, sym, H4_SEC, READ_BARS, READ_EVERY_MS)]);
  const t1 = trendOf(d1), t4 = trendOf(h4);
  return { d1: t1, h4: t4, market: marketRead(t1, t4) };
}

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

  /**
   * Check and start a plan. Throws PlanError with the field to fix. Its margin must fit in what the account has left after
   * the running plans' margins and `makerReservedUsd`, what the market maker holds.
   */
  create(input: PlanInput, makerMarkets: MarketSym[], makerReservedUsd = 0): PlanView {
    const v = this.venue();
    if (!v?.connected()) throw new PlanError('Monday is still connecting to the exchange. Try again in a few seconds.', undefined, 409);
    const spec = this.feed.specs()[input.sym];
    const mark = this.feed.snapshot(input.sym)?.mark ?? null;
    const free = v.account().balanceUsd - makerReservedUsd - this.running().reduce((a, p) => a + p.input.marginUsd, 0);
    const problems = planProblems(input, spec, { mark, balanceUsd: Math.max(0, free), makerMarkets, planMarkets: this.markets(), activePlans: this.running().length });
    const first = Object.entries(problems)[0];
    if (first) throw new PlanError(first[1], first[0]);
    // One position per market on Perpl: a plan in a market that already holds one would take it over.
    const held = v.position(input.sym).size;
    if (held) throw new PlanError(`This account already holds a ${input.sym} position (${+held.toFixed(6)}). Close it first, or pick another market.`, 'sym');
    const n = planNumbers(input, spec!, mark!);
    const now = Date.now();
    const st = fresh();
    if (input.kind === 'twap') Object.assign(st, { arrival: mark, nextAt: now });
    const status: PlanStatus = input.kind === 'twap' ? 'entering' : 'waiting';
    const id = Number(insPlan.run(this.userId, input.kind, input.sym, JSON.stringify(input), JSON.stringify(st), status, n.size, now).lastInsertRowid);
    const p: Plan = { id, input, status, outcome: null, createdAt: now, endedAt: null, targetSize: n.size, st };
    this.plans.set(id, p);
    journal(this.userId, 'plan_start', input.sym, n.notionalUsd, { plan: id, input, size: n.size, ref: n.ref, lossUsd: n.lossUsd });
    this.step(p, now);
    return this.view(p);
  }

  /**
   * Stop a plan. `close` also closes its position at market. Without it a TWAP position keeps its stop loss and take
   * profit, and a scalping session takes no new scalp but lets the one open reach its own exits.
   */
  async cancel(id: number, close: boolean): Promise<PlanView> {
    const p = this.plans.get(id);
    if (!p) throw new PlanError('No such plan.', undefined, 404);
    if (p.status === 'done') return this.view(p);
    const v = this.venue();
    if (!v?.connected()) throw new PlanError('Not connected to the exchange right now. Try again in a few seconds.', undefined, 409);
    if (p.st.entryKey && v.working(p.st.entryKey)) await v.cancelOrder(p.st.entryKey);
    p.st.entryKey = null;
    p.st.sliceEnds = null;
    if (p.input.kind === 'trade') {
      Object.assign(p.st, { ending: close ? 'closed' : 'cancelled', endClose: close });
      this.save(p);
      this.step(p, Date.now());
      return this.view(p);
    }
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
    const long = p.input.bias === 'long';
    const opening = (f.side === 'bid') === long;
    st.fees += f.feeUsd;
    st.realized += f.realizedUsd;
    if (opening) {
      st.filled += f.size;
      st.cost += f.price * f.size;
      if (f.isMaker) st.makerSize += f.size;
      if (p.input.kind === 'trade') {
        if (st.scalp && st.scalp.filledAt == null) st.scalp.filledAt = Date.now();
        p.status = 'open';
      } else if (st.slPrice == null) {
        // A TWAP's levels are fixed once, at the first fill, from where it started.
        const ref = st.arrival ?? f.price;
        const tick = this.feed.specs()[p.input.sym]?.priceTick ?? 0;
        const round = (x: number) => (tick ? toTick(x, tick) : x);
        st.slPrice = round(priceAway(p.input.bias, ref, p.input.stopLossPct, true));
        st.tpPrice = p.input.takeProfitPct ? round(priceAway(p.input.bias, ref, p.input.takeProfitPct, false)) : null;
      }
    } else {
      st.closed += f.size;
      // By the order that filled; and by price, in case the venue gives a fired trigger's order a key of its own.
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
   * The process is stopping: pull the entries Monday watches (a scalp's limit, a TWAP slice) so none fills with nobody
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
    if (p.input.kind === 'trade') return this.scalpStep(p, p.input, v, snap, now);
    this.twapStep(p, p.input, v, snap, now);
  }

  // ---- Agentic Trade: a scalping session ----
  private scalpStep(p: Plan, input: TradeInput, v: Venue, snap: MarketSnapshot, now: number) {
    const st = p.st;
    const frameMs = FRAME_SEC[input.frame] * 1000;
    const held = this.held(p, v);
    const pos = v.position(input.sym);
    const pnl = st.realized - st.fees + (held ? pos.size * (snap.mark - pos.entryPrice) : 0);
    const lossLimit = (input.marginUsd * input.lossLimitPct) / 100;
    const target = input.profitTargetPct != null ? (input.marginUsd * input.profitTargetPct) / 100 : null;
    const entryOpen = Boolean(st.entryKey && v.working(st.entryKey));

    // A scalp that went flat: book its result before anything else.
    if (st.scalp?.filledAt != null && !held) {
      const result = st.realized - st.fees - (st.scalp.from.realized - st.scalp.from.fees);
      st.scalps++;
      if (result > 0) st.wins++;
      else st.losses++;
      st.note = `Scalp ${st.scalps} ${result >= 0 ? 'made' : 'lost'} ${usd(Math.abs(result), 2)}${st.exitBy === 'tp' ? ' at its target' : st.exitBy === 'sl' ? ' at its stop' : ''}.`;
      Object.assign(st, { scalp: null, slPrice: null, tpPrice: null, exitBy: null, cooldownUntil: now + frameMs, slSlipBps: EXIT_SLIP_BPS });
      p.status = 'waiting';
      return this.run(p, this.cancelExits(p, v));
    }

    // The session's own limits, shares of the margin, and its time.
    if (!st.ending) {
      if (pnl <= -lossLimit) Object.assign(st, { ending: 'stop_loss', endClose: true });
      else if (target != null && pnl >= target) Object.assign(st, { ending: 'take_profit', endClose: true });
      else if (now >= p.createdAt + input.expiryHours * 3_600_000) Object.assign(st, { ending: 'expired', endClose: true });
    }
    if (st.ending) {
      if (entryOpen) return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
      if (held && st.endClose) {
        st.retryAt = now + 3_000;
        st.note = 'Session over: closing the open scalp.';
        return this.run(p, this.closeNow(p, v, EXIT_SLIP_BPS * 2));
      }
      // A plain Stop: the scalp in progress runs to its own target or stop, then the session ends.
      if (held) return this.protect(p, v, snap);
      return this.run(p, this.cancelExits(p, v).then(() => this.endSession(p, pnl)));
    }

    if (held) {
      // A position with no scalp on record (a restart mid-fill): adopt it with the last range seen, or a fifth of a percent.
      if (!st.scalp) {
        const range = st.lastAtr ?? pos.entryPrice * 0.002;
        const mode = scalpMode(input.bias, marketRead(st.d1, st.h4)) ?? 'counter';
        const ex = scalpExits(input.bias, mode, pos.entryPrice, range);
        st.scalp = { entry: pos.entryPrice, tp: ex.tp, sl: ex.sl, size: Math.abs(pos.size), why: 'Position found on restart', signalAt: now, filledAt: now, from: { realized: st.realized, fees: st.fees } };
      }
      st.scalp.filledAt ??= now;
      Object.assign(st, { slPrice: st.scalp.sl, tpPrice: st.scalp.tp });
      p.status = 'open';
      // A scalp that has not worked within its bars is closed: holding it would make it a swing trade.
      if (now - st.scalp.filledAt > SCALP_MAX_BARS * frameMs) {
        st.note = `Time stop: the scalp had not reached its target after ${SCALP_MAX_BARS} ${input.frame} bars.`;
        st.retryAt = now + 3_000;
        return this.run(p, this.closeNow(p, v, EXIT_SLIP_BPS * 2));
      }
      if (entryOpen && now - st.scalp.signalAt > SCALP_ENTRY_BARS * frameMs) return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
      return this.protect(p, v, snap);
    }

    if (entryOpen) {
      // The signal's moment has passed without a fill: let it go and wait for the next one.
      if (!st.scalp || now - st.scalp.signalAt > SCALP_ENTRY_BARS * frameMs) {
        return this.run(p, v.cancelOrder(st.entryKey!).then(() => {
          Object.assign(st, { entryKey: null, scalp: null });
          st.note = 'The entry was not filled in time. Waiting for the next setup.';
        }));
      }
      return;
    }
    if (st.scalp && st.scalp.filledAt == null) st.scalp = null; // its entry is gone without a fill
    p.status = 'waiting';

    if (now - st.readAt > READ_EVERY_MS) return this.run(p, this.read(p, now));
    const mode = scalpMode(input.bias, marketRead(st.d1, st.h4));
    if (!mode) {
      st.note = `D1 ${TREND_LABEL[st.d1].toLowerCase()}, H4 ${TREND_LABEL[st.h4].toLowerCase()}: waiting until both point the same way.`;
      return;
    }
    if (now < st.cooldownUntil) return;
    this.run(p, this.trigger(p, input, v, mode, lossLimit, now));
  }

  private async read(p: Plan, now: number) {
    const r = await readMarket(this.feed, p.input.sym);
    Object.assign(p.st, { d1: r.d1, h4: r.h4, readAt: now });
  }

  /** On each newly closed trigger bar: look for the setup and, on one, rest a maker entry sized to the loss limit left. */
  private async trigger(p: Plan, input: TradeInput, v: Venue, mode: ScalpMode, lossLimit: number, now: number) {
    const st = p.st;
    const bars = await barsOf(this.feed, input.sym, FRAME_SEC[input.frame], 80, 5_000);
    const last = bars[bars.length - 1];
    // Once per closed bar: what it showed stays the note until the next one.
    if (!last || last.t <= st.lastBarT) return;
    st.lastBarT = last.t;
    st.note = mode === 'follow'
      ? `Follow: watching the ${input.frame} chart for a pullback to the 20 EMA.`
      : `Counter: watching the ${input.frame} chart for a stretched RSI to turn.`;
    const sig = scalpSignal(bars, input.bias, mode);
    if (!sig) return;
    const snap = this.feed.snapshot(input.sym);
    const spec = this.feed.specs()[input.sym];
    const long = input.bias === 'long';
    const touch = long ? snap?.bestBid : snap?.bestAsk;
    if (!snap || !spec || touch == null) return;
    // Never across the book: a maker entry at the signal's close, or at the touch if the price has come through it.
    const price = toTick(long ? Math.min(sig.price, touch) : Math.max(sig.price, touch), spec.priceTick);
    let size = sizeFor(input.marginUsd * input.leverage, price, spec);
    const liq = liquidationAt(input.bias, price, size, input.leverage, spec);
    const ex = scalpExits(input.bias, mode, price, sig.atr, STOP_SHARE_OF_LIQ * Math.abs(price - liq));
    // A target the fees would eat is no scalp: on a quiet market or a short timeframe the setup is skipped.
    const fees = (price * (spec.makerFeeBps + spec.takerFeeBps)) / 1e4;
    if (Math.abs(ex.tp - price) < SCALP_MIN_TARGET_FEES * fees) {
      st.note = `${sig.why}, but skipped: a ${((Math.abs(ex.tp - price) / price) * 100).toFixed(3)}% target does not clear the ${((fees / price) * 100).toFixed(3)}% of fees ${SCALP_MIN_TARGET_FEES} times. A longer timeframe gives it room.`;
      return;
    }
    // One scalp may lose at most the loss limit left: its stop distance plus fees, times its size.
    const stopDist = Math.abs(price - ex.sl);
    const perUnit = stopDist + fees;
    const left = Math.min(lossLimit, lossLimit + st.realized - st.fees);
    if (size * perUnit > left) size = sizeFor((left / perUnit) * price, price, spec);
    if (!(size >= spec.sizeStep)) {
      Object.assign(st, { ending: 'stop_loss', endClose: true, note: 'The loss limit left is too small for another scalp.' });
      return;
    }
    st.lastAtr = sig.atr;
    st.scalp = { entry: price, tp: toTick(ex.tp, spec.priceTick), sl: toTick(ex.sl, spec.priceTick), size, why: sig.why, signalAt: now, filledAt: null, from: { realized: st.realized, fees: st.fees } };
    p.status = 'entering';
    st.note = `${sig.why}: ${long ? 'buying' : 'selling'} ${size} at ${price}.`;
    try {
      await this.send(p, v, { sym: input.sym, side: long ? 'bid' : 'ask', size, leverage: input.leverage, price, postOnly: true }, 'entry');
    } catch (e) {
      Object.assign(st, { scalp: null, entryKey: null });
      p.status = 'waiting';
      st.note = e instanceof VenueError && e.code === 'crosses_book' ? 'The price moved through the entry before it rested. Waiting for the next setup.' : `The entry was refused: ${e instanceof Error ? e.message : e}`;
    }
  }

  private endSession(p: Plan, pnl: number) {
    const st = p.st;
    const how = st.ending ?? 'closed';
    const why = how === 'stop_loss' ? 'Session loss limit reached' : how === 'take_profit' ? 'Session target reached' : how === 'expired' ? 'Session time over' : OUTCOME_LABEL[how];
    this.end(p, how, `${why}: ${pnl >= 0 ? '+' : '-'}${usd(Math.abs(pnl), 2)} after ${st.scalps} scalp${st.scalps === 1 ? '' : 's'} (${st.wins} won).`);
  }

  // ---- TWAP ----
  private twapStep(p: Plan, input: TwapInput, v: Venue, snap: MarketSnapshot, now: number) {
    const st = p.st;
    const held = this.held(p, v);
    const entryOpen = st.entryKey !== null && st.entryKey !== '' && v.working(st.entryKey);
    // An exit filled while still entering (the stop loss hit mid-way): stop entering.
    if (st.exitBy && p.status === 'entering') {
      this.stopEntering(p);
      if (entryOpen) return this.run(p, v.cancelOrder(st.entryKey!).then(() => void (st.entryKey = null)));
    }
    if (p.status === 'entering' && !st.closing) this.slice(p, input, v, snap, now);
    if (!held) {
      // Flat after filling: the stop loss, the take profit or the user closed it.
      if (st.filled > 0 && !entryOpen && p.status !== 'entering') this.run(p, this.cancelExits(p, v).then(() => this.finish(p)));
      return;
    }
    if (st.closing) return void (st.retryAt = now + 3_000, this.run(p, this.closeNow(p, v, EXIT_SLIP_BPS * 2)));
    this.protect(p, v, snap);
  }

  /** One slice at a time on the schedule; maker first, the rest taken at the slice's end if the style says so. */
  private slice(p: Plan, input: TwapInput, v: Venue, snap: MarketSnapshot, now: number) {
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
      if (left >= spec.sizeStep && now < st.sliceEnds) return this.postMaker(p, input, snap, left);
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
    this.postMaker(p, input, snap, size);
  }

  /** A PostOnly order at the touch, one tick better when the spread leaves room. */
  private postMaker(p: Plan, input: TwapInput, snap: MarketSnapshot, size: number) {
    const v = this.venue();
    if (!v) return;
    const spec = this.feed.specs()[input.sym]!;
    const long = input.bias === 'long';
    const best = long ? snap.bestBid : snap.bestAsk;
    const other = long ? snap.bestAsk : snap.bestBid;
    if (best == null || other == null) return;
    const room = Math.abs(other - best) > spec.priceTick * 1.5;
    let price = toTick(room ? best + (long ? spec.priceTick : -spec.priceTick) : best, spec.priceTick);
    if (input.limitPrice != null) price = long ? Math.min(price, input.limitPrice) : Math.max(price, input.limitPrice);
    p.st.slicePrice = price;
    p.st.entryKey = '';
    this.place(p, v, { sym: input.sym, side: long ? 'bid' : 'ask', size, leverage: input.leverage, price, postOnly: true }, 'entry', (err, code) => {
      p.st.entryKey = null; // crossed in the meantime: the next tick quotes the new touch
      // Any other refusal (a price out of range, a balance short) would come back every second: wait before trying again.
      if (code !== 'crosses_book') Object.assign(p.st, { retryAt: Date.now() + 3_000, note: `Slice ${p.st.slicesDone + 1} not placed yet (${err}). Retrying.` });
    });
  }

  // ---- shared: protection, closing, ending ----
  /**
   * Every position a plan holds has its stop loss resting on the exchange, and its take profit when it has one: a scalp's
   * target is a maker limit, a TWAP's a trigger. Both are Close orders clamped to the position, linked to it.
   */
  private protect(p: Plan, v: Venue, snap: MarketSnapshot) {
    const st = p.st;
    const input = p.input;
    if (st.slPrice == null) return;
    const long = input.bias === 'long';
    const exit: Side = long ? 'ask' : 'bid';
    // Sized to the whole position it may grow to: a close is clamped to the position, so later entry fills are covered too.
    const size = input.kind === 'trade' ? st.scalp?.size ?? this.held(p, v) : p.targetSize;
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
          if (input.kind === 'trade') Object.assign(st, { ending: 'failed', endClose: true });
          else st.closing = true;
        }
      });
    }
    st.slFailures = 0;
    if (st.tpPrice != null && (!st.tpKey || !v.working(st.tpKey))) {
      st.tpKey = null;
      const tp: OrderSpec = input.kind === 'trade'
        ? { sym: input.sym, side: exit, size, leverage: input.leverage, close: true, price: st.tpPrice, postOnly: true }
        : { sym: input.sym, side: exit, size, leverage: input.leverage, close: true, slippageBps: EXIT_SLIP_BPS, trigger: { price: st.tpPrice, when: long ? 'gte' : 'lte' } };
      return this.place(p, v, tp, 'tp', (err, code) => {
        st.retryAt = Date.now() + 5_000;
        // Already past the target: take it there, never worse than the target.
        if (code === 'crosses_book' && input.kind === 'trade') return void this.place(p, v, { ...tp, postOnly: false }, 'tp', () => {});
        st.note = `Take profit not placed yet (${err}). Retrying.`;
      });
    }
    if (p.status === 'open' && input.kind === 'twap') st.note = '';
  }

  /** No more entry orders: a TWAP has no slices left. */
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
      setTimeout(() => this.placing.get(p.input.sym) === p.id && this.placing.delete(p.input.sym), 5_000).unref?.();
    }
  }

  private async cancelExits(p: Plan, v: Venue) {
    for (const k of [p.st.slKey, p.st.tpKey, p.st.entryKey]) if (k && v.working(k)) await v.cancelOrder(k).catch(() => {});
  }

  /** A TWAP's position closed: say how, and keep the numbers. */
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
    journal(this.userId, 'plan_end', p.input.sym, p.st.realized - p.st.fees, { plan: p.id, outcome, filled: p.st.filled, realized: p.st.realized, fees: p.st.fees, scalps: p.st.scalps });
    this.alert(outcome === 'failed' || outcome === 'stop_loss' ? 'warn' : 'info', `${p.input.kind === 'twap' ? 'TWAP' : 'Agentic Trade'} ${p.input.bias} ${p.input.sym}: ${note}`);
  }

  /** Send one order and remember it; resolves with the order's key while it works, or null once it is done. */
  private async send(p: Plan, v: Venue, o: OrderSpec, role: 'entry' | 'sl' | 'tp'): Promise<string | null> {
    this.placing.set(o.sym, p.id);
    try {
      const key = await v.placeOrder(o);
      if (key) this.keys.set(key, p.id);
      // An order the venue finished without naming (an IOC) holds nothing to watch.
      const working = key && v.working(key) ? key : null;
      if (role === 'entry') p.st.entryKey = working;
      else if (role === 'sl') p.st.slKey = working ?? key;
      else p.st.tpKey = working ?? key;
      return working;
    } finally {
      setTimeout(() => this.placing.get(o.sym) === p.id && this.placing.delete(o.sym), 5_000).unref?.();
    }
  }

  /** `send` as a request of its own: `onError` gets the venue's reason, `onDone` runs once the venue has the order. */
  private place(p: Plan, v: Venue, o: OrderSpec, role: 'entry' | 'sl' | 'tp', onError: (message: string, code?: string) => void, onDone?: () => void) {
    this.run(p, this.send(p, v, o, role).then(() => onDone?.(), (e: unknown) => {
      if (role === 'entry') p.st.entryKey = null;
      onError(e instanceof Error ? e.message : String(e), e instanceof VenueError ? e.code : undefined);
    }));
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
    const unrealizedUsd = held && snap ? held.size * (snap.mark - held.entryPrice) : 0;
    const input = p.input;
    return {
      id: p.id, input, status: p.status, outcome: p.outcome, note: st.note || this.describe(p), createdAt: p.createdAt, endedAt: p.endedAt,
      targetSize: input.kind === 'trade' ? st.scalp?.size ?? 0 : p.targetSize,
      filledSize: input.kind === 'trade' ? Math.abs(held?.size ?? 0) : st.filled,
      avgEntry: input.kind === 'trade' ? st.scalp?.entry ?? null : st.filled ? st.cost / st.filled : null,
      slPrice: st.slPrice ?? (input.kind === 'trade' ? st.scalp?.sl ?? null : null), tpPrice: st.tpPrice ?? (input.kind === 'trade' ? st.scalp?.tp ?? null : null),
      stopOnVenue: Boolean(st.slKey && v?.working(st.slKey)), takeOnVenue: Boolean(st.tpKey && v?.working(st.tpKey)),
      realizedUsd: st.realized, feesUsd: st.fees, unrealizedUsd,
      twap: input.kind === 'twap'
        ? { slicesDone: Math.min(st.slicesDone, input.slices), slices: input.slices, nextAt: p.status === 'entering' ? st.nextAt : null, arrival: st.arrival ?? 0, makerPct: st.filled ? (st.makerSize / st.filled) * 100 : null }
        : null,
      scalp: input.kind === 'trade'
        ? {
          frame: input.frame, d1: st.d1, h4: st.h4, market: marketRead(st.d1, st.h4), mode: st.readAt ? scalpMode(input.bias, marketRead(st.d1, st.h4)) : null,
          scalps: st.scalps, wins: st.wins, losses: st.losses, sessionPnl: st.realized - st.fees + unrealizedUsd,
          lossLimitUsd: (input.marginUsd * input.lossLimitPct) / 100, targetUsd: input.profitTargetPct != null ? (input.marginUsd * input.profitTargetPct) / 100 : null,
          endsAt: p.createdAt + input.expiryHours * 3_600_000, why: st.scalp?.why ?? null,
        }
        : null,
    };
  }

  private describe(p: Plan): string {
    const input = p.input;
    if (p.status === 'done') return p.outcome ? OUTCOME_LABEL[p.outcome] : 'Done.';
    if (input.kind === 'trade') return p.st.readAt ? 'Waiting for a setup.' : 'Reading D1 and H4.';
    if (p.status === 'open') return p.st.slKey ? `Open. Its stop loss${p.st.tpKey ? ' and take profit' : ''} rest on the exchange.` : 'Open. Placing its stop loss.';
    return `Slice ${Math.min(p.st.slicesDone + 1, input.slices)} of ${input.slices}.`;
  }
}
