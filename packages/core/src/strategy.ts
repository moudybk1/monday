// Maker quoting model, reflex and fallback regimes (PRD section 10).
// Pure functions only: no I/O, no clock, no randomness.

import type { InventoryStage } from './execution';
import type { BookLevel, GovernorParams, MarketSpec, MarketSym, PolicyLimits, QuoteTarget, ReflexState, Regime, Side } from './types';

/** Anchored with every decision, so a record says which rules produced it. Bump it when quoting or risk rules change. */
export const STRATEGY_VERSION = '2026-10-10.1';

export interface StrategyConfig {
  a: number; // volatility multiplier
  gamma: number; // inventory skew
  k: number; // Nansen skew, bps per unit of S
  z1: number;
  z2: number;
  reflexWiden: number;
  reflexHoldMs: number;
  bigTradeUsd: number;
  kBook: number; // order-book skew, bps per unit of imbalance
  book1: number; // |imbalance| that widens the threatened side
  book2: number; // |imbalance| that pulls it
  bookHoldMs: number;
  exitFrac: number; // a held reflex lets go only below this share of its entry level (hysteresis)
  blend: number; // weight of Hyperliquid's mid in the reference price (Tread's Blend mode), 0..1
  blendMaxBps: number; // a bigger Perpl/Hyperliquid gap is bad data or a dislocation, not something to lean into
  participation: number; // each quote is at most this share of the market's average hourly volume
  touchMaxMult: number; // join the best price only while the governor's spread_mult is at most this (calm, active)
  touchFloorBps: number; // a touch quote still keeps the maker fee plus this from the reference, so a fill can never lose to the fee alone
  touchSlackBps: number; // a quote that was at the front of the book keeps its place while it is within this of the best price
  aheadMaxUsd: number; // but moves back to the front once more than this rests ahead of it
  refWindowMs: number; // the reference-move guard looks at Hyperliquid's mid over this window
  refWidenBps: number; // a move this big widens the side the move runs into
  refPullBps: number; // a move this big pulls it
  refHoldMs: number; // for this long after the last such move
  trendMinBps: number; // a move of the mark over the last five minutes smaller than this is noise
  kTrend: number; // centre shift per bps of trend beyond that
  trendMaxBps: number; // and at most this (also at most half the half-spread, so the near side keeps clear of the fee)
  exitMinProfitBps: number; // below the urgent stage, an exit rests at least this far past the entry, after both fees
}

