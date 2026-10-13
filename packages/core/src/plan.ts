// Agentic Trade and TWAP: trading the user directs and Monday carries out. The numbers a plan implies and the checks it
// must pass live here once, so the setup page shows exactly what the server enforces.

import { usd } from './format';
import { liquidationPrice } from './perpl';
import type { MarketRead, ScalpFrame, ScalpMode, Trend } from './scalp';
import type { MarketSpec, MarketSym } from './types';

export type Bias = 'long' | 'short';
/** passive: maker orders only. balanced: maker first, the rest of each slice taken at its end. aggressive: taker every slice. */
export type TwapStyle = 'passive' | 'balanced' | 'aggressive';

interface PlanBase {
  sym: MarketSym;
  bias: Bias;
  /** Collateral each position takes from the account. */
  marginUsd: number;
  leverage: number;
}
/**
 * Agentic Trade: a scalping session. Monday reads D1 and H4, then scalps the user's side on the trigger timeframe, one
 * position at a time, until the session has lost its stop loss or made its take profit (both shares of the margin), or
 * its time is up.
 */
export interface TradeInput extends PlanBase {
  kind: 'trade';
  frame: ScalpFrame;
  /** The session stops and closes once it has lost this share of the margin. */
  lossLimitPct: number;
  /** The session stops and closes once it has made this share of the margin. Null: until the stop loss or the time. */
  profitTargetPct: number | null;
  /** How long the session may run. */
  expiryHours: number;
}
/** TWAP: one position built in slices, then held under a stop loss and take profit priced from where it started. */
export interface TwapInput extends PlanBase {
  kind: 'twap';
  durationMin: number;
  slices: number;
  style: TwapStyle;
  /** The worst price a slice may fill at: at most this for a long, at least this for a short. Null: none. */
  limitPrice: number | null;
  /** A move of this many percent against the start closes the position. It rests on Perpl as a stop order. */
  stopLossPct: number;
  /** A move of this many percent in favour closes it. Null leaves the exit to the stop loss or the user. */
  takeProfitPct: number | null;
}
export type PlanInput = TradeInput | TwapInput;
export type PlanField =
  | 'sym' | 'marginUsd' | 'leverage' | 'frame' | 'lossLimitPct' | 'profitTargetPct' | 'expiryHours'
  | 'stopLossPct' | 'takeProfitPct' | 'durationMin' | 'slices' | 'limitPrice';

export type PlanStatus = 'waiting' | 'entering' | 'open' | 'done';
export type PlanOutcome = 'take_profit' | 'stop_loss' | 'closed' | 'cancelled' | 'expired' | 'killed' | 'failed';

/** A plan as the terminal shows it. */
export interface PlanView {
  id: number;
  input: PlanInput;
  status: PlanStatus;
  outcome: PlanOutcome | null;
  /** One plain sentence: what the plan is doing now, or why it ended. */
  note: string;
  createdAt: number;
  endedAt: number | null;
  targetSize: number;
  filledSize: number;
  /** The open position's (or the scalp's) entry. */
  avgEntry: number | null;
  /** The stop and target resting now: the TWAP's position's, or the scalp's in progress. */
  slPrice: number | null;
  tpPrice: number | null;
  /** The stop loss (and take profit) rest on the exchange itself, so they hold while Monday's server is down. */
  stopOnVenue: boolean;
  takeOnVenue: boolean;
  realizedUsd: number;
  feesUsd: number;
  unrealizedUsd: number;
  twap: { slicesDone: number; slices: number; nextAt: number | null; arrival: number; makerPct: number | null } | null;
  scalp: ScalpView | null;
}

export interface ScalpView {
  frame: ScalpFrame;
  d1: Trend;
  h4: Trend;
  market: MarketRead;
  mode: ScalpMode | null;
  scalps: number;
  wins: number;
  losses: number;
  /** Realised less fees, plus the open scalp at the mark. */
  sessionPnl: number;
  lossLimitUsd: number;
  targetUsd: number | null;
  endsAt: number;
  /** Why the scalp in progress (or waiting to fill) was taken. */
  why: string | null;
}

