import { afterEach, expect, it, vi } from 'vitest';
import { PRESETS, type MarketSym, type Policy } from '@monday/core';
import type { TapeTrade, VenueFill } from './venue/types';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_PROVIDER: 'anthropic', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '' });
const { Runner } = await import('./runner');
const { VenueError } = await import('./venue/types');
const { db, simStore, upsertUser } = await import('./db');
const { createPaperDriver } = await import('./venue/paper');
const { Collector } = await import('./collector');

const settle = () => new Promise((ok) => setImmediate(ok));
afterEach(() => void vi.useRealTimers());

/** A one-market Perpl feed with a tape the test prints to, behind the real paper venue and the SQLite account store. */
function paperWorld() {
  const listeners: ((t: TapeTrade) => void)[] = [];
  const spec = { sym: 'BTC' as const, marketId: 1, priceTick: 0.1, sizeStep: 0.0001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 10 };
  const book = { mark: 100_000, bestBid: 99_990, bestAsk: 100_010 };
  const feed = {
    start: async () => {}, stop() {}, candles: async () => [], specs: () => ({ BTC: spec }), onTrade: (cb: (t: TapeTrade) => void) => listeners.push(cb),
    snapshot: (sym: MarketSym) => (sym !== 'BTC' ? null : {
      sym, ...book, oracle: book.mark, mid: (book.bestBid + book.bestAsk) / 2, fundingRate: 0, openInterest: 0, updatedAt: Date.now(),
      bids: [{ price: book.bestBid, size: 1 }], asks: [{ price: book.bestAsk, size: 1 }],
    }),
  };
  const driver = createPaperDriver({ kind: 'perpl', feed } as never, simStore);
  return { driver, book, print: (t: TapeTrade) => listeners.forEach((cb) => cb(t)) };
}
const POLICY: Policy = { mode: 'maker', markets: ['BTC'], preset: 'custom', quoteSizeUsd: 50, maxInventoryUsd: 500, minHalfSpreadBps: 4, maxDailyLossUsd: 50, maxLeverage: 3 };
function runnerOn(driver: never, wallet: string, policy = POLICY) {
  const deps = { driver, collector: new Collector(null), k: () => 0, notify: () => {}, creds: () => ({ wallet, accountId: 1, token: 't', secret: 's' }) };
  return new Runner(upsertUser(wallet), wallet, 1, policy, deps);
}

