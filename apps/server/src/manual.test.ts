import { describe, expect, it } from 'vitest';
import type { MarketSpec, MarketSym } from '@monday/core';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { GOVERNOR_LLM_PROVIDER: '', VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '', ENVIO_API_TOKEN: '' });
const { ManualDesk, ManualError } = await import('./manual');
const { SimVenue } = await import('./venue/sim');
const { upsertUser } = await import('./db');

const BTC: MarketSpec = { sym: 'BTC', marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15, maintLeverage: 25 };
const addr = () => `0x${Math.random().toString(16).slice(2).padEnd(40, 'b')}`;

async function setup() {
  let px = 60_000;
  const snapshot = (sym: MarketSym) => (sym === 'BTC' ? {
    sym, mark: px, oracle: px, mid: px, bestBid: px - 0.1, bestAsk: px + 0.1, bids: [], asks: [], fundingRate: 0, openInterest: 0, updatedAt: Date.now(),
  } : null);
  const market = { snapshot, specs: () => ({ BTC }), price: () => px };
  const feed = { ...market, start: async () => {}, stop: () => {}, candles: async () => [] };
  const v = new SimVenue(market, { wallet: addr(), accountId: 1, token: 't', secret: 's' }, () => {});
  await v.connect();
  const alerts: string[] = [];
  const desk = new ManualDesk(upsertUser(addr()), feed as never, () => v, (_s, m) => void alerts.push(m));
  const fills: string[] = [];
  v.on('fill', (f) => {
    if (desk.owns(f)) {
      fills.push(f.id);
      desk.onFill(f, false);
    }
  });
  const settle = async () => {
    for (let j = 0; j < 8; j++) await new Promise((r) => setImmediate(r));
  };
  const tick = async () => {
    v.checkOrders();
    desk.tick();
    await settle();
  };
  const ctx = { freeUsd: v.account().balanceUsd, taken: [] as MarketSym[], capNotionalUsd: null };
  return { v, desk, alerts, fills, tick, ctx, move: (to: number) => void (px = to) };
}

describe('Trade tab: orders placed by hand', () => {
  it('buys at the market, claims the fill, and rests the take profit and stop loss as reduce-only triggers', async () => {
    const t = await setup();
    const placed = await t.desk.place({ sym: 'BTC', side: 'bid', kind: 'market', size: 0.01, leverage: 5, tpPrice: 61_000, slPrice: 59_000 }, t.ctx);
    await t.tick();
    expect(t.v.position('BTC').size).toBeCloseTo(0.01);
    expect(t.fills.length).toBeGreaterThan(0);
    expect(placed.map((o) => o.role).sort()).toEqual(['sl', 'tp']);
    expect(t.desk.views().orders.every((o) => o.reduceOnly)).toBe(true);
    // The stop loss fires on the mark and closes the position; the take profit is dropped once nothing is left to close.
    t.move(58_900);
    await t.tick();
    await t.tick();
    expect(t.v.position('BTC').size).toBe(0);
    expect(t.desk.views().orders).toHaveLength(0);
  });

  it('rests a post-only limit, and cancels it', async () => {
    const t = await setup();
    const [o] = await t.desk.place({ sym: 'BTC', side: 'bid', kind: 'limit', size: 0.01, leverage: 3, price: 59_500 }, t.ctx);
    expect(o?.price).toBe(59_500);
    expect(t.desk.views().orders).toHaveLength(1);
    await t.desk.cancel(o!.key);
    expect(t.desk.views().orders).toHaveLength(0);
  });

  it('refuses what would go wrong: a crossing post-only, a stop on the wrong side, too little margin, a taken market', async () => {
    const t = await setup();
    const err = (p: Promise<unknown>) => p.then(() => null, (e) => e);
    expect(await err(t.desk.place({ sym: 'BTC', side: 'bid', kind: 'limit', size: 0.01, leverage: 3, price: 60_100 }, t.ctx))).toBeInstanceOf(ManualError);
    expect((await err(t.desk.place({ sym: 'BTC', side: 'bid', kind: 'stop', size: 0.01, leverage: 3, triggerPrice: 59_000 }, t.ctx)))?.field).toBe('triggerPrice');
    expect((await err(t.desk.place({ sym: 'BTC', side: 'bid', kind: 'market', size: 1, leverage: 1 }, { ...t.ctx, freeUsd: 100 })))?.field).toBe('size');
    expect((await err(t.desk.place({ sym: 'BTC', side: 'bid', kind: 'market', size: 0.01, leverage: 1 }, { ...t.ctx, taken: ['BTC'] })))?.status).toBe(409);
    expect((await err(t.desk.place({ sym: 'BTC', side: 'ask', kind: 'market', size: 0.01, leverage: 1, reduceOnly: true }, t.ctx)))?.field).toBe('reduceOnly');
  });

  it('closes a position at the market and drops its protective orders', async () => {
    const t = await setup();
    await t.desk.place({ sym: 'BTC', side: 'ask', kind: 'market', size: 0.02, leverage: 5 }, t.ctx);
    await t.tick();
    expect(t.v.position('BTC').size).toBeCloseTo(-0.02);
    await t.desk.protect('BTC', 59_000, 61_000, []);
    expect(t.desk.views().orders).toHaveLength(2);
    expect(await t.desk.closeAll([])).toEqual(['BTC']);
    await t.tick();
    expect(t.v.position('BTC').size).toBe(0);
    expect(t.desk.views().orders).toHaveLength(0);
  });
});