// PRD 10.6
export const DEFAULT_CONFIG: StrategyConfig = {
  // Half-spread is 1.5x the 1-minute volatility, floored by the policy's min half-spread, so in a calm market the policy
  // sets the distance and volatility only widens it. History: the Apr-Jun 2026 replay lost at 1x and was positive for
  // BTC at 4x, but live on mainnet (2026-10-08) 4x put BTC quotes 15 bps out (29 with a book reflex) while BTC moved
  // ~3.5 bps a minute: 0 fills in over an hour. Recorded minutes put 6 bps at about 7 fills an hour, 4 bps at about 17.
  a: 1.5,
  gamma: 1.0,
  k: 1.5,
  z1: 1.5,
  z2: 2.5,
  reflexWiden: 2,
  reflexHoldMs: 5 * 60_000,
  bigTradeUsd: 250_000,
  kBook: 2,
  // Perpl's thin book sits past 0.5 (smoothed top-5 imbalance) a quarter to half of the time, so 0.5/0.75 kept one
  // side widened or pulled most of a night (2026-10-07). Live on mainnet (2026-10-09) 0.7/0.85 still pulled the ask on
  // BTC and ETH at once: a single $19k ask against $300 of bids reads as 97% one side. The book now only widens the
  // threatened side, never pulls it (a pull is for smart-money bursts), and only when nine tenths of the depth is one side.
  book1: 0.8,
  book2: Infinity,
  bookHoldMs: 60_000,
  exitFrac: 0.8,
  blend: 0.5,
  blendMaxBps: 50,
  participation: 0.05,
  // Mainnet BTC is one tick wide and Monday re-centres every second, so a quote even 4 bps behind the best price only
  // fills on a sweep through every level ahead of it: 0 fills in hours live (2026-10-08). Makers fill at the touch.
  // Calm (1.0) and active (1.5) join it; storm (2.5) and a stale signal (2.0) keep the model's distance.
  touchMaxMult: 1.5,
  // The touch is joined, or bettered by a tick when the spread leaves room, down to the fee: on mainnet ETH (2.8 bps
  // wide) and SOL (7.8 bps) that is the front of the queue; on BTC (0.01 bps wide) the fee floor stops 0.45 bps short.
  touchFloorBps: 0,
  // A requote goes to the back of the queue, so a quote a few ticks behind the best stays put until it is clearly
  // behind, or until the depth ahead of it would take a sweep to clear.
  touchSlackBps: 0.5,
  aheadMaxUsd: 3_000,
  // Perpl's mark is a median of Binance, Hyperliquid, OKX and Bybit, so Perpl follows them. When Hyperliquid's mid
  // jumps, the quote on the side it runs into is stale until Perpl's book catches up, and that is the fill that
  // loses (the 10-second markout). The guard reads the free Hyperliquid feed and steps that side aside for a moment.
  refWindowMs: 3_000,
  refWidenBps: 1.5,
  refPullBps: 3,
  refHoldMs: 6_000,
  // Momentum. In a trending market the side that adds against the trend is the one takers hit, and price keeps going:
  // on mainnet (2026-10-09, 30 minutes with a 30-70 bps slide) bids filled 29 of 37 times and carried a 5-minute
  // markout of -12 bps against +7 on asks. Lean with the trend and keep that side off the touch until it settles.
  trendMinBps: 4,
  kTrend: 0.5,
  trendMaxBps: 8,
  // Close in profit or wait. Live on mainnet (2026-10-08 to 10) 76 of 91 closes lost, about -6 bps each: the exit was
  // priced off the market, not the entry. On those fills, an exit resting at entry + both fees + 1 bp was reached within
  // the hour by every position the Hyperliquid guard (7b) would still have opened (25 of 25, median 4 minutes). Without
  // that guard it is worse than nothing: a quarter never got there and lost -28 bps on the way out. Keep the two together.
  // The urgent stage (an hour old, a quarter of the daily loss, far past the cap) and a kill still get out at the market.
  exitMinProfitBps: 1,
};

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// Float-safe rounding to a grid: 85181.8 / 0.1 is not an integer in IEEE 754.
const EPS = 1e-9;
export const floorTo = (x: number, step: number) => Number((Math.floor(x / step + EPS) * step).toFixed(10));
export const ceilTo = (x: number, step: number) => Number((Math.ceil(x / step - EPS) * step).toFixed(10));

/** EWMA variance of 1-minute log returns. Returns the new variance (in return^2 units). */
export function ewmaVar(prevVar: number, logReturn: number, halfLifeMin = 15): number {
  const lambda = Math.pow(0.5, 1 / halfLifeMin);
  return lambda * prevVar + (1 - lambda) * logReturn * logReturn;
}
export const varToBps = (v: number) => Math.sqrt(Math.max(v, 0)) * 1e4;

export interface QuoteInput {
  mark: number;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  sigma1mBps: number;
  positionUsd: number; // signed notional, long positive
  S: number;
  /** Smoothed top-of-book size imbalance, -1..1. Omitted where there is no book (replay). */
  book?: number;
  /** Hyperliquid mid. Omitted or null: quote off Perpl alone. */
  hlMid?: number | null;
  /** Average hourly traded volume in USD over the last 24 h. Omitted or null: no volume cap. */
  hourlyVolumeUsd?: number | null;
  policy: Pick<PolicyLimits, 'quoteSizeUsd' | 'maxInventoryUsd' | 'minHalfSpreadBps'>;
  gov: Pick<GovernorParams, 'enabled' | 'spread_mult' | 'skew_bias_bps' | 'size_mult' | 'max_inventory_usd'>;
  reflex: Pick<ReflexState, 'side' | 'action'> | null;
  spec: Pick<MarketSpec, 'priceTick' | 'sizeStep' | 'makerFeeBps'>;
  cfg?: StrategyConfig;
  /** Inventory lifecycle (execution.ts). Past normal, Monday stops adding and works the exit. */
  stage?: InventoryStage;
  /** Signed position in base units: the exit side never quotes more than it. */
  positionBase?: number;
  /** Signed move of the mark over the last five minutes, in bps. Omitted: no trend term. */
  trendBps?: number;
  /** Average entry price of the position. Omitted: exits are priced off the market alone. */
  entryPrice?: number;
}

