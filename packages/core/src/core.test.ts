import { describe, expect, it } from 'vitest';
import {
  PRESETS, analyticsOf, candleScale, safeReturnPath, holesOf, liquidationPrice, spanCoverage, thin, walletPerformance, windowStartDay, type PxTrade, balanceNeededUsd, canonicalJson, limitsFromMargin, marginFloorUsd, clampParams, fitLimits, computeQuotes, computeSignal, decileMeans, fallbackParams, markoutBps, nextReflex,
  riskGate, inventoryStage, orderJobs, refTrigger, reflexTrigger, bookImbalance, bookTrigger, DEFAULT_CONFIG, depthAhead, regimeOf, robustZ, shouldRequote, spearman, touchRequote, tradeSign, windowSums,
  type QuoteInput, type SmartTrade,
} from './index';

const base: QuoteInput = {
  mark: 85_000, mid: 85_000, bestBid: 84_995, bestAsk: 85_005, sigma1mBps: 2, positionUsd: 0, S: 0,
  policy: { quoteSizeUsd: 100, maxInventoryUsd: 500, minHalfSpreadBps: 4 },
  gov: { enabled: true, spread_mult: 1, skew_bias_bps: 0, size_mult: 1, max_inventory_usd: 500 },
  reflex: null,
  spec: { priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45 },
};

describe('FR-ENG-1 quoting model', () => {
  it('quotes symmetric around the reference when flat and calm', () => {
    const q = computeQuotes(base);
    expect(q.halfBps).toBeCloseTo(4.45); // calm: the 4 bps policy floor beats 1.5 x sigma (3 bps), plus the maker fee
    expect(computeQuotes({ ...base, sigma1mBps: 6 }).halfBps).toBeCloseTo(9.45); // volatile: 1.5 x 6 bps clears the floor
    expect(q.bid!.price).toBeLessThan(85_000);
    expect(q.ask!.price).toBeGreaterThan(85_000);
    expect(85_000 - q.bid!.price).toBeCloseTo(q.ask!.price - 85_000, 0);
    expect(q.bid!.size * q.bid!.price).toBeLessThanOrEqual(100);
  });

  it('uses mark when the book mid drifts more than 5 bps from it', () => {
    expect(computeQuotes({ ...base, mid: 85_100 }).ref).toBe(85_000);
    expect(computeQuotes({ ...base, mid: 85_010 }).ref).toBe(85_010);
  });

  it('long inventory pushes both quotes down and shrinks the bid', () => {
    const cfg = { ...DEFAULT_CONFIG, touchMaxMult: 0 }; // the model alone, without joining the touch
    const flat = computeQuotes({ ...base, cfg });
    const long = computeQuotes({ ...base, positionUsd: 250, cfg });
    expect(long.ask!.price).toBeLessThan(flat.ask!.price);
    expect(long.bid!.price).toBeLessThan(flat.bid!.price);
    expect(long.bid!.size).toBeLessThan(flat.bid!.size);
    expect(long.ask!.size).toBe(flat.ask!.size);
  });

  it('betters the best price by a tick when calm and the spread has room, stops at the fee on a one-tick book, and keeps its distance in a storm, under a reflex, or when adding past half the cap', () => {
    const wide = { ...base, bestBid: 84_990, bestAsk: 85_010 }; // 2.4 bps wide, like mainnet ETH: one tick inside the best price, first in line
    const w = computeQuotes(wide);
    expect([w.bid!.price, w.ask!.price]).toEqual([84_990.1, 85_009.9]);
    expect(w.touch).toEqual({ bid: true, ask: true });
    const tight = computeQuotes({ ...base, bestBid: 84_999.9, bestAsk: 85_000 }); // one tick wide, like mainnet BTC: the fee floor (0.45 bps) stops short of the touch
    expect([tight.bid!.price, tight.ask!.price]).toEqual([84_996.1, 85_003.9]);
    expect(tight.touch).toEqual({ bid: false, ask: false });
    expect(computeQuotes({ ...wide, gov: { ...wide.gov, spread_mult: 2.5 } }).bid!.price).toBeLessThan(84_980);
    const widened = computeQuotes({ ...wide, reflex: { side: 'ask', action: 'widen' } });
    expect(widened.bid!.price).toBe(84_990.1);
    expect(widened.ask!.price).toBeGreaterThan(85_010);
    const long = computeQuotes({ ...wide, positionUsd: 300 }); // q 0.6: the bid adds, the ask sheds
    expect(long.bid!.price).toBeLessThan(84_980);
    expect(long.ask!.price).toBe(85_009.9);
  });

  it('leans with a trend and keeps the side that would add against it off the touch', () => {
    const wide = { ...base, bestBid: 84_990, bestAsk: 85_010 };
    const down = computeQuotes({ ...wide, trendBps: -12 }); // falling 12 bps over five minutes
    expect(down.skewTrendBps).toBeLessThan(0);
    expect(down.bid!.price).toBeLessThan(84_980); // the bid waits at the model's distance
    expect(down.ask!.price).toBe(85_009.9); // the ask still sits first in line
    expect(down.touch).toEqual({ bid: false, ask: true });
    expect(computeQuotes({ ...wide, trendBps: 2 }).skewTrendBps).toBe(0); // noise
    expect(computeQuotes({ ...wide, trendBps: 40 }).skewTrendBps).toBeCloseTo(4.45 / 2); // capped at half the half-spread
  });

  it('FR-ENG-5 skips the side that would breach max inventory', () => {
    expect(computeQuotes({ ...base, positionUsd: 500 }).bid).toBeNull();
    expect(computeQuotes({ ...base, positionUsd: -600 }).ask).toBeNull();
    expect(computeQuotes({ ...base, positionUsd: 500 }).ask).not.toBeNull();
  });

  it('leans with smart money: positive S lifts the centre', () => {
    expect(computeQuotes({ ...base, S: 2 }).center).toBeGreaterThan(computeQuotes(base).center);
    expect(computeQuotes({ ...base, S: 99 }).skewNanBps).toBe(4.5);
  });

  it('FR-ENG-4 never crosses the book', () => {
    const q = computeQuotes({ ...base, S: 3, gov: { ...base.gov, skew_bias_bps: 10 }, bestAsk: 85_001, bestBid: 85_000 });
    expect(q.bid!.price).toBeLessThan(85_001);
    const r = computeQuotes({ ...base, S: -3, gov: { ...base.gov, skew_bias_bps: -10 }, bestBid: 84_999.5, bestAsk: 85_000 });
    expect(r.ask!.price).toBeGreaterThan(84_999.5);
  });

  it('prices land on the tick grid', () => {
    const q = computeQuotes({ ...base, mark: 85_181.83, mid: null });
    expect(Math.abs(q.bid!.price * 10 - Math.round(q.bid!.price * 10))).toBeLessThan(1e-6);
    expect(Math.abs(q.ask!.price * 10 - Math.round(q.ask!.price * 10))).toBeLessThan(1e-6);
  });

  it('disabled governor quotes nothing', () => {
    const q = computeQuotes({ ...base, gov: { ...base.gov, enabled: false } });
    expect(q.bid).toBeNull();
    expect(q.ask).toBeNull();
  });
});

