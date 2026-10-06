import { expect, it, vi } from 'vitest';
import { PRESETS, type Policy } from '@monday/core';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '' });
const { Runner } = await import('./runner');
const { VenueError } = await import('./venue/types');
const { upsertUser } = await import('./db');

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
  const settle = () => new Promise((ok) => setImmediate(ok));

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
  vi.useRealTimers();
});
