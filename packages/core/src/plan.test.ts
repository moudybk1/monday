import { describe, expect, it } from 'vitest';
import { planNumbers, planProblems, type PlanContext, type TradeInput, type TwapInput } from './plan';
import type { MarketSpec } from './types';

const BTC: MarketSpec = { sym: 'BTC', marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15, maintLeverage: 25 };
const trade = (o: Partial<TradeInput> = {}): TradeInput => ({ kind: 'trade', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, entry: 'market', entryPrice: null, expiryHours: 24, stopLossPct: 2, takeProfitPct: 4, ...o });
const twap = (o: Partial<TwapInput> = {}): TwapInput => ({ kind: 'twap', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, durationMin: 30, slices: 30, style: 'balanced', limitPrice: null, stopLossPct: 2, takeProfitPct: null, ...o });
const ctx = (o: Partial<PlanContext> = {}): PlanContext => ({ mark: 60_000, balanceUsd: 1_000, makerMarkets: [], planMarkets: [], activePlans: 0, ...o });

describe('plan numbers', () => {
  it('sizes from margin times leverage, rounded down to the size step, with stop and target on the right sides', () => {
    const n = planNumbers(trade(), BTC, 60_000);
    expect(n.size).toBe(0.00833); // $500 / 60,000 = 0.0083333 BTC
    expect(n.slPrice).toBe(58_800);
    expect(n.tpPrice).toBe(62_400);
    expect(n.feesUsd).toBeCloseTo(0.00833 * 60_000 * 6.9e-4, 6); // taker in, taker out
    expect(n.lossUsd).toBeCloseTo(0.00833 * 60_000 * 0.02 + n.feesUsd, 6);
    // Perpl's formula: entry * (1 + 1/25 - 1/5) for a long at 5x with 25x maintenance.
    expect(n.liqPrice).toBeCloseTo(60_000 * 0.84, 6);
    const short = planNumbers(trade({ bias: 'short' }), BTC, 60_000);
    expect(short.slPrice).toBe(61_200);
    expect(short.tpPrice).toBe(57_600);
    expect(short.liqPrice).toBeGreaterThan(60_000);
  });

  it('figures a limit entry at its own price and charges it the maker fee', () => {
    const n = planNumbers(trade({ entry: 'limit', entryPrice: 59_000 }), BTC, 60_000);
    expect(n.ref).toBe(59_000);
    expect(n.slPrice).toBe(57_820);
    expect(n.feesUsd).toBeCloseTo(n.notionalUsd * (0.45 + 3.45) / 1e4, 9);
  });

  it('splits a TWAP into equal slices', () => {
    const n = planNumbers(twap(), BTC, 60_000);
    expect(n.twap).toEqual({ sliceSize: 0.00027, sliceUsd: n.notionalUsd / 30, intervalSec: 60 });
  });
});

describe('plan problems', () => {
  it('passes a sound plan', () => {
    expect(planProblems(trade(), BTC, ctx())).toEqual({});
    expect(planProblems(twap(), BTC, ctx())).toEqual({});
  });

  it('keeps the stop well inside the liquidation distance', () => {
    // 15x on BTC liquidates about 2.67% away: a 2.5% stop would come after it in a fast market.
    expect(planProblems(trade({ leverage: 15, stopLossPct: 2.5 }), BTC, ctx()).stopLossPct).toMatch(/liquidated about 2\.67%/);
    expect(planProblems(trade({ leverage: 15, stopLossPct: 2 }), BTC, ctx()).stopLossPct).toBeUndefined();
  });

  it('refuses a market the market maker quotes, a second plan on one market, and too many plans', () => {
    expect(planProblems(trade(), BTC, ctx({ makerMarkets: ['BTC'] })).sym).toMatch(/market maker quotes BTC/);
    expect(planProblems(trade(), BTC, ctx({ planMarkets: ['BTC'] })).sym).toMatch(/One plan per market/);
    expect(planProblems(trade(), BTC, ctx({ activePlans: 4 })).sym).toMatch(/4 plans/);
  });

  it('puts a limit on the better side of the price and a stop on the breakout side', () => {
    expect(planProblems(trade({ entry: 'limit', entryPrice: 61_000 }), BTC, ctx()).entryPrice).toMatch(/below the current price/);
    expect(planProblems(trade({ entry: 'stop', entryPrice: 59_000 }), BTC, ctx()).entryPrice).toMatch(/above the current price/);
    expect(planProblems(trade({ bias: 'short', entry: 'limit', entryPrice: 59_000 }), BTC, ctx()).entryPrice).toMatch(/above the current price/);
    expect(planProblems(trade({ bias: 'short', entry: 'stop', entryPrice: 59_000 }), BTC, ctx())).toEqual({});
    expect(planProblems(trade({ entry: 'limit', entryPrice: 40_000 }), BTC, ctx()).entryPrice).toMatch(/Within 20%/);
  });

  it('checks margin against the balance and the size step', () => {
    expect(planProblems(trade({ marginUsd: 2_000 }), BTC, ctx()).marginUsd).toMatch(/Perpl balance/);
    expect(planProblems(trade({ marginUsd: 0.1, leverage: 1 }), BTC, ctx()).marginUsd).toMatch(/At least/);
    // ETH steps are 0.001 (about $2.70): $1 at 1x buys less than one.
    const ETH: MarketSpec = { ...BTC, sym: 'ETH', priceTick: 0.01, sizeStep: 0.001, maxLeverage: 12, maintLeverage: 20 };
    expect(planProblems(trade({ sym: 'ETH', marginUsd: 1, leverage: 1 }), ETH, ctx({ mark: 2_700 })).marginUsd).toMatch(/Too small/);
  });

  it('keeps TWAP slices tradable and far enough apart', () => {
    expect(planProblems(twap({ marginUsd: 1, leverage: 1, slices: 10 }), BTC, ctx()).slices).toMatch(/under one BTC size step/);
    expect(planProblems(twap({ durationMin: 5, slices: 60 }), BTC, ctx()).slices).toMatch(/15 s apart/);
    expect(planProblems(twap({ durationMin: 2 }), BTC, ctx()).durationMin).toBeDefined();
  });
});