describe('FR-RFX reflex', () => {
  it('maps z to the threatened side', () => {
    expect(reflexTrigger(2.9, 0)).toEqual({ side: 'ask', action: 'pull' });
    expect(reflexTrigger(2.0, 0)).toEqual({ side: 'ask', action: 'widen' });
    expect(reflexTrigger(-2.6, 0)).toEqual({ side: 'bid', action: 'pull' });
    expect(reflexTrigger(-1.6, 0)).toEqual({ side: 'bid', action: 'widen' });
    expect(reflexTrigger(0.4, 0)).toBeNull();
    expect(reflexTrigger(0.1, -1)).toEqual({ side: 'bid', action: 'pull' });
  });

  it('pull removes the side, widen doubles its distance', () => {
    const pulled = computeQuotes({ ...base, reflex: { side: 'ask', action: 'pull' } });
    expect(pulled.ask).toBeNull();
    expect(pulled.bid).not.toBeNull();
    const normal = computeQuotes(base);
    const wide = computeQuotes({ ...base, reflex: { side: 'ask', action: 'widen' } });
    expect(wide.ask!.price - wide.center).toBeGreaterThan((normal.ask!.price - normal.center) * 1.9);
    expect(wide.bid!.price).toBe(normal.bid!.price);
  });

  it('holds for 5 minutes after the last trigger and never downgrades a pull', () => {
    const t0 = 1_000_000;
    const a = nextReflex(null, { side: 'ask', action: 'pull' }, t0, 2.9, ['0xa']);
    expect(a.changed).toBe(true);
    const b = nextReflex(a.state, { side: 'ask', action: 'widen' }, t0 + 60_000, 2.0, ['0xb']);
    expect(b.state!.action).toBe('pull');
    expect(b.changed).toBe(false);
    expect(b.state!.until).toBe(t0 + 60_000 + 300_000);
    const c = nextReflex(b.state, null, t0 + 200_000, 0, []);
    expect(c.state).not.toBeNull();
    // The pull runs out at t0 + 360 s and steps down to a widen for half a hold before letting go.
    const d = nextReflex(c.state, null, t0 + 361_000, 0, []);
    expect(d.state).toMatchObject({ action: 'widen', released: true, until: t0 + 361_000 + 150_000 });
    expect(d.changed).toBe(true);
    const e = nextReflex(d.state, null, t0 + 512_000, 0, []);
    expect(e.state).toBeNull();
    expect(e.changed).toBe(true);
  });

  it('a held side lets go only below 80% of its entry level', () => {
    const held = { side: 'ask' as const };
    expect(reflexTrigger(1.3, 0)).toBeNull();
    expect(reflexTrigger(1.3, 0, DEFAULT_CONFIG, held)).toEqual({ side: 'ask', action: 'widen' }); // 1.3 > 0.8 x 1.5
    expect(reflexTrigger(1.1, 0, DEFAULT_CONFIG, held)).toBeNull();
    expect(bookTrigger(0.7, DEFAULT_CONFIG, held)).toEqual({ side: 'ask', action: 'widen' }); // 0.7 > 0.8 x 0.8
    expect(bookTrigger(0.6, DEFAULT_CONFIG, held)).toBeNull();
  });

  it('a reference move runs into the side it is heading for: Hyperliquid up pulls the ask, a smaller move widens it', () => {
    expect(refTrigger(3.4)).toEqual({ side: 'ask', action: 'pull' });
    expect(refTrigger(-1.8)).toEqual({ side: 'bid', action: 'widen' });
    expect(refTrigger(0.9)).toBeNull();
  });

  it('the reflex state remembers which kind of trigger it came from, also when a held side is extended by another kind', () => {
    const t0 = 1_000_000;
    const short = { ...DEFAULT_CONFIG, reflexHoldMs: 6_000 };
    const ref = nextReflex(null, { side: 'ask', action: 'pull', ref: true }, t0, 3.2, [], short);
    expect(ref.state).toMatchObject({ side: 'ask', action: 'pull', ref: true, until: t0 + 6_000 });
    const book = nextReflex(null, { side: 'ask', action: 'widen', book: true }, t0, 0.85, [], { ...DEFAULT_CONFIG, reflexHoldMs: 60_000 });
    const extended = nextReflex(book.state, { side: 'ask', action: 'pull', ref: true }, t0 + 1_000, 3.5, [], short);
    expect(extended.state).toMatchObject({ action: 'pull', ref: true, until: t0 + 60_000 }); // the longer book hold stays, the kind is the reference move
    expect(extended.state!.book).toBeUndefined();
  });
});

