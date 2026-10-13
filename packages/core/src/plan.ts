// Agentic Trade and TWAP: a trade the user directs and Monday carries out. The numbers a plan implies and the checks it
// must pass live here once, so the setup page shows exactly what the server enforces.

import { usd } from './format';
import { liquidationPrice } from './perpl';
import type { MarketSpec, MarketSym } from './types';

export type Bias = 'long' | 'short';
/** market: now. limit: at a better price (a pullback). stop: once the price breaks through a level. */
export type EntryKind = 'market' | 'limit' | 'stop';
/** passive: maker orders only. balanced: maker first, the rest of each slice taken at its end. aggressive: taker every slice. */
export type TwapStyle = 'passive' | 'balanced' | 'aggressive';

interface PlanBase {
  sym: MarketSym;
  bias: Bias;
  /** Collateral the position takes from the account. */
  marginUsd: number;
  leverage: number;
  /** A move of this many percent against the entry closes the position. It rests on Perpl as a stop order. */
  stopLossPct: number;
  /** A move of this many percent in favour closes it. Null leaves the exit to the stop loss or the user. */
  takeProfitPct: number | null;
}
export interface TradeInput extends PlanBase {
  kind: 'trade';
  entry: EntryKind;
  /** Limit: a long buys at or below it, a short sells at or above. Stop: entered once the mark crosses it. Null for market. */
  entryPrice: number | null;
  /** How long a limit or stop entry waits before Monday gives it up. */
  expiryHours: number;
}
export interface TwapInput extends PlanBase {
  kind: 'twap';
  durationMin: number;
  slices: number;
  style: TwapStyle;
  /** The worst price a slice may fill at: at most this for a long, at least this for a short. Null: none. */
  limitPrice: number | null;
}
export type PlanInput = TradeInput | TwapInput;
export type PlanField = 'sym' | 'marginUsd' | 'leverage' | 'entryPrice' | 'expiryHours' | 'stopLossPct' | 'takeProfitPct' | 'durationMin' | 'slices' | 'limitPrice';

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
  avgEntry: number | null;
  slPrice: number | null;
  tpPrice: number | null;
  /** The stop loss (and take profit) rest on the exchange itself, so they hold while Monday's server is down. */
  stopOnVenue: boolean;
  takeOnVenue: boolean;
  realizedUsd: number;
  feesUsd: number;
  unrealizedUsd: number;
  twap: { slicesDone: number; slices: number; nextAt: number | null; arrival: number; makerPct: number | null } | null;
}

export const PLAN_RULES = {
  minMarginUsd: 1,
  minStopPct: 0.1,
  maxTakePct: 500,
  /** A limit or stop entry this far from the price is a typo more often than a plan. */
  maxEntryAwayPct: 20,
  /** The stop must sit inside this share of the distance to liquidation. */
  stopShareOfLiq: 0.8,
  maxExpiryHours: 168,
  minDurationMin: 5,
  maxDurationMin: 1440,
  minSlices: 2,
  maxSlices: 120,
  minIntervalSec: 15,
  /** Each plan needs up to two of Perpl's 16 trigger orders per account; four plans leave room to spare. */
  maxActive: 4,
} as const;

export const PLAN_DEFAULTS = { trade: { leverage: 3, stopLossPct: 2, takeProfitPct: 4, expiryHours: 24 }, twap: { durationMin: 30, style: 'balanced' as TwapStyle } };

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const floorTo = (v: number, step: number) => Math.floor(v / step + 1e-9) * step;
/** Strip float noise from a value on a tick grid (0.30000000000000004 -> 0.3). */
const clean = (v: number) => Number(v.toPrecision(12));

/** The leverage at which a market liquidates; venues that do not say get a stricter guess than Perpl's real ones. */
export const maintLeverageOf = (spec: Pick<MarketSpec, 'maxLeverage' | 'maintLeverage'>) => spec.maintLeverage ?? spec.maxLeverage * 1.5;

