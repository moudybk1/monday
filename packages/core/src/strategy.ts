// Maker quoting model, reflex and fallback regimes (PRD section 10).
// Pure functions only: no I/O, no clock, no randomness.

import type { GovernorParams, MarketSpec, MarketSym, PolicyLimits, QuoteTarget, ReflexState, Regime, Side } from './types';

export interface StrategyConfig {
  a: number; // volatility multiplier
  gamma: number; // inventory skew
  k: number; // Nansen skew, bps per unit of S
  z1: number;
  z2: number;
  reflexWiden: number;
  reflexHoldMs: number;
  bigTradeUsd: number;
}

// PRD 10.6
export const DEFAULT_CONFIG: StrategyConfig = {
  a: 1.0,
  gamma: 1.0,
  k: 1.5,
  z1: 1.5,
  z2: 2.5,
  reflexWiden: 2,
  reflexHoldMs: 5 * 60_000,
  bigTradeUsd: 250_000,
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
  q: number;
}

export function computeQuotes(i: QuoteInput): QuoteOutput {
  const cfg = i.cfg ?? DEFAULT_CONFIG;
  const tick = i.spec.priceTick;

  // 1. Reference price: mark, or book mid when it sits within 5 bps of mark.
  const ref = i.mid != null && Math.abs(i.mid / i.mark - 1) * 1e4 <= 5 ? i.mid : i.mark;

  // 3. Half-spread
  const h = Math.max(i.policy.minHalfSpreadBps, cfg.a * i.sigma1mBps) * i.gov.spread_mult + i.spec.makerFeeBps;

  // 4. Inventory skew. Long inventory pushes both quotes down so the ask fills first.
  const maxInv = Math.max(1, Math.min(i.policy.maxInventoryUsd, i.gov.max_inventory_usd));
  const q = clamp(i.positionUsd / maxInv, -1, 1);
  const skewInvBps = -cfg.gamma * q * h;

  // 5-6. Nansen skew and governor bias
  const skewNanBps = cfg.k * clamp(i.S, -3, 3);
  const bias = clamp(i.gov.skew_bias_bps, -10, 10);

  // 7. Quotes
  const center = ref * (1 + (skewInvBps + skewNanBps + bias) / 1e4);
  const widen = (side: Side) => (i.reflex?.action === 'widen' && i.reflex.side === side ? cfg.reflexWiden : 1);
  let bidPx = floorTo(center * (1 - (h * widen('bid')) / 1e4), tick);
  let askPx = ceilTo(center * (1 + (h * widen('ask')) / 1e4), tick);

  // 8. PostOnly safety: never cross the book, sit one tick behind the opposite best.
  if (i.bestAsk != null && bidPx >= i.bestAsk) bidPx = floorTo(i.bestAsk - tick, tick);
  if (i.bestBid != null && askPx <= i.bestBid) askPx = ceilTo(i.bestBid + tick, tick);

  // 9. Size. The side that grows inventory shrinks linearly as |q| approaches 1.
  const size = (side: Side, px: number): number => {
    const grows = (side === 'bid' && q > 0) || (side === 'ask' && q < 0);
    const usd = i.policy.quoteSizeUsd * i.gov.size_mult * (grows ? 1 - Math.abs(q) : 1);
    return floorTo(usd / px, i.spec.sizeStep);
  };
  const side = (s: Side, px: number): QuoteTarget | null => {
    if (!i.gov.enabled) return null;
    if (i.reflex?.action === 'pull' && i.reflex.side === s) return null;
    if (!(px > 0)) return null;
    const sz = size(s, px);
    return sz > 0 ? { price: px, size: sz } : null;
  };

  return { bid: side('bid', bidPx), ask: side('ask', askPx), ref, center, halfBps: h, skewInvBps, skewNanBps, q };
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

/**
 * Fold a trigger into the held reflex. A reflex holds for `reflexHoldMs` after
 * the last trigger; a pull is never downgraded to a widen while it holds.
 * `changed` is true when the action the engine sees is new (worth logging).
 */
export function nextReflex(
  prev: ReflexState | null,
  trigger: Pick<ReflexState, 'side' | 'action'> | null,
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
    return { state: { ...held, action, until, z, triggerHashes }, changed: action !== held.action };
  }
  return { state: { side: trigger.side, action: trigger.action, until, z, triggerHashes }, changed: true };
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