describe('order-book reflex', () => {
  const lv = (...sizes: number[]) => sizes.map((size, i) => ({ price: 100 + i, size }));

  it('measures top-5 imbalance and ignores a one-sided book', () => {
    expect(bookImbalance(lv(3, 1), lv(1, 1))).toBeCloseTo(1 / 3);
    expect(bookImbalance(lv(1, 1, 1, 1, 1, 99), lv(1, 1, 1, 1, 1))).toBe(0); // level 6 is out of range
    expect(bookImbalance(lv(5), [])).toBe(0);
  });

  it('heavy bids widen the ask and never pull it, and the lean follows the heavy side', () => {
    expect(bookTrigger(0.9)).toEqual({ side: 'ask', action: 'widen' });
    expect(bookTrigger(-0.85)).toEqual({ side: 'bid', action: 'widen' });
    expect(bookTrigger(-0.75)).toBeNull(); // a merely lopsided Perpl book is normal
    expect(bookTrigger(0.6)).toBeNull();
    expect(computeQuotes({ ...base, book: 1 }).skewBookBps).toBe(2);
    expect(computeQuotes({ ...base, book: -0.5 }).center).toBeLessThan(computeQuotes(base).center);
  });

  it('a short book hold never cuts a longer smart-money hold', () => {
    const t0 = 1_000_000;
    const flow = nextReflex(null, { side: 'ask', action: 'pull' }, t0, 2.9, ['0xa']);
    const book = nextReflex(flow.state, { side: 'ask', action: 'widen', book: true }, t0 + 10_000, 0.6, [], { ...DEFAULT_CONFIG, reflexHoldMs: 60_000 });
    expect(book.state!.until).toBe(t0 + 300_000);
    expect(book.state!.action).toBe('pull');
  });
});

describe('Hyperliquid blend and volume cap', () => {
  it('centres halfway to Hyperliquid, and ignores a gap too wide to trust', () => {
    expect(computeQuotes({ ...base, hlMid: 85_020 }).ref).toBeCloseTo(85_010);
    expect(computeQuotes({ ...base, hlMid: 85_020 }).blendBps).toBeCloseTo(1.18, 1);
    expect(computeQuotes({ ...base, hlMid: 86_000 }).ref).toBe(85_000); // 118 bps away: bad data or a dislocation
    expect(computeQuotes({ ...base, hlMid: null }).ref).toBe(85_000);
  });
  it('caps each quote at a share of an average hour of volume', () => {
    const q = computeQuotes({ ...base, hourlyVolumeUsd: 600 }); // 5% = $30 < $100
    expect(q.sizeCapUsd).toBe(30);
    expect(q.bid!.size * q.bid!.price).toBeLessThanOrEqual(30);
    expect(computeQuotes({ ...base, hourlyVolumeUsd: 1e6 }).bid!.size * 85_000).toBeGreaterThan(99);
  });
});

