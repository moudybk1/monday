import { describe, expect, it } from 'vitest';
import type { Bar, MarketSpec, MarketSym, PlanInput, TradeInput, TwapInput } from '@monday/core';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '', ENVIO_API_TOKEN: '' });
const { PlanBook } = await import('./plans');
const { SimVenue } = await import('./venue/sim');
const { upsertUser } = await import('./db');

const BTC: MarketSpec = { sym: 'BTC', marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15, maintLeverage: 25 };
const line = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + step * i);

/** Bars of `res` seconds ending with the last one closed before `to`; each opens at the previous close and wicks `wick` each way. */
function series(res: number, to: number, closes: number[], wick = 0.3): Bar[] {
  const ms = res * 1000;
  const last = Math.floor(to / ms) * ms - ms;
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { t: last - (closes.length - 1 - i) * ms, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c };
  });
}

/**
 * One market whose price the test moves; the book is a tick either side of it. D1 and H4 trend as `htf` says; the
 * trigger timeframe shows an uptrend that dipped to its 20 EMA and closed back above it: a follow long, 188 under the
 * start price, on 5m bars about 0.09% wide, wide enough for a target to clear the fees. `k` scales the bars.
 */
function world(start = 60_000, htf: 'up' | 'down' | 'mixed' = 'up', k = 40) {
  let px = start;
  const snapshot = (sym: MarketSym) => (sym === 'BTC' ? {
    sym, mark: px, oracle: px, mid: px, bestBid: px - 0.1, bestAsk: px + 0.1, bids: [], asks: [], fundingRate: 0, openInterest: 0, updatedAt: Date.now(),
  } : null);
  const pullback = [...line(start - 30 * k, 0.5 * k, 60), start - 5.5 * k, start - 4.7 * k];
  const candles = async (_sym: MarketSym, _from: number, to: number, res = 60) => {
    if (res === 86_400) return series(res, to, htf === 'down' ? line(70_000, -150, 60) : line(50_000, 150, 60));
    if (res === 14_400) return series(res, to, htf === 'up' ? line(55_000, 80, 60) : line(65_000, -80, 60));
    return series(res, to, pullback, 0.3 * k);
  };
  const market = { snapshot, specs: () => ({ BTC }), price: () => px };
  const feed = { ...market, start: async () => {}, stop: () => {}, candles };
  return { market, feed, move: (to: number) => void (px = to) };
}

async function setup(start?: number, htf?: 'up' | 'down' | 'mixed', k?: number) {
  const w = world(start, htf, k);
  const v = new SimVenue(w.market, { wallet: `0x${Math.random().toString(16).slice(2).padEnd(40, 'a')}`, accountId: 1, token: 't', secret: 's' }, () => {});
  await v.connect();
  const alerts: string[] = [];
  const book = new PlanBook(upsertUser(`0x${Math.random().toString(16).slice(2).padEnd(40, '0')}`), w.feed as never, () => v, (_s, m) => void alerts.push(m));
  v.on('fill', (f) => {
    const id = book.claim(f);
    if (id != null) book.onFill(f, id);
  });
  let now = Date.now();
  const settle = async () => {
    for (let j = 0; j < 8; j++) await new Promise((r) => setImmediate(r));
  };
  /** Seconds of the world: the venue checks its orders, the plans step, pending requests settle. */
  const tick = async (seconds = 1) => {
    for (let i = 0; i < seconds; i++) {
      now += 1_000;
      v.checkOrders();
      book.tick(now);
      await settle();
    }
  };
  const create = async (p: PlanInput) => {
    const view = book.create(p, []);
    await settle();
    return view;
  };
  return { ...w, v, book, tick, create, alerts, plan: () => book.views()[0], at: () => now };
}

const trade = (o: Partial<TradeInput> = {}): TradeInput => ({ kind: 'trade', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, frame: '5m', lossLimitPct: 20, profitTargetPct: 30, expiryHours: 24, ...o });