it('a kill while Perpl is unreachable cancels and flattens once it is back', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const v = {
    up: true, orders: 2, size: 0.01,
    connect: async () => v.account(), close() {}, on() {}, connected: () => v.up, quote: () => null, setQuote: async () => {},
    account: () => ({ accountId: 1, balanceUsd: 1_000, canTrade: true }),
    position: () => ({ size: v.size, entryPrice: 0 }),
    cancelAll: async () => { if (!v.up) throw new VenueError('disconnected', 'trading socket is down'); v.orders = 0; },
    flatten: async () => { if (!v.up) throw new VenueError('disconnected', 'trading socket is down'); v.size = 0; },
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const policy: Policy = { mode: 'maker', markets: ['BTC'], preset: 'balanced', ...PRESETS.balanced };
  const r = new Runner(upsertUser('0xabc'), '0xabc', 1, policy, { driver, collector: {} as never, k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xabc', accountId: 1, token: 't', secret: 's' }) });
  await r.start();
  v.up = false;
  await r.kill('stale_data');
  expect([v.orders, v.size]).toEqual([2, 0.01]); // nothing reached Perpl

  v.up = true;
  r.tick();
  await settle();
  expect(v.orders).toBe(2); // retries wait 10 s after a failure

  vi.setSystemTime(Date.now() + 11_000);
  r.tick();
  await settle();
  expect([v.orders, v.size]).toEqual([0, 0]);
});

it('a kill that could not reach Perpl is still finished after a restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const v = {
    up: false, size: 0.01,
    connect: async () => v.account(), close() {}, on() {}, connected: () => v.up, quote: () => null, setQuote: async () => {},
    account: () => ({ accountId: 1, balanceUsd: 1_000, canTrade: true }), position: () => ({ size: v.size, entryPrice: 0 }),
    cancelAll: async () => { if (!v.up) throw new VenueError('disconnected', 'trading socket is down'); },
    flatten: async () => { if (!v.up) throw new VenueError('disconnected', 'trading socket is down'); v.size = 0; },
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const deps = { driver, collector: {} as never, k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xdef', accountId: 1, token: 't', secret: 's' }) };
  const uid = upsertUser('0xdef');
  const before = new Runner(uid, '0xdef', 1, POLICY, deps);
  await before.start();
  await before.kill('manual');
  before.dispose(); // the process restarts before Perpl is back

  const after = new Runner(uid, '0xdef', 1, POLICY, deps);
  expect(after.state()).toMatchObject({ status: 'killed', killReason: 'manual' });
  await after.resumeCleanup();
  expect(after.state().closing).toBe(true);
  v.up = true;
  vi.setSystemTime(Date.now() + 11_000);
  after.tick();
  await settle();
  expect(v.size).toBe(0);
  expect(after.state().closing).toBe(false);
  expect((db.prepare('select owed from agents where user_id = ?').get(uid) as { owed: string | null }).owed).toBeNull();
});

it('a paper account survives a restart, and its fill traces back to the request and the market behind it', async () => {
  const w = paperWorld();
  const wallet = '0x00000000000000000000000000000000000000a1';
  const r = runnerOn(w.driver as never, wallet);
  await r.start();
  r.tick();
  await settle();
  const bid = r.state().markets.BTC!.quotes.bid!;
  expect(bid).not.toBeNull();
  w.print({ sym: 'BTC', price: bid.price - 1, size: 1, side: 'sell' }); // a taker sweeps through the bid
  const s1 = r.state();
  expect(s1.markets.BTC!.position.size).toBe(bid.size);

  const row = db.prepare('select quote_event_id, ctx from fills where user_id = (select id from users where wallet = ?)').get(wallet) as { quote_event_id: number; ctx: string };
  const placed = db.prepare('select action, side, price, ok from quote_events where id = ?').get(row.quote_event_id);
  expect(placed).toMatchObject({ action: 'place', side: 'bid', price: bid.price, ok: 1 });
  expect(JSON.parse(row.ctx)).toMatchObject({ quoteEventId: row.quote_event_id, market: { bestBid: 99_990, bestAsk: 100_010 }, stage: 'normal' });

  r.dispose(); // restart
  const again = runnerOn(w.driver as never, wallet);
  await again.start();
  const s2 = again.state();
  expect(s2.account.balanceUsd).toBe(s1.account.balanceUsd);
  expect(s2.markets.BTC!.position).toEqual(s1.markets.BTC!.position);
  expect(s2.pnl.realizedUsd).toBe(s1.pnl.realizedUsd);
  expect(s2.pnl.feesUsd).toBe(s1.pnl.feesUsd);
  again.dispose();
});

it('a fill message seen twice counts once, and a deposit is neither profit nor take profit', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let onFill: (f: VenueFill) => void = () => {};
  const v = {
    balance: 1_000,
    connect: async () => v.account(), close() {}, connected: () => true, quote: () => null, setQuote: async () => {}, cancelAll: async () => {}, flatten: async () => {},
    on: (e: string, cb: never) => { if (e === 'fill') onFill = cb; },
    account: () => ({ accountId: 1, balanceUsd: v.balance, canTrade: true }), position: () => ({ size: 0, entryPrice: 0 }),
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const deps = { driver, collector: new Collector(null), k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xfee', accountId: 1, token: 't', secret: 's' }) };
  const r = new Runner(upsertUser('0xfee'), '0xfee', 1, POLICY, deps);
  await r.start({ stopLossUsd: null, takeProfitUsd: 5 });
  r.tick();

  const fill: VenueFill = { id: 'perpl:1:0xabc:1:7', sym: 'BTC', side: 'ask', price: 100_000, size: 0.001, feeUsd: 0.05, realizedUsd: 2, isMaker: true, ts: Date.now() };
  v.balance += 2 - 0.05;
  onFill(fill);
  onFill(fill); // the same fill again after a reconnect
  expect(r.state().pnl).toMatchObject({ realizedUsd: 2, feesUsd: 0.05 });

  v.balance += 100; // a deposit
  for (let i = 0; i < 8; i++) {
    vi.setSystemTime(Date.now() + 1_000);
    r.tick();
  }
  const s = r.state();
  expect(s.status).toBe('quoting'); // +$101.95 of equity, but only $1.95 of it is trading: no take profit
  expect(s.session!.pnlUsd).toBeCloseTo(1.95);
  expect(s.pnl.depositsUsd).toBe(100);
});

it('dropping a market from the policy keeps its position in view and works its exit', async () => {
  const w = paperWorld();
  const wallet = '0x00000000000000000000000000000000000000b2';
  simStore.save(wallet, 1_000, { BTC: { size: 0.002, entryPrice: 99_000 } }); // long $200, $2 up
  const r = runnerOn(w.driver as never, wallet);
  await r.start();
  r.setPolicy({ ...POLICY, markets: ['ETH'] });
  r.tick();
  await settle();
  const btc = r.state().markets.BTC!;
  expect(btc).toMatchObject({ inPolicy: false, stage: 'reduce' });
  expect(btc.position.unrealizedUsd).toBeCloseTo(2);
  expect(r.state().pnl.unrealizedUsd).toBeCloseTo(2);
  expect(btc.quotes.bid).toBeNull(); // no new inventory
  expect(btc.quotes.ask!.size).toBeLessThanOrEqual(0.002); // only the exit, never a flip
  r.dispose();
});