export const PLAN_RULES = {
  minMarginUsd: 1,
  minStopPct: 0.1,
  maxTakePct: 500,
  /** The stop must sit inside this share of the distance to liquidation. */
  stopShareOfLiq: 0.8,
  minLossLimitPct: 1,
  maxLossLimitPct: 100,
  maxProfitTargetPct: 1000,
  maxExpiryHours: 168,
  minDurationMin: 5,
  maxDurationMin: 1440,
  minSlices: 2,
  maxSlices: 120,
  minIntervalSec: 15,
  /** Each plan needs up to two of Perpl's 16 trigger orders per account; four plans leave room to spare. */
  maxActive: 4,
} as const;

export const PLAN_DEFAULTS = {
  trade: { leverage: 3, frame: '5m' as ScalpFrame, lossLimitPct: 20, profitTargetPct: 30, expiryHours: 24 },
  twap: { leverage: 3, durationMin: 30, style: 'balanced' as TwapStyle, stopLossPct: 2, takeProfitPct: null as number | null },
};

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const floorTo = (v: number, step: number) => Math.floor(v / step + 1e-9) * step;
/** Strip float noise from a value on a tick grid (0.30000000000000004 -> 0.3). */
const clean = (v: number) => Number(v.toPrecision(12));
export const toTick = (v: number, tick: number) => clean(roundTo(v, tick));

/** The leverage at which a market liquidates; venues that do not say get a stricter guess than Perpl's real ones. */
export const maintLeverageOf = (spec: Pick<MarketSpec, 'maxLeverage' | 'maintLeverage'>) => spec.maintLeverage ?? spec.maxLeverage * 1.5;

/** The price `pct` percent away from `ref`: in the position's favour, or against it. */
export function priceAway(bias: Bias, ref: number, pct: number, against: boolean): number {
  const up = (bias === 'long') !== against;
  return ref * (1 + ((up ? 1 : -1) * pct) / 100);
}

/** Base units for `notional` dollars at `price`, rounded down to the market's size step. */
export const sizeFor = (notionalUsd: number, price: number, spec: Pick<MarketSpec, 'sizeStep'>) => clean(floorTo(notionalUsd / price, spec.sizeStep));

/** Perpl's liquidation price for a position of `size` at `entry` on `leverage` (its own formula, the margin as deposit). */
export const liquidationAt = (bias: Bias, entry: number, size: number, leverage: number, spec: Pick<MarketSpec, 'maxLeverage' | 'maintLeverage'>) =>
  liquidationPrice(bias === 'long', entry, size, (size * entry) / leverage, 0, maintLeverageOf(spec));

export interface PlanNumbers {
  ref: number;
  /** One position (one scalp, or the whole TWAP). */
  notionalUsd: number;
  /** Base units, rounded down to the market's size step. */
  size: number;
  /** TWAP: the position's stop and target. Agentic Trade: set per scalp from its entry, so null here. */
  slPrice: number | null;
  tpPrice: number | null;
  liqPrice: number;
  /** Percent move from the entry to liquidation. */
  liqPct: number;
  /** Fees of one round trip that ends at the stop: in, then the taker fee out. */
  feesUsd: number;
  /** What the stop loss costs: TWAP, the move plus fees; Agentic Trade, the session's whole loss limit. */
  lossUsd: number;
  profitUsd: number | null;
  /** Reward over risk. */
  rr: number | null;
  /** The stop loss as a share of the margin. */
  lossOfMarginPct: number;
  twap: { sliceSize: number; sliceUsd: number; intervalSec: number } | null;
}

