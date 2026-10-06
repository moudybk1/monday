// One runner per user account (PRD 9.2, 9.3): engine tick, reflex, governor
// scheduling, risk monitor and order sync. The venue is the only thing that
// sends orders, and only this file tells the venue what to do.

import {
  DEFAULT_CONFIG, KILL_CODE, REGIME_CODE, bookImbalance, bookTrigger, computeQuotes, ewmaVar, marginFloorUsd, markoutBps, median, nextReflex, preTradeReject, reflexTrigger,
  shouldRequote, tradeSign, usd, usdCompact, varToBps,
  type AgentStatus, type Alert, type BookLevel, type DashboardState, type Decision, type DecisionSource, type Fill, type GovernorParams,
  type KillReason, type MarketSignal, type MarketSpec, type MarketState, type MarketSym, type Policy, type QuoteOutput,
  type QuoteTarget, type ReflexState, type Side, type StrategyConfig,
} from '@monday/core';
import type { Hex } from 'viem';
import { agentAddress, chainEnabled, enqueue } from './chain';
import type { Collector } from './collector';
import { config } from './config';
import { db, event } from './db';
import { decide, fallbackDecision, hashOf, llmEnabled, llmFailures, type GovernorContext } from './governor';
import { hlMid } from './hyperliquid';
import { VenueError, type MarketSnapshot, type Venue, type VenueCredentials, type VenueDriver, type VenueFill } from './venue/types';

const MIN_REQUOTE_MS = 1_500;
const RESERVED_TOKENS = 8; // PRD 11.7: cancels, kill, keep-alive and headroom
const STALE_CANCEL_MS = 5_000;
const STALE_KILL_MS = 30_000;

export interface RunnerDeps {
  driver: VenueDriver;
  collector: Collector;
  creds: () => VenueCredentials;
  /** Nansen skew per unit of S for this market; 0 until the event study supports leaning. */
  k: (sym: MarketSym) => number;
  notify: (text: string) => void;
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
  nextGovAt: number;
  lastGovAt: number;
  govBusy: boolean;
  govAsap: boolean;
  wasStorm: boolean;
  reflex: ReflexState | null;
  lastBigTs: number;
  lastSent: Record<Side, number>;
  inflight: Record<Side, boolean>;
  model: QuoteOutput | null;
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

/** Since the last Start. Tread runs every bot with its own stop loss and take profit; Monday adds them per session. */
export interface SessionLimits {
  stopLossUsd: number | null;
  takeProfitUsd: number | null;
}

// Average hourly traded volume over 24 h per market, shared by every runner and refreshed every 10 minutes.
// Null until known, and always on the simulator, whose candles carry no volume.
const volume = new Map<MarketSym, { at: number; hourlyUsd: number | null }>();

const insDecision = db.prepare(
  'insert into decisions (user_id, at, market, source, regime, params, evidence, params_hash, evidence_hash, reason, llm_model) values (?,?,?,?,?,?,?,?,?,?,?)',
);
const insFill = db.prepare('insert or ignore into fills (id, user_id, sym, side, price, size, fee, is_maker, ts, regime, realized, half_bps) values (?,?,?,?,?,?,?,?,?,?,?,?)');

export class Runner {
  status: AgentStatus = 'idle';
  killReason: KillReason | null = null;
  startedAt: number | null = null;
  lastSeenAt = Date.now();
  private venue: Venue | null = null;
  private m = {} as Record<MarketSym, MarketRt>;
  private budget = config.budgetPerMin;
  private budgetRestoreAt = 0;
  private tokens = config.budgetPerMin;
  private lastRefill = Date.now();
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

  constructor(readonly userId: number, readonly wallet: string, private accountId: number, public policy: Policy, private deps: RunnerDeps) {
    // Restore what the dashboard shows after a process restart.
    const dayStart = new Date().setUTCHours(0, 0, 0, 0);
    const d = db.prepare('select * from decisions where user_id = ? order by id desc limit 60').all(userId) as Record<string, never>[];
    this.decisions = d.map((r) => ({
      id: r.id, at: r.at, market: r.market, source: r.source, regime: r.regime, params: JSON.parse(r.params), reason: r.reason ?? '',
      paramsHash: r.params_hash, evidenceHash: r.evidence_hash, llmModel: r.llm_model, txHash: r.tx_hash, onchainId: r.onchain_id,
    }));
    const f = db.prepare('select * from fills where user_id = ? and ts >= ? order by ts desc').all(userId, dayStart) as Record<string, never>[];
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
    }
    const a = db.prepare('select started_at, session_sl, session_tp, session_equity from agents where user_id = ?').get(userId) as Record<string, number | null> | undefined;
    if (a?.session_equity != null) this.session = { startedAt: a.started_at ?? Date.now(), startEquity: a.session_equity, stopLossUsd: a.session_sl, takeProfitUsd: a.session_tp };
  }

