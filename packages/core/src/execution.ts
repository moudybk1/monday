// Execution layer, pure: the last risk check every order passes, the inventory lifecycle, and the order in which
// requests go out when the venue's request budget is short.

import { floorTo } from './strategy';
import type { QuoteTarget, Side } from './types';

export type GateReason = 'price_band' | 'max_order_size' | 'max_inventory' | 'max_account' | 'max_leverage';

export interface GateInput {
  side: Side;
  target: QuoteTarget;
  oracle: number;
  mark: number;
  positionSize: number; // signed base units
  /** Gross worst-case exposure in every other market: |position| plus resting or in-flight orders that would grow it. */
  otherUsd: number;
  equityUsd: number;
  /** This market's inventory cap: the lowest of the user's policy, the governor and the operator. */
  capUsd: number;
  /** Gross cap across markets. Long BTC and short ETH add up; they do not cancel. */
  accountCapUsd: number;
  maxOrderUsd: number;
  maxLeverage: number;
  sizeStep: number;
}

/**
 * The last check before any order goes out, whoever asked for it: the engine, a reflex, a policy change, a reconnect
 * or an inventory reduction. Returns the order to send, possibly cut down to a pure reduction, or why it must not go.
 */
export function riskGate(i: GateInput): { target: QuoteTarget } | { reject: GateReason } {
  if (Math.abs(i.target.price / i.oracle - 1) > 0.01) return { reject: 'price_band' };
  if (i.target.price * i.target.size > i.maxOrderUsd * 1.01) return { reject: 'max_order_size' };
  const pos = i.positionSize;
  const signed = i.side === 'bid' ? i.target.size : -i.target.size;
  const after = pos + signed;
  const reduces = pos !== 0 && Math.sign(signed) !== Math.sign(pos);
  // Stopping at or before zero only ever lowers risk.
  if (reduces && (Math.abs(after) < 1e-12 || Math.sign(after) === Math.sign(pos))) return { target: i.target };
  const exposure = Math.abs(after) * i.mark;
  const total = i.otherUsd + exposure;
  const why: GateReason | null = exposure > i.capUsd * 1.01 ? 'max_inventory'
    : total > i.accountCapUsd * 1.01 ? 'max_account'
    : i.equityUsd > 0 && total / i.equityUsd > i.maxLeverage ? 'max_leverage'
    : null;
  if (!why) return { target: i.target };
  // Through zero into a side the limits do not allow: send the reduction alone, never the flip.
  const size = reduces ? floorTo(Math.abs(pos), i.sizeStep) : 0;
  return size > 0 ? { target: { ...i.target, size } } : { reject: why };
}

export type InventoryStage = 'normal' | 'reduce' | 'urgent';

export const STAGE = {
  reduceQ: 0.75, // share of the cap
  urgentQ: 1.25, // well past the cap: limits were lowered under the position, or a gap filled through it
  reduceAgeMs: 20 * 60_000,
  urgentAgeMs: 60 * 60_000,
  urgentLossFrac: 0.25, // open loss as a share of the daily loss limit
};

/**
 * Where a position is in its life. normal: quote both sides, skewed. reduce: stop adding, quote the exit tighter.
 * urgent: the exit joins the best price. The hard limits (loss, margin) are kills, handled by the runner.
 */
export function inventoryStage(i: { positionUsd: number; capUsd: number; ageMs: number; unrealizedUsd: number; dailyLossUsd: number; inPolicy: boolean }): InventoryStage {
  const size = Math.abs(i.positionUsd);
  if (size < 0.5) return 'normal';
  const q = i.capUsd > 0 ? size / i.capUsd : Infinity;
  if (i.ageMs >= STAGE.urgentAgeMs || i.unrealizedUsd <= -STAGE.urgentLossFrac * i.dailyLossUsd || (i.inPolicy && q >= STAGE.urgentQ)) return 'urgent';
  if (!i.inPolicy || q >= STAGE.reduceQ || i.ageMs >= STAGE.reduceAgeMs) return 'reduce';
  return 'normal';
}

/**
 * Request classes, most urgent first: 1 cancel for a kill, stale data or a limit breach; 2 reduce exposure;
 * 3 cancel or move a quote that has become dangerous; 4 ordinary requote; 5 new quote.
 */
export type Priority = 1 | 2 | 3 | 4 | 5;

export interface Job {
  sym: string;
  side: Side;
  prio: Priority;
  /** When this side first wanted a change that has not been sent yet. */
  since: number;
}

/** A routine job climbs one class for every AGE_STEP_MS it waits, up to just behind the risk classes. */
export const AGE_STEP_MS = 10_000;

/** Order of service. Ties go to the longest wait, then rotate across markets with `turn`, so no market starves. */
export function orderJobs<J extends Job>(jobs: J[], now: number, markets: readonly string[], turn: number): J[] {
  const score = (j: J) => (j.prio <= 3 ? j.prio : Math.max(3.5, j.prio - (now - j.since) / AGE_STEP_MS));
  const n = Math.max(1, markets.length);
  const slot = (j: J) => (((markets.indexOf(j.sym) - turn) % n) + n) % n;
  return [...jobs].sort((a, b) => score(a) - score(b) || a.since - b.since || slot(a) - slot(b) || (a.side === 'bid' ? -1 : 1));
}
