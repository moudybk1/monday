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

it('resume is refused while a kill still owes its flatten, and allowed once the position is closed', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const v = {
    up: true, size: 0.01,
    connect: async () => v.account(), close() {}, on() {}, connected: () => v.up, quote: () => null, setQuote: async () => {},
    account: () => ({ accountId: 1, balanceUsd: 1_000, canTrade: true }), position: () => ({ size: v.size, entryPrice: 0 }),
    cancelAll: async () => { if (!v.up) throw new VenueError('disconnected', 'trading socket is down'); },
    flatten: async () => { if (!v.up) throw new VenueError('disconnected', 'trading socket is down'); v.size = 0; },
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const r = new Runner(upsertUser('0xres'), '0xres', 1, POLICY, { driver, collector: {} as never, k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xres', accountId: 1, token: 't', secret: 's' }) });
  await r.start();
  v.up = false;
  await r.kill('manual');
  v.up = true;
  await expect(r.start()).rejects.toThrow(/still closing/);
  expect([r.status, r.owes, v.size]).toEqual(['killed', 'flatten', 0.01]); // the duty survives the attempt

  vi.setSystemTime(Date.now() + 11_000);
  r.tick();
  await settle();
  expect([r.owes, v.size]).toEqual([null, 0]);
  await r.start();
  expect(r.status).toBe('quoting');
});

it('a stopped agent leaves its position alone, even past the daily loss limit', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const v = {
    size: 0.01, balance: 1_000,
    connect: async () => v.account(), close() {}, on() {}, connected: () => true, quote: () => null, setQuote: async () => {},
    account: () => ({ accountId: 1, balanceUsd: v.balance, canTrade: true }), position: () => ({ size: v.size, entryPrice: 0 }),
    cancelAll: async () => {}, flatten: async () => { v.size = 0; },
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const r = new Runner(upsertUser('0xstp'), '0xstp', 1, POLICY, { driver, collector: {} as never, k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xstp', accountId: 1, token: 't', secret: 's' }) });
  await r.start();
  r.tick(); // sets the day's starting equity
  await r.pause();
  expect([r.status, v.size]).toEqual(['paused', 0.01]);

  v.balance = 1_000 - POLICY.maxDailyLossUsd - 10;
  r.tick();
  await settle();
  expect([r.status, v.size]).toEqual(['paused', 0.01]); // stop means stop: the position is the user's now
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
  expect(after.state().closing).toBe('flatten');
  v.up = true;
  vi.setSystemTime(Date.now() + 11_000);
  after.tick();
  await settle();
  expect(v.size).toBe(0);
  expect(after.state().closing).toBeNull();
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
  expect(s1.fills[0].realizedUsd).toBeNull(); // an opening fill closed nothing

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
  expect(s2.fills[0].realizedUsd).toBeNull();
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
  for (let i = 0; i < 20; i++) {
    vi.setSystemTime(Date.now() + 1_000);
    r.tick();
  }
  const s = r.state();
  expect(s.status).toBe('quoting'); // +$101.95 of equity, but only $1.95 of it is trading: no take profit
  expect(s.session!.pnlUsd).toBeCloseTo(1.95);
  expect(s.pnl.depositsUsd).toBe(100);
});

it('margin moving between Perpl\'s cash and position messages is not a loss; a real loss still stops Monday', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let onFill: (f: VenueFill) => void = () => {};
  const v = {
    balance: 1_000, size: 0,
    connect: async () => v.account(), close() {}, connected: () => true, quote: () => null, setQuote: async () => {}, cancelAll: async () => {}, flatten: async () => { v.size = 0; },
    on: (e: string, cb: never) => { if (e === 'fill') onFill = cb; },
    account: () => ({ accountId: 1, balanceUsd: v.balance, canTrade: true }), position: () => ({ size: v.size, entryPrice: 0 }),
    settling: () => v.pending,
    pending: false,
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const deps = { driver, collector: new Collector(null), k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xmgn', accountId: 1, token: 't', secret: 's' }) };
  const r = new Runner(upsertUser('0xmgn'), '0xmgn', 1, { ...POLICY, maxDailyLossUsd: 1 }, deps);
  await r.start();
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) {
      vi.setSystemTime(Date.now() + 1_000);
      r.tick();
    }
  };
  ticks(1);

  // 2026-10-12: a fill's cash message took $2 of margin out seconds before its position message showed it.
  const fill = { sym: 'BTC' as const, price: 100_000, size: 0.0002, feeUsd: 0.01, isMaker: true, ts: Date.now() };
  onFill({ ...fill, id: 'perpl:1:0xm:1:1', side: 'bid', realizedUsd: 0 });
  v.size = 0.0002;
  v.balance -= 2 + 0.01;
  ticks(4);
  expect(r.status).toBe('quoting');
  v.balance += 2;
  ticks(20);
  expect(r.state().pnl.lossLimitUsedPct).toBeCloseTo(1); // the $0.01 fee, of a $1 limit

  // The position message 20 s late, longer than the 15 s a cash move needs to be booked: still not a withdrawal.
  onFill({ ...fill, id: 'perpl:1:0xm:3:3', side: 'bid', realizedUsd: 0, feeUsd: 0 });
  v.pending = true;
  v.balance -= 2;
  ticks(20);
  v.pending = false;
  v.balance += 2;
  ticks(20);
  expect(r.state()).toMatchObject({ status: 'quoting', pnl: { depositsUsd: 0 } });
  expect(r.state().pnl.lossLimitUsedPct).toBeCloseTo(1);

  onFill({ ...fill, id: 'perpl:1:0xm:2:2', side: 'ask', realizedUsd: -1.5 });
  v.size = 0;
  v.balance -= 1.5 + 0.01;
  ticks(1);
  expect(r.state()).toMatchObject({ status: 'killed', killReason: 'loss_limit' });
  r.dispose();
});

it('dropping a market from the policy keeps its position in view and works its exit', async () => {
  const w = paperWorld();
  const wallet = '0x00000000000000000000000000000000000000b2';
  simStore.save(wallet, 1_000, { BTC: { size: 0.002, entryPrice: 99_000 } }); // long $200, $2 up
  // Monday's own fill opened it: the exit is Monday's to work.
  db.prepare('insert into fills (id, user_id, sym, side, price, size, fee, is_maker, ts) values (?,?,?,?,?,?,?,?,?)').run('own-b2', upsertUser(wallet), 'BTC', 'bid', 99_000, 0.002, 0, 1, Date.now());
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

  // The same position opened by hand, in a market Monday has not traded: the user's, left alone (2026-10-12).
  const hand = '0x00000000000000000000000000000000000000b4';
  simStore.save(hand, 1_000, { BTC: { size: 0.002, entryPrice: 99_000 } });
  const r2 = runnerOn(w.driver as never, hand, { ...POLICY, markets: ['ETH'] });
  await r2.start();
  r2.tick();
  await settle();
  expect(r2.state().markets.BTC!.quotes).toEqual({ bid: null, ask: null });
  expect(r2.state().pnl.unrealizedUsd).toBeCloseTo(2); // still in view and in the account's equity
  r2.dispose();
});

it('never adds to a position: with one open, only its exit is quoted (2026-10-12)', async () => {
  const w = paperWorld();
  const wallet = '0x00000000000000000000000000000000000000b3';
  simStore.save(wallet, 1_000, { BTC: { size: 0.0005, entryPrice: 99_000 } }); // long $50, well under the $500 limit
  const r = runnerOn(w.driver as never, wallet);
  await r.start();
  r.tick();
  await settle();
  const btc = r.state().markets.BTC!;
  expect(btc).toMatchObject({ inPolicy: true, stage: 'reduce' });
  expect(btc.quotes.bid).toBeNull();
  expect(btc.quotes.ask!.size).toBeLessThanOrEqual(0.0005);
  r.dispose();
});

it('cash that moves while Monday is stopped is not PnL: a deposit during a restart, a withdrawal while paused and flat', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const v = {
    balance: 1_000,
    connect: async () => v.account(), close() {}, on() {}, connected: () => true, quote: () => null, setQuote: async () => {}, cancelAll: async () => {}, flatten: async () => {},
    account: () => ({ accountId: 1, balanceUsd: v.balance, canTrade: true }), position: () => ({ size: 0, entryPrice: 0 }),
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const deps = { driver, collector: new Collector(null), k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xca5', accountId: 1, token: 't', secret: 's' }) };
  const uid = upsertUser('0xca5');
  const ticks = (r: InstanceType<typeof Runner>, n = 20) => {
    for (let i = 0; i < n; i++) {
      vi.setSystemTime(Date.now() + 1_000);
      r.tick();
    }
  };
  const before = new Runner(uid, '0xca5', 1, POLICY, deps);
  await before.start();
  ticks(before, 2);
  await before.shutdown(); // Ctrl+C

  v.balance += 100; // deposited while the server was down
  const after = new Runner(uid, '0xca5', 1, POLICY, deps);
  await after.start(); // boot resume
  ticks(after);
  expect(after.state().pnl).toMatchObject({ depositsUsd: 100, lossLimitUsedPct: 0 });
  expect(after.state().pnl.todayUsd).toBeCloseTo(0);

  await after.pause();
  v.balance -= 50; // withdrawn while paused, with no position
  ticks(after);
  await after.start();
  ticks(after, 2);
  expect(after.state().status).toBe('quoting'); // not a $50 loss against a $50 limit
  expect(after.state().pnl.lossLimitUsedPct).toBe(0);
  after.dispose();
});

it('a Stop during a boot resume is saved, and cash withdrawn while stopped is not a loss at the next Start (2026-10-12)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const v = {
    balance: 1_000,
    connect: async () => v.account(), close() {}, on() {}, connected: () => true, quote: () => null, setQuote: async () => {}, cancelAll: async () => {}, flatten: async () => {},
    account: () => ({ accountId: 1, balanceUsd: v.balance, canTrade: true }), position: () => ({ size: 0, entryPrice: 0 }),
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const deps = { driver, collector: new Collector(null), k: () => 0, notify: () => {}, creds: () => ({ wallet: '0xb00', accountId: 1, token: 't', secret: 's' }) };
  const uid = upsertUser('0xb00');
  const status = () => (db.prepare('select status from agents where user_id = ?').get(uid) as { status: string }).status;
  const ticks = (r: InstanceType<typeof Runner>, n: number) => {
    for (let i = 0; i < n; i++) {
      vi.setSystemTime(Date.now() + 1_000);
      r.tick();
    }
  };
  const a = new Runner(uid, '0xb00', 1, POLICY, deps);
  await a.start();
  ticks(a, 2);
  await a.shutdown(); // a deploy while quoting

  const b = new Runner(uid, '0xb00', 1, POLICY, deps); // boot is resuming it
  await b.pause(); // Stop pressed before the resume landed
  expect(status()).toBe('paused');
  b.dispose(); // and another restart while stopped

  v.balance -= 500; // withdrawn while stopped and flat
  const c = new Runner(uid, '0xb00', 1, POLICY, deps);
  ticks(c, 2);
  expect(c.state().status).toBe('paused'); // not resumed
  await c.start();
  ticks(c, 20);
  expect(c.state()).toMatchObject({ status: 'quoting', killReason: null }); // not a $500 loss against a $50 limit
  expect(c.state().pnl.lossLimitUsedPct).toBe(0);
  c.dispose();
});

/** A scripted Perpl account for the lifecycle tests: one market, a position, and every cleanup call recorded. */
function scriptedVenue(wallet: string) {
  const v = {
    size: 0.01, balance: 1_000, down: false, gate: null as Promise<void> | null, errors: [] as ((e: unknown) => void)[], cancels: [] as boolean[], flattens: 0,
    connect: async () => {
      if (v.down) throw new VenueError('disconnected', 'Perpl is unreachable');
      await v.gate;
      return v.account();
    },
    close() {}, connected: () => true, quote: () => null, setQuote: async () => {},
    on: (event: string, cb: (e: unknown) => void) => void (event === 'error' && v.errors.push(cb)),
    account: () => ({ accountId: 1, balanceUsd: v.balance, canTrade: true }), position: () => ({ size: v.size, entryPrice: 0 }),
    cancelAll: async (onlyOwn?: boolean) => void v.cancels.push(onlyOwn ?? false),
    flatten: async () => { v.flattens++; v.size = 0; },
  };
  const driver = { kind: 'perpl', open: () => v, feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] } } as never;
  const deps = { driver, collector: {} as never, k: () => 0, notify: () => {}, creds: () => ({ wallet, accountId: 1, token: 't', secret: 's' }) };
  return { v, deps, uid: upsertUser(wallet) };
}

it('a Kill pressed while Start is still connecting wins: the agent stays killed and the flatten stays owed', async () => {
  const { v, deps, uid } = scriptedVenue('0xe90');
  let release!: () => void;
  v.gate = new Promise((ok) => (release = ok));
  const r = new Runner(uid, '0xe90', 1, POLICY, deps);
  const starting = r.start();
  await r.kill('manual'); // Perpl not connected yet: the flatten cannot land, so it is owed
  release();
  await starting;
  expect([r.status, r.owes, v.size]).toEqual(['killed', 'flatten', 0.01]);
});

it('Stop cancels only Monday\'s own orders, a Kill sweeps them all, and nothing that fails after Stop closes the position', async () => {
  const { v, deps, uid } = scriptedVenue('0x570');
  const r = new Runner(uid, '0x570', 1, POLICY, deps);
  await r.start();
  await r.pause();
  expect(v.cancels).toEqual([true]); // the user's own stop loss and take profit orders stay

  // Requests rejected after Stop, then the key revoked: still stopped, still holding the position, nothing owed.
  for (let i = 0; i < 3; i++) (r as unknown as { onOrderError(e: unknown): void }).onOrderError(new VenueError('rejected', 'order rejected'));
  v.errors.forEach((cb) => cb(new VenueError('revoked', 'key revoked')));
  await settle();
  expect([r.status, r.owes, v.size, v.flattens]).toEqual(['paused', null, 0.01, 0]);
  db.prepare("update perpl_credentials set status = 'active' where user_id = ?").run(uid);

  await r.start();
  await r.kill('manual');
  expect(v.cancels).toEqual([true, false]);
  expect(v.size).toBe(0);
});

it('an agent saved as quoting resumes by itself, retries while Perpl is down, and keeps its session\'s start', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const { v, deps, uid } = scriptedVenue('0x2e5');
  const before = new Runner(uid, '0x2e5', 1, POLICY, deps);
  await before.start({ stopLossUsd: 20, takeProfitUsd: null });
  const startedAt = () => (db.prepare('select started_at s from agents where user_id = ?').get(uid) as { s: number }).s;
  const sessionStart = startedAt();
  before.dispose(); // the process stops without a clean shutdown

  vi.setSystemTime(Date.now() + 60_000);
  v.down = true;
  const after = new Runner(uid, '0x2e5', 1, POLICY, deps);
  after.tick();
  await settle();
  expect(after.status).toBe('idle'); // Perpl unreachable at boot

  v.down = false;
  after.tick(); // too soon: retries wait 10 s
  await settle();
  expect(after.status).toBe('idle');
  vi.setSystemTime(Date.now() + 11_000);
  after.tick();
  await settle();
  expect(after.status).toBe('quoting');
  expect(after.state().session).toMatchObject({ stopLossUsd: 20 });
  expect(startedAt()).toBe(sessionStart); // a resume must not move the session start: deposits since then stay deposits
  after.dispose();
});