export interface QuoteOutput {
  bid: QuoteTarget | null;
  ask: QuoteTarget | null;
  ref: number;
  center: number;
  halfBps: number;
  skewInvBps: number;
  skewNanBps: number;
  skewBookBps: number;
  skewTrendBps: number;
  q: number;
  blendBps: number; // how far Hyperliquid moved the reference
  sizeCapUsd: number | null;
  /** The side's price is at or inside the best price: it should stay at the front of the queue (see touchRequote). */
  touch: Record<Side, boolean>;
}

export function computeQuotes(i: QuoteInput): QuoteOutput {
  const cfg = i.cfg ?? DEFAULT_CONFIG;
  const tick = i.spec.priceTick;

  // 1. Reference price: mark, or book mid when it sits within 5 bps of mark, then blended toward Hyperliquid,
  // where price discovery happens. A gap wider than blendMaxBps is ignored rather than leaned into.
  const local = i.mid != null && Math.abs(i.mid / i.mark - 1) * 1e4 <= 5 ? i.mid : i.mark;
  const hl = i.hlMid != null && i.hlMid > 0 && Math.abs(i.hlMid / local - 1) * 1e4 <= cfg.blendMaxBps ? i.hlMid : null;
  const ref = hl == null ? local : local + cfg.blend * (hl - local);

  // 3. Half-spread
  const h = Math.max(i.policy.minHalfSpreadBps, cfg.a * i.sigma1mBps) * i.gov.spread_mult + i.spec.makerFeeBps;

  // 4. Inventory skew. Long inventory pushes both quotes down so the ask fills first.
  const maxInv = Math.max(1, Math.min(i.policy.maxInventoryUsd, i.gov.max_inventory_usd));
  const q = clamp(i.positionUsd / maxInv, -1, 1);
  const skewInvBps = -cfg.gamma * q * h;

  // 5-6. Nansen skew and governor bias
  const skewNanBps = cfg.k * clamp(i.S, -3, 3);
  const bias = clamp(i.gov.skew_bias_bps, -10, 10);
  // Order-book skew: lean toward the heavy side of Perpl's own book.
  const skewBookBps = cfg.kBook * clamp(i.book ?? 0, -1, 1);
  // Trend skew: lean with a move that is past the noise, never so far that the near side sits inside half the spread.
  const trend = i.trendBps ?? 0;
  const against = Math.abs(trend) > cfg.trendMinBps ? trend - Math.sign(trend) * cfg.trendMinBps : 0;
  const trendCap = Math.min(cfg.trendMaxBps, h / 2);
  const skewTrendBps = clamp(cfg.kTrend * against, -trendCap, trendCap);

  // 7. Quotes. Past the normal stage the exit side (the one that shrinks the position) is worked: tighter when
  // reducing, at the best price when urgent, and a reflex may widen it but never pull it, because protection
  // from a signal must not remove the way out of a position the account has to shed.
  const center = ref * (1 + (skewInvBps + skewNanBps + skewBookBps + skewTrendBps + bias) / 1e4);
  const stage = i.stage ?? 'normal';
  const exit: Side | null = stage === 'normal' ? null : q > 0 ? 'ask' : q < 0 ? 'bid' : null;
  const reflexOn = (s: Side): ReflexState['action'] | null => {
    if (!i.reflex || i.reflex.side !== s) return null;
    if (s === exit) return stage === 'urgent' ? null : 'widen';
    return i.reflex.action;
  };
  const dist = (s: Side) => (s === exit && stage === 'reduce' ? h / 2 : h) * (reflexOn(s) === 'widen' ? cfg.reflexWiden : 1);
  let bidPx = floorTo(center * (1 - dist('bid') / 1e4), tick);
  let askPx = ceilTo(center * (1 + dist('ask') / 1e4), tick);
  if (stage === 'urgent' && exit === 'ask' && i.bestAsk != null) askPx = Math.min(askPx, i.bestBid != null && i.bestAsk - tick > i.bestBid ? ceilTo(i.bestAsk - tick, tick) : i.bestAsk);
  if (stage === 'urgent' && exit === 'bid' && i.bestBid != null) bidPx = Math.max(bidPx, i.bestAsk != null && i.bestBid + tick < i.bestAsk ? floorTo(i.bestBid + tick, tick) : i.bestBid);

  // 7b. Join the touch when the market is calm or active and no reflex holds that side, and better it by one tick when
  // the spread has room for both sides to (three ticks or more), so the quote is first in line. Never closer to the
  // reference than the fee: a fill there loses even if price stands still. The side that shrinks the position always
  // may; the side that grows it only while the position is under half its cap, so the inventory skew still works,
  // and never the side that would add against a trend: it waits at the model's distance until the move settles.
  // Nor on the wrong side of Hyperliquid's mid: Perpl follows it, so a touch quote past it is the one taken just before
  // Perpl catches up. On mainnet (2026-10-08 to 10) those fills ran -5 bps at five minutes; the rest +0.5.
  if (i.gov.spread_mult <= cfg.touchMaxMult) {
    const may = (s: Side) => !reflexOn(s) && !(s === 'bid' ? against < 0 : against > 0) && ((s === 'bid' ? q < 0 : q > 0) || Math.abs(q) < 0.5);
    const floor = (i.spec.makerFeeBps + cfg.touchFloorBps) / 1e4;
    const room = i.bestBid != null && i.bestAsk != null && i.bestAsk - i.bestBid > 2 * tick + EPS;
    const bidRef = hl == null ? ref : Math.min(ref, hl);
    const askRef = hl == null ? ref : Math.max(ref, hl);
    if (may('bid') && i.bestBid != null) bidPx = Math.max(bidPx, floorTo(Math.min(room ? i.bestBid + tick : i.bestBid, bidRef * (1 - floor)), tick));
    if (may('ask') && i.bestAsk != null) askPx = Math.min(askPx, ceilTo(Math.max(room ? i.bestAsk - tick : i.bestAsk, askRef * (1 + floor)), tick));
  }

  // 7c. Exit in profit: below the urgent stage, the side that shrinks the position rests no better for the taker than
  // the entry plus both fees and exitMinProfitBps, so a round trip closes in profit or waits (see exitMinProfitBps).
  if (stage !== 'urgent' && i.entryPrice && i.entryPrice > 0 && i.positionBase) {
    const need = (2 * i.spec.makerFeeBps + cfg.exitMinProfitBps) / 1e4;
    if (i.positionBase > 0) askPx = Math.max(askPx, ceilTo(i.entryPrice * (1 + need), tick));
    else bidPx = Math.min(bidPx, floorTo(i.entryPrice * (1 - need), tick));
  }

  // 8. PostOnly safety: never cross the book, sit one tick behind the opposite best.
  if (i.bestAsk != null && bidPx >= i.bestAsk) bidPx = floorTo(i.bestAsk - tick, tick);
  if (i.bestBid != null && askPx <= i.bestBid) askPx = ceilTo(i.bestBid + tick, tick);
  const touch: Record<Side, boolean> = { bid: i.bestBid != null && bidPx >= i.bestBid - EPS, ask: i.bestAsk != null && askPx <= i.bestAsk + EPS };

  // 9. Size. The side that grows inventory shrinks linearly as |q| approaches 1. A quiet market caps it (Tread's participation rate).
  const sizeCapUsd = i.hourlyVolumeUsd ? cfg.participation * i.hourlyVolumeUsd : null;
  const size = (side: Side, px: number): number => {
    const grows = (side === 'bid' && q > 0) || (side === 'ask' && q < 0);
    const usd = Math.min(sizeCapUsd ?? Infinity, i.policy.quoteSizeUsd * i.gov.size_mult * (grows ? 1 - Math.abs(q) : 1));
    const sz = floorTo(usd / px, i.spec.sizeStep);
    return side === exit && i.positionBase != null ? Math.min(sz, floorTo(Math.abs(i.positionBase), i.spec.sizeStep)) : sz;
  };
  const side = (s: Side, px: number): QuoteTarget | null => {
    if (exit && s !== exit) return null; // stop adding
    if (!i.gov.enabled && s !== exit) return null;
    if (reflexOn(s) === 'pull') return null;
    if (!(px > 0)) return null;
    const sz = size(s, px);
    return sz > 0 ? { price: px, size: sz } : null;
  };

  return { bid: side('bid', bidPx), ask: side('ask', askPx), ref, center, halfBps: h, skewInvBps, skewNanBps, skewBookBps, skewTrendBps, q, blendBps: (ref / local - 1) * 1e4, sizeCapUsd, touch };
}