export function planNumbers(p: PlanInput, spec: MarketSpec, mark: number): PlanNumbers {
  const size = sizeFor(p.marginUsd * p.leverage, mark, spec);
  const notionalUsd = size * mark;
  const liqPrice = liquidationAt(p.bias, mark, size, p.leverage, spec);
  const liqPct = Math.abs(liqPrice / mark - 1) * 100;
  // Scalps enter and take profit with maker orders; TWAP slices enter as their style says. A stop always exits as taker.
  const makerIn = p.kind === 'trade' || p.style === 'passive';
  const feesUsd = (notionalUsd * ((makerIn ? spec.makerFeeBps : spec.takerFeeBps) + spec.takerFeeBps)) / 1e4;
  if (p.kind === 'trade') {
    const lossUsd = (p.marginUsd * p.lossLimitPct) / 100;
    const profitUsd = p.profitTargetPct ? (p.marginUsd * p.profitTargetPct) / 100 : null;
    return {
      ref: mark, notionalUsd, size, slPrice: null, tpPrice: null, liqPrice, liqPct, feesUsd, lossUsd, profitUsd,
      rr: profitUsd != null && lossUsd > 0 ? profitUsd / lossUsd : null, lossOfMarginPct: p.lossLimitPct, twap: null,
    };
  }
  const tick = spec.priceTick;
  const slPrice = toTick(priceAway(p.bias, mark, p.stopLossPct, true), tick);
  const tpPrice = p.takeProfitPct ? toTick(priceAway(p.bias, mark, p.takeProfitPct, false), tick) : null;
  const lossUsd = (notionalUsd * p.stopLossPct) / 100 + feesUsd;
  const profitUsd = p.takeProfitPct ? (notionalUsd * p.takeProfitPct) / 100 - feesUsd : null;
  return {
    ref: mark, notionalUsd, size, slPrice, tpPrice, liqPrice, liqPct, feesUsd, lossUsd, profitUsd,
    rr: profitUsd != null && lossUsd > 0 ? profitUsd / lossUsd : null, lossOfMarginPct: p.marginUsd > 0 ? (lossUsd / p.marginUsd) * 100 : 0,
    twap: p.slices > 0 ? { sliceSize: sizeFor(notionalUsd / p.slices, mark, spec), sliceUsd: notionalUsd / p.slices, intervalSec: (p.durationMin * 60) / p.slices } : null,
  };
}

export interface PlanContext {
  mark: number | null;
  /** The account's collateral; null when not known yet. */
  balanceUsd: number | null;
  /** Markets the market maker quotes: a plan there would share its position. */
  makerMarkets: MarketSym[];
  /** Markets another running plan already trades. */
  planMarkets: MarketSym[];
  activePlans: number;
}

