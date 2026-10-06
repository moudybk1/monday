// Maker quoting model, reflex and fallback regimes (PRD section 10).
// Pure functions only: no I/O, no clock, no randomness.

import type { BookLevel, GovernorParams, MarketSpec, MarketSym, PolicyLimits, QuoteTarget, ReflexState, Regime, Side } from './types';

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
  blend: number; // weight of Hyperliquid's mid in the reference price (Tread's Blend mode), 0..1
  blendMaxBps: number; // a bigger Perpl/Hyperliquid gap is bad data or a dislocation, not something to lean into
  participation: number; // each quote is at most this share of the market's average hourly volume
}

// PRD 10.6
export const DEFAULT_CONFIG: StrategyConfig = {
  // Half-spread is 4x the 1-minute volatility. At 1x the replay on Perpl's Apr-Jun 2026 BTC/ETH tape lost in 5 of 6
  // months: quotes only filled when price ran through them. At 4x BTC was positive in all three months, ETH about flat.
  a: 4,
  gamma: 1.0,
  k: 1.5,
  z1: 1.5,
  z2: 2.5,
  reflexWiden: 2,
  reflexHoldMs: 5 * 60_000,
  bigTradeUsd: 250_000,
  kBook: 2,
  book1: 0.5,
  book2: 0.75,
  bookHoldMs: 60_000,
  blend: 0.5,
  blendMaxBps: 50,
  participation: 0.05,
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

  // 7. Quotes
  const center = ref * (1 + (skewInvBps + skewNanBps + skewBookBps + bias) / 1e4);
  const widen = (side: Side) => (i.reflex?.action === 'widen' && i.reflex.side === side ? cfg.reflexWiden : 1);
  let bidPx = floorTo(center * (1 - (h * widen('bid')) / 1e4), tick);
  let askPx = ceilTo(center * (1 + (h * widen('ask')) / 1e4), tick);

  // 8. PostOnly safety: never cross the book, sit one tick behind the opposite best.
  if (i.bestAsk != null && bidPx >= i.bestAsk) bidPx = floorTo(i.bestAsk - tick, tick);
  if (i.bestBid != null && askPx <= i.bestBid) askPx = ceilTo(i.bestBid + tick, tick);

  // 9. Size. The side that grows inventory shrinks linearly as |q| approaches 1. A quiet market caps it (Tread's participation rate).
  const sizeCapUsd = i.hourlyVolumeUsd ? cfg.participation * i.hourlyVolumeUsd : null;
  const size = (side: Side, px: number): number => {
    const grows = (side === 'bid' && q > 0) || (side === 'ask' && q < 0);
    const usd = Math.min(sizeCapUsd ?? Infinity, i.policy.quoteSizeUsd * i.gov.size_mult * (grows ? 1 - Math.abs(q) : 1));
    return floorTo(usd / px, i.spec.sizeStep);
  };
  const side = (s: Side, px: number): QuoteTarget | null => {
    if (!i.gov.enabled) return null;
    if (i.reflex?.action === 'pull' && i.reflex.side === s) return null;
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
): Pick<ReflexState, 'side' | 'action'> | null {
  if (z5m > cfg.z2 || bigTradeDir === 1) return { side: 'ask', action: 'pull' };
  if (z5m < -cfg.z2 || bigTradeDir === -1) return { side: 'bid', action: 'pull' };
  if (z5m > cfg.z1) return { side: 'ask', action: 'widen' };
  if (z5m < -cfg.z1) return { side: 'bid', action: 'widen' };
  return null;
}

/** Size imbalance of the top `levels` of the book: +1 all bids, -1 all asks, 0 when a side is empty. */
export function bookImbalance(bids: BookLevel[], asks: BookLevel[], levels = 5): number {
  const b = bids.slice(0, levels).reduce((s, l) => s + l.size, 0);
  const a = asks.slice(0, levels).reduce((s, l) => s + l.size, 0);
  return b > 0 && a > 0 ? (b - a) / (b + a) : 0;
}

/** The reflex ladder on order-book imbalance: a heavy bid side threatens the ask, and the reverse. */
export const bookTrigger = (imbalance: number, cfg: StrategyConfig = DEFAULT_CONFIG) =>
  reflexTrigger(imbalance, 0, { ...cfg, z1: cfg.book1, z2: cfg.book2 });

/**
 * Fold a trigger into the held reflex. A reflex holds for `reflexHoldMs` after
 * the last trigger; a pull is never downgraded to a widen while it holds.
 * `changed` is true when the action the engine sees is new (worth logging).
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
  if (!trigger) return { state: held, changed: prev !== null && held === null };
  const until = now + cfg.reflexHoldMs;
  if (held && held.side === trigger.side) {
    const action = held.action === 'pull' ? 'pull' : trigger.action;
    // A short book hold must not cut a longer smart-money hold.
    return { state: { ...held, action, until: Math.max(held.until, until), z, triggerHashes, book: trigger.book }, changed: action !== held.action };
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

export function fallbackParams(market: MarketSym, regime: Regime, S: number, maxInventoryUsd: number): Omit<GovernorParams, 'reason'> {
  const f = FALLBACK[regime];
  return {
    market,
    enabled: true,
    spread_mult: f.spread_mult,
    skew_bias_bps: f.bias * Math.sign(S),
    size_mult: f.size_mult,
    max_inventory_usd: maxInventoryUsd,
    ttl_min: 15,
    regime,
  };
}

/** Clamp anything (LLM output included) into the bounds of PRD 10.4 and the user's policy. */
export function clampParams(p: GovernorParams, policyMaxInventoryUsd: number): GovernorParams {
  return {
    ...p,
    spread_mult: clamp(p.spread_mult, 1, 4),
    skew_bias_bps: clamp(p.skew_bias_bps, -10, 10),
    size_mult: clamp(p.size_mult, 0, 1.5),
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

/** Pre-trade checks from PRD 17.3. Returns the reason an order must be rejected, or null. */
export function preTradeReject(
  target: QuoteTarget,
  side: Side,
  oracle: number,
  positionUsd: number,
  equityUsd: number,
  limits: Pick<PolicyLimits, 'maxInventoryUsd' | 'maxLeverage' | 'quoteSizeUsd'>,
): string | null {
  if (Math.abs(target.price / oracle - 1) > 0.01) return 'price_band';
  const orderUsd = target.price * target.size;
  if (orderUsd > limits.quoteSizeUsd * 1.5 * 1.01) return 'max_order_size';
  const after = positionUsd + (side === 'bid' ? orderUsd : -orderUsd);
  const grows = Math.abs(after) > Math.abs(positionUsd);
  if (grows && Math.abs(after) > limits.maxInventoryUsd * 1.01) return 'max_inventory';
  if (grows && equityUsd > 0 && Math.abs(after) / equityUsd > limits.maxLeverage) return 'max_leverage';
  return null;
}