/** PRD 10.2 step 10: only touch a side when it moved enough to be worth a request. */
export function shouldRequote(live: QuoteTarget | null, target: QuoteTarget | null, halfBps: number, tick: number): boolean {
  if (!live && !target) return false;
  if (!live || !target) return true;
  const threshold = Math.max(tick, (0.3 * halfBps * target.price) / 1e4);
  if (Math.abs(live.price - target.price) > threshold - EPS) return true;
  return Math.abs(live.size - target.size) / live.size > 0.2;
}

/**
 * Base units resting ahead of a maker order on its side of the book: every level at a better price, plus whatever
 * else sits at its own price (`ownSize` is taken out, since a live book shows the order itself).
 */
export function depthAhead(levels: BookLevel[], side: Side, price: number, ownSize = 0): number {
  let ahead = 0;
  for (const l of levels) {
    if (side === 'bid' ? l.price > price + EPS : l.price < price - EPS) ahead += l.size;
    else if (Math.abs(l.price - price) <= EPS) ahead += Math.max(0, l.size - ownSize);
  }
  return ahead;
}

/**
 * A quote that was placed at the front of the book has fallen behind the best price. A requote goes to the back of
 * the queue, so it is only worth one once the quote is clearly behind (touchSlackBps) or the depth ahead of it would
 * take a sweep to clear (aheadMaxUsd). The ordinary rule (shouldRequote) still catches larger moves.
 */
