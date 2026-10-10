// One runner per user account (PRD 9.2, 9.3): engine tick, reflex, governor
// scheduling, risk monitor and order sync. The venue is the only thing that
// sends orders, and only this file tells the venue what to do.
//
// Every order passes riskGate (core/execution.ts) right before it is queued, and
// leaves through one scheduler that serves risk work first and shares the request
// budget across markets. Fills, cash moving in or out and every request are written
// down (db.ts), so a fill can be traced to the market, signal, policy and decision
// behind it, and a restart does not lose positions, PnL or unfinished cleanup.

import {
  DEFAULT_CONFIG, KILL_CODE, MARKETS, REGIME_CODE, STRATEGY_VERSION, bookImbalance, bookTrigger, computeQuotes, depthAhead, ewmaVar, inventoryStage, marginFloorUsd,
  markoutBps, median, nextReflex, orderJobs, refTrigger, reflexTrigger, riskGate, shouldRequote, touchRequote, tradeSign, usd, usdCompact, varToBps,
  type AgentStatus, type Alert, type BookLevel, type DashboardState, type Decision, type DecisionSource, type Fill, type GateReason, type GovernorParams,
  type InventoryStage, type Job, type KillReason, type MarketSignal, type MarketSpec, type MarketState, type MarketSym, type Policy, type Priority,
  type QuoteOutput, type QuoteTarget, type ReflexState, type Side, type StrategyConfig, type TapePrint,
} from '@monday/core';
import type { Hex } from 'viem';
import { agentAddress, anchorOf, chainEnabled, enqueue } from './chain';
import type { Collector } from './collector';
import { config } from './config';
import { atomically, db, event, journal } from './db';
import { decide, fallbackDecision, hashOf, llmEnabled, llmFailures, rulesProposal, type GovernorContext } from './governor';
import { hlAgeMs, hlMid, hlMoveBps } from './hyperliquid';
import { VenueError, type MarketFeed, type MarketSnapshot, type Venue, type VenueCredentials, type VenueDriver, type VenueFill } from './venue/types';

const MIN_REQUOTE_MS = 1_500;
const RESERVED_TOKENS = 8; // PRD 11.7: kept for cancels and exits, never spent on routine requotes
const STALE_CANCEL_MS = 5_000;
const STALE_KILL_MS = 30_000;
const LATE_DECISION_MS = 120_000; // a governor answer older than this describes a market that has moved on
const CASH_SETTLE_MS = 5_000; // an unexplained balance move must hold this long before it is booked
const DEPOSIT_MIN_USD = 1; // smaller unexplained moves are funding or rounding, and count as trading PnL

export interface RunnerDeps {
  driver: VenueDriver;
  collector: Collector;
  creds: () => VenueCredentials;
  /** Nansen skew per unit of S for this market; 0 until the event study supports leaning. */
  k: (sym: MarketSym) => number;
  notify: (text: string) => void;
}

interface MinuteAgg {
  k: number;
  o: number; h: number; l: number; c: number;
  hl: number | null;
  spread: number; spreadN: number;
  bid: number; bidN: number; ask: number; askN: number; both: number; ticks: number;
  why: Map<string, number>;
}

interface Want extends Job {
  sym: MarketSym;
  target: QuoteTarget | null;
  reason: string;
}

interface MarketRt {
  sym: MarketSym;
  var1m: number;
  lastClose: number;
  lastMinute: number;
  sigmaHist: number[];
  book: number;
  params: GovernorParams;
  paramsSource: DecisionSource;
  paramsUntil: number;
  nextGovAt: number;
  lastGovAt: number;
  govBusy: boolean;
  govAsap: boolean;
  wasStorm: boolean;
  wasStale: boolean;
  reflex: ReflexState | null;
  lastBigTs: number;
  lastSent: Record<Side, number>;
  inflight: Record<Side, boolean>;
  /** The target of the request in flight, counted as exposure until the venue answers. */
  sending: Record<Side, QuoteTarget | null>;
  /** Since when a side has wanted a change that has not been sent: the scheduler's age. 0 when nothing waits. */
  since: Record<Side, number>;
  /** Why the scheduler held a side back on the last tick. */
  held: Record<Side, 'budget' | 'pace' | 'confirm' | null>;
  /** The last thing that kept a side off the book (risk, reflex, lifecycle), for the dashboard. */
  block: Record<Side, string | null>;
  ackedAt: Record<Side, number>;
  /** quote_events id of the request that put the resting order there. */
  resting: Record<Side, number | null>;
  model: QuoteOutput | null;
  stage: InventoryStage;
  posSince: number;
  posSign: number;
  basis: { bps: number; dev: number; gap: number; n: number };
  gapAlarm: boolean;
  why: string;
  min: MinuteAgg | null;
  bothHist: number[];
  lastDecisionId: number | null;
  series: MarketState['priceSeries'];
  bandAlertAt: number;
}

const KILL_TEXT: Record<KillReason, string> = {
  manual: 'Kill switch pressed. All orders were cancelled and positions closed.',
  loss_limit: 'Daily loss limit reached. All orders were cancelled and positions closed.',
  stale_data: 'Perpl market data stopped for 30 seconds. All orders were cancelled and positions closed.',
  order_failures: 'Three orders failed in a row. All orders were cancelled and positions closed.',
  key_error: 'Perpl rejected the API key. The agent has stopped.',
  session_loss: 'Session stop loss reached. All orders were cancelled and positions closed.',
  margin: 'Equity fell below the margin this policy needs. All orders were cancelled and positions closed.',
};

const GATE_TEXT: Record<GateReason, string> = {
  price_band: 'it would sit more than 1% from the oracle price',
  max_order_size: 'the order is bigger than the policy allows',
  max_inventory: 'inventory is at its limit',
  max_account: 'the account-wide exposure limit is reached',
  max_leverage: 'the account would pass its leverage limit',
};

/** Since the last Start. Tread runs every bot with its own stop loss and take profit; Monday adds them per session. */
export interface SessionLimits {
  stopLossUsd: number | null;
  takeProfitUsd: number | null;
}

// The last 24 hours of candles per market, shared by every runner and refreshed every 10 minutes: average hourly
// volume (null until known, and always on the simulator, whose candles carry no volume), the day's open, high and low.
interface Day { at: number; hourlyUsd: number | null; open: number | null; high: number | null; low: number | null }
const volume = new Map<MarketSym, Day>();

// The tape per market, shared by every runner on a feed: each minute's high, low and volume, which the minute records
// use to show whether price ever reached Monday's quotes when nothing filled, and the last prints for the dashboard.
const TAPE_PRINTS = 40;
interface Tape { minutes: Map<string, { hi: number; lo: number; usd: number }>; prints: Map<MarketSym, TapePrint[]> }
const tapes = new WeakMap<MarketFeed, Tape>();
function tapeOf(feed: MarketFeed): Tape {
  let t = tapes.get(feed);
  if (!t) {
    const minutes: Tape['minutes'] = new Map();
    const prints: Tape['prints'] = new Map();
    tapes.set(feed, (t = { minutes, prints }));
    feed.onTrade?.((tr) => {
      const ts = tr.ts ?? Date.now();
      const k = `${tr.sym}:${Math.floor(ts / 60_000)}`;
      const a = minutes.get(k);
      if (a) Object.assign(a, { hi: Math.max(a.hi, tr.price), lo: Math.min(a.lo, tr.price), usd: a.usd + tr.price * tr.size });
      else minutes.set(k, { hi: tr.price, lo: tr.price, usd: tr.price * tr.size });
      if (minutes.size > 300) minutes.delete(minutes.keys().next().value!);
      const p = prints.get(tr.sym) ?? [];
      p.unshift({ price: tr.price, size: tr.size, side: tr.side, ts });
      if (p.length > TAPE_PRINTS) p.length = TAPE_PRINTS;
      prints.set(tr.sym, p);
    });
  }
  return t;
}