/** Everything wrong with a plan, by field, in words for the person fixing it. Empty when it can go. */
export function planProblems(p: PlanInput, spec: MarketSpec | undefined, ctx: PlanContext): Partial<Record<PlanField, string>> {
  const out: Partial<Record<PlanField, string>> = {};
  const R = PLAN_RULES;
  if (!spec) return { sym: `${p.sym} is not listed on this venue.` };
  if (ctx.makerMarkets.includes(p.sym)) out.sym = `The market maker quotes ${p.sym}, and a plan would share its position. Pick another market, or take ${p.sym} out of the market maker first.`;
  else if (ctx.planMarkets.includes(p.sym)) out.sym = `Another plan already trades ${p.sym}. One plan per market.`;
  else if (ctx.activePlans >= R.maxActive) out.sym = `${R.maxActive} plans are running, the most at once. Let one finish or cancel it first.`;
  else if (!ctx.mark) out.sym = `No price for ${p.sym} yet. Try again in a moment.`;

  if (!(p.leverage >= 1 && p.leverage <= spec.maxLeverage)) out.leverage = `Between 1x and ${spec.maxLeverage}x on ${p.sym}.`;
  if (!(p.marginUsd >= R.minMarginUsd)) out.marginUsd = `At least ${usd(R.minMarginUsd)}.`;
  else if (ctx.balanceUsd != null && p.marginUsd > ctx.balanceUsd) out.marginUsd = `More than your Perpl balance of ${usd(ctx.balanceUsd, 2)}.`;

  if (p.kind === 'trade') {
    if (!['1m', '5m', '15m'].includes(p.frame)) out.frame = 'Pick 1m, 5m or 15m.';
    if (!(p.lossLimitPct >= R.minLossLimitPct && p.lossLimitPct <= R.maxLossLimitPct)) out.lossLimitPct = `Between ${R.minLossLimitPct}% and ${R.maxLossLimitPct}% of the margin.`;
    if (p.profitTargetPct != null && !(p.profitTargetPct >= R.minLossLimitPct && p.profitTargetPct <= R.maxProfitTargetPct)) out.profitTargetPct = `Between ${R.minLossLimitPct}% and ${R.maxProfitTargetPct}% of the margin, or off.`;
    if (!(p.expiryHours >= 1 && p.expiryHours <= R.maxExpiryHours)) out.expiryHours = `Between 1 and ${R.maxExpiryHours} hours.`;
  } else {
    if (!(p.stopLossPct >= R.minStopPct)) out.stopLossPct = `At least ${R.minStopPct}%.`;
    if (p.takeProfitPct != null && !(p.takeProfitPct >= R.minStopPct && p.takeProfitPct <= R.maxTakePct)) out.takeProfitPct = `Between ${R.minStopPct}% and ${R.maxTakePct}%.`;
    if (!(Number.isInteger(p.durationMin) && p.durationMin >= R.minDurationMin && p.durationMin <= R.maxDurationMin)) out.durationMin = `Between ${R.minDurationMin} minutes and ${R.maxDurationMin / 60} hours.`;
    if (!(Number.isInteger(p.slices) && p.slices >= R.minSlices && p.slices <= R.maxSlices)) out.slices = `Between ${R.minSlices} and ${R.maxSlices} slices.`;
    else if (!out.durationMin && (p.durationMin * 60) / p.slices < R.minIntervalSec) out.slices = `Slices must be at least ${R.minIntervalSec} s apart: fewer slices or a longer duration.`;
    if (p.limitPrice != null && !(p.limitPrice > 0)) out.limitPrice = 'A price above zero, or leave it empty.';
  }

  if (ctx.mark && !out.leverage && !out.marginUsd) {
    const n = planNumbers(p, spec, ctx.mark);
    if (!(n.size > 0)) out.marginUsd = `Too small: one ${p.sym} size step is ${spec.sizeStep} (${usd(spec.sizeStep * ctx.mark, 2)} at this price, before leverage).`;
    if (p.kind === 'twap' && !out.stopLossPct && p.stopLossPct > n.liqPct * R.stopShareOfLiq) {
      out.stopLossPct = `At ${p.leverage}x the position is liquidated about ${n.liqPct.toFixed(2)}% away. Keep the stop under ${(n.liqPct * R.stopShareOfLiq).toFixed(2)}%, or lower the leverage.`;
    }
    if (p.kind === 'twap' && n.size > 0 && n.twap && !out.slices && n.twap.sliceSize < spec.sizeStep) {
      out.slices = `Each slice would be under one ${p.sym} size step. Use fewer slices or more margin.`;
    }
  }
  return out;
}

/** A sensible slice count for a duration: about one a minute, at most PLAN_RULES.maxSlices, at least two. */
export const twapSlicesFor = (durationMin: number) => Math.max(PLAN_RULES.minSlices, Math.min(PLAN_RULES.maxSlices, Math.round(durationMin)));

export const BIAS_LABEL: Record<Bias, string> = { long: 'Long', short: 'Short' };
export const STYLE_LABEL: Record<TwapStyle, string> = { passive: 'Passive', balanced: 'Balanced', aggressive: 'Aggressive' };
export const OUTCOME_LABEL: Record<PlanOutcome, string> = {
  take_profit: 'Take profit', stop_loss: 'Stop loss', closed: 'Closed', cancelled: 'Cancelled', expired: 'Expired', killed: 'Killed', failed: 'Failed',
};