export function touchRequote(live: QuoteTarget, side: Side, best: number | null, aheadUsd: number, cfg: StrategyConfig = DEFAULT_CONFIG): boolean {
  if (best == null) return false;
  const behind = side === 'bid' ? best - live.price : live.price - best;
  if (behind <= EPS) return false;
  return (behind / best) * 1e4 > cfg.touchSlackBps || aheadUsd > cfg.aheadMaxUsd;
}

/** PRD 10.3. Which side does smart money threaten right now, and how hard? */
export function reflexTrigger(
  z5m: number,
  bigTradeDir: 1 | -1 | 0,
  cfg: StrategyConfig = DEFAULT_CONFIG,
  held: Pick<ReflexState, 'side'> | null = null,
): Pick<ReflexState, 'side' | 'action'> | null {
  if (z5m > cfg.z2 || bigTradeDir === 1) return { side: 'ask', action: 'pull' };
  if (z5m < -cfg.z2 || bigTradeDir === -1) return { side: 'bid', action: 'pull' };
  if (z5m > cfg.z1) return { side: 'ask', action: 'widen' };
  if (z5m < -cfg.z1) return { side: 'bid', action: 'widen' };
  // Hysteresis: a held side stays held while the reading is still above exitFrac of the entry level, so a value
  // hovering at the threshold cannot switch the quote on and off every few seconds.
  if (held && (held.side === 'ask' ? z5m : -z5m) > cfg.exitFrac * cfg.z1) return { side: held.side, action: 'widen' };
  return null;
}

/** Size imbalance of the top `levels` of the book: +1 all bids, -1 all asks, 0 when a side is empty. */
export function bookImbalance(bids: BookLevel[], asks: BookLevel[], levels = 5): number {
  const b = bids.slice(0, levels).reduce((s, l) => s + l.size, 0);
  const a = asks.slice(0, levels).reduce((s, l) => s + l.size, 0);
  return b > 0 && a > 0 ? (b - a) / (b + a) : 0;
}

/** The reflex ladder on order-book imbalance: a heavy bid side threatens the ask, and the reverse. With book2 at Infinity it only ever widens. */
export const bookTrigger = (imbalance: number, cfg: StrategyConfig = DEFAULT_CONFIG, held: Pick<ReflexState, 'side'> | null = null) =>
  reflexTrigger(imbalance, 0, { ...cfg, z1: cfg.book1, z2: cfg.book2 }, held);

/** The reflex ladder on a reference move: Hyperliquid up runs into the ask, down into the bid. `moveBps` is signed. */
export const refTrigger = (moveBps: number, cfg: StrategyConfig = DEFAULT_CONFIG, held: Pick<ReflexState, 'side'> | null = null) =>
  reflexTrigger(moveBps, 0, { ...cfg, z1: cfg.refWidenBps, z2: cfg.refPullBps }, held);

/**
 * Fold a trigger into the held reflex. A reflex holds for `reflexHoldMs` after
 * the last trigger; a pull is never downgraded to a widen while it holds. When a
 * pull runs out it steps down to a widen for half the hold, so protection lets go
 * in stages. `changed` is true when the action the engine sees is new (worth logging).
 */
