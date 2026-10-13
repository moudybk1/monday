import { describe, expect, it } from 'vitest';
import type { MarketSpec, MarketSym, PlanInput, TradeInput, TwapInput } from '@monday/core';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '', ENVIO_API_TOKEN: '' });
const { PlanBook } = await import('./plans');
const { SimVenue } = await import('./venue/sim');
const { upsertUser } = await import('./db');

const BTC: MarketSpec = { sym: 'BTC', marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15, maintLeverage: 25 };

/** One market whose price the test moves; the book is a tick either side of it. */
function world(start = 60_000) {
  let px = start;
  const snapshot = (sym: MarketSym) => (sym === 'BTC' ? {
    sym, mark: px, oracle: px, mid: px, bestBid: px - 0.1, bestAsk: px + 0.1, bids: [], asks: [], fundingRate: 0, openInterest: 0, updatedAt: Date.now(),
  } : null);
  const market = { snapshot, specs: () => ({ BTC }), price: () => px };
  const feed = { ...market, start: async () => {}, stop: () => {}, candles: async () => [] };
  return { market, feed, move: (to: number) => void (px = to) };
}

async function setup(start?: number) {
  const w = world(start);
  const v = new SimVenue(w.market, { wallet: `0x${'a'.repeat(39)}${Math.floor(Math.random() * 9)}`, accountId: 1, token: 't', secret: 's' }, () => {});
  await v.connect();
  const alerts: string[] = [];
  const book = new PlanBook(upsertUser(`0x${Math.random().toString(16).slice(2).padEnd(40, '0')}`), w.feed as never, () => v, (_s, m) => void alerts.push(m));
  v.on('fill', (f) => {
    const id = book.claim(f);
    if (id != null) book.onFill(f, id);
  });
  let now = Date.now();
  /** One second of the world: the venue checks its orders, the plans step, pending requests settle. */
  const tick = async (seconds = 1) => {
    for (let i = 0; i < seconds; i++) {
      now += 1_000;
      v.checkOrders();
      book.tick(now);
      for (let j = 0; j < 5; j++) await new Promise((r) => setImmediate(r));
    }
  };
  const create = async (p: PlanInput) => {
    const view = book.create(p, []);
    for (let j = 0; j < 5; j++) await new Promise((r) => setImmediate(r));
    return view;
  };
  return { ...w, v, book, tick, create, alerts, plan: () => book.views()[0] };
}

const trade = (o: Partial<TradeInput> = {}): TradeInput => ({ kind: 'trade', sym: 'BTC', bias: 'long', marginUsd: 100, leverage: 5, entry: 'market', entryPrice: null, expiryHours: 24, stopLossPct: 2, takeProfitPct: 4, ...o });

describe('Agentic Trade', () => {
  it('enters at market, rests its stop loss and take profit, and ends at the take profit with the stop dropped', async () => {
    const t = await setup();
    await t.create(trade());
    expect(t.v.position('BTC').size).toBeCloseTo(0.00833, 8);
    await t.tick(3); // stop loss, then take profit
    let p = t.plan();
    expect(p.status).toBe('open');
    expect(p.slPrice).toBe(58_800.1); // 2% under the fill at the ask, 60,000.1, on the 0.1 tick
    expect(p.stopOnVenue && p.takeOnVenue).toBe(true);
    t.move(62_500);
    await t.tick(2);
    p = t.plan();
    expect(t.v.position('BTC').size).toBe(0);
    expect(p.status).toBe('done');
    expect(p.outcome).toBe('take_profit');
    expect(p.realizedUsd).toBeGreaterThan(0);
    expect(p.stopOnVenue).toBe(false);
  });

  it('closes at the stop loss for a short', async () => {
    const t = await setup();
    await t.create(trade({ bias: 'short' }));
    await t.tick(3);
    t.move(61_500);
    await t.tick(2);
    expect(t.plan()).toMatchObject({ status: 'done', outcome: 'stop_loss' });
    expect(t.v.position('BTC').size).toBe(0);
  });

  it('rests a limit below the price, fills as maker when the price comes down, then protects it', async () => {
    const t = await setup();
    await t.create(trade({ entry: 'limit', entryPrice: 59_700 }));
    await t.tick(1);
    expect(t.plan().status).toBe('waiting');
    expect(t.v.position('BTC').size).toBe(0);
    t.move(59_650);
    await t.tick(3);
    const p = t.plan();
    expect(p.status).toBe('open');
    expect(p.avgEntry).toBe(59_700);
    expect(p.slPrice).toBe(58_506);
    expect(p.stopOnVenue).toBe(true);
  });

  it('waits for a breakout above the level before entering', async () => {
    const t = await setup();
    await t.create(trade({ entry: 'stop', entryPrice: 60_500 }));
    await t.tick(2);
    expect(t.v.position('BTC').size).toBe(0);
    t.move(60_520);
    await t.tick(3);
    expect(t.v.position('BTC').size).toBeGreaterThan(0);
    expect(t.plan()).toMatchObject({ status: 'open', stopOnVenue: true });
  });

  it('cancelling a waiting plan leaves nothing behind; cancelling an open one with close flattens it', async () => {
    const t = await setup();
    const w = await t.create(trade({ entry: 'limit', entryPrice: 59_700 }));
    await t.tick(1);
    await t.book.cancel(w.id, false);
    expect(t.plan()).toMatchObject({ status: 'done', outcome: 'cancelled' });
    const o = await t.create(trade());
    await t.tick(3);
    await t.book.cancel(o.id, true);
    await t.tick(2);
    expect(t.v.position('BTC').size).toBe(0);
    expect(t.book.views().find((p) => p.id === o.id)).toMatchObject({ status: 'done', outcome: 'closed' });
  });

  it('places the stop loss again when it disappears from the book', async () => {
    const t = await setup();
    await t.create(trade());
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