  // ---- lifecycle ----
  /** `limits` opens a new session; without it (boot resume) the persisted session carries on. */
  async start(limits?: SessionLimits) {
    if (this.status === 'quoting') return;
    if (!this.venue) {
      const v = this.deps.driver.open(this.deps.creds());
      await v.connect(); // throws VenueError: the API surfaces the exact reason
      v.on('fill', (f) => this.onFill(f));
      v.on('error', (e) => this.onVenueError(e));
      this.venue = v;
    }
    this.killReason = null;
    this.failures = 0;
    this.status = 'quoting';
    this.startedAt = Date.now();
    if (limits || !this.session) this.session = { stopLossUsd: null, takeProfitUsd: null, ...limits, startedAt: this.startedAt, startEquity: this.equityNow() };
    for (const sym of this.policy.markets) this.rt(sym).govAsap = true;
    this.persist();
    this.alert('info', 'Monday started quoting.');
    event(this.userId, 'connect', { markets: this.policy.markets });
  }

  async pause() {
    if (this.status !== 'quoting') return;
    this.status = 'paused';
    this.persist();
    await this.venue?.cancelAll().catch((e) => this.onVenueError(e));
    this.alert('info', 'Paused. All orders cancelled, positions kept.');
  }

  async kill(reason: KillReason) {
    if (this.status === 'killed') return;
    this.status = 'killed';
    this.killReason = reason;
    this.persist();
    const evidence = { at: Date.now(), reason, equityUsd: this.equityNow(), pnlTodayUsd: this.pnlToday(), positions: this.policy.markets.map((s) => ({ market: s, size: this.venue?.position(s).size ?? 0 })) };
    try {
      await this.venue?.cancelAll();
      await this.venue?.flatten();
    } catch (e) {
      this.alert('critical', `Could not flatten automatically: ${e instanceof Error ? e.message : e}. Close the position on Perpl.`);
    }
    const done = 'All orders were cancelled and positions closed.';
    const text = reason === 'loss_limit' ? `Daily loss limit of ${usd(this.policy.maxDailyLossUsd)} reached. ${done}`
      : reason === 'session_loss' && this.session?.stopLossUsd != null ? `Session stop loss of ${cents(this.session.stopLossUsd)} reached. ${done}`
      : reason === 'margin' ? `Equity fell below the ${usd(marginFloorUsd(this.policy, this.policy.markets.length))} of margin this policy needs at ${this.policy.maxLeverage}x. ${done} Lower the limits or deposit more.`
      : KILL_TEXT[reason];
    this.session = null;
    this.persist();
    this.logDecision(this.policy.markets[0] ?? 'BTC', 'kill', 'killed', { reason }, text, evidence, null);
    this.alert('critical', text);
    this.deps.notify(`Monday kill switch (${reason}) for ${this.wallet.slice(0, 8)}: ${text}`);
    event(this.userId, 'kill', { reason });
  }

  /** Session take profit: cancel, close the position and stop. Not a kill, nothing went wrong. */
  private async takeProfit(pnlUsd: number) {
    this.status = 'paused';
    this.session = null;
    this.persist();
    try {
      await this.venue?.cancelAll();
      await this.venue?.flatten();
    } catch (e) {
      this.alert('critical', `Take profit reached but the position could not be closed: ${e instanceof Error ? e.message : e}. Close it on Perpl.`);
    }
    this.alert('info', `Take profit reached: ${cents(pnlUsd)} this session. Orders cancelled and positions closed.`);
    this.deps.notify(`Monday take profit (${cents(pnlUsd)}) for ${this.wallet.slice(0, 8)}`);
    event(this.userId, 'take_profit', { pnlUsd });
  }