describe('Agentic Trade: a scalping session', () => {
  it('reads D1 and H4, rests a maker entry on the trigger, protects the fill, and books the scalp at its target', async () => {
    const t = await setup();
    await t.create(trade());
    await t.tick(3); // read the higher timeframes, then the trigger bar
    let p = t.plan();
    expect(p.scalp).toMatchObject({ d1: 'bullish', h4: 'bullish', market: 'bullish', mode: 'follow' });
    expect(p.status).toBe('entering');
    expect(p.avgEntry).toBe(59_812); // the signal bar's close, under the touch: a maker entry
    expect(t.v.position('BTC').size).toBe(0);
    t.move(59_811); // the price comes down to it
    await t.tick(3);
    p = t.plan();
    expect(p.status).toBe('open');
    expect(t.v.position('BTC').size).toBeCloseTo(0.00835, 8); // $500 at 59,812
    expect(p.stopOnVenue && p.takeOnVenue).toBe(true);
    // 1.5 ranges up, 1 range down; each rounded to the 0.1 tick on its own.
    expect(Math.abs(p.tpPrice! - 59_812 - 1.5 * (p.avgEntry! - p.slPrice!))).toBeLessThanOrEqual(0.15);
    t.move(p.tpPrice! + 0.5);
    await t.tick(3);
    p = t.plan();
    expect(t.v.position('BTC').size).toBe(0);
    expect(p.scalp).toMatchObject({ scalps: 1, wins: 1, losses: 0 });
    expect(p.status).toBe('waiting'); // and goes on to the next setup
    expect(p.scalp!.sessionPnl).toBeGreaterThan(0);
  });

  it('ends the session once its loss reaches the share of the margin set', async () => {
    const t = await setup();
    await t.create(trade({ leverage: 15, lossLimitPct: 1 })); // $1 of a $100 margin
    await t.tick(3);
    t.move(59_811);
    await t.tick(3);
    expect(t.v.position('BTC').size).toBeGreaterThan(0);
    t.move(59_650); // a gap through the stop
    await t.tick(6);
    const p = t.plan();
    expect(t.v.position('BTC').size).toBe(0);
    expect(p).toMatchObject({ status: 'done', outcome: 'stop_loss' });
    expect(p.note).toMatch(/Session loss limit reached/);
  });

  it('waits while D1 and H4 disagree, and calls a long against both a counter trade', async () => {
    const mixed = await setup(60_000, 'mixed');
    await mixed.create(trade());
    await mixed.tick(5);
    expect(mixed.plan().note).toMatch(/waiting until both point the same way/);
    expect(mixed.plan().status).toBe('waiting');
    const counter = await setup(60_000, 'down');
    await counter.create(trade());
    await counter.tick(3);
    expect(counter.plan().scalp?.mode).toBe('counter');
    expect(counter.plan().status).toBe('waiting'); // the pullback pattern is not a counter setup
  });

  it('Stop takes no new scalp but lets the open one run to its exit; Close closes it now', async () => {
    const t = await setup();
    const a = await t.create(trade());
    await t.tick(3);
    t.move(59_811);
    await t.tick(3);
    await t.book.cancel(a.id, false);
    await t.tick(2);
    expect(t.v.position('BTC').size).toBeGreaterThan(0); // still open, still protected
    expect(t.plan().stopOnVenue).toBe(true);
    t.move(t.plan().tpPrice! + 0.5);
    await t.tick(4);
    expect(t.plan()).toMatchObject({ status: 'done', outcome: 'cancelled' });
    const u = await setup();
    const b = await u.create(trade());
    await u.tick(3);
    u.move(59_811);
    await u.tick(3);
    await u.book.cancel(b.id, true);
    await u.tick(4);
    expect(u.v.position('BTC').size).toBe(0);
    expect(u.plan()).toMatchObject({ status: 'done', outcome: 'closed' });
  });

  it('skips a setup whose target would not clear the fees', async () => {
    const t = await setup(60_000, 'up', 1); // the same pattern on bars 40 times smaller: a 0.004% target
    await t.create(trade());
    await t.tick(3);
    expect(t.plan().status).toBe('waiting');
    expect(t.plan().note).toMatch(/does not clear .* of fees 3 times/);
  });

  it('places the stop loss again when it disappears from the book', async () => {
    const t = await setup();
    await t.create(trade());
    await t.tick(3);
    t.move(59_811);
    await t.tick(3);
    await t.v.cancelAll(false); // someone pulled every order on the account
    expect(t.plan().stopOnVenue).toBe(false);
    await t.tick(3);
    expect(t.plan().stopOnVenue).toBe(true);
  });
});

describe('TWAP', () => {
  const twap = (o: Partial<TwapInput> = {}): TwapInput => ({ kind: 'twap', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, durationMin: 5, slices: 5, style: 'aggressive', limitPrice: null, stopLossPct: 2, takeProfitPct: null, ...o });

  it('buys in slices on the schedule and protects the position from the first fill', async () => {
    const t = await setup();
    await t.create(twap());
    await t.tick(2);
    const first = t.v.position('BTC').size;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.00833);
    expect(t.plan().stopOnVenue).toBe(true);
    await t.tick(5 * 60);
    const p = t.plan();
    expect(p.status).toBe('open');
    expect(p.twap?.slicesDone).toBe(5);
    expect(t.v.position('BTC').size).toBeCloseTo(0.00833, 8);
    expect(p.slPrice).toBe(58_800); // from the arrival price
  });

  it('closing mid-way stops the slices and ends the plan once flat', async () => {
    const t = await setup();
    const w = await t.create(twap({ durationMin: 10, slices: 5 }));
    await t.tick(3);
    expect(t.v.position('BTC').size).toBeGreaterThan(0);
    await t.book.cancel(w.id, true);
    await t.tick(3);
    expect(t.plan()).toMatchObject({ status: 'done', outcome: 'closed' });
    await t.tick(10 * 60);
    expect(t.v.position('BTC').size).toBe(0); // no slice after the close
  });

  it('skips slices past the limit price and stops entering when the stop loss closes the position', async () => {
    const t = await setup();
    await t.create(twap({ limitPrice: 59_000 }));
    await t.tick(70);
    expect(t.v.position('BTC').size).toBe(0);
    expect(t.plan().note).toMatch(/past your limit/);
    const u = await setup();
    await u.create(twap({ durationMin: 10, slices: 5 }));
    await u.tick(3);
    u.move(58_000);
    await u.tick(3);
    expect(u.plan()).toMatchObject({ status: 'done', outcome: 'stop_loss' });
    await u.tick(10 * 60);
    expect(u.v.position('BTC').size).toBe(0); // no more slices after the stop
  });
});

describe('Balance', () => {
  it('a plan gets only what is left: the market maker\'s hold and the running plans\' margins come off the balance', async () => {
    const t = await setup();
    const bal = t.v.account().balanceUsd;
    // The market maker holds half: a plan asking for 60% is refused, and the error names what is left.
    expect(() => t.book.create(trade({ marginUsd: bal * 0.6 }), [], bal * 0.5)).toThrow(`More than the $${(bal * 0.5).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} still free`);
    // With the market maker holding nothing, the same plan fits.
    await t.create(trade({ marginUsd: bal * 0.6 }));
    expect(t.plan()).toMatchObject({ status: 'waiting' });
  });
});