export function nextReflex(
  prev: ReflexState | null,
  trigger: Pick<ReflexState, 'side' | 'action' | 'book' | 'ref'> | null,
  now: number,
  z: number,
  triggerHashes: string[],
  cfg: StrategyConfig = DEFAULT_CONFIG,
): { state: ReflexState | null; changed: boolean } {
  const held = prev && prev.until > now ? prev : null;
  if (!trigger) {
    if (!held && prev?.action === 'pull' && !prev.released) return { state: { ...prev, action: 'widen', until: now + cfg.reflexHoldMs / 2, released: true }, changed: true };
    return { state: held, changed: prev !== null && held === null };
  }
  const until = now + cfg.reflexHoldMs;
  // The state carries which kind of trigger it came from (flow, book, reference): the runner reads that to pick the
  // hold and the release time. A hold extended by a different kind keeps the kind of the trigger that just fired.
  const kind = { book: trigger.book, ref: trigger.ref };
  if (held && held.side === trigger.side) {
    const action = held.action === 'pull' ? 'pull' : trigger.action;
    // A short book hold must not cut a longer smart-money hold.
    return { state: { ...held, action, until: Math.max(held.until, until), z, triggerHashes, ...kind, released: false }, changed: action !== held.action };
  }
  return { state: { side: trigger.side, action: trigger.action, until, z, triggerHashes, ...kind }, changed: true };
}

export function regimeOf(S: number, sigma1mBps: number, sigmaMedianBps: number, stale: boolean, cfg: StrategyConfig = DEFAULT_CONFIG): Regime {
  if (stale) return 'stale';
  const a = Math.abs(S);
  if (a >= cfg.z2 || (sigmaMedianBps > 0 && sigma1mBps > 3 * sigmaMedianBps)) return 'storm';
  if (a >= 1) return 'active';
  return 'calm';
}

// PRD 10.4 rule-based fallback table.
const FALLBACK: Record<Regime, { spread_mult: number; size_mult: number; bias: number }> = {
  calm: { spread_mult: 1.0, size_mult: 1.0, bias: 0 },
  active: { spread_mult: 1.5, size_mult: 0.7, bias: 2 },
  storm: { spread_mult: 2.5, size_mult: 0.4, bias: 0 },
  stale: { spread_mult: 2.0, size_mult: 0.5, bias: 0 },
};

/**
 * `lean`: the event study supports leaning with the flow (PRD 19.1). Without that evidence Nansen only widens and
 * shrinks quotes; it never moves their centre, here or in the LLM governor (clampParams).
 */
export function fallbackParams(market: MarketSym, regime: Regime, S: number, maxInventoryUsd: number, lean = false): Omit<GovernorParams, 'reason'> {
  const f = FALLBACK[regime];
  return {
    market,
    enabled: true,
    spread_mult: f.spread_mult,
    skew_bias_bps: lean ? f.bias * Math.sign(S) : 0,
    size_mult: f.size_mult,
    max_inventory_usd: maxInventoryUsd,
    ttl_min: 15,
    regime,
  };
}

/**
 * Clamp anything (LLM output included) into the bounds of PRD 10.4 and the user's policy. Without `lean` evidence the
 * bias is zero. Against `prev`, tightening applies at once but loosening moves one step per decision (spread at most
 * 1x narrower, size at most 0.5x bigger), so one odd reply cannot swing the book.
 */
export function clampParams(p: GovernorParams, policyMaxInventoryUsd: number, o: { lean?: boolean; prev?: Pick<GovernorParams, 'spread_mult' | 'size_mult'> | null } = {}): GovernorParams {
  return {
    ...p,
    spread_mult: clamp(p.spread_mult, Math.max(1, o.prev ? o.prev.spread_mult - 1 : 1), 4),
    skew_bias_bps: o.lean ? clamp(p.skew_bias_bps, -10, 10) : 0,
    size_mult: clamp(p.size_mult, 0, Math.min(1.5, o.prev ? o.prev.size_mult + 0.5 : 1.5)),
    max_inventory_usd: clamp(p.max_inventory_usd, 0, policyMaxInventoryUsd),
    ttl_min: clamp(Math.round(p.ttl_min), 5, 30),
    reason: p.reason.slice(0, 280),
  };
}

/** Markout in bps. Positive means the fill was good for the maker. */
export function markoutBps(side: Side, fillPrice: number, midLater: number): number {
  const m = ((midLater - fillPrice) / fillPrice) * 1e4;
  return side === 'bid' ? m : -m;
}
