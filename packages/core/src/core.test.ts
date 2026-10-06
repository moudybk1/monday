import { describe, expect, it } from 'vitest';
import {
  PRESETS, analyticsOf, liquidationPrice, walletPerformance, type PxTrade, balanceNeededUsd, canonicalJson, limitsFromMargin, marginFloorUsd, clampParams, limitsForBalance, computeQuotes, computeSignal, decileMeans, fallbackParams, markoutBps, nextReflex,
  preTradeReject, reflexTrigger, bookImbalance, bookTrigger, DEFAULT_CONFIG, regimeOf, robustZ, shouldRequote, spearman, tradeSign, windowSums,
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
    expect(q.halfBps).toBeCloseTo(4.45);
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
    const flat = computeQuotes(base);
    const long = computeQuotes({ ...base, positionUsd: 250 });
    expect(long.ask!.price).toBeLessThan(flat.ask!.price);
    expect(long.bid!.price).toBeLessThan(flat.bid!.price);
    expect(long.bid!.size).toBeLessThan(flat.bid!.size);
    expect(long.ask!.size).toBe(flat.ask!.size);
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
    const d = nextReflex(c.state, null, t0 + 361_000, 0, []);
    expect(d.state).toBeNull();
    expect(d.changed).toBe(true);
  });
});

describe('order-book reflex', () => {
  const lv = (...sizes: number[]) => sizes.map((size, i) => ({ price: 100 + i, size }));

  it('measures top-5 imbalance and ignores a one-sided book', () => {
    expect(bookImbalance(lv(3, 1), lv(1, 1))).toBeCloseTo(1 / 3);
    expect(bookImbalance(lv(1, 1, 1, 1, 1, 99), lv(1, 1, 1, 1, 1))).toBe(0); // level 6 is out of range
    expect(bookImbalance(lv(5), [])).toBe(0);
  });

  it('heavy bids threaten the ask, and the lean follows the heavy side', () => {
    expect(bookTrigger(0.8)).toEqual({ side: 'ask', action: 'pull' });
    expect(bookTrigger(-0.6)).toEqual({ side: 'bid', action: 'widen' });
    expect(bookTrigger(0.3)).toBeNull();
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
    realized: null, halfBps: 4, markouts: [1, 1, 1, 2, 3], ...o,
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
});

describe('FR-GOV-2 regimes and clamps', () => {
  it('classifies regimes per the fallback table', () => {
    expect(regimeOf(0.5, 2, 2, false)).toBe('calm');
    expect(regimeOf(-1.2, 2, 2, false)).toBe('active');
    expect(regimeOf(2.6, 2, 2, false)).toBe('storm');
    expect(regimeOf(0, 9, 2, false)).toBe('storm');
    expect(regimeOf(3, 2, 2, true)).toBe('stale');
    expect(fallbackParams('BTC', 'active', -1.2, 500).skew_bias_bps).toBe(-2);
  });

  it('clamps hostile parameters into bounds', () => {
    const p = clampParams(
      { market: 'BTC', enabled: true, spread_mult: 0.1, skew_bias_bps: 500, size_mult: 9, max_inventory_usd: 1e9, ttl_min: 999, regime: 'calm', reason: 'x'.repeat(999) },
      500,
    );
    expect(p).toMatchObject({ spread_mult: 1, skew_bias_bps: 10, size_mult: 1.5, max_inventory_usd: 500, ttl_min: 30 });
    expect(p.reason.length).toBe(280);
  });
});

describe('FR-RSK-3 pre-trade checks', () => {
  const lim = { maxInventoryUsd: 500, maxLeverage: 3, quoteSizeUsd: 100 };
  it('blocks quotes outside the 1% oracle band', () => {
    expect(preTradeReject({ price: 86_000, size: 0.001 }, 'ask', 85_000, 0, 1000, lim)).toBe('price_band');
    expect(preTradeReject({ price: 85_040, size: 0.001 }, 'ask', 85_000, 0, 1000, lim)).toBeNull();
  });
  it('blocks growth past inventory and leverage but always allows reducing', () => {
    expect(preTradeReject({ price: 85_000, size: 0.001 }, 'bid', 85_000, 480, 1000, lim)).toBe('max_inventory');
    expect(preTradeReject({ price: 85_000, size: 0.001 }, 'ask', 85_000, 480, 1000, lim)).toBeNull();
    expect(preTradeReject({ price: 85_000, size: 0.001 }, 'bid', 85_000, 250, 100, lim)).toBe('max_leverage');
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
    const z = robustZ(40, baseline);
    expect(robustZ(40, [...baseline, 1e9])).toBeCloseTo(z, 0);
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
    expect(z).toBeGreaterThan(10);
    expect(Number.isFinite(z)).toBe(true);
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
    expect(limitsFromMargin(100, 10, 1)).toMatchObject({ maxDailyLossUsd: 10, maxInventoryUsd: 900, quoteSizeUsd: 180 });
  });
  it('shrinks limits to fit small balances and never exceeds them', () => {
    for (const [bal, n] of [[100, 1], [10, 1], [100, 3], [57.3, 2]] as const) {
      const l = limitsForBalance(bal, n);
      expect(balanceNeededUsd(l, n)).toBeLessThanOrEqual(bal);
      expect(l.quoteSizeUsd).toBeLessThanOrEqual(l.maxInventoryUsd);
      expect(l.maxLeverage).toBe(PRESETS.conservative.maxLeverage);
    }
    expect(limitsForBalance(100, 1)).toMatchObject({ quoteSizeUsd: 33, maxInventoryUsd: 166, maxDailyLossUsd: 16 });
    expect(limitsForBalance(5_000, 1)).toEqual(PRESETS.conservative);
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
  });
});
