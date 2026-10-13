import { describe, expect, it } from 'vitest';
import { planNumbers, planProblems, type PlanContext, type TradeInput, type TwapInput } from './plan';
import type { MarketSpec } from './types';

const BTC: MarketSpec = { sym: 'BTC', marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15, maintLeverage: 25 };
const ETH: MarketSpec = { ...BTC, sym: 'ETH', priceTick: 0.01, sizeStep: 0.001, maxLeverage: 12, maintLeverage: 20 };
const trade = (o: Partial<TradeInput> = {}): TradeInput => ({ kind: 'trade', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, frame: '5m', lossLimitPct: 20, profitTargetPct: 30, expiryHours: 24, ...o });
const twap = (o: Partial<TwapInput> = {}): TwapInput => ({ kind: 'twap', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, durationMin: 30, slices: 30, style: 'balanced', limitPrice: null, stopLossPct: 2, takeProfitPct: null, ...o });
const ctx = (o: Partial<PlanContext> = {}): PlanContext => ({ mark: 60_000, balanceUsd: 1_000, makerMarkets: [], planMarkets: [], activePlans: 0, ...o });

describe('plan numbers', () => {
  it('sizes a scalp from margin times leverage and takes the session limits as shares of the margin', () => {
    const n = planNumbers(trade(), BTC, 60_000);
    expect(n.size).toBe(0.00833); // $500 / 60,000 = 0.0083333 BTC, rounded down to the step
    expect(n.lossUsd).toBe(20); // 20% of $100
    expect(n.profitUsd).toBe(30);
    expect(n.rr).toBe(1.5);
    expect(n.slPrice).toBeNull(); // each scalp sets its own from its entry
    expect(n.feesUsd).toBeCloseTo(0.00833 * 60_000 * (0.45 + 3.45) / 1e4, 9); // maker in, taker out at the stop
    // Perpl's formula: entry * (1 + 1/25 - 1/5) for a long at 5x with 25x maintenance.
    expect(n.liqPrice).toBeCloseTo(60_000 * 0.84, 6);
    expect(planNumbers(trade({ profitTargetPct: null }), BTC, 60_000).profitUsd).toBeNull();
  });

  it('prices a TWAP stop and target from where it starts and splits it into equal slices', () => {
    const n = planNumbers(twap({ takeProfitPct: 4 }), BTC, 60_000);
    expect(n.slPrice).toBe(58_800);
    expect(n.tpPrice).toBe(62_400);
    expect(n.twap).toEqual({ sliceSize: 0.00027, sliceUsd: n.notionalUsd / 30, intervalSec: 60 });
    const short = planNumbers(twap({ bias: 'short', takeProfitPct: 4 }), BTC, 60_000);
    expect([short.slPrice, short.tpPrice]).toEqual([61_200, 57_600]);
  });
});

describe('plan problems', () => {
  it('passes sound plans', () => {
    expect(planProblems(trade(), BTC, ctx())).toEqual({});
    expect(planProblems(twap(), BTC, ctx())).toEqual({});
  });

  it('keeps the session limits within the margin', () => {
    expect(planProblems(trade({ lossLimitPct: 0.5 }), BTC, ctx()).lossLimitPct).toMatch(/Between 1% and 100%/);
    expect(planProblems(trade({ lossLimitPct: 150 }), BTC, ctx()).lossLimitPct).toBeDefined();
    expect(planProblems(trade({ profitTargetPct: 0 }), BTC, ctx()).profitTargetPct).toBeDefined();
    expect(planProblems(trade({ profitTargetPct: null }), BTC, ctx())).toEqual({});
    expect(planProblems(trade({ expiryHours: 0 }), BTC, ctx()).expiryHours).toBeDefined();
  });

  it('keeps a TWAP stop well inside the liquidation distance', () => {
    // 15x on BTC liquidates about 2.67% away: a 2.5% stop would come after it in a fast market.
    expect(planProblems(twap({ leverage: 15, stopLossPct: 2.5 }), BTC, ctx()).stopLossPct).toMatch(/liquidated about 2\.67%/);
    expect(planProblems(twap({ leverage: 15, stopLossPct: 2 }), BTC, ctx()).stopLossPct).toBeUndefined();
  });

  it('refuses a market the market maker quotes, a second plan on one market, and too many plans', () => {
    expect(planProblems(trade(), BTC, ctx({ makerMarkets: ['BTC'] })).sym).toMatch(/market maker quotes BTC/);
    expect(planProblems(trade(), BTC, ctx({ planMarkets: ['BTC'] })).sym).toMatch(/One plan per market/);
    expect(planProblems(trade(), BTC, ctx({ activePlans: 4 })).sym).toMatch(/4 plans/);
  });

  it('checks margin against the balance and the size step', () => {
    expect(planProblems(trade({ marginUsd: 2_000 }), BTC, ctx()).marginUsd).toMatch(/still free in your Perpl account/);
    expect(planProblems(trade({ marginUsd: 0.1, leverage: 1 }), BTC, ctx()).marginUsd).toMatch(/At least/);
    // ETH steps are 0.001 (about $2.70): $1 at 1x buys less than one.
    expect(planProblems(trade({ sym: 'ETH', marginUsd: 1, leverage: 1 }), ETH, ctx({ mark: 2_700 })).marginUsd).toMatch(/Too small/);
  });

  it('keeps TWAP slices tradable and far enough apart', () => {
    expect(planProblems(twap({ marginUsd: 1, leverage: 1, slices: 10 }), BTC, ctx()).slices).toMatch(/under one BTC size step/);
    expect(planProblems(twap({ durationMin: 5, slices: 60 }), BTC, ctx()).slices).toMatch(/15 s apart/);
    expect(planProblems(twap({ durationMin: 2 }), BTC, ctx()).durationMin).toBeDefined();
  });
});