describe('analytics', () => {
  const row = (o: Partial<Parameters<typeof analyticsOf>[0][number]>) => ({
    sym: 'BTC' as const, side: 'bid' as const, price: 100, size: 1, fee: 0.01, isMaker: true, ts: Date.UTC(2026, 9, 6, 14), regime: 'calm',
    realized: null, closes: null, halfBps: 4, markouts: [1, 1, 1, 2, 3], ...o,
  });
  it('a close at break-even counts in the win rate; rows from before the flag fall back to non-zero PnL', () => {
    const a = analyticsOf([row({ realized: 0, closes: true }), row({ realized: 0.5, closes: true }), row({ realized: 0, closes: null }), row({ realized: 0.3, closes: null })], 0, 1);
    expect(a.summary.winRate).toBeCloseTo(2 / 3); // the break-even close loses its fee
  });
  it('nets fees against realised PnL and buckets by market, regime, spread and hour', () => {
    const a = analyticsOf([row({}), row({ side: 'ask', realized: 0.5, halfBps: 12, regime: 'storm', markouts: [null, null, null, -4, null] }), row({ sym: 'ETH', realized: -0.2, isMaker: false })], 0, 1);
    expect(a.summary.fills).toBe(3);
    expect(a.summary.netUsd).toBeCloseTo(0.27);
    expect(a.summary.netBps).toBeCloseTo(9);
    expect(a.summary.winRate).toBe(0.5);
    expect(a.markouts.find((m) => m.horizon === '1m')).toEqual({ horizon: '1m', bps: -1, n: 2 });
    expect(a.bySpread.map((b) => b.key)).toEqual(['<5', '10-20']);
    expect(a.byRegime.map((b) => b.key)).toEqual(['calm', 'storm']);
    expect(a.hourly.find((c) => c.dow === 2 && c.hour === 14)!.fills).toBe(3);
    expect(a.daily).toEqual([{ day: '2026-10-06', volumeUsd: 300, netUsd: expect.closeTo(0.27) }]);
  });
});

describe('FR-ENG-3 requote rule', () => {
  it('ignores small drift, reacts to large drift and size changes', () => {
    const live = { price: 85_000, size: 0.001 };
    expect(shouldRequote(live, { price: 85_005, size: 0.001 }, 4.45, 0.1)).toBe(false); // 0.59 bps < 0.3h
    expect(shouldRequote(live, { price: 85_020, size: 0.001 }, 4.45, 0.1)).toBe(true);
    expect(shouldRequote(live, { price: 85_000, size: 0.0007 }, 4.45, 0.1)).toBe(true);
    expect(shouldRequote(live, null, 4.45, 0.1)).toBe(true);
    expect(shouldRequote(null, null, 4.45, 0.1)).toBe(false);
  });

  it('a quote placed at the front of the book keeps its place a few ticks behind, and moves once clearly behind or buried', () => {
    const live = { price: 2_486.5, size: 0.02 };
    expect(touchRequote(live, 'bid', 2_486.5, 0)).toBe(false); // still the best
    expect(touchRequote(live, 'bid', 2_486.58, 500)).toBe(false); // 0.3 bps behind with $500 ahead: a requote would only lose the place in line
    expect(touchRequote(live, 'bid', 2_486.7, 500)).toBe(true); // 0.8 bps behind
    expect(touchRequote(live, 'bid', 2_486.58, 4_000)).toBe(true); // buried under $4k
    expect(touchRequote(live, 'ask', 2_486.3, 0)).toBe(true);
    expect(touchRequote(live, 'ask', null, 0)).toBe(false);
    // Ahead of a bid at 2486.5: the level above it plus the rest of its own level (its own 0.02 taken out).
    expect(depthAhead([{ price: 2_486.6, size: 1 }, { price: 2_486.5, size: 0.5 }, { price: 2_486.4, size: 9 }], 'bid', 2_486.5, 0.02)).toBeCloseTo(1.48);
    expect(depthAhead([{ price: 2_486.4, size: 9 }], 'bid', 2_486.5)).toBe(0); // inside the spread: nothing ahead
  });
});

describe('FR-GOV-2 regimes and clamps', () => {
  it('classifies regimes per the fallback table', () => {
    expect(regimeOf(0.5, 2, 2, false)).toBe('calm');
    expect(regimeOf(-1.2, 2, 2, false)).toBe('active');
    expect(regimeOf(2.6, 2, 2, false)).toBe('storm');
    expect(regimeOf(0, 9, 2, false)).toBe('storm');
    expect(regimeOf(3, 2, 2, true)).toBe('stale');
    expect(fallbackParams('BTC', 'active', -1.2, 500, true).skew_bias_bps).toBe(-2);
    expect(fallbackParams('BTC', 'active', -1.2, 500).skew_bias_bps).toBe(0); // no evidence, no lean (PRD 19.1)
  });

  it('clamps hostile parameters into bounds', () => {
    const p = clampParams(
      { market: 'BTC', enabled: true, spread_mult: 0.1, skew_bias_bps: 500, size_mult: 9, max_inventory_usd: 1e9, ttl_min: 999, regime: 'calm', reason: 'x'.repeat(999) },
      500, { lean: true },
    );
    expect(p).toMatchObject({ spread_mult: 1, skew_bias_bps: 10, size_mult: 1.5, max_inventory_usd: 500, ttl_min: 30 });
    expect(p.reason.length).toBe(280);
  });

  it('keeps the bias at zero without evidence and loosens one step at a time', () => {
    const p = { market: 'BTC' as const, enabled: true, spread_mult: 1, skew_bias_bps: 8, size_mult: 1.5, max_inventory_usd: 500, ttl_min: 15, regime: 'calm' as const, reason: 'x' };
    expect(clampParams(p, 500).skew_bias_bps).toBe(0);
    const stepped = clampParams(p, 500, { prev: { spread_mult: 3, size_mult: 0.4 } });
    expect([stepped.spread_mult, stepped.size_mult]).toEqual([2, 0.9]);
    expect(clampParams({ ...p, spread_mult: 4, size_mult: 0 }, 500, { prev: { spread_mult: 1, size_mult: 1 } })).toMatchObject({ spread_mult: 4, size_mult: 0 }); // tightening is immediate
  });
});