  setPolicy(p: Policy) {
    const removed = this.policy.markets.filter((s) => !p.markets.includes(s));
    this.policy = p;
    for (const sym of removed) for (const side of ['bid', 'ask'] as const) void this.venue?.setQuote(sym, side, null, p.maxLeverage).catch(() => {});
    for (const sym of p.markets) this.rt(sym).govAsap = true; // new limits apply at the next tick (FR-POL-4)
  }

  /** Process is stopping: pull resting orders off the book, but leave the persisted status so boot resumes. */
  async shutdown() {
    await this.venue?.cancelAll().catch(() => {});
    this.dispose();
  }

  dispose() {
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
    db.prepare('insert into agents (user_id, status, kill_reason, started_at, session_sl, session_tp, session_equity) values (?,?,?,?,?,?,?) on conflict(user_id) do update set status = excluded.status, kill_reason = excluded.kill_reason, started_at = excluded.started_at, session_sl = excluded.session_sl, session_tp = excluded.session_tp, session_equity = excluded.session_equity')
      .run(this.userId, this.status, this.killReason, this.startedAt, s?.stopLossUsd ?? null, s?.takeProfitUsd ?? null, s?.startEquity ?? null);
  }

  // ---- per-market runtime ----
  private rt(sym: MarketSym): MarketRt {
    return (this.m[sym] ??= {
      sym, var1m: 0, lastClose: 0, lastMinute: 0, sigmaHist: [], book: 0,
      params: { market: sym, enabled: true, spread_mult: 2, skew_bias_bps: 0, size_mult: 0.5, max_inventory_usd: this.policy.maxInventoryUsd, ttl_min: 15, regime: 'stale', reason: 'Waiting for the first governor decision.' },
      paramsSource: 'fallback', nextGovAt: 0, lastGovAt: 0, govBusy: false, govAsap: false, wasStorm: false, reflex: null, lastBigTs: Date.now(),
      lastSent: { bid: 0, ask: 0 }, inflight: { bid: false, ask: false }, model: null, series: [], bandAlertAt: 0,
    });
  }
  private cfg(sym: MarketSym): StrategyConfig {
    return { ...DEFAULT_CONFIG, k: this.deps.k(sym) };
  }
  private spec(sym: MarketSym): MarketSpec {
    return this.deps.driver.feed.specs()[sym]!;
  }
  private hourlyVolume(sym: MarketSym, now: number): number | null {
    const hit = volume.get(sym);
    if (!hit || now - hit.at > 10 * 60_000) {
      volume.set(sym, { at: now, hourlyUsd: hit?.hourlyUsd ?? null }); // one fetch in flight
      void this.deps.driver.feed.candles(sym, now - 86_400_000, now).then((cs) => {
        const usd = cs.reduce((s, c) => s + (c.v ?? 0), 0);
        volume.set(sym, { at: now, hourlyUsd: usd > 0 ? usd / 24 : null });
      }).catch(() => {});
    }
    return volume.get(sym)!.hourlyUsd;
  }

  // ---- the tick (PRD 9.3) ----
  tick() {
    const now = Date.now();
    this.refill(now);
    const feed = this.deps.driver.feed;

    for (const sym of this.policy.markets) {
      const snap = feed.snapshot(sym);
      if (!snap || !this.spec(sym)) continue;
      const rt = this.rt(sym);
      this.updateVol(rt, snap, now);
      // EWMA with a 5-tick half-life (ticks are 1 s), so one flickering level cannot fire the reflex.
      rt.book += (this.bookNow(sym, snap) - rt.book) * 0.13;
      if (!rt.series.length || now - rt.series[rt.series.length - 1].t >= 5_000) {
        rt.series.push({ t: now, p: snap.mark, bid: this.venue?.quote(sym, 'bid')?.price ?? null, ask: this.venue?.quote(sym, 'ask')?.price ?? null });
        if (rt.series.length > 240) rt.series.shift();
      }
      if (this.status !== 'quoting' || !this.venue) continue;

      // 1. Stale market data: cancel at 5 s, kill at 30 s. Fail closed.
      const age = now - snap.updatedAt;
      if (age > STALE_KILL_MS) return void this.kill('stale_data');
      if (age > STALE_CANCEL_MS) {
        this.sync(rt, 'bid', null, 1, now);
        this.sync(rt, 'ask', null, 1, now);
        continue;
      }
      // 2-4. Signal, reflex, governor parameters
      const sig = this.deps.collector.signal(sym);
      this.runReflex(rt, sig, snap, now);
      this.runGovernor(rt, snap, sig, now);

      const spec = this.spec(sym);
      const posUsd = this.venue.position(sym).size * snap.mark;
      const out = computeQuotes({
        mark: snap.mark, mid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk, sigma1mBps: varToBps(rt.var1m), positionUsd: posUsd, S: sig.S, book: rt.book, hlMid: hlMid(sym), hourlyVolumeUsd: this.hourlyVolume(sym, now),
        policy: this.policy, gov: rt.params, reflex: rt.reflex, spec, cfg: this.cfg(sym),
      });
      rt.model = out;

      // 5-6. Risk checks, then send only what changed.
      const equity = this.equityNow();
      for (const side of ['bid', 'ask'] as const) {
        let target: QuoteTarget | null = out[side];
        const reject = target && preTradeReject(target, side, snap.oracle, posUsd, equity, this.policy);
        if (reject) {
          target = null;
          if (reject === 'price_band' && now - rt.bandAlertAt > 60_000) {
            rt.bandAlertAt = now;
            this.alert('warn', `${sym} ${side} would sit more than 1% from the oracle price. Order blocked.`);
          }
        }
        this.sync(rt, side, target, out.halfBps, now);
      }
    }

    if (this.venue) this.riskAndBooks(now);
    if (this.listeners.size) {
      const s = this.state();
      for (const cb of this.listeners) cb(s);
    }
  }