const insDecision = db.prepare(
  'insert into decisions (user_id, at, market, source, regime, params, evidence, params_hash, evidence_hash, reason, llm_model, llm_ms, llm_cost) values (?,?,?,?,?,?,?,?,?,?,?,?,?)',
);
const insFill = db.prepare('insert or ignore into fills (id, user_id, sym, side, price, size, fee, is_maker, ts, regime, realized, half_bps, external, quote_event_id, ctx) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insQuote = db.prepare('insert into quote_events (user_id, sym, side, action, prio, price, size, reason, data_at, sent_at, ctx) values (?,?,?,?,?,?,?,?,?,?,?)');
const doneQuote = db.prepare('update quote_events set done_at = ?, ok = ?, error = ? where id = ?');
const insMinute = db.prepare(
  'insert or replace into market_minutes (user_id, sym, minute, mid_o, mid_h, mid_l, mid_c, tape_hi, tape_lo, tape_usd, hl, spread_bps, bid_bps, ask_bps, bid_s, ask_s, both_s, ticks, pos_usd, regime, stage, why) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
);

export class Runner {
  status: AgentStatus = 'idle';
  killReason: KillReason | null = null;
  startedAt: number | null = null;
  lastSeenAt = Date.now();
  private venue: Venue | null = null;
  private opening: Promise<void> | null = null;
  private m = {} as Record<MarketSym, MarketRt>;
  private budget = config.budgetPerMin;
  private budgetRestoreAt = 0;
  private tokens = config.budgetPerMin;
  private lastRefill = Date.now();
  private ownRequests = 0;
  private seenRequests = { venue: 0, own: 0 };
  private turn = 0;
  private failures = 0;
  private dayKey = '';
  private dayStartEquity = 0;
  private warned70 = false;
  private realized = 0;
  private fees = 0;
  private fills: Fill[] = [];
  private decisions: Decision[] = [];
  private equity: { t: number; v: number }[] = [];
  private alerts: Alert[] = [];
  private pendingMarkouts: Fill[] = [];
  private listeners = new Set<(s: DashboardState) => void>();
  private lastPnlWrite = 0;
  private disconnectedAt = 0;
  private session: (SessionLimits & { startedAt: number; startEquity: number }) | null = null;
  private policyHash: string;
  /**
   * Cash that moved without a fill. `expected` is the balance the fills explain; a different balance that holds for
   * CASH_SETTLE_MS is booked: $1 or more as a deposit or withdrawal, less as funding.
   */
  private cash = { expected: null as number | null, drift: 0, since: 0 };
  /** dayOutIdle: withdrawals made while stopped and flat, the only ones the loss limit is sure are not losses. */
  private flows = { dayIn: 0, dayOut: 0, dayOutIdle: 0, dayFunding: 0, sessionIn: 0, sessionOut: 0 };
  /** Positions as Monday's own records have them, compared with Perpl's after every reconnect. */
  private expectedPos: Partial<Record<MarketSym, number>> = {};
  private wasConnected = false;
  private latency = { send: [] as number[], venue: [] as number[] };
  private costCache = { at: 0, usd: null as number | null, calls: 0 };
  /** Cleanup that did not reach Perpl (socket down, or an IOC close left a position). Stored, and retried every 10 s, also after a restart. */
  private owed: 'cancel' | 'flatten' | null = null;
  private owedRetryAt = 0;
  private cleaning = false;
  /** Bumped by every Stop, Kill and dispose, so a Start still connecting to Perpl when one arrives cannot undo it. */
  private epoch = 0;
  private disposed = false;
  /** Saved as quoting when the process stopped: tick keeps trying to resume from this time until it works or the user acts. */
  private resumeAt = 0;
  /** Cancel or flatten still owed to Perpl. */
  get owes() {
    return this.owed;
  }

  constructor(readonly userId: number, readonly wallet: string, private accountId: number, public policy: Policy, private deps: RunnerDeps) {
    this.policyHash = hashOf(policy);
    // Restore what the dashboard shows after a process restart.
    const dayStart = new Date().setUTCHours(0, 0, 0, 0);
    const d = db.prepare('select * from decisions where user_id = ? order by id desc limit 60').all(userId) as Record<string, never>[];
    this.decisions = d.map((r) => ({
      id: r.id, at: r.at, market: r.market, source: r.source, regime: r.regime, params: JSON.parse(r.params), reason: r.reason ?? '',
      paramsHash: r.params_hash, evidenceHash: r.evidence_hash, llmModel: r.llm_model, txHash: r.tx_hash, onchainId: r.onchain_id, anchor: r.tx_hash ? 'confirmed' : chainEnabled ? 'pending' : 'off',
    }));
    // Monday's own fills only: a trade placed by hand counts for risk (it is in equity), not in Monday's results.
    const f = db.prepare('select * from fills where user_id = ? and ts >= ? and coalesce(external, 0) = 0 order by ts desc').all(userId, dayStart) as Record<string, never>[];
    for (const r of f) {
      this.realized += r.realized ?? 0;
      this.fees += r.fee;
    }
    this.fills = f.slice(0, 80).map((r) => ({
      id: r.id, sym: r.sym, side: r.side, price: r.price, size: r.size, feeUsd: r.fee, isMaker: !!r.is_maker, ts: r.ts, regime: r.regime,
      markout1sBps: r.markout_1s, markout5sBps: r.markout_5s, markout10sBps: r.markout_10s, markout1mBps: r.markout_1m, markout5mBps: r.markout_5m,
    }));
    const e = db.prepare('select ts, equity from pnl_snapshots where user_id = ? and ts >= ? order by ts').all(userId, Date.now() - 86_400_000) as { ts: number; equity: number }[];
    this.equity = e.map((r) => ({ t: r.ts, v: r.equity }));
    const first = e.find((r) => r.ts >= dayStart);
    if (first) {
      this.dayKey = new Date().toISOString().slice(0, 10);
      this.dayStartEquity = first.equity;
      // The balance before the restart: cash that moved while the server was down is booked as a deposit or withdrawal, not PnL.
      const last = db.prepare('select balance from pnl_snapshots where user_id = ? and ts >= ? and balance > 0 order by ts desc limit 1').get(userId, dayStart) as { balance: number } | undefined;
      if (last) this.cash.expected = last.balance;
    }
    const a = db.prepare('select status, kill_reason, started_at, session_sl, session_tp, session_equity, owed from agents where user_id = ?').get(userId) as Record<string, never> | undefined;
    if (a?.session_equity != null) this.session = { startedAt: a.started_at ?? Date.now(), startEquity: a.session_equity, stopLossUsd: a.session_sl, takeProfitUsd: a.session_tp };
    // A stopped agent comes back stopped, with whatever cleanup it still owes. A quoting one is resumed by boot (start()).
    if (a?.status === 'killed' || a?.status === 'paused') {
      this.status = a.status;
      this.killReason = a.kill_reason;
    }
    if (a?.status === 'quoting') this.resumeAt = Date.now();
    this.owed = a?.owed ?? null;
    const sum = (kind: string, from: number) => (db.prepare('select coalesce(sum(amount), 0) s from journal where user_id = ? and kind = ? and at >= ?').get(userId, kind, from) as { s: number }).s;
    this.flows = {
      dayIn: sum('deposit', dayStart), dayOut: sum('withdrawal', dayStart), dayFunding: sum('funding', dayStart),
      dayOutIdle: (db.prepare("select coalesce(sum(amount), 0) s from journal where user_id = ? and kind = 'withdrawal' and at >= ? and json_extract(detail, '$.idle') = 1").get(userId, dayStart) as { s: number }).s,
      sessionIn: this.session ? sum('deposit', this.session.startedAt) : 0, sessionOut: this.session ? sum('withdrawal', this.session.startedAt) : 0,
    };
    tapeOf(deps.driver.feed);
  }

  // ---- lifecycle ----
  private open(): Promise<void> {
    if (this.venue) return Promise.resolve();
    this.opening ??= (async () => {
      const v = this.deps.driver.open(this.deps.creds());
      try {
        await v.connect(); // throws VenueError: the API surfaces the exact reason
        // Disposed while connecting (key replaced or removed): a socket kept now would live on with nobody ticking it.
        if (this.disposed) throw new VenueError('disconnected', 'Monday was shut down while connecting to Perpl.');
      } catch (e) {
        v.close();
        throw e;
      }
      v.on('fill', (f) => this.onFill(f));
      v.on('error', (e) => this.onVenueError(e));
      this.venue = v;
      this.seenRequests = { venue: v.requests?.() ?? 0, own: this.ownRequests };
    })().finally(() => (this.opening = null));
    return this.opening;
  }

  /** `limits` opens a new session; without it (boot resume) the persisted session carries on. */
  async start(limits?: SessionLimits) {
    if (this.status === 'quoting') return;
    // A kill whose flatten has not landed is not over: quoting again would drop that duty while the position stays open.
    if (this.owed === 'flatten') throw new VenueError('rejected', 'The kill is still closing positions. Wait for Perpl to confirm, or close them on Perpl, then start again.');
    const epoch = this.epoch;
    await this.open();
    // A Stop or Kill pressed while Perpl was connecting wins; so does a second Start that got there first.
    // (The status is read again: TypeScript's narrowing from the first line does not survive the await.)
    if (epoch !== this.epoch || (this.status as AgentStatus) === 'quoting') return;
    this.resumeAt = 0;
    this.killReason = null;
    this.failures = 0;
    this.owed = null; // quoting again: the runner manages its own orders (a cancel owed by a pause is moot)
    this.status = 'quoting';
    this.startedAt = Date.now();
    if (limits || !this.session) {
      this.session = { stopLossUsd: null, takeProfitUsd: null, ...limits, startedAt: this.startedAt, startEquity: this.equityNow() };
      this.flows.sessionIn = this.flows.sessionOut = 0;
      journal(this.userId, 'session_start', null, this.session.startEquity, {
        strategy: STRATEGY_VERSION, policyHash: this.policyHash, policy: this.policy, stopLossUsd: this.session.stopLossUsd, takeProfitUsd: this.session.takeProfitUsd,
        positions: Object.fromEntries(MARKETS.map((s) => [s, this.venue?.position(s).size ?? 0])),
      });
    }
    for (const sym of this.policy.markets) this.rt(sym).govAsap = true;
    this.persist();
    this.alert('info', 'Monday started quoting.');
    event(this.userId, 'connect', { markets: this.policy.markets });
  }

  /** Boot: a stopped agent that still owes a cancel or a flatten connects to finish it. Tick retries until it lands. */
  async resumeCleanup() {
    if (!this.owed) return;
    this.alert('warn', `Monday restarted with ${this.owed === 'flatten' ? 'positions' : 'orders'} still to close. Retrying.`);
    await this.open().catch((e) => {
      this.owedRetryAt = Date.now() + 10_000;
      event(this.userId, 'error', { resumeCleanup: String(e) });
    });
  }

  async pause() {
    this.epoch++; // also cancels a Start still connecting
    this.resumeAt = 0;
    if (this.status !== 'quoting') return;
    this.status = 'paused';
    this.endSession('pause');
    this.persist();
    const err = await this.cleanup('cancel');
    if (err) this.alert('warn', `Stopped, but Monday's orders could not be cancelled yet (${err}). Monday retries while Perpl is reachable.`);
    else this.alert('info', "Stopped. Monday's orders are cancelled. Open positions and orders you placed yourself are kept, and Monday no longer watches them: close them on Perpl or use Kill and flatten.");
  }

  async kill(reason: KillReason) {
    this.epoch++;
    this.resumeAt = 0;
    if (this.status === 'killed') return;
    this.status = 'killed';
    this.killReason = reason;
    this.persist();
    const evidence = { at: Date.now(), reason, strategy: STRATEGY_VERSION, policyHash: this.policyHash, equityUsd: this.equityNow(), pnlTodayUsd: this.pnlToday(), positions: MARKETS.map((s) => ({ market: s, size: this.venue?.position(s).size ?? 0 })) };
    const err = await this.cleanup('flatten');
    if (err) this.alert('critical', `Could not flatten automatically: ${err}. Monday retries every 10 seconds while Perpl is reachable; you can also close the position on Perpl.`);
    const done = 'All orders were cancelled and positions closed.';
    let text = reason === 'loss_limit' ? `Daily loss limit of ${usd(this.policy.maxDailyLossUsd)} reached. ${done}`
      : reason === 'session_loss' && this.session?.stopLossUsd != null ? `Session stop loss of ${cents(this.session.stopLossUsd)} reached. ${done}`
      : reason === 'margin' ? `Equity fell below the ${usd(marginFloorUsd(this.policy, this.policy.markets.length))} of margin this policy needs at ${this.policy.maxLeverage}x. ${done} Lower the limits or deposit more.`
      : KILL_TEXT[reason];
    if (err) text = text.replace(done, 'Orders and positions could not be closed yet; Monday is retrying.');
    this.endSession(`kill:${reason}`);
    this.persist();
    this.logDecision(this.policy.markets[0] ?? 'BTC', 'kill', 'killed', { reason }, text, evidence, null);
    this.alert('critical', text);
    this.deps.notify(`Monday kill switch (${reason}) for ${this.wallet.slice(0, 8)}: ${text}`);
    event(this.userId, 'kill', { reason });
  }

  /** Session take profit: cancel, close the position and stop. Not a kill, nothing went wrong. */
  private async takeProfit(pnlUsd: number) {
    this.epoch++;
    this.status = 'paused';
    this.endSession('take_profit');
    this.persist();
    const err = await this.cleanup('flatten');
    if (err) this.alert('critical', `Take profit reached (${cents(pnlUsd)} this session) but the position could not be closed yet: ${err}. Monday retries while Perpl is reachable; you can also close it on Perpl.`);
    else this.alert('info', `Take profit reached: ${cents(pnlUsd)} this session. Orders cancelled and positions closed.`);
    this.deps.notify(`Monday take profit (${cents(pnlUsd)}) for ${this.wallet.slice(0, 8)}${err ? ', position still closing' : ''}`);
    event(this.userId, 'take_profit', { pnlUsd });
  }

  private endSession(why: string) {
    if (!this.session) return;
    journal(this.userId, 'session_stop', null, this.equityNow(), { why, pnlUsd: this.sessionPnl(), startedAt: this.session.startedAt });
    this.session = null;
  }

  /**
   * New limits apply at the next tick (FR-POL-4), through the same gate as everything else. A market taken out of the
   * policy gets no new inventory, but a position there stays on the dashboard and Monday keeps working its exit.
   */
  setPolicy(p: Policy) {
    this.policy = p;
    this.policyHash = hashOf(p);
    journal(this.userId, 'policy', null, null, { policyHash: this.policyHash, policy: p });
    for (const sym of p.markets) this.rt(sym).govAsap = true;
  }

  /** Cancel every order and, for 'flatten', close every position. On failure the work stays owed (and stored) for tick to retry. Returns the error. */
  private async cleanup(what: 'cancel' | 'flatten'): Promise<string | null> {
    if (this.owed !== 'flatten') this.owed = what; // a flatten owed by a kill is never downgraded to a cancel
    this.persist();
    this.cleaning = true;
    try {
      if (!this.venue) throw new VenueError('disconnected', 'not connected to Perpl yet');
      await this.venue.cancelAll(this.owed !== 'flatten'); // a Stop cancels Monday's orders only, a kill everything
      if (this.owed === 'flatten') await this.venue.flatten();
      this.owed = null;
      return null;
    } catch (e) {
      this.owedRetryAt = Date.now() + 10_000;
      return e instanceof Error ? e.message : String(e);
    } finally {
      this.cleaning = false;
      this.persist();
    }
  }

  /** Process is stopping: pull resting orders off the book, but leave the persisted status so boot resumes. */
  async shutdown() {
    this.status = 'idle'; // in memory only: a tick during the cancels must not post a new quote
    if (this.venue) this.snapshot(Date.now(), this.equityNow());
    const err = await this.venue?.cancelAll(true).then(() => null, (e) => (e instanceof Error ? e.message : String(e)));
    if (err) {
      console.error(JSON.stringify({ service: 'runner', user: this.userId, event: 'shutdown_cancel_failed', error: err }));
      this.deps.notify(`Monday stopped but could not cancel the orders of ${this.wallet.slice(0, 8)} (${err}). Check Perpl.`);
    }
    this.dispose();
  }

  private dropVenue() {
    const v = this.venue;
    this.venue = null;
    v?.close();
  }

  dispose() {
    this.epoch++;
    this.disposed = true;
    this.venue?.close();
    this.venue = null;
    this.status = 'idle';
    this.listeners.clear();
  }

  subscribe(cb: (s: DashboardState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private persist() {
    const s = this.session;
    // started_at is the session's start, which a restart reads back: resuming must not move it, or the deposits made
    // earlier in the session would stop counting as deposits and show up as session profit.
    db.prepare('insert into agents (user_id, status, kill_reason, started_at, session_sl, session_tp, session_equity, owed) values (?,?,?,?,?,?,?,?) on conflict(user_id) do update set status = excluded.status, kill_reason = excluded.kill_reason, started_at = excluded.started_at, session_sl = excluded.session_sl, session_tp = excluded.session_tp, session_equity = excluded.session_equity, owed = excluded.owed')
      .run(this.userId, this.status, this.killReason, s?.startedAt ?? this.startedAt, s?.stopLossUsd ?? null, s?.takeProfitUsd ?? null, s?.startEquity ?? null, this.owed);
  }

  // ---- per-market runtime ----
  private rt(sym: MarketSym): MarketRt {
    return (this.m[sym] ??= {
      sym, var1m: 0, lastClose: 0, lastMinute: 0, sigmaHist: [], book: 0,
      params: { market: sym, enabled: true, spread_mult: 2, skew_bias_bps: 0, size_mult: 0.5, max_inventory_usd: this.policy.maxInventoryUsd, ttl_min: 15, regime: 'stale', reason: 'Waiting for the first governor decision.' },
      paramsSource: 'fallback', paramsUntil: 0, nextGovAt: 0, lastGovAt: 0, govBusy: false, govAsap: false, wasStorm: false, wasStale: false, reflex: null, lastBigTs: Date.now(),
      lastSent: { bid: 0, ask: 0 }, inflight: { bid: false, ask: false }, sending: { bid: null, ask: null }, since: { bid: 0, ask: 0 }, held: { bid: null, ask: null },
      block: { bid: null, ask: null }, ackedAt: { bid: 0, ask: 0 }, resting: { bid: null, ask: null }, model: null, stage: 'normal', posSince: 0, posSign: 0,
      basis: { bps: 0, dev: 0, gap: 0, n: 0 }, gapAlarm: false, why: '', min: null, bothHist: [], lastDecisionId: null, series: [], bandAlertAt: 0,
    });
  }
  private cfg(sym: MarketSym): StrategyConfig {
    return { ...DEFAULT_CONFIG, k: this.deps.k(sym) };
  }
  private spec(sym: MarketSym): MarketSpec {
    return this.deps.driver.feed.specs()[sym]!;
  }
  /** Markets Monday looks after: the policy's, plus any other that still holds a position or a resting quote. */
  private managed(): MarketSym[] {
    const v = this.venue;
    return MARKETS.filter((s) => this.policy.markets.includes(s) || (v && (v.position(s).size !== 0 || v.quote(s, 'bid') || v.quote(s, 'ask'))));
  }
  private day(sym: MarketSym, now: number): Day {
    const hit = volume.get(sym);
    if (!hit || now - hit.at > 10 * 60_000) {
      volume.set(sym, { hourlyUsd: null, open: null, high: null, low: null, ...hit, at: now }); // one fetch in flight
      void this.deps.driver.feed.candles(sym, now - 86_400_000, now).then((cs) => {
        const usd = cs.reduce((s, c) => s + (c.v ?? 0), 0);
        let high: number | null = null, low: number | null = null;
        for (const c of cs) {
          high = high == null ? c.h : Math.max(high, c.h);
          low = low == null ? c.l : Math.min(low, c.l);
        }
        volume.set(sym, { at: now, hourlyUsd: usd > 0 ? usd / 24 : null, open: cs[0]?.o ?? null, high, low });
      }).catch(() => {});
    }
    return volume.get(sym)!;
  }
  private hourlyVolume(sym: MarketSym, now: number): number | null {
    return this.day(sym, now).hourlyUsd;
  }

  // ---- the tick (PRD 9.3) ----
  tick() {
    const now = Date.now();
    this.refill(now);
    const feed = this.deps.driver.feed;
    const v = this.venue;
    // Perpl's snapshots after a (re)connect are the truth; compare before anything new is quoted.
    if (v?.connected() && !this.wasConnected) this.reconcile();
    this.wasConnected = v?.connected() ?? false;
    if (v) this.trackCash(now);
    if (this.resumeAt && now >= this.resumeAt && this.status === 'idle') {
      this.resumeAt = now + 10_000; // Perpl unreachable at boot: try again until it answers
      void this.start().catch((e) => event(this.userId, 'error', { resume: e instanceof Error ? e.message : String(e) }));
    }
    // Account limits before any market is quoted: a breach must stop this tick's orders, not follow them.
    if (v) this.riskAndBooks(now);

    const wants: Want[] = [];
    const quoted: [MarketRt, MarketSnapshot, number][] = [];
    const equity = this.equityNow();
    for (const sym of this.managed()) {
      const snap = feed.snapshot(sym);
      if (!snap || !this.spec(sym)) continue;
      const rt = this.rt(sym);
      const inPolicy = this.policy.markets.includes(sym);
      this.updateVol(rt, snap, now);
      // EWMA with a 5-tick half-life (ticks are 1 s), so one flickering level cannot fire the reflex.
      rt.book += (this.bookNow(sym, snap) - rt.book) * 0.13;
      this.updateBasis(rt, snap);
      if (!rt.series.length || now - rt.series[rt.series.length - 1].t >= 5_000) {
        rt.series.push({ t: now, p: snap.mark, bid: v?.quote(sym, 'bid')?.price ?? null, ask: v?.quote(sym, 'ask')?.price ?? null });
        if (rt.series.length > 240) rt.series.shift();
      }
      if (this.status !== 'quoting' || !v) {
        rt.why = this.status === 'killed' ? 'Monday is stopped by its kill switch.' : this.status === 'paused' ? 'Monday is stopped.' : 'Monday is not started.';
        continue;
      }
      this.record(rt, snap, now);

      // 1. Stale market data: cancel at 5 s, kill at 30 s. Fail closed.
      const age = now - snap.updatedAt;
      if (age > STALE_KILL_MS) return void this.kill('stale_data');
      if (age > STALE_CANCEL_MS) {
        rt.block = { bid: 'stale', ask: 'stale' };
        for (const side of ['bid', 'ask'] as const) this.plan(wants, rt, side, null, 1, 'stale data', 1, now);
        rt.why = 'Perpl market data is late, so quotes are pulled until it returns.';
        continue;
      }
      // 2-4. Signal, reflex, governor parameters
      const sig = this.deps.collector.signal(sym);
      if (inPolicy) {
        this.runReflex(rt, sig, snap, now);
        this.runGovernor(rt, snap, sig, now);
      }

      const spec = this.spec(sym);
      const pos = v.position(sym);
      const posUsd = pos.size * snap.mark;
      const cap = this.capUsd(rt);
      rt.stage = inventoryStage({
        positionUsd: posUsd, capUsd: cap, ageMs: this.positionAge(rt, pos.size, now), unrealizedUsd: pos.size * (snap.mark - pos.entryPrice),
        dailyLossUsd: this.policy.maxDailyLossUsd, inPolicy,
      });
      // A Perpl/Hyperliquid gap far from its usual level: quote wider and smaller until it settles, rather than treat it as an opportunity.
      const gov = { ...rt.params, max_inventory_usd: cap, enabled: inPolicy && rt.params.enabled };
      if (rt.gapAlarm) Object.assign(gov, { spread_mult: gov.spread_mult * 1.5, size_mult: gov.size_mult * 0.5 });
      // The operator's quote cap holds per order, whatever size multiplier the governor picked.
      if (config.caps) gov.size_mult = Math.min(gov.size_mult, config.caps.quoteSizeUsd / this.policy.quoteSizeUsd);
      const out = computeQuotes({
        mark: snap.mark, mid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk, sigma1mBps: varToBps(rt.var1m), positionUsd: posUsd, S: sig.S, book: rt.book,
        hlMid: this.hlReference(rt), hourlyVolumeUsd: this.hourlyVolume(sym, now), policy: this.policy, gov, reflex: rt.reflex, spec, cfg: this.cfg(sym),
        stage: rt.stage, positionBase: pos.size, entryPrice: pos.entryPrice, trendBps: this.trendBps(rt, now, snap.mark),
      });
      rt.model = out;

      // 5-6. The final risk gate, then queue only what changed.
      const others = this.grossExcept(sym);
      const exit = rt.stage !== 'normal' ? (pos.size > 0 ? 'ask' : 'bid') : null;
      for (const side of ['bid', 'ask'] as const) {
        let target: QuoteTarget | null = out[side];
        let gate: GateReason | null = null;
        if (target) {
          const g = riskGate({
            side, target, oracle: snap.oracle, mark: snap.mark, positionSize: pos.size, otherUsd: others, equityUsd: equity, capUsd: cap,
            accountCapUsd: this.accountCapUsd(), maxOrderUsd: Math.min(this.policy.quoteSizeUsd * 1.5, config.caps?.quoteSizeUsd ?? Infinity),
            maxLeverage: this.policy.maxLeverage, sizeStep: spec.sizeStep,
          });
          if ('reject' in g) {
            target = null;
            gate = g.reject;
            if (gate === 'price_band' && now - rt.bandAlertAt > 60_000) {
              rt.bandAlertAt = now;
              this.alert('warn', `${sym} ${side} would sit more than 1% from the oracle price. Order blocked.`);
            }
          } else target = g.target;
        }
        rt.block[side] = gate ? `risk:${gate}` : target ? null
          : !inPolicy ? 'not in policy'
          : exit && side !== exit ? 'exit'
          : rt.reflex?.side === side && rt.reflex.action === 'pull' ? 'reflex'
          : !gov.enabled ? 'governor'
          : 'size';
        const prio: Priority = !target && (gate || !inPolicy) ? 1 : side === exit ? 2 : 3;
        this.plan(wants, rt, side, target, out.halfBps, gate ? `risk:${gate}` : side === exit ? `exit:${rt.stage}` : rt.block[side] ?? 'quote', prio, now, out.touch[side] ? snap : null);
      }
      quoted.push([rt, snap, posUsd]);
    }
    this.dispatch(wants, now);
    for (const [rt, snap, posUsd] of quoted) rt.why = this.whyIdle(rt, snap, posUsd);

    if (this.owed && !this.cleaning && this.status !== 'quoting' && now >= this.owedRetryAt) {
      if (!this.venue) {
        // Restarted with cleanup owed and Perpl unreachable at boot: keep trying to connect.
        this.owedRetryAt = now + 10_000;
        void this.open().catch(() => {});
      } else if (this.venue.connected()) {
        const what = this.owed;
        void this.cleanup(what).then((err) => err
          ? event(this.userId, 'error', { cleanup: what, message: err })
          : this.alert('info', `Perpl is reachable again: all orders cancelled${what === 'flatten' ? ' and positions closed' : ''}.`));
      }
    }
    if (this.listeners.size) {
      const s = this.state();
      for (const cb of this.listeners) cb(s);
    }
  }

  /**
   * Queue one side if it differs enough from what rests on the book. The class comes from the caller, refined here:
   * a cancel is never routine, a live quote now more aggressive than wanted is dangerous (3), a requote chasing price
   * is routine (4), a new quote least urgent (5). Targets are rebuilt every tick, so a request that waited for budget
   * goes out with the newest target, and one no longer needed is simply not sent.
   */
  private plan(wants: Want[], rt: MarketRt, side: Side, target: QuoteTarget | null, halfBps: number, reason: string, prio: Priority, now: number, front: MarketSnapshot | null = null) {
    const live = this.venue!.quote(rt.sym, side);
    let move = shouldRequote(live, target, halfBps, this.spec(rt.sym).priceTick);
    // The target is the front of the book and the live quote has slipped behind it: back to the front once it is clearly
    // behind or buried, not on every tick the best price flickers, because each requote gives up its place in line.
    if (!move && front && live && target) move = touchRequote(live, side, side === 'bid' ? front.bestBid : front.bestAsk, this.aheadUsd(front, side, live), this.cfg(rt.sym));
    if (!move) {
      rt.since[side] = 0;
      rt.held[side] = null;
      return;
    }
    rt.since[side] ||= now;
    if (prio === 3 && target) prio = !live ? 5 : (side === 'bid' ? live.price > target.price : live.price < target.price) ? 3 : 4;
    wants.push({ sym: rt.sym, side, target, prio, since: rt.since[side], reason: target ? reason : `cancel:${reason}` });
  }

  /** Send what the budget allows, most urgent first. Cancels may spend the whole reserve, exits half of it, routine work none. */
  private dispatch(wants: Want[], now: number) {
    if (!this.venue?.connected()) return; // every request would fail at once and only spend budget
    this.turn++;
    for (const w of orderJobs(wants, now, MARKETS, this.turn)) {
      const rt = this.rt(w.sym);
      if (rt.inflight[w.side]) {
        rt.held[w.side] = 'confirm';
        continue;
      }
      if (w.target && w.prio >= 4 && now - rt.lastSent[w.side] < MIN_REQUOTE_MS) {
        rt.held[w.side] = 'pace';
        continue;
      }
      const floor = !w.target ? 0 : w.prio <= 2 ? RESERVED_TOKENS / 2 : RESERVED_TOKENS;
      if (this.tokens - 1 < floor) {
        rt.held[w.side] = 'budget';
        continue;
      }
      rt.held[w.side] = null;
      this.send(rt, w, now);
    }
  }

  private send(rt: MarketRt, w: Want, now: number) {
    const v = this.venue!;
    const { sym, side, target } = w;
    const snap = this.deps.driver.feed.snapshot(sym);
    const dataAt = snap?.updatedAt ?? now;
    this.tokens -= 1;
    this.ownRequests++;
    rt.inflight[side] = true;
    rt.lastSent[side] = now;
    rt.sending[side] = target;
    rt.since[side] = 0;
    const action = !target ? 'cancel' : v.quote(sym, side) ? 'change' : 'place';
    const sig = this.deps.collector.signal(sym);
    const ctx = {
      mid: snap?.mid, bestBid: snap?.bestBid, bestAsk: snap?.bestAsk, mark: snap?.mark, hl: hlMid(sym), basisBps: rt.basis.n ? +rt.basis.bps.toFixed(2) : null,
      sigma1mBps: +varToBps(rt.var1m).toFixed(2), book: +rt.book.toFixed(3), S: +sig.S.toFixed(2), z5: +sig.w5.z.toFixed(2), signalAt: sig.at,
      regime: rt.params.regime, reflex: rt.reflex && { side: rt.reflex.side, action: rt.reflex.action, book: !!rt.reflex.book }, stage: rt.stage,
      halfBps: rt.model && +rt.model.halfBps.toFixed(2), waitedMs: now - w.since, tokens: Math.floor(this.tokens),
    };
    const id = Number(insQuote.run(this.userId, sym, side, action, w.prio, target?.price ?? null, target?.size ?? null, w.reason, dataAt, now, JSON.stringify(ctx)).lastInsertRowid);
    v.setQuote(sym, side, target, this.policy.maxLeverage)
      .then(() => {
        const done = Date.now();
        this.failures = 0;
        doneQuote.run(done, 1, null, id);
        rt.ackedAt[side] = target ? done : 0;
        rt.resting[side] = target ? id : null;
        // Two latencies: market data to request sent, and to Perpl confirming the change.
        for (const [k, ms] of [['send', now - dataAt], ['venue', done - dataAt]] as const) {
          this.latency[k].push(ms);
          if (this.latency[k].length > 100) this.latency[k].shift();
        }
      })
      .catch((e) => {
        doneQuote.run(Date.now(), 0, e instanceof Error ? e.message.slice(0, 200) : String(e), id);
        this.onOrderError(e);
      })
      .finally(() => {
        rt.inflight[side] = false;
        rt.sending[side] = null;
      });
  }

  private refill(now: number) {
    if (this.budgetRestoreAt && now > this.budgetRestoreAt) {
      this.budget = config.budgetPerMin;
      this.budgetRestoreAt = 0;
    }
    this.tokens = Math.min(this.budget, this.tokens + ((now - this.lastRefill) / 60_000) * this.budget);
    this.lastRefill = now;
    // Requests the venue sent on its own (retries, keep-alives, cancel sweeps, closes) spend the same rate limit.
    // ponytail: counted a tick late and floored at zero per tick; ask the venue for a per-request hook if that ever matters.
    const sent = this.venue?.requests?.();
    if (sent != null) {
      const extra = sent - this.seenRequests.venue - (this.ownRequests - this.seenRequests.own);
      if (extra > 0) this.tokens = Math.max(0, this.tokens - extra);
      this.seenRequests = { venue: sent, own: this.ownRequests };
    }
  }

  private updateVol(rt: MarketRt, snap: MarketSnapshot, now: number) {
    const minute = Math.floor(now / 60_000);
    if (rt.lastMinute === 0) {
      // Warm up from recent candles so the first quotes are not priced with zero volatility.
      rt.lastMinute = minute;
      rt.lastClose = snap.mark;
      void this.deps.driver.feed.candles(rt.sym, now - 3 * 3_600_000, now).then((cs) => {
        for (let i = 1; i < cs.length; i++) {
          rt.var1m = ewmaVar(rt.var1m, Math.log(cs[i].c / cs[i - 1].c));
          rt.sigmaHist.push(varToBps(rt.var1m));
        }
      }).catch(() => {});
      return;
    }
    if (minute === rt.lastMinute) return;
    rt.var1m = ewmaVar(rt.var1m, Math.log(snap.mark / rt.lastClose));
    rt.lastMinute = minute;
    rt.lastClose = snap.mark;
    rt.sigmaHist.push(varToBps(rt.var1m));
    if (rt.sigmaHist.length > 1440) rt.sigmaHist.shift();
  }

  /**
   * The usual Perpl premium over Hyperliquid, learned live (EWMA, about 10 minutes), and how far the gap typically
   * strays from it. A steady premium is not mispricing, so the blend leans toward Hyperliquid plus that premium.
   */
  private updateBasis(rt: MarketRt, snap: MarketSnapshot) {
    const hl = hlMid(rt.sym);
    const local = snap.mid ?? snap.mark;
    if (!hl || !local) return;
    const gap = (local / hl - 1) * 1e4;
    if (Math.abs(gap) > DEFAULT_CONFIG.blendMaxBps) return; // a dislocation, not the basis
    const b = rt.basis;
    if (!b.n) Object.assign(b, { bps: gap, dev: 0 });
    b.dev += (Math.abs(gap - b.bps) - b.dev) / 120;
    b.bps += (gap - b.bps) / 600;
    b.gap = gap;
    b.n++;
    rt.gapAlarm = b.n > 300 && Math.abs(gap - b.bps) > Math.max(5, 4 * b.dev);
  }
  private hlReference(rt: MarketRt): number | null {
    const hl = hlMid(rt.sym);
    return hl == null ? null : hl * (1 + rt.basis.bps / 1e4);
  }

  /** Signed move of the mark over the last five minutes (less while the series is shorter), in bps. Zero under a minute of data. */
  private trendBps(rt: MarketRt, now: number, mark: number): number {
    const s = rt.series; // one sample every 5 s
    if (s.length < 12) return 0;
    const since = now - 5 * 60_000;
    let base = s[0];
    for (const p of s) {
      if (p.t > since) break;
      base = p;
    }
    return base.p > 0 ? (mark / base.p - 1) * 1e4 : 0;
  }

  /** USD resting ahead of one of Monday's quotes on its side. Only the live book shows the quote itself, which is taken out. */
  private aheadUsd(snap: MarketSnapshot, side: Side, q: QuoteTarget): number {
    return depthAhead(side === 'bid' ? snap.bids : snap.asks, side, q.price, this.deps.driver.kind === 'perpl' ? q.size : 0) * q.price;
  }

  /** Top-of-book imbalance. Only the live book carries Monday's own resting quotes; leave them out so it cannot chase itself. */
  private bookNow(sym: MarketSym, snap: MarketSnapshot): number {
    const tick = this.spec(sym).priceTick;
    const others = (levels: BookLevel[], side: Side) => {
      const q = this.deps.driver.kind === 'perpl' ? this.venue?.quote(sym, side) : null;
      if (!q) return levels;
      return levels.map((l) => (Math.abs(l.price - q.price) < tick / 2 ? { ...l, size: l.size - q.size } : l)).filter((l) => l.size > 0);
    };
    return bookImbalance(others(snap.bids, 'bid'), others(snap.asks, 'ask'));
  }

  // ---- limits ----
  /** This market's inventory cap: the lowest of the user's policy, the governor and the operator. */
  private capUsd(rt: MarketRt): number {
    return Math.min(this.policy.maxInventoryUsd, rt.params.max_inventory_usd, config.caps?.maxInventoryUsd ?? Infinity);
  }
  private accountCapUsd(): number {
    return Math.min(this.policy.maxInventoryUsd, config.caps?.maxInventoryUsd ?? Infinity) * Math.max(1, this.policy.markets.length);
  }
  /** Worst-case gross exposure outside `sym`: each market's position plus whichever resting or in-flight quote would grow it most. */
  private grossExcept(sym: MarketSym): number {
    const v = this.venue;
    if (!v) return 0;
    let g = 0;
    for (const s of MARKETS) {
      if (s === sym) continue;
      const snap = this.deps.driver.feed.snapshot(s);
      if (!snap) continue;
      const rt = this.m[s];
      const pos = v.position(s).size;
      const bid = Math.max(v.quote(s, 'bid')?.size ?? 0, rt?.sending.bid?.size ?? 0);
      const ask = Math.max(v.quote(s, 'ask')?.size ?? 0, rt?.sending.ask?.size ?? 0);
      g += Math.max(Math.abs(pos + bid), Math.abs(pos - ask)) * snap.mark;
    }
    return g;
  }
  /** How long the current position has been open, from Monday's fills (so a restart keeps the age). */
  private positionAge(rt: MarketRt, size: number, now: number): number {
    if (size === 0) {
      rt.posSince = rt.posSign = 0;
      return 0;
    }
    if (Math.sign(size) !== rt.posSign || !rt.posSince) {
      rt.posSign = Math.sign(size);
      rt.posSince = now;
      // Walk back through the fills until the position was flat or the other way: that fill opened this one.
      let s = size;
      for (const f of db.prepare('select side, size, ts from fills where user_id = ? and sym = ? order by ts desc limit 500').all(this.userId, rt.sym) as { side: Side; size: number; ts: number }[]) {
        const before = s - (f.side === 'bid' ? f.size : -f.size);
        rt.posSince = f.ts;
        if (Math.abs(before) < 1e-9 || Math.sign(before) !== Math.sign(size)) break;
        s = before;
      }
    }
    return now - rt.posSince;
  }

  // ---- reflex and governor ----
  private runReflex(rt: MarketRt, sig: MarketSignal, snap: MarketSnapshot, now: number) {
    const cfg = this.cfg(rt.sym);
    const sym = rt.sym;
    const big = this.deps.collector.recentTrades(sym, Math.max(rt.lastBigTs, now - 60_000)).filter((t) => t.valueUsd >= cfg.bigTradeUsd).sort((a, b) => b.valueUsd - a.valueUsd)[0];
    if (big) rt.lastBigTs = Math.max(rt.lastBigTs, big.ts) + 1;
    const z = sig.stale ? 0 : sig.w5.z;
    const held = rt.reflex && rt.reflex.until > now ? rt.reflex : null;
    const flow = reflexTrigger(z, big ? tradeSign(big) : 0, cfg, held && !held.book && !held.ref ? held : null);
    // Smart-money flow wins; then a move in the reference price, then the book. Each holds for its own time.
    const move = this.deps.driver.kind === 'sim' ? null : hlMoveBps(sym, cfg.refWindowMs);
    const onRef = move == null ? null : refTrigger(move, cfg, held?.ref ? held : null);
    const onBook = bookTrigger(rt.book, cfg, held?.book ? held : null);
    const trig = flow ?? (onRef && { ...onRef, ref: true }) ?? (onBook && { ...onBook, book: true });
    // With no trigger the hold that is running out decides how long its release lasts.
    const kind = trig ? (flow ? 'flow' : onRef ? 'ref' : 'book') : rt.reflex?.ref ? 'ref' : rt.reflex?.book ? 'book' : 'flow';
    const holdCfg = kind === 'flow' ? cfg : { ...cfg, reflexHoldMs: kind === 'ref' ? cfg.refHoldMs : cfg.bookHoldMs };
    const dir = trig?.side === 'ask' ? 1 : -1;
    const culprits = flow ? this.deps.collector.recentTrades(sym, now - 5 * 60_000).filter((t) => tradeSign(t) === dir).sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 12) : [];
    const { state, changed } = nextReflex(rt.reflex, trig, now, flow ? z : onRef ? move! : rt.book, culprits.map((t) => t.hash), holdCfg);
    const before = rt.reflex;
    rt.reflex = state;
    if (!changed) return;
    if (!state?.book && !state?.ref) rt.govAsap = true; // book flicker and a few seconds of reference move are not worth an early governor run
    const holdMin = cfg.reflexHoldMs / 60_000;
    if (state?.released) {
      const what = state.ref ? 'Perpl has had time to catch up with Hyperliquid' : state.book ? 'The book has evened out' : 'Flow has cooled';
      this.logDecision(sym, 'reflex', 'reflex', { widen: state.side, release: true }, `${what}. The ${state.side} is back, still widened for now.`, { z5m: z, bookImbalance: rt.book, hlMoveBps: move, at: now }, null);
    } else if (state?.ref) {
      const what = state.action === 'pull' ? `${cap(state.side)} pulled` : `${cap(state.side)} widened ${cfg.reflexWiden}x`;
      const reason = `Hyperliquid's ${sym} mid moved ${move! >= 0 ? 'up' : 'down'} ${Math.abs(move!).toFixed(1)} bps in ${cfg.refWindowMs / 1000} seconds and Perpl's book has not caught up. ${what} for ${cfg.refHoldMs / 1000} seconds.`;
      this.logDecision(sym, 'reflex', 'reflex', { [state.action]: state.side, hold_s: cfg.refHoldMs / 1000, trigger: 'reference' }, reason, { hlMoveBps: move, windowMs: cfg.refWindowMs, hlMid: hlMid(sym), perplMid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk, at: now }, null);
    } else if (state?.book) {
      const what = state.action === 'pull' ? `${cap(state.side)} pulled` : `${cap(state.side)} widened ${cfg.reflexWiden}x`;
      const heavy = state.side === 'ask' ? 'bids' : 'asks';
      const reason = `Perpl's ${sym} book is ${Math.round(50 + Math.abs(rt.book) * 50)}% ${heavy} in the top 5 levels. ${what} for ${cfg.bookHoldMs / 1000} seconds.`;
      this.logDecision(sym, 'reflex', 'reflex', { [state.action]: state.side, hold_s: cfg.bookHoldMs / 1000, trigger: 'book' }, reason, { bookImbalance: rt.book, bids: snap.bids.slice(0, 5), asks: snap.asks.slice(0, 5), at: now }, null);
    } else if (state) {
      const verb = state.side === 'ask' ? 'bought' : 'sold';
      const what = state.action === 'pull' ? `${cap(state.side)} pulled` : `${cap(state.side)} widened ${cfg.reflexWiden}x`;
      const reason = big && Math.abs(z) <= cfg.z2
        ? `A single smart-money ${state.side === 'ask' ? 'buy' : 'sell'} of ${usdCompact(big.valueUsd)} ${sym} landed on Hyperliquid. ${what} for ${holdMin} minutes.`
        : `Smart money ${verb} ${usdCompact(Math.abs(sig.w5.netUsd))} ${sym} on Hyperliquid in 5 min (z = ${z.toFixed(1)}). ${what} for ${holdMin} minutes.`;
      const signalAgeMs = now - (culprits[0]?.fetchedAt ?? now);
      this.logDecision(sym, 'reflex', 'reflex', { [state.action]: state.side, hold_min: holdMin }, reason, { z5m: z, netUsd5m: sig.w5.netUsd, nansenTx: state.triggerHashes, signalAgeMs, at: now }, null);
    } else if (before) {
      const what = before.ref ? 'Perpl has caught up with Hyperliquid' : before.book ? 'The book has evened out' : 'Flow has cooled';
      this.logDecision(sym, 'reflex', 'reflex', { restore: before.side }, `${what}. The ${before.side} is back to normal.`, { z5m: z, netUsd5m: sig.w5.netUsd, bookImbalance: rt.book, hlMoveBps: move, at: now }, null);
    }
  }

  private context(rt: MarketRt, snap: MarketSnapshot, sig: MarketSignal): GovernorContext {
    const hourAgo = Date.now() - 3_600_000;
    const recent = this.fills.filter((f) => f.sym === rt.sym && f.ts > hourAgo);
    const marks = recent.filter((f) => f.markout1mBps != null).map((f) => f.markout1mBps!);
    const lean = this.deps.k(rt.sym) > 0;
    const base = { market: rt.sym, signal: sig, sigma1mBps: varToBps(rt.var1m), sigmaMedianBps: median(rt.sigmaHist), policy: this.policy, lean, noSmartMoney: !this.deps.collector.hasSource };
    return {
      ...base,
      topTrades: this.deps.collector.recentTrades(rt.sym, hourAgo).sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 5),
      mark: snap.mark, fundingRate: snap.fundingRate,
      inventoryUsd: (this.venue?.position(rt.sym).size ?? 0) * snap.mark, pnlTodayUsd: this.pnlToday(), feesUsd: this.fees,
      avgMarkout1mBps: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null, lossLimitUsedPct: this.lossUsedPct(),
      prev: rt.params, fills1h: recent.length, markoutSamples1h: marks.length, quotedPct1h: this.quotedPct(rt),
      inventoryAgeMin: rt.posSince ? (Date.now() - rt.posSince) / 60_000 : null, inventoryStage: rt.stage, feedAgeMs: Date.now() - snap.updatedAt,
      orderLatencyMs: this.latency.venue.length ? median(this.latency.venue) : null, proposal: rulesProposal(base),
    };
  }

  private runGovernor(rt: MarketRt, snap: MarketSnapshot, sig: MarketSignal, now: number) {
    const storm = Math.abs(sig.S) >= DEFAULT_CONFIG.z2;
    if (storm && !rt.wasStorm) rt.govAsap = true; // |S| crossed z2: run early
    if (sig.stale !== rt.wasStale && rt.nextGovAt) rt.govAsap = true; // smart-money data went stale or came back
    rt.wasStorm = storm;
    rt.wasStale = sig.stale;
    // Parameters past their time-to-live with no fresh answer: the rules take over until one arrives.
    if (rt.paramsSource === 'governor' && rt.paramsUntil && now > rt.paramsUntil) {
      const f = fallbackDecision(this.context(rt, snap, sig));
      rt.params = f.params;
      rt.paramsSource = 'fallback';
      rt.paramsUntil = 0;
    }
    if (rt.govBusy) return;
    if (now < rt.nextGovAt && !(rt.govAsap && now - rt.lastGovAt > 60_000)) return;
    rt.govBusy = true;
    rt.govAsap = false;
    rt.lastGovAt = now;
    const ctx = this.context(rt, snap, sig);
    // Until the LLM answers, the rules already protect the account.
    if (rt.nextGovAt === 0) rt.params = fallbackDecision(ctx).params;
    rt.nextGovAt = now + config.governorIntervalMin * 60_000;
    const policyAtAsk = this.policyHash;
    const evidence = {
      at: now, strategy: STRATEGY_VERSION, policyHash: policyAtAsk, lean: ctx.lean,
      signal: { S: sig.S, z5m: sig.w5.z, z15m: sig.w15.z, z60m: sig.w60.z, net5m: sig.w5.netUsd, net15m: sig.w15.netUsd, net60m: sig.w60.netUsd, stale: sig.stale, ageMs: Number.isFinite(this.deps.collector.ageMs) ? this.deps.collector.ageMs : null },
      nansenTx: this.deps.collector.recentTrades(rt.sym, now - 15 * 60_000).map((t) => t.hash),
      market: { mark: snap.mark, oracle: snap.oracle, bestBid: snap.bestBid, bestAsk: snap.bestAsk, sigma1mBps: ctx.sigma1mBps, fundingRate: snap.fundingRate, dataAgeMs: ctx.feedAgeMs },
      inventoryUsd: ctx.inventoryUsd, inventoryStage: rt.stage, results1h: { fills: ctx.fills1h, markout1mBps: ctx.avgMarkout1mBps, quotedPct: ctx.quotedPct1h },
      rules: ctx.proposal,
    };
    void decide(ctx)
      .then((res) => {
        if (this.status !== 'quoting') return;
        // An answer to a question that no longer stands (the policy changed, or it took too long) is not applied.
        if (this.policyHash !== policyAtAsk || Date.now() - now > LATE_DECISION_MS) {
          event(this.userId, 'governor_discarded', { market: rt.sym, late: Date.now() - now, policyChanged: this.policyHash !== policyAtAsk });
          return;
        }
        rt.params = res.params;
        rt.paramsSource = res.source;
        rt.paramsUntil = now + res.params.ttl_min * 60_000;
        rt.nextGovAt = now + Math.min(config.governorIntervalMin, res.params.ttl_min) * 60_000;
        const { reason, ...params } = res.params;
        const adjusted = res.proposed ? Object.keys(params).filter((k) => typeof res.proposed![k] === 'number' && res.proposed![k] !== (params as Record<string, unknown>)[k]) : [];
        this.logDecision(rt.sym, res.source, res.params.regime, params, reason, { ...evidence, proposed: res.proposed ?? null, clamped: adjusted }, res.llmModel, res.ms ?? null, res.costUsd ?? null);
        if (llmEnabled && llmFailures === 3) this.alert('warn', 'The LLM governor failed three times in a row. Rule-based regimes are in control.');
      })
      .catch((e) => event(this.userId, 'error', { governor: String(e) }))
      .finally(() => (rt.govBusy = false));
  }

  private onOrderError(e: unknown) {
    const code = e instanceof VenueError ? e.code : 'rejected';
    if (code === 'crosses_book') return; // next tick requotes behind the fresh best price
    if (code === 'revoked' || code === 'bad_signature' || code === 'read_only_key' || code === 'rate_limited' || code === 'fatal' || code === 'disconnected') return this.onVenueError(e as VenueError);
    // Only a quoting agent is killed for failing orders: a request rejected after Stop must not close the positions Stop keeps.
    if (this.status === 'quoting' && ++this.failures >= 3) void this.kill('order_failures');
  }

  private onVenueError(e: unknown) {
    const code = e instanceof VenueError ? e.code : 'fatal';
    event(this.userId, 'error', { code, message: e instanceof Error ? e.message : String(e) });
    if (code === 'revoked' || code === 'bad_signature' || code === 'read_only_key') {
      db.prepare("update perpl_credentials set status = 'revoked' where user_id = ?").run(this.userId);
      this.alert('critical', 'Key revoked, agent stopped. Add a new key to continue.');
      if (this.status === 'quoting') void this.kill('key_error');
      else this.dropVenue(); // stopped: nothing to close, and a new key must not inherit a flatten
    } else if (code === 'rate_limited') {
      // PRD 11.6: close code 1008. Back off and halve the request budget for 5 minutes.
      this.budget = Math.max(10, Math.floor(config.budgetPerMin / 2));
      this.budgetRestoreAt = Date.now() + 5 * 60_000;
      this.tokens = 0;
      this.alert('warn', 'Perpl rate limit hit. Request budget halved for 5 minutes.');
    } else if (code === 'disconnected') {
      if (!this.disconnectedAt) this.disconnectedAt = Date.now();
    } else {
      this.alert('critical', `Perpl closed the trading session: ${e instanceof Error ? e.message : e}`);
      this.deps.notify(`Monday: Perpl closed the trading session of ${this.wallet.slice(0, 8)} (${e instanceof Error ? e.message : e}). Reconnecting.`);
      // The venue stopped itself for good. Drop it so tick opens a fresh session and any owed cleanup can land.
      this.dropVenue();
      if (this.status === 'quoting') void this.kill('order_failures');
    }
  }

  // ---- the ledger ----
  /**
   * A fill is written with the venue's new balance and positions in one transaction, and only once: a message that
   * arrives again changes nothing. Its context links it to the request that placed the order and to what Monday saw.
   */
  private onFill(f: VenueFill) {
    const rt = this.m[f.sym];
    const snap = this.deps.driver.feed.snapshot(f.sym);
    const sig = this.deps.collector.kind === 'none' ? null : this.deps.collector.signal(f.sym);
    const now = Date.now();
    const quoteEventId = rt?.resting[f.side] ?? null;
    const ctx = {
      strategy: STRATEGY_VERSION, policyHash: this.policyHash, decisionId: rt?.lastDecisionId ?? null, quoteEventId,
      quoteAgeMs: rt?.ackedAt[f.side] ? now - rt.ackedAt[f.side] : null, seenAt: now, venueAt: f.ts,
      market: snap && { mid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk, mark: snap.mark, oracle: snap.oracle, dataAt: snap.updatedAt, hl: hlMid(f.sym), basisBps: rt?.basis.n ? rt.basis.bps : null, book: rt?.book ?? null, sigma1mBps: rt ? varToBps(rt.var1m) : null },
      signal: sig && { S: sig.S, z5: sig.w5.z, stale: sig.stale, at: sig.at, ageMs: Number.isFinite(this.deps.collector.ageMs) ? this.deps.collector.ageMs : null },
      params: rt && { regime: rt.params.regime, spread_mult: rt.params.spread_mult, size_mult: rt.params.size_mult, source: rt.paramsSource },
      reflex: rt?.reflex ?? null, stage: rt?.stage ?? null, halfBps: rt?.model?.halfBps ?? null,
      // A fill against the position is a close, whatever its PnL (win rate must count the break-even ones too).
      reduces: (this.expectedPos[f.sym] ?? 0) !== 0 && Math.sign(this.expectedPos[f.sym]!) !== (f.side === 'bid' ? 1 : -1),
    };
    const regime = rt?.params.regime ?? 'calm';
    // The distance the fill actually had from fair, not the model's half-spread: joining the touch brings a quote inside it.
    const ref = rt?.model?.ref ?? snap?.mid ?? null;
    const distBps = ref ? Math.abs(f.price / ref - 1) * 1e4 : null;
    const inserted = atomically(() => {
      const r = insFill.run(f.id, this.userId, f.sym, f.side, f.price, f.size, f.feeUsd, f.isMaker ? 1 : 0, f.ts, regime, f.realizedUsd, distBps, f.external ? 1 : 0, quoteEventId, JSON.stringify(ctx));
      if (r.changes === 0) return false;
      this.venue?.persist?.();
      return true;
    });
    if (!inserted) return;
    this.expectedPos[f.sym] = (this.expectedPos[f.sym] ?? 0) + (f.side === 'bid' ? f.size : -f.size);
    if (this.cash.expected != null) this.cash.expected += f.realizedUsd - f.feeUsd;
    if (f.external) {
      this.alert('info', `A ${f.sym} trade placed outside Monday filled. It counts toward your limits but not toward Monday's results.`);
      return;
    }
    const fill: Fill = {
      id: f.id, sym: f.sym, side: f.side, price: f.price, size: f.size, feeUsd: f.feeUsd, isMaker: f.isMaker, ts: f.ts, regime,
      markout1sBps: null, markout5sBps: null, markout10sBps: null, markout1mBps: null, markout5mBps: null,
    };
    this.fills.unshift(fill);
    if (this.fills.length > 80) this.fills.pop();
    this.realized += f.realizedUsd;
    this.fees += f.feeUsd;
    if (f.isMaker) this.pendingMarkouts.push(fill);
  }

  /** After a (re)connect: Perpl's positions are the truth. A difference from Monday's own record is written down and shown. */
  private reconcile() {
    const v = this.venue!;
    for (const sym of MARKETS) {
      const actual = v.position(sym).size;
      const mine = this.expectedPos[sym];
      const step = this.spec(sym)?.sizeStep ?? 1e-9;
      if (mine !== undefined && Math.abs(actual - mine) > step / 2) {
        journal(this.userId, 'reconcile', sym, actual - mine, { expected: mine, venue: actual });
        this.alert('warn', `${sym} position on Perpl (${+actual.toFixed(6)}) differs from Monday's record (${+mine.toFixed(6)}), most likely a trade made elsewhere while disconnected. Monday continues from Perpl's.`);
      }
      this.expectedPos[sym] = actual;
    }
  }

  /** Book cash that moved without a fill: deposits and withdrawals are not trading results; small moves are funding. */
  private trackCash(now: number) {
    const bal = this.venue!.account().balanceUsd;
    if (this.cash.expected == null) {
      if (bal > 0) this.cash.expected = bal;
      return;
    }
    const d = bal - this.cash.expected;
    if (Math.abs(d) < 0.005) {
      this.cash.since = 0;
      return;
    }
    if (!this.cash.since || Math.abs(d - this.cash.drift) > 0.005) {
      Object.assign(this.cash, { drift: d, since: now }); // still moving
      return;
    }
    if (now - this.cash.since < CASH_SETTLE_MS) return;
    const kind = Math.abs(d) < DEPOSIT_MIN_USD ? 'funding' : d > 0 ? 'deposit' : 'withdrawal';
    // Stopped with no position, a drop in cash can only be a withdrawal (no fill, no liquidation, no funding).
    const idle = kind === 'withdrawal' && this.status !== 'quoting' && MARKETS.every((s) => !this.venue!.position(s).size);
    journal(this.userId, kind, null, d, { balance: bal, expected: this.cash.expected, ...(idle && { idle: true }) });
    if (idle) this.flows.dayOutIdle += d;
    if (kind === 'funding') this.flows.dayFunding += d;
    else if (kind === 'deposit') {
      this.flows.dayIn += d;
      this.flows.sessionIn += d;
    } else {
      this.flows.dayOut += d;
      this.flows.sessionOut += d;
    }
    if (kind !== 'funding') this.alert('info', `${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${cents(Math.abs(d))} seen. It is not counted as profit or loss.`);
    Object.assign(this.cash, { expected: bal, drift: 0, since: 0 });
  }

  // ---- PnL, loss limit, markouts, snapshots ----
  private unrealized(): number {
    let u = 0;
    for (const sym of MARKETS) {
      const p = this.venue?.position(sym);
      const snap = this.deps.driver.feed.snapshot(sym);
      if (p && snap && p.size !== 0) u += p.size * (snap.mark - p.entryPrice);
    }
    return u;
  }
  private equityNow(): number {
    return (this.venue?.account().balanceUsd ?? 0) + this.unrealized();
  }
  /** A balance rise no fill explains, still settling: not profit until it is (it is most likely a deposit). */
  private unexplainedIn(): number {
    return this.cash.since && this.cash.drift > 0 ? this.cash.drift : 0;
  }
  /** Trading PnL today: equity change minus net deposits. Fees and funding are already in equity. */
  private pnlToday(): number {
    return this.dayKey ? this.equityNow() - this.dayStartEquity - this.flows.dayIn - this.flows.dayOut - this.unexplainedIn() : 0;
  }
  /**
   * What the loss limits see. Deposits are taken out; withdrawals are not, so an unexplained drop in the balance
   * (a liquidation or a fee Monday did not see would look the same) always counts against the limit. Fail closed:
   * pause Monday and close positions before withdrawing.
   */
  private riskPnlToday(): number {
    return this.dayKey ? this.equityNow() - this.dayStartEquity - this.flows.dayIn - this.flows.dayOutIdle - this.unexplainedIn() : 0;
  }
  private sessionPnl(): number {
    return this.session ? this.equityNow() - this.session.startEquity - this.flows.sessionIn - this.flows.sessionOut - this.unexplainedIn() : 0;
  }
  private lossUsedPct(): number {
    return (Math.max(0, -this.riskPnlToday()) / Math.min(this.policy.maxDailyLossUsd, config.caps?.maxDailyLossUsd ?? Infinity)) * 100;
  }
  /** What closing everything now would cost: taker fee plus half the book's spread, per market. */
  private exitCostUsd(): number {
    let c = 0;
    for (const sym of MARKETS) {
      const size = this.venue?.position(sym).size ?? 0;
      const snap = this.deps.driver.feed.snapshot(sym);
      if (!size || !snap) continue;
      const half = snap.bestBid && snap.bestAsk ? ((snap.bestAsk - snap.bestBid) / 2 / snap.mark) * 1e4 : 5;
      c += (Math.abs(size) * snap.mark * ((this.spec(sym)?.takerFeeBps ?? 3.45) + half)) / 1e4;
    }
    return c;
  }

  private riskAndBooks(now: number) {
    const equity = this.equityNow();
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dayStartEquity = equity;
      this.realized = this.fees = 0;
      this.flows.dayIn = this.flows.dayOut = this.flows.dayOutIdle = this.flows.dayFunding = 0;
      this.warned70 = false;
    }
    if (this.venue?.connected()) this.disconnectedAt = 0;
    else if (this.disconnectedAt && now - this.disconnectedAt > 60_000) {
      this.alert('warn', 'Trading connection to Perpl has been down for over a minute. Reconnecting.');
      this.deps.notify(`Monday: trading socket down over 60 s for ${this.wallet.slice(0, 8)}`);
      this.disconnectedAt = now; // re-arm
    }

    // Stop means stop: once stopped Monday checks nothing, and an open position is the user's (the UI says so).
    if (this.status === 'quoting') {
      const used = this.lossUsedPct();
      if (used >= 100) return void this.kill('loss_limit');
      if (used >= 70 && !this.warned70) {
        this.warned70 = true;
        this.alert('warn', `Today's loss has passed 70% of your ${usd(this.policy.maxDailyLossUsd)} limit. Monday is quoting more carefully.`);
        this.deps.notify(`Monday: daily loss above 70% of limit for ${this.wallet.slice(0, 8)}`);
        for (const sym of this.policy.markets) this.rt(sym).govAsap = true;
      }
      // Equity below the margin the policy's full inventory needs: stop before Perpl's maintenance margin, which
      // sits lower at any leverage Perpl allows. Skipped while the account balance is unknown (0).
      if ((this.venue?.account().balanceUsd ?? 0) > 0 && equity < marginFloorUsd(this.policy, this.policy.markets.length)) return void this.kill('margin');
      const s = this.session;
      if (s) {
        if (s.stopLossUsd != null && equity - s.startEquity - this.flows.sessionIn - this.unexplainedIn() <= -s.stopLossUsd) return void this.kill('session_loss');
        // Take profit counts what would be left after closing the position, not the paper gain.
        const pnl = this.sessionPnl();
        if (s.takeProfitUsd != null && pnl - this.exitCostUsd() >= s.takeProfitUsd) return void this.takeProfit(pnl);
      }
    }

    // Markouts after each maker fill: 1, 5 and 10 s (Tread's view of the book reacting) and 1 and 5 min (PRD 11.4 step 7).
    // Ticks are 1 s apart, so a "1 s" markout is read 1 to 2 s after the fill.
    for (const f of this.pendingMarkouts) {
      const snap = this.deps.driver.feed.snapshot(f.sym);
      const ref = snap?.mid ?? snap?.mark;
      if (!ref) continue;
      if (f.markout1sBps == null && now >= f.ts + 1_000) f.markout1sBps = markoutBps(f.side, f.price, ref);
      if (f.markout5sBps == null && now >= f.ts + 5_000) f.markout5sBps = markoutBps(f.side, f.price, ref);
      if (f.markout10sBps == null && now >= f.ts + 10_000) f.markout10sBps = markoutBps(f.side, f.price, ref);
      if (f.markout1mBps == null && now >= f.ts + 60_000) f.markout1mBps = markoutBps(f.side, f.price, ref);
      if (f.markout5mBps == null && now >= f.ts + 300_000) {
        f.markout5mBps = markoutBps(f.side, f.price, ref);
        db.prepare('update fills set markout_1s = ?, markout_5s = ?, markout_10s = ?, markout_1m = ?, markout_5m = ? where id = ?')
          .run(f.markout1sBps, f.markout5sBps, f.markout10sBps, f.markout1mBps, f.markout5mBps, f.id);
      }
    }
    this.pendingMarkouts = this.pendingMarkouts.filter((f) => f.markout5mBps == null);

    const last = this.equity[this.equity.length - 1];
    if (!last || now - last.t >= 10_000) {
      this.equity.push({ t: now, v: equity });
      if (this.equity.length > 8_640) this.equity.shift();
    }
    if (now - this.lastPnlWrite >= 60_000) {
      this.lastPnlWrite = now;
      this.snapshot(now, equity);
    }
  }

  private snapshot(now: number, equity: number) {
    db.prepare('insert or replace into pnl_snapshots (user_id, ts, equity, realized, unrealized, fees, balance) values (?,?,?,?,?,?,?)')
      .run(this.userId, now, equity, this.realized, this.unrealized(), this.fees, this.venue?.account().balanceUsd ?? null);
  }

  // ---- what happened when nothing filled ----
  /** Fold this tick into the market's minute record; write the record when the minute turns. */
  private record(rt: MarketRt, snap: MarketSnapshot, now: number) {
    const k = Math.floor(now / 60_000);
    if (rt.min && rt.min.k !== k) this.flushMinute(rt, rt.min);
    const mid = snap.mid ?? snap.mark;
    const a = (rt.min ??= { k, o: mid, h: mid, l: mid, c: mid, hl: null, spread: 0, spreadN: 0, bid: 0, bidN: 0, ask: 0, askN: 0, both: 0, ticks: 0, why: new Map() });
    a.h = Math.max(a.h, mid);
    a.l = Math.min(a.l, mid);
    a.c = mid;
    a.hl = hlMid(rt.sym) ?? a.hl;
    if (snap.bestBid && snap.bestAsk) {
      a.spread += ((snap.bestAsk - snap.bestBid) / mid) * 1e4;
      a.spreadN++;
    }
    const bq = this.venue?.quote(rt.sym, 'bid'), aq = this.venue?.quote(rt.sym, 'ask');
    if (bq) {
      a.bid += ((mid - bq.price) / mid) * 1e4;
      a.bidN++;
    }
    if (aq) {
      a.ask += ((aq.price - mid) / mid) * 1e4;
      a.askN++;
    }
    if (bq && aq) a.both++;
    a.ticks++;
    if (rt.why) a.why.set(rt.why, (a.why.get(rt.why) ?? 0) + 1);
  }
  private flushMinute(rt: MarketRt, a: MinuteAgg) {
    rt.min = null;
    rt.bothHist.push(a.both / Math.max(1, a.ticks));
    if (rt.bothHist.length > 60) rt.bothHist.shift();
    const tape = tapeOf(this.deps.driver.feed).minutes.get(`${rt.sym}:${a.k}`);
    const why = [...a.why].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const snap = this.deps.driver.feed.snapshot(rt.sym);
    insMinute.run(
      this.userId, rt.sym, a.k, a.o, a.h, a.l, a.c, tape?.hi ?? null, tape?.lo ?? null, tape?.usd ?? null, a.hl, a.spreadN ? a.spread / a.spreadN : null,
      a.bidN ? a.bid / a.bidN : null, a.askN ? a.ask / a.askN : null, a.bidN, a.askN, a.both, a.ticks,
      (this.venue?.position(rt.sym).size ?? 0) * (snap?.mark ?? 0), rt.params.regime, rt.stage, why,
    );
  }
  private quotedPct(rt: MarketRt): number | null {
    return rt.bothHist.length ? (rt.bothHist.reduce((s, x) => s + x, 0) / rt.bothHist.length) * 100 : null;
  }

  /** One plain sentence on what is keeping this market from trading, or what Monday is waiting for. */
  private whyIdle(rt: MarketRt, snap: MarketSnapshot, posUsd: number): string {
    const v = this.venue!;
    const mid = snap.mid ?? snap.mark;
    const bq = v.quote(rt.sym, 'bid'), aq = v.quote(rt.sym, 'ask');
    const word = { bid: 'Buying', ask: 'Selling' } as const;
    const sideWhy = (side: Side): string | null => {
      const b = rt.block[side];
      if (b?.startsWith('risk:')) return `${word[side]} is blocked because ${GATE_TEXT[b.slice(5) as GateReason]}.`;
      if (b === 'exit') return `Adding to the ${posUsd > 0 ? 'long' : 'short'} is stopped; Monday is working its ${usd(Math.abs(posUsd))} exit${rt.stage === 'urgent' ? ' at the best price' : ''}.`;
      if (b === 'not in policy') return `${rt.sym} is no longer in your policy; Monday only closes what it holds there.`;
      if (b === 'reflex' && rt.reflex) return `${cap(side)} pulled: ${rt.reflex.ref ? `Hyperliquid just moved ${side === 'ask' ? 'up' : 'down'} and Perpl has not caught up` : rt.reflex.book ? `Perpl's book is lopsided toward ${side === 'ask' ? 'buyers' : 'sellers'}` : `smart money is ${side === 'ask' ? 'buying' : 'selling'}`}.`;
      if (b === 'governor') return `The governor turned quoting off: ${rt.params.reason}`;
      if (b === 'size') return `The ${side} rounds to zero size (quote size, volume cap or inventory skew).`;
      if (rt.held[side] === 'budget') return `Waiting for request budget to move the ${side}.`;
      if (rt.held[side] === 'confirm' || rt.inflight[side]) return `Waiting for Perpl to confirm the ${side}.`;
      return null;
    };
    if (bq && aq) {
      const gap = rt.gapAlarm ? ' Perpl and Hyperliquid disagree more than usual, so quotes are wider and smaller.' : '';
      // At the front of the book the question is how much is queued ahead; behind it, how far away it sits.
      const where = (side: Side, q: QuoteTarget): string => {
        const best = side === 'bid' ? snap.bestBid : snap.bestAsk;
        const front = best != null && (side === 'bid' ? q.price >= best : q.price <= best);
        const ahead = this.aheadUsd(snap, side, q);
        if (front) return `${side} at the best price${ahead >= 1 ? `, ${usd(ahead, 0)} queued ahead of it` : ', first in line'}`;
        return `${side} ${(Math.abs(q.price - mid) / mid * 1e4).toFixed(1)} bps ${side === 'bid' ? 'below' : 'above'} mid`;
      };
      return `Quoting both sides: ${where('bid', bq)}; ${where('ask', aq)}. Waiting for a taker.${gap}`;
    }
    const reasons = [...new Set([sideWhy('bid'), sideWhy('ask')].filter(Boolean))];
    return reasons.join(' ') || 'Placing quotes.';
  }

  // ---- decisions and alerts ----
  private logDecision(market: MarketSym, source: DecisionSource, regime: Decision['regime'], params: Record<string, unknown>, reason: string, evidence: Record<string, unknown>, llmModel: string | null, llmMs: number | null = null, llmCost: number | null = null) {
    const at = Date.now();
    const paramsHash = hashOf(params);
    const evidenceHash = hashOf(evidence);
    const r = insDecision.run(this.userId, at, market, source, regime, JSON.stringify(params), JSON.stringify(evidence), paramsHash, evidenceHash, reason, llmModel, llmMs, llmCost);
    const d: Decision = { id: Number(r.lastInsertRowid), at, market, source, regime, params, reason, paramsHash, evidenceHash, llmModel, txHash: null, onchainId: null, anchor: chainEnabled ? 'pending' : 'off' };
    if (this.m[market]) this.m[market].lastDecisionId = d.id;
    this.decisions.unshift(d);
    if (this.decisions.length > 60) this.decisions.pop();
    if (!chainEnabled) return;
    if (source === 'kill') enqueue({ kind: 'kill', user: this.wallet as Hex, reason: KILL_CODE[params.reason as KillReason], evidenceHash }, d.id);
    else enqueue({ kind: 'decision', user: this.wallet as Hex, market: this.spec(market)?.marketId ?? 0, paramsHash, evidenceHash, regime: REGIME_CODE[regime] ?? 0, uri: `${config.apiPublicUrl}/api/decisions/${d.id}` }, d.id);
  }

  private alert(severity: Alert['severity'], message: string) {
    this.alerts.unshift({ id: `${Date.now()}-${this.alerts.length}`, at: Date.now(), severity, message });
    if (this.alerts.length > 20) this.alerts.pop();
  }

  // ---- what the dashboard sees ----
  /** The Hyperliquid mid the engine would blend in, for display. */
  private hlShown(sym: MarketSym, mark: number): number | null {
    const h = hlMid(sym);
    return h != null && Math.abs(h / mark - 1) * 1e4 <= this.cfg(sym).blendMaxBps ? h : null;
  }

  /** LLM spend over 24 h from the decision log, refreshed once a minute. Null when calls ran but none reported a cost. */
  private costs(now: number): DashboardState['costs'] {
    if (now - this.costCache.at > 60_000) {
      const r = db.prepare('select count(*) n, count(llm_cost) costed, sum(llm_cost) usd from decisions where user_id = ? and at >= ? and llm_model is not null').get(this.userId, now - 86_400_000) as { n: number; costed: number; usd: number | null };
      // A total over only some of the calls would read as the whole cost: show it only when every call reported one.
      this.costCache = { at: now, usd: r.n && r.costed === r.n ? r.usd : null, calls: r.n };
    }
    return { llmUsd24h: this.costCache.usd, llmCalls24h: this.costCache.calls, nansenUsd: null, hostingUsd: null, gasUsd: null };
  }

  state(): DashboardState {
    const now = Date.now();
    const feed = this.deps.driver.feed;
    const markets: DashboardState['markets'] = {};
    let worstAge = 0;
    // Every market the feed carries, so the terminal can show one before the policy trades it; inPolicy tells them apart.
    for (const sym of MARKETS) {
      const snap = feed.snapshot(sym);
      const spec = this.spec(sym);
      if (!snap || !spec) continue;
      const rt = this.rt(sym);
      const pos = this.venue?.position(sym) ?? { size: 0, entryPrice: 0 };
      const age = now - snap.updatedAt;
      worstAge = Math.max(worstAge, age);
      const quoting = this.status === 'quoting';
      const ageOf = (side: Side) => (this.venue?.quote(sym, side) && rt.ackedAt[side] ? now - rt.ackedAt[side] : null);
      const aheadOf = (side: Side) => {
        const q = this.venue?.quote(sym, side);
        return q ? this.aheadUsd(snap, side, q) : null;
      };
      const day = this.day(sym, now);
      const hour = this.fills.filter((f) => f.sym === sym && f.isMaker && f.ts > now - 3_600_000);
      const marks = hour.filter((f) => f.markout1mBps != null).map((f) => f.markout1mBps!);
      markets[sym] = {
        sym, spec, mark: snap.mark, oracle: snap.oracle, mid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk,
        bids: snap.bids.slice(0, 12), asks: snap.asks.slice(0, 12), fundingRate: snap.fundingRate, dataAgeMs: age, sigma1mBps: varToBps(rt.var1m),
        quotes: { bid: this.venue?.quote(sym, 'bid') ?? null, ask: this.venue?.quote(sym, 'ask') ?? null },
        model: quoting && rt.model ? { ref: rt.model.ref, center: rt.model.center, halfBps: rt.model.halfBps, skewInvBps: rt.model.skewInvBps, skewNanBps: rt.model.skewNanBps, skewBookBps: rt.model.skewBookBps, skewTrendBps: rt.model.skewTrendBps, q: rt.model.q, blendBps: rt.model.blendBps, sizeCapUsd: rt.model.sizeCapUsd } : null, book: rt.book,
        trend5mBps: this.trendBps(rt, now, snap.mark),
        hlMid: this.hlShown(sym, snap.mark),
        position: { size: pos.size, entryPrice: pos.entryPrice, notionalUsd: pos.size * snap.mark, unrealizedUsd: pos.size ? pos.size * (snap.mark - pos.entryPrice) : 0 },
        params: rt.params, paramsSource: rt.paramsSource, reflex: quoting && rt.reflex && rt.reflex.until > now ? rt.reflex : null,
        signal: this.deps.collector.kind === 'none' ? null : this.deps.collector.signal(sym), trades: this.deps.collector.latestTrades(sym, 14), priceSeries: rt.series,
        inPolicy: this.policy.markets.includes(sym), stage: rt.stage, why: rt.why, quotedPct: this.quotedPct(rt), quoteAgeMs: { bid: ageOf('bid'), ask: ageOf('ask') },
        basisBps: rt.basis.n ? rt.basis.bps : null,
        aheadUsd: { bid: aheadOf('bid'), ask: aheadOf('ask') }, tape: tapeOf(feed).prints.get(sym) ?? [],
        day: { volumeUsd: day.hourlyUsd == null ? null : day.hourlyUsd * 24, changePct: day.open ? (snap.mark / day.open - 1) * 100 : null, high: day.high, low: day.low },
        openInterestUsd: snap.openInterest * snap.mark, fills1h: hour.length, markout1mBps: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null,
      };
    }
    const acct = this.venue?.account();
    const step = Math.max(1, Math.ceil(this.equity.length / 300));
    const decisions = this.decisions.slice(0, 40).map((d) => {
      const a = anchorOf(d.id);
      return a ? { ...d, anchor: a.status, txHash: a.tx ?? d.txHash, onchainId: a.onchainId ?? d.onchainId } : d;
    });
    // Full snapshot every second per subscriber. Send diffs if bandwidth ever matters.
    return {
      at: now, sim: this.deps.driver.kind === 'sim', paper: this.deps.driver.kind === 'paper', status: this.status, killReason: this.killReason,
      closing: this.status !== 'quoting' ? this.owed : null, startedAt: this.startedAt, policy: this.policy, // owed is set for the whole of a cleanup
      account: { id: this.accountId, balanceUsd: acct?.balanceUsd ?? 0, equityUsd: this.equityNow() },
      pnl: {
        todayUsd: this.pnlToday(), realizedUsd: this.realized, unrealizedUsd: this.unrealized(), feesUsd: this.fees, lossLimitUsedPct: this.lossUsedPct(),
        depositsUsd: this.flows.dayIn + this.flows.dayOut, fundingUsd: this.flows.dayFunding,
      },
      session: this.session && { startedAt: this.session.startedAt, pnlUsd: this.sessionPnl(), stopLossUsd: this.session.stopLossUsd, takeProfitUsd: this.session.takeProfitUsd },
      health: {
        marketDataAgeMs: worstAge, signalAgeMs: Number.isFinite(this.deps.collector.ageMs) ? this.deps.collector.ageMs : -1, budgetRemaining: Math.floor(this.tokens),
        budgetPerMin: this.budget, venueConnected: this.venue?.connected() ?? false, llm: llmEnabled, llmFailing: llmEnabled && llmFailures >= 3, chain: chainEnabled && agentAddress !== null,
        hlAgeMs: this.deps.driver.kind === 'sim' ? -1 : hlAgeMs(),
        latencyMs: { send: this.latency.send.length ? median(this.latency.send) : null, venue: this.latency.venue.length ? median(this.latency.venue) : null },
      },
      costs: this.costs(now),
      markets, equity: this.equity.filter((_, i) => i % step === 0 || i === this.equity.length - 1), fills: this.fills.slice(0, 40), decisions, alerts: this.alerts,
    };
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** Whole dollars when whole, otherwise cents: session limits and take-profit amounts are often small. */
const cents = (n: number) => usd(n, Number.isInteger(n) ? 0 : 2);