describe('FR-RSK-3 final risk gate', () => {
  const g = { side: 'bid' as const, target: { price: 85_000, size: 0.001 }, oracle: 85_000, mark: 85_000, positionSize: 0, otherUsd: 0, equityUsd: 1000, capUsd: 500, accountCapUsd: 1500, maxOrderUsd: 150, maxLeverage: 3, sizeStep: 0.00001 };
  it('blocks quotes outside the 1% oracle band', () => {
    expect(riskGate({ ...g, side: 'ask', target: { price: 86_000, size: 0.001 } })).toEqual({ reject: 'price_band' });
    expect(riskGate({ ...g, side: 'ask', target: { price: 85_040, size: 0.001 } })).toHaveProperty('target');
  });
  it('a governor cap of $10 stops a $50 order', () => {
    expect(riskGate({ ...g, target: { price: 85_000, size: 50 / 85_000 }, capUsd: 10 })).toEqual({ reject: 'max_inventory' });
  });
  it('counts other markets gross, and leverage across the account', () => {
    expect(riskGate({ ...g, otherUsd: 1_450 })).toEqual({ reject: 'max_account' }); // short ETH does not offset long BTC
    expect(riskGate({ ...g, positionSize: 250 / 85_000, equityUsd: 100 })).toEqual({ reject: 'max_leverage' });
  });
  it('always allows a reduction, and cuts one that would flip into a side over the cap', () => {
    const long = 480 / 85_000;
    expect(riskGate({ ...g, positionSize: long })).toEqual({ reject: 'max_inventory' });
    expect(riskGate({ ...g, side: 'ask', positionSize: long })).toHaveProperty('target');
    const flip = riskGate({ ...g, side: 'ask', positionSize: 0.0005, target: { price: 85_000, size: 0.01 }, capUsd: 100, maxOrderUsd: 1_000 });
    expect(flip).toEqual({ target: { price: 85_000, size: 0.0005 } }); // the reduction alone, not the $800 short
  });
});

describe('inventory lifecycle', () => {
  const p = { positionUsd: 100, capUsd: 500, ageMs: 0, unrealizedUsd: 0, dailyLossUsd: 50, inPolicy: true };
  it('moves from normal to reduce to urgent by size, age and open loss', () => {
    expect(inventoryStage(p)).toBe('normal');
    expect(inventoryStage({ ...p, positionUsd: -400 })).toBe('reduce');
    expect(inventoryStage({ ...p, ageMs: 25 * 60_000 })).toBe('reduce');
    expect(inventoryStage({ ...p, inPolicy: false })).toBe('reduce'); // dropped from the policy: work the exit
    expect(inventoryStage({ ...p, positionUsd: 700 })).toBe('urgent'); // limits lowered under the position
    expect(inventoryStage({ ...p, unrealizedUsd: -13 })).toBe('urgent');
  });
  it('stops adding, works the exit, and keeps the exit even when a reflex would pull it', () => {
    const long = { ...base, positionUsd: 400, positionBase: 400 / 85_000 };
    const normal = computeQuotes(long);
    const reduce = computeQuotes({ ...long, stage: 'reduce', reflex: { side: 'ask', action: 'pull' } });
    expect(reduce.bid).toBeNull();
    expect(reduce.ask).not.toBeNull(); // widened, not pulled
    const urgent = computeQuotes({ ...long, stage: 'urgent', reflex: { side: 'ask', action: 'pull' } });
    expect(urgent.ask!.price).toBe(85_004.9); // one tick inside the best ask
    expect(normal.ask!.price).toBe(85_004.9); // the exit side joins the front of the book as soon as there is a position to shed
    expect(reduce.ask!.price).toBeGreaterThan(normal.ask!.price); // widened by the reflex, not pulled
    const small = computeQuotes({ ...base, positionUsd: 20, positionBase: 20 / 85_000, stage: 'reduce' });
    expect(small.ask!.size).toBe(0.00023); // the position, rounded down to the size step: never a flip
  });
});

describe('request scheduler', () => {
  const now = 100_000;
  const mk = ['BTC', 'ETH', 'SOL'];
  it('serves risk first, then the longest wait, and rotates ties across markets', () => {
    const jobs = [
      { sym: 'BTC', side: 'bid' as const, prio: 4 as const, since: now },
      { sym: 'ETH', side: 'bid' as const, prio: 5 as const, since: now - 30_000 },
      { sym: 'SOL', side: 'ask' as const, prio: 1 as const, since: now },
      { sym: 'BTC', side: 'ask' as const, prio: 3 as const, since: now },
    ];
    expect(orderJobs(jobs, now, mk, 0).map((j) => `${j.sym}:${j.prio}`)).toEqual(['SOL:1', 'BTC:3', 'ETH:5', 'BTC:4']);
    const tie = mk.map((sym) => ({ sym, side: 'bid' as const, prio: 4 as const, since: now }));
    expect(orderJobs(tie, now, mk, 1)[0].sym).toBe('ETH');
    expect(orderJobs(tie, now, mk, 2)[0].sym).toBe('SOL');
  });
  it('never lets waiting routine work overtake risk work', () => {
    const old = { sym: 'ETH', side: 'bid' as const, prio: 5 as const, since: 0 };
    const risk = { sym: 'BTC', side: 'bid' as const, prio: 3 as const, since: now };
    expect(orderJobs([old, risk], now, mk, 0)[0]).toBe(risk);
  });
});