  private refill(now: number) {
    if (this.budgetRestoreAt && now > this.budgetRestoreAt) {
      this.budget = config.budgetPerMin;
      this.budgetRestoreAt = 0;
    }
    this.tokens = Math.min(this.budget, this.tokens + ((now - this.lastRefill) / 60_000) * this.budget);
    this.lastRefill = now;
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

  private runReflex(rt: MarketRt, sig: MarketSignal, snap: MarketSnapshot, now: number) {
    const cfg = this.cfg(rt.sym);
    const sym = rt.sym;
    const big = this.deps.collector.recentTrades(sym, Math.max(rt.lastBigTs, now - 60_000)).filter((t) => t.valueUsd >= cfg.bigTradeUsd).sort((a, b) => b.valueUsd - a.valueUsd)[0];
    if (big) rt.lastBigTs = Math.max(rt.lastBigTs, big.ts) + 1;
    const z = sig.stale ? 0 : sig.w5.z;
    const flow = reflexTrigger(z, big ? tradeSign(big) : 0, cfg);
    // Smart-money flow wins; the book only acts when flow is quiet, and holds for less time.
    const onBook = bookTrigger(rt.book, cfg);
    const trig = flow ?? (onBook && { ...onBook, book: true });
    const holdCfg = flow ? cfg : { ...cfg, reflexHoldMs: cfg.bookHoldMs };
    const dir = trig?.side === 'ask' ? 1 : -1;
    const culprits = flow ? this.deps.collector.recentTrades(sym, now - 5 * 60_000).filter((t) => tradeSign(t) === dir).sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 12) : [];
    const { state, changed } = nextReflex(rt.reflex, trig, now, flow ? z : rt.book, culprits.map((t) => t.hash), holdCfg);
    const before = rt.reflex;
    rt.reflex = state;
    if (!changed) return;
    if (!state?.book) rt.govAsap = true; // book flicker is not worth an early governor run
    const holdMin = cfg.reflexHoldMs / 60_000;
    if (state?.book) {
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
      this.logDecision(sym, 'reflex', 'reflex', { [state.action]: state.side, hold_min: holdMin }, reason, { z5m: z, netUsd5m: sig.w5.netUsd, nansenTx: state.triggerHashes, at: now }, null);
    } else if (before) {
      this.logDecision(sym, 'reflex', 'reflex', { restore: before.side }, `${before.book ? 'The book has evened out' : 'Flow has cooled'}. The ${before.side} is back to normal.`, { z5m: z, netUsd5m: sig.w5.netUsd, bookImbalance: rt.book, at: now }, null);
    }
  }

