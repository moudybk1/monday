// Maker quoting model, reflex and fallback regimes (PRD section 10).
// Pure functions only: no I/O, no clock, no randomness.

import type { InventoryStage } from './execution';
import type { BookLevel, GovernorParams, MarketSpec, MarketSym, PolicyLimits, QuoteTarget, ReflexState, Regime, Side } from './types';

/** Anchored with every decision, so a record says which rules produced it. Bump it when quoting or risk rules change. */
export const STRATEGY_VERSION = '2026-10-07.2';

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
  touchBps: number; // then sit at most this far behind the best price on the quote's own side
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
  // side widened or pulled most of a night (2026-10-07). 0.7/0.85 is its tail: an unusually lopsided book only.
  book1: 0.7,
  book2: 0.85,
  bookHoldMs: 60_000,
  exitFrac: 0.8,
  blend: 0.5,
  blendMaxBps: 50,
  participation: 0.05,
  // Mainnet BTC is one tick wide and Monday re-centres every second, so a quote even 4 bps behind the best price only
  // fills on a sweep through every level ahead of it: 0 fills in hours live (2026-10-08). Makers fill at the touch.
  // Calm (1.0) and active (1.5) join it; storm (2.5) and a stale signal (2.0) keep the model's distance.
  touchMaxMult: 1.5,
  touchBps: 0,
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
  q: number;
  blendBps: number; // how far Hyperliquid moved the reference
  sizeCapUsd: number | null;
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

  // 7. Quotes. Past the normal stage the exit side (the one that shrinks the position) is worked: tighter when
  // reducing, at the best price when urgent, and a reflex may widen it but never pull it, because protection
  // from a signal must not remove the way out of a position the account has to shed.
  const center = ref * (1 + (skewInvBps + skewNanBps + skewBookBps + bias) / 1e4);
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

  // 7b. Join the touch when the market is calm or active and no reflex holds that side. The side that shrinks the position
  // always may; the side that grows it only while the position is under half its cap, so the inventory skew still works.
  if (i.gov.spread_mult <= cfg.touchMaxMult) {
    const may = (s: Side) => !reflexOn(s) && ((s === 'bid' ? q < 0 : q > 0) || Math.abs(q) < 0.5);
    if (may('bid') && i.bestBid != null) bidPx = Math.max(bidPx, floorTo(i.bestBid * (1 - cfg.touchBps / 1e4), tick));
    if (may('ask') && i.bestAsk != null) askPx = Math.min(askPx, ceilTo(i.bestAsk * (1 + cfg.touchBps / 1e4), tick));
  }

  // 8. PostOnly safety: never cross the book, sit one tick behind the opposite best.
  if (i.bestAsk != null && bidPx >= i.bestAsk) bidPx = floorTo(i.bestAsk - tick, tick);
  if (i.bestBid != null && askPx <= i.bestBid) askPx = ceilTo(i.bestBid + tick, tick);

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

  return { bid: side('bid', bidPx), ask: side('ask', askPx), ref, center, halfBps: h, skewInvBps, skewNanBps, skewBookBps, q, blendBps: (ref / local - 1) * 1e4, sizeCapUsd };
}

/** PRD 10.2 step 10: only touch a side when it moved enough to be worth a request. */
export function shouldRequote(live: QuoteTarget | null, target: QuoteTarget | null, halfBps: number, tick: number): boolean {
  if (!live && !target) return false;
  if (!live || !target) return true;
  const threshold = Math.max(tick, (0.3 * halfBps * target.price) / 1e4);
  if (Math.abs(live.price - target.price) > threshold - EPS) return true;
  return Math.abs(live.size - target.size) / live.size > 0.2;
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

/** The reflex ladder on order-book imbalance: a heavy bid side threatens the ask, and the reverse. */
export const bookTrigger = (imbalance: number, cfg: StrategyConfig = DEFAULT_CONFIG, held: Pick<ReflexState, 'side'> | null = null) =>
  reflexTrigger(imbalance, 0, { ...cfg, z1: cfg.book1, z2: cfg.book2 }, held);

/**
 * Fold a trigger into the held reflex. A reflex holds for `reflexHoldMs` after
 * the last trigger; a pull is never downgraded to a widen while it holds. When a
 * pull runs out it steps down to a widen for half the hold, so protection lets go
 * in stages. `changed` is true when the action the engine sees is new (worth logging).
 */
export function nextReflex(
  prev: ReflexState | null,
  trigger: Pick<ReflexState, 'side' | 'action' | 'book'> | null,
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
  if (held && held.side === trigger.side) {
    const action = held.action === 'pull' ? 'pull' : trigger.action;
    // A short book hold must not cut a longer smart-money hold.
    return { state: { ...held, action, until: Math.max(held.until, until), z, triggerHashes, book: trigger.book, released: false }, changed: action !== held.action };
  }
  return { state: { side: trigger.side, action: trigger.action, until, z, triggerHashes, book: trigger.book }, changed: true };
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