describe('FR-SIG-2 signal engine', () => {
  const now = 10_000_000_000;
  const trade = (ago: number, action: string, usd: number): SmartTrade => ({
    hash: `0x${ago}`, sym: 'BTC', action, side: 'Long', valueUsd: usd, priceUsd: 85_000, amount: usd / 85_000,
    type: 'Market', trader: '0xabc', label: 'Smart HL Perps Trader', ts: now - ago, fetchedAt: now,
  });

  it('signs actions', () => {
    expect(tradeSign({ action: 'Buy - Open Long', side: 'Long' })).toBe(1);
    expect(tradeSign({ action: 'Buy - Close Short', side: 'Short' })).toBe(1);
    expect(tradeSign({ action: 'Sell - Open Short', side: 'Short' })).toBe(-1);
    // Nansen's live format: the action alone has no direction, the side decides it.
    expect(tradeSign({ action: 'Open', side: 'Long' })).toBe(1);
    expect(tradeSign({ action: 'Add', side: 'Long' })).toBe(1);
    expect(tradeSign({ action: 'Close', side: 'Short' })).toBe(1);
    expect(tradeSign({ action: 'Reduce', side: 'Short' })).toBe(1);
    expect(tradeSign({ action: 'Open', side: 'Short' })).toBe(-1);
    expect(tradeSign({ action: 'Add', side: 'Short' })).toBe(-1);
    expect(tradeSign({ action: 'Close', side: 'Long' })).toBe(-1);
    expect(tradeSign({ action: 'Reduce', side: 'Long' })).toBe(-1);
    expect(tradeSign({ action: 'Liquidation', side: 'Long' })).toBe(0);
  });

  it('robust z ignores one whale in the baseline', () => {
    const baseline = Array.from({ length: 200 }, (_, i) => ((i * 37) % 21) - 10);
    const z = robustZ(20, baseline);
    expect(z).toBeLessThan(5); // below the cap, so the comparison means something
    expect(robustZ(20, [...baseline, 1e9])).toBeCloseTo(z, 0);
    expect(robustZ(5, [1, 1, 1])).toBe(0);
  });

  it('window sums roll correctly', () => {
    expect(windowSums([1, 2, 3, 4], 3)).toEqual([6, 9]);
    // Empty windows after real flow stay exactly 0, not float residue.
    expect(windowSums([0.1, 0.2, 0.3, 0, 0, 0], 3).slice(-1)).toEqual([0]);
  });

  it('sparse flow still scores: a bucket with flow stands out when most buckets are empty', () => {
    const sparse = Array.from({ length: 2016 }, (_, i) => (i % 3 === 0 ? ((i * 7919) % 41) * 1000 : 0));
    const z = robustZ(1_000_000, sparse);
    expect(z).toBe(5); // stands out, but capped
    expect(robustZ(-1_000_000, sparse)).toBe(-5);
    expect(robustZ(0, sparse)).toBe(0);
    expect(robustZ(5, Array(20).fill(0))).toBe(0);
  });

  it('computes flow, imbalance and a positive S on a buy burst', () => {
    const buckets = Array.from({ length: 2016 }, (_, i) => (((i * 7919) % 41) - 20) * 1000);
    const trades = [trade(60_000, 'Buy - Open Long', 400_000), trade(120_000, 'Buy - Add Long', 240_000), trade(50 * 60_000, 'Sell - Open Short', 30_000)];
    const s = computeSignal('BTC', trades, buckets, now, false);
    expect(s.w5.netUsd).toBe(640_000);
    expect(s.w5.imbalance).toBe(1);
    expect(s.w60.netUsd).toBe(610_000);
    expect(s.w5.z).toBeGreaterThan(2.5);
    expect(s.S).toBeGreaterThan(2.5);
    expect(computeSignal('BTC', trades, buckets, now, true).S).toBe(0);
  });
});