  private context(rt: MarketRt, snap: MarketSnapshot, sig: MarketSignal): GovernorContext {
    const hourAgo = Date.now() - 3_600_000;
    const marks = this.fills.filter((f) => f.sym === rt.sym && f.ts > hourAgo && f.markout1mBps != null).map((f) => f.markout1mBps!);
    return {
      market: rt.sym, signal: sig,
      topTrades: this.deps.collector.recentTrades(rt.sym, hourAgo).sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 5),
      mark: snap.mark, sigma1mBps: varToBps(rt.var1m), sigmaMedianBps: median(rt.sigmaHist), fundingRate: snap.fundingRate,
      inventoryUsd: (this.venue?.position(rt.sym).size ?? 0) * snap.mark, pnlTodayUsd: this.pnlToday(), feesUsd: this.fees,
      avgMarkout1mBps: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null, lossLimitUsedPct: this.lossUsedPct(), policy: this.policy,
    };
  }

  private runGovernor(rt: MarketRt, snap: MarketSnapshot, sig: MarketSignal, now: number) {
    const storm = Math.abs(sig.S) >= DEFAULT_CONFIG.z2;
    if (storm && !rt.wasStorm) rt.govAsap = true; // |S| crossed z2: run early
    rt.wasStorm = storm;
    if (rt.govBusy) return;
    if (now < rt.nextGovAt && !(rt.govAsap && now - rt.lastGovAt > 60_000)) return;
    rt.govBusy = true;
    rt.govAsap = false;
    rt.lastGovAt = now;
    const ctx = this.context(rt, snap, sig);
    // Until the LLM answers, the rules already protect the account.
    if (rt.nextGovAt === 0) rt.params = fallbackDecision(ctx).params;
    rt.nextGovAt = now + config.governorIntervalMin * 60_000;
    const evidence = {
      at: now, signal: { S: sig.S, z5m: sig.w5.z, z15m: sig.w15.z, z60m: sig.w60.z, net5m: sig.w5.netUsd, net15m: sig.w15.netUsd, net60m: sig.w60.netUsd, stale: sig.stale },
      nansenTx: this.deps.collector.recentTrades(rt.sym, now - 15 * 60_000).map((t) => t.hash),
      market: { mark: snap.mark, oracle: snap.oracle, bestBid: snap.bestBid, bestAsk: snap.bestAsk, sigma1mBps: ctx.sigma1mBps, fundingRate: snap.fundingRate },
      inventoryUsd: ctx.inventoryUsd,
    };
    void decide(ctx)
      .then((res) => {
        if (this.status !== 'quoting') return;
        rt.params = res.params;
        rt.paramsSource = res.source;
        rt.nextGovAt = now + Math.min(config.governorIntervalMin, res.params.ttl_min) * 60_000;
        const { reason, ...params } = res.params;
        this.logDecision(rt.sym, res.source, res.params.regime, params, reason, evidence, res.llmModel);
        if (llmEnabled && llmFailures === 3) this.alert('warn', 'The LLM governor failed three times in a row. Rule-based regimes are in control.');
      })
      .finally(() => (rt.govBusy = false));
  }

  /** Diff one side against the venue and send at most one request (PRD 10.2 step 10). */
  private sync(rt: MarketRt, side: Side, target: QuoteTarget | null, halfBps: number, now: number) {
    if (rt.inflight[side] || !this.venue) return;
    const live = this.venue.quote(rt.sym, side);
    if (!shouldRequote(live, target, halfBps, this.spec(rt.sym).priceTick)) return;
    const cancel = target === null;
    if (!cancel && now - rt.lastSent[side] < MIN_REQUOTE_MS) return;
    // Cancels may dip into the reserve; ordinary requotes wait for budget.
    if (this.tokens - 1 < (cancel ? 0 : RESERVED_TOKENS)) return;
    this.tokens -= 1;
    rt.inflight[side] = true;
    rt.lastSent[side] = now;
    this.venue.setQuote(rt.sym, side, target, this.policy.maxLeverage)
      .then(() => (this.failures = 0))
      .catch((e) => this.onOrderError(e))
      .finally(() => (rt.inflight[side] = false));
  }

  private onOrderError(e: unknown) {
    const code = e instanceof VenueError ? e.code : 'rejected';
    if (code === 'crosses_book') return; // next tick requotes behind the fresh best price
    if (code === 'revoked' || code === 'bad_signature' || code === 'read_only_key' || code === 'rate_limited' || code === 'fatal' || code === 'disconnected') return this.onVenueError(e as VenueError);
    if (++this.failures >= 3) void this.kill('order_failures');
  }

  private onVenueError(e: unknown) {
    const code = e instanceof VenueError ? e.code : 'fatal';
    event(this.userId, 'error', { code, message: e instanceof Error ? e.message : String(e) });
    if (code === 'revoked' || code === 'bad_signature' || code === 'read_only_key') {
      db.prepare("update perpl_credentials set status = 'revoked' where user_id = ?").run(this.userId);
      this.alert('critical', 'Key revoked, agent stopped. Add a new key to continue.');
      void this.kill('key_error');
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
      void this.kill('order_failures');
    }
  }

  private onFill(f: VenueFill) {
    const regime = this.m[f.sym]?.params.regime ?? 'calm';
    const fill: Fill = {
      id: f.id, sym: f.sym, side: f.side, price: f.price, size: f.size, feeUsd: f.feeUsd, isMaker: f.isMaker, ts: f.ts, regime,
      markout1sBps: null, markout5sBps: null, markout10sBps: null, markout1mBps: null, markout5mBps: null,
    };
    this.fills.unshift(fill);
    if (this.fills.length > 80) this.fills.pop();
    this.realized += f.realizedUsd;
    this.fees += f.feeUsd;
    insFill.run(f.id, this.userId, f.sym, f.side, f.price, f.size, f.feeUsd, f.isMaker ? 1 : 0, f.ts, regime, f.realizedUsd, this.m[f.sym]?.model?.halfBps ?? null);
    if (f.isMaker) this.pendingMarkouts.push(fill);
  }

  // ---- PnL, loss limit, markouts, snapshots ----
  private unrealized(): number {
    let u = 0;
    for (const sym of this.policy.markets) {
      const p = this.venue?.position(sym);
      const snap = this.deps.driver.feed.snapshot(sym);
      if (p && snap && p.size !== 0) u += p.size * (snap.mark - p.entryPrice);
    }
    return u;
  }
  private equityNow(): number {
    return (this.venue?.account().balanceUsd ?? 0) + this.unrealized();
  }
  private pnlToday(): number {
    return this.dayKey ? this.equityNow() - this.dayStartEquity : 0;
  }
  private lossUsedPct(): number {
    return (Math.max(0, -this.pnlToday()) / this.policy.maxDailyLossUsd) * 100;
  }

  private riskAndBooks(now: number) {
    const equity = this.equityNow();
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dayStartEquity = equity;
      this.realized = this.fees = 0;
      this.warned70 = false;
    }
    if (this.venue?.connected()) this.disconnectedAt = 0;
    else if (this.disconnectedAt && now - this.disconnectedAt > 60_000) {
      this.alert('warn', 'Trading connection to Perpl has been down for over a minute. Reconnecting.');
      this.deps.notify(`Monday: trading socket down over 60 s for ${this.wallet.slice(0, 8)}`);
      this.disconnectedAt = now; // re-arm
    }

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
        const pnl = equity - s.startEquity;
        if (s.stopLossUsd != null && pnl <= -s.stopLossUsd) return void this.kill('session_loss');
        if (s.takeProfitUsd != null && pnl >= s.takeProfitUsd) return void this.takeProfit(pnl);
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
      db.prepare('insert or replace into pnl_snapshots (user_id, ts, equity, realized, unrealized, fees) values (?,?,?,?,?,?)').run(this.userId, now, equity, this.realized, this.unrealized(), this.fees);
    }
  }

  // ---- decisions and alerts ----
  private logDecision(market: MarketSym, source: DecisionSource, regime: Decision['regime'], params: Record<string, unknown>, reason: string, evidence: Record<string, unknown>, llmModel: string | null) {
    const at = Date.now();
    const paramsHash = hashOf(params);
    const evidenceHash = hashOf(evidence);
    const r = insDecision.run(this.userId, at, market, source, regime, JSON.stringify(params), JSON.stringify(evidence), paramsHash, evidenceHash, reason, llmModel);
    const d: Decision = { id: Number(r.lastInsertRowid), at, market, source, regime, params, reason, paramsHash, evidenceHash, llmModel, txHash: null, onchainId: null };
    this.decisions.unshift(d);
    if (this.decisions.length > 60) this.decisions.pop();
    if (!chainEnabled) return;
    const done = (tx: string, onchainId: number | null) => {
      d.txHash = tx;
      d.onchainId = onchainId;
      db.prepare('update decisions set tx_hash = ?, onchain_id = ? where id = ?').run(tx, onchainId, d.id);
    };
    if (source === 'kill') enqueue({ kind: 'kill', user: this.wallet as Hex, reason: KILL_CODE[params.reason as KillReason], evidenceHash, done });
    else enqueue({ kind: 'decision', user: this.wallet as Hex, market: this.spec(market)?.marketId ?? 0, paramsHash, evidenceHash, regime: REGIME_CODE[regime] ?? 0, uri: `${config.apiPublicUrl}/api/decisions/${d.id}`, done });
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

  state(): DashboardState {
    const now = Date.now();
    const feed = this.deps.driver.feed;
    const markets: DashboardState['markets'] = {};
    let worstAge = 0;
    for (const sym of this.policy.markets) {
      const snap = feed.snapshot(sym);
      const spec = this.spec(sym);
      if (!snap || !spec) continue;
      const rt = this.rt(sym);
      const pos = this.venue?.position(sym) ?? { size: 0, entryPrice: 0 };
      const age = now - snap.updatedAt;
      worstAge = Math.max(worstAge, age);
      const quoting = this.status === 'quoting';
      markets[sym] = {
        sym, spec, mark: snap.mark, oracle: snap.oracle, mid: snap.mid, bestBid: snap.bestBid, bestAsk: snap.bestAsk,
        bids: snap.bids.slice(0, 12), asks: snap.asks.slice(0, 12), fundingRate: snap.fundingRate, dataAgeMs: age, sigma1mBps: varToBps(rt.var1m),
        quotes: { bid: this.venue?.quote(sym, 'bid') ?? null, ask: this.venue?.quote(sym, 'ask') ?? null },
        model: quoting && rt.model ? { ref: rt.model.ref, center: rt.model.center, halfBps: rt.model.halfBps, skewInvBps: rt.model.skewInvBps, skewNanBps: rt.model.skewNanBps, skewBookBps: rt.model.skewBookBps, q: rt.model.q, blendBps: rt.model.blendBps, sizeCapUsd: rt.model.sizeCapUsd } : null, book: rt.book,
        hlMid: this.hlShown(sym, snap.mark),
        position: { size: pos.size, entryPrice: pos.entryPrice, notionalUsd: pos.size * snap.mark, unrealizedUsd: pos.size ? pos.size * (snap.mark - pos.entryPrice) : 0 },
        params: rt.params, paramsSource: rt.paramsSource, reflex: quoting && rt.reflex && rt.reflex.until > now ? rt.reflex : null,
        signal: this.deps.collector.kind === 'none' ? null : this.deps.collector.signal(sym), trades: this.deps.collector.latestTrades(sym, 14), priceSeries: rt.series,
      };
    }
    const acct = this.venue?.account();
    const step = Math.max(1, Math.ceil(this.equity.length / 300));
    // Full snapshot every second per subscriber. Send diffs if bandwidth ever matters.
    return {
      at: now, sim: this.deps.driver.kind === 'sim', paper: this.deps.driver.kind === 'paper', status: this.status, killReason: this.killReason, startedAt: this.startedAt, policy: this.policy,
      account: { id: this.accountId, balanceUsd: acct?.balanceUsd ?? 0, equityUsd: this.equityNow() },
      pnl: { todayUsd: this.pnlToday(), realizedUsd: this.realized, unrealizedUsd: this.unrealized(), feesUsd: this.fees, lossLimitUsedPct: this.lossUsedPct() },
      session: this.session && { startedAt: this.session.startedAt, pnlUsd: this.equityNow() - this.session.startEquity, stopLossUsd: this.session.stopLossUsd, takeProfitUsd: this.session.takeProfitUsd },
      health: {
        marketDataAgeMs: worstAge, signalAgeMs: Number.isFinite(this.deps.collector.ageMs) ? this.deps.collector.ageMs : -1, budgetRemaining: Math.floor(this.tokens),
        budgetPerMin: this.budget, venueConnected: this.venue?.connected() ?? false, llm: llmEnabled, llmFailing: llmEnabled && llmFailures >= 3, chain: chainEnabled && agentAddress !== null,
      },
      markets, equity: this.equity.filter((_, i) => i % step === 0 || i === this.equity.length - 1), fills: this.fills.slice(0, 40), decisions: this.decisions.slice(0, 40), alerts: this.alerts,
    };
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** Whole dollars when whole, otherwise cents: session limits and take-profit amounts are often small. */
const cents = (n: number) => usd(n, Number.isInteger(n) ? 0 : 2);