/** The price `pct` percent away from `ref`: in the position's favour, or against it. */
export function priceAway(bias: Bias, ref: number, pct: number, against: boolean): number {
  const up = (bias === 'long') !== against;
  return ref * (1 + ((up ? 1 : -1) * pct) / 100);
}

/** The price the plan is figured at: its own entry price for a limit or stop entry, the mark otherwise. */
export const planRef = (p: PlanInput, mark: number) => (p.kind === 'trade' && p.entry !== 'market' && p.entryPrice ? p.entryPrice : mark);

export interface PlanNumbers {
  ref: number;
  notionalUsd: number;
  /** Base units, rounded down to the market's size step. */
  size: number;
  slPrice: number;
  tpPrice: number | null;
  liqPrice: number;
  /** Percent move from the entry to liquidation. */
  liqPct: number;
  /** Fee in plus the taker fee out. */
  feesUsd: number;
  /** What the stop loss costs: the move plus fees, before slippage. */
  lossUsd: number;
  profitUsd: number | null;
  /** Reward over risk, both after fees. */
  rr: number | null;
  /** The stop loss as a share of the margin. */
  lossOfMarginPct: number;
  twap: { sliceSize: number; sliceUsd: number; intervalSec: number } | null;
}

export function planNumbers(p: PlanInput, spec: MarketSpec, mark: number): PlanNumbers {
  const ref = planRef(p, mark);
  const size = clean(floorTo((p.marginUsd * p.leverage) / ref, spec.sizeStep));
  const notionalUsd = size * ref;
  const makerIn = (p.kind === 'trade' && p.entry === 'limit') || (p.kind === 'twap' && p.style === 'passive');
  const feesUsd = (notionalUsd * ((makerIn ? spec.makerFeeBps : spec.takerFeeBps) + spec.takerFeeBps)) / 1e4;
  const tick = spec.priceTick;
  const slPrice = clean(roundTo(priceAway(p.bias, ref, p.stopLossPct, true), tick));
  const tpPrice = p.takeProfitPct ? clean(roundTo(priceAway(p.bias, ref, p.takeProfitPct, false), tick)) : null;
  // Perpl's own formula, with the position's margin as its deposit. Fees and funding move it slightly closer.
  const liqPrice = liquidationPrice(p.bias === 'long', ref, size, notionalUsd / p.leverage, 0, maintLeverageOf(spec));
  const lossUsd = (notionalUsd * p.stopLossPct) / 100 + feesUsd;
  const profitUsd = p.takeProfitPct ? (notionalUsd * p.takeProfitPct) / 100 - feesUsd : null;
  const twap = p.kind === 'twap' && p.slices > 0
    ? { sliceSize: clean(floorTo(size / p.slices, spec.sizeStep)), sliceUsd: notionalUsd / p.slices, intervalSec: (p.durationMin * 60) / p.slices }
    : null;
  return {
    ref, notionalUsd, size, slPrice, tpPrice, liqPrice, liqPct: Math.abs(liqPrice / ref - 1) * 100, feesUsd, lossUsd, profitUsd,
    rr: profitUsd != null && lossUsd > 0 ? profitUsd / lossUsd : null, lossOfMarginPct: p.marginUsd > 0 ? (lossUsd / p.marginUsd) * 100 : 0, twap,
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

  if (p.kind === 'trade' && p.entry !== 'market') {
    const e = p.entryPrice;
    const long = p.bias === 'long';
    if (!(e != null && e > 0)) out.entryPrice = 'Enter the price.';
    else if (ctx.mark) {
      const above = e > ctx.mark;
      if (p.entry === 'limit' && long && above) out.entryPrice = 'A long limit buys below the current price. To buy a breakout above it, choose Stop.';
      else if (p.entry === 'limit' && !long && !above) out.entryPrice = 'A short limit sells above the current price. To sell a break below it, choose Stop.';
      else if (p.entry === 'stop' && long && !above) out.entryPrice = 'A long stop enters when the price breaks above this level, so it must be above the current price.';
      else if (p.entry === 'stop' && !long && above) out.entryPrice = 'A short stop enters when the price breaks below this level, so it must be below the current price.';
      else if (Math.abs(e / ctx.mark - 1) * 100 > R.maxEntryAwayPct) out.entryPrice = `Within ${R.maxEntryAwayPct}% of the current price.`;
    }
    if (!(p.expiryHours >= 1 && p.expiryHours <= R.maxExpiryHours)) out.expiryHours = `Between 1 and ${R.maxExpiryHours} hours.`;
  }

  if (!(p.stopLossPct >= R.minStopPct)) out.stopLossPct = `At least ${R.minStopPct}%.`;
  if (p.takeProfitPct != null && !(p.takeProfitPct >= R.minStopPct && p.takeProfitPct <= R.maxTakePct)) out.takeProfitPct = `Between ${R.minStopPct}% and ${R.maxTakePct}%.`;

  if (ctx.mark && !out.leverage && !out.marginUsd && !out.entryPrice) {
    const n = planNumbers(p, spec, ctx.mark);
    if (!(n.size > 0)) out.marginUsd = `Too small: one ${p.sym} size step is ${spec.sizeStep} (${usd(spec.sizeStep * n.ref, 2)} at this price, before leverage).`;
    if (!out.stopLossPct && p.stopLossPct > n.liqPct * R.stopShareOfLiq) {
      out.stopLossPct = `At ${p.leverage}x the position is liquidated about ${n.liqPct.toFixed(2)}% away. Keep the stop under ${(n.liqPct * R.stopShareOfLiq).toFixed(2)}%, or lower the leverage.`;
    }
    if (p.kind === 'twap' && n.size > 0 && n.twap && !out.slices && n.twap.sliceSize < spec.sizeStep) {
      out.slices = `Each slice would be under one ${p.sym} size step. Use fewer slices or more margin.`;
    }
  }

  if (p.kind === 'twap') {
    if (!(Number.isInteger(p.durationMin) && p.durationMin >= R.minDurationMin && p.durationMin <= R.maxDurationMin)) out.durationMin = `Between ${R.minDurationMin} minutes and ${R.maxDurationMin / 60} hours.`;
    if (!(Number.isInteger(p.slices) && p.slices >= R.minSlices && p.slices <= R.maxSlices)) out.slices = `Between ${R.minSlices} and ${R.maxSlices} slices.`;
    else if (!out.durationMin && (p.durationMin * 60) / p.slices < R.minIntervalSec) out.slices = `Slices must be at least ${R.minIntervalSec} s apart: fewer slices or a longer duration.`;
    if (p.limitPrice != null && !(p.limitPrice > 0)) out.limitPrice = 'A price above zero, or leave it empty.';
  }
  return out;
}

/** A sensible slice count for a duration: about one a minute, at most PLAN_RULES.maxSlices, at least two. */
export const twapSlicesFor = (durationMin: number) => Math.max(PLAN_RULES.minSlices, Math.min(PLAN_RULES.maxSlices, Math.round(durationMin)));

export const BIAS_LABEL: Record<Bias, string> = { long: 'Long', short: 'Short' };
export const ENTRY_LABEL: Record<EntryKind, string> = { market: 'Market', limit: 'Limit', stop: 'Stop' };
export const STYLE_LABEL: Record<TwapStyle, string> = { passive: 'Passive', balanced: 'Balanced', aggressive: 'Aggressive' };
export const OUTCOME_LABEL: Record<PlanOutcome, string> = {
  take_profit: 'Take profit', stop_loss: 'Stop loss', closed: 'Closed', cancelled: 'Cancelled', expired: 'Expired', killed: 'Killed', failed: 'Failed',
};