describe('evidence statistics', () => {
  it('spearman is rank based', () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 5000])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it('deciles are ordered by x', () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const d = decileMeans(x, x.map((v) => v * 2));
    expect(d).toHaveLength(10);
    expect(d[0].meanY).toBeLessThan(d[9].meanY);
  });
  it('markout sign follows the maker', () => {
    expect(markoutBps('bid', 100, 100.1)).toBeCloseTo(10);
    expect(markoutBps('ask', 100, 100.1)).toBeCloseTo(-10);
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe('FR-POL-2 policy sizing', () => {
  it('needs the margin for full inventory at leverage plus the daily loss', () => {
    expect(balanceNeededUsd(PRESETS.conservative, 1)).toBe(150);
    expect(balanceNeededUsd(PRESETS.balanced, 3)).toBe(550);
    expect(balanceNeededUsd(PRESETS.high, 1)).toBe(100); // the point of 10x: Balanced sizes on far less collateral
    expect(marginFloorUsd(PRESETS.high, 3)).toBe(150);
  });
  it('sizes from margin and leverage without needing more than the margin', () => {
    for (const [margin, lev, n] of [[100, 10, 1], [250, 15, 3], [37, 2.5, 2]] as const) {
      const l = limitsFromMargin(margin, lev, n);
      expect(balanceNeededUsd(l, n)).toBeLessThanOrEqual(margin);
      expect(l.maxLeverage).toBe(lev);
    }
    expect(limitsFromMargin(100, 10, 1)).toMatchObject({ maxDailyLossUsd: 10, maxInventoryUsd: 900, quoteSizeUsd: 90 });
  });
  it('shrinks any preset to fit small balances and the caps, never past either', () => {
    const caps = { quoteSizeUsd: 50, maxInventoryUsd: 250, maxDailyLossUsd: 25 };
    for (const base of Object.values(PRESETS)) {
      for (const [bal, n] of [[100, 1], [10, 1], [25.29, 1], [100, 3], [57.3, 2]] as const) {
        const l = fitLimits(base, bal, n, caps);
        expect(balanceNeededUsd(l, n)).toBeLessThanOrEqual(bal);
        expect(l.quoteSizeUsd).toBeLessThanOrEqual(Math.min(l.maxInventoryUsd, caps.quoteSizeUsd));
        expect(l.maxInventoryUsd).toBeLessThanOrEqual(caps.maxInventoryUsd);
        expect(Math.min(l.quoteSizeUsd, l.maxInventoryUsd, l.maxDailyLossUsd)).toBeGreaterThanOrEqual(1); // the server's floors
        expect(l.maxLeverage).toBe(base.maxLeverage);
      }
    }
    expect(fitLimits(PRESETS.conservative, 100, 1)).toMatchObject({ quoteSizeUsd: 16, maxInventoryUsd: 166, maxDailyLossUsd: 16 });
    expect(fitLimits(PRESETS.conservative, 25.29, 1, caps)).toMatchObject({ quoteSizeUsd: 4, maxInventoryUsd: 42, maxDailyLossUsd: 4 });
    expect(fitLimits(PRESETS.conservative, 5_000, 1)).toBe(PRESETS.conservative);
    expect(fitLimits(PRESETS.balanced, 5_000, 1, caps)).toMatchObject({ quoteSizeUsd: 25, maxInventoryUsd: 250, maxDailyLossUsd: 25 });
  });
});

describe('Perpl stats', () => {
  it('matches the SDK liquidation price', () => {
    // Long 1 BTC from 100,000 with 10,000 posted at 25x maintenance: MMR 4,000, so 6,000 of room.
    expect(liquidationPrice(true, 100_000, 1, 10_000, 0, 25)).toBe(94_000);
    expect(liquidationPrice(false, 100_000, 1, 10_000, 0, 25)).toBe(106_000);
    expect(liquidationPrice(true, 100_000, 1, 10_000, 1_000, 25)).toBe(93_000); // funding received adds room
    expect(liquidationPrice(true, 100, 1, 1_000, 0, 25)).toBe(0); // over-collateralised long never liquidates
  });

  it('scores a wallet from its trades', () => {
    const t = (ts: number, kind: PxTrade['kind'], pnl: number, fee = 1, sym = 'BTC'): PxTrade => ({
      ts, block: ts, idx: 0, sym, role: 'taker', kind, side: 'buy', long: true, price: 100, size: 1, usd: 100, fee, pnl, funding: 0,
    });
    const p = walletPerformance([
      t(0, 'open', 0), t(60_000, 'close', 21), // +20
      t(120_000, 'open', 0), t(180_000, 'decrease', -9), t(240_000, 'close', -9), // -10, -10
      t(300_000, 'open', 0, 1, 'ETH'), t(420_000, 'close', 6, 1, 'ETH'), // +5
    ]);
    expect(p.closes).toBe(4);
    expect(p.winRate).toBe(0.5);
    expect(p.profitFactor).toBeCloseTo(25 / 20);
    expect(p.netUsd).toBe(2); // 21 - 9 - 9 + 6 = 9 price PnL, minus 7 fees
    expect(p.longestLoss).toBe(2);
    expect(p.longestWin).toBe(1);
    expect(p.maxDrawdownUsd).toBe(22); // peak +19 after the first close, trough -3 after the second loss
    expect(p.avgHoldMin).toBeCloseTo((1 + 2 + 2) / 3);
    expect(p.byMarket.map((m) => m.sym)).toEqual(['ETH', 'BTC']);
    // No losing close: no finite profit factor, and it must survive JSON as null rather than Infinity.
    const clean = walletPerformance([t(0, 'open', 0, 0), t(60_000, 'close', 5, 0)]);
    expect([clean.profitFactor, clean.winRate]).toEqual([null, 1]);
  });

  it('finds the block ranges never scanned, back to block 0', () => {
    const ranges = [{ lo: 500, hi: 900 }, { lo: 0, hi: 100 }, { lo: 100, hi: 200 }];
    expect(holesOf(ranges, 900)).toEqual([{ lo: 200, hi: 500 }]);
    expect(holesOf(ranges, 300)).toEqual([{ lo: 200, hi: 300 }]);
    expect(holesOf([{ lo: 50, hi: 80 }], 80)).toEqual([{ lo: 0, hi: 50 }]); // history before the first scan is missing
    expect(holesOf([], 10)).toEqual([{ lo: 0, hi: 10 }]);
  });

  it('a gap in the middle stays partial even when the indexer is at the head; a scanned day without events is full', () => {
    const D = 86_400_000;
    const c = { start: 0, end: 10 * D, gaps: [{ from: 4 * D, to: 6 * D + D / 2 }] };
    expect(spanCoverage(0, D, c)).toBe('full'); // first day: events or not, it was scanned
    expect(spanCoverage(9 * D, 10 * D, c)).toBe('full'); // last day
    expect(spanCoverage(4 * D, 5 * D, c)).toBe('none');
    expect(spanCoverage(6 * D, 7 * D, c)).toBe('partial');
    expect(spanCoverage(0, 10 * D, c)).toBe('partial'); // the whole history is not complete
    expect(spanCoverage(10 * D, 11 * D, c)).toBe('none'); // past what was scanned
    expect(spanCoverage(0, D, { start: null, end: 0, gaps: [] })).toBe('none');
  });

  it('counts every period in whole UTC days, today included, before, at and after midnight', () => {
    const D = 86_400_000, oct10 = Date.UTC(2026, 9, 10) / D;
    expect(windowStartDay(Date.UTC(2026, 9, 9, 23, 59), 7)).toBe(oct10 - 7); // 3..9 Oct
    expect(windowStartDay(Date.UTC(2026, 9, 10, 0, 0), 7)).toBe(oct10 - 6); // 4..10 Oct
    expect(windowStartDay(Date.UTC(2026, 9, 10, 5, 0), 7)).toBe(oct10 - 6);
    expect(windowStartDay(Date.UTC(2026, 9, 10, 5, 0), 1)).toBe(oct10);
  });

  it('calibrates a candle series off by a power of ten, and leaves real differences alone', () => {
    expect(candleScale(7_764_931, 771_291)).toBe(10); // ETH on mainnet, 2026-10-10
    expect(candleScale(6_429_455, 6_306_937)).toBe(1); // BTC
    expect(candleScale(3_000_000, 1_000_000)).toBe(1); // 3x is not a unit error
    expect(candleScale(50_000, 5_000)).toBe(1); // too thin to compare
  });

  it('thins a long series to at most n points, keeping both ends', () => {
    const p = Array.from({ length: 1000 }, (_, i) => i);
    const out = thin(p, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect([out[0], out.at(-1)]).toEqual([0, 999]);
    expect(thin([1, 2], 5)).toEqual([1, 2]);
  });
});

describe('sign-in return path', () => {
  it('returns to a page on this site and nowhere else', () => {
    expect(safeReturnPath('/analytics/monday')).toBe('/analytics/monday');
    expect(safeReturnPath('/app?x=1')).toBe('/app?x=1');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/javascript:alert(1)', 'analytics', '/a b', '', null]) expect(safeReturnPath(bad)).toBeNull();
  });
});

describe('exits in profit, and no touch quote past Hyperliquid (2026-10-10)', () => {
  const wide = { ...base, bestBid: 84_990, bestAsk: 85_010 };
  it('keeps a touch quote off the side Hyperliquid has already moved past', () => {
    const up = computeQuotes({ ...wide, hlMid: 85_010 }); // Hyperliquid 1.2 bps above Perpl: the ask would be lifted
    expect(up.ask!.price).toBe(85_013.9); // Hyperliquid's mid plus the maker fee, not one tick inside Perpl's ask
    expect(up.touch.ask).toBe(false);
    expect(up.bid!.price).toBe(84_990.1); // the side Hyperliquid moved away from still joins
    const down = computeQuotes({ ...wide, hlMid: 84_990 });
    expect(down.bid!.price).toBe(84_986.1);
    expect(down.ask!.price).toBe(85_009.9);
    expect(computeQuotes(wide).ask!.price).toBe(85_009.9); // no Hyperliquid mid: unchanged
  });
  it('rests the exit at the entry plus both fees and a basis point until the urgent stage', () => {
    const long = { ...wide, positionUsd: 300, positionBase: 300 / 85_000 };
    expect(computeQuotes({ ...long, entryPrice: 85_100 }).ask!.price).toBe(85_116.2); // 85,100 x (1 + 1.9 bps)
    expect(computeQuotes({ ...long, entryPrice: 84_900 }).ask!.price).toBe(85_009.9); // already in profit: the market price stands
    expect(computeQuotes({ ...long, entryPrice: 85_100, stage: 'urgent' }).ask!.price).toBe(85_009.9); // urgent gets out at the market
    const short = { ...wide, positionUsd: -300, positionBase: -300 / 85_000 };
    expect(computeQuotes({ ...short, entryPrice: 84_900 }).bid!.price).toBe(84_883.8); // 84,900 x (1 - 1.9 bps)
    expect(computeQuotes({ ...short, entryPrice: 84_900, stage: 'reduce' }).bid!.price).toBe(84_883.8);
    expect(computeQuotes({ ...long, entryPrice: 85_100 }).bid).not.toBeNull(); // the adding side is unchanged
  });
});
