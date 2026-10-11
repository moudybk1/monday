// Offline replay of market-data frames into a feed whose sockets are fakes.

import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import type { PerplConfig } from './index';
import type { LinkHandlers } from './socket';

const sockets: { h: LinkHandlers; sent: any[]; bounced: number }[] = [];
vi.mock('./socket', () => ({
  openLink: (_url: string, h: LinkHandlers) => {
    const s = { h, sent: [] as any[], bounced: 0 };
    sockets.push(s);
    return { send: (f: unknown) => (s.sent.push(f), true), bounce: () => void s.bounced++, ok() {}, stop() {} };
  },
}));
const { PerplFeed } = await import('./feed');

afterEach(() => {
  vi.useRealTimers();
  sockets.length = 0;
});

const market = (id: number, sym: string) => ({ id, px: 10, sz: 1e5, ttlBlocks: 20, spec: { sym } });
async function feedOf(ms: ReturnType<typeof market>[]) {
  const ctx = { markets: Object.fromEntries(ms.map((m) => [m.spec.sym, m])), byId: new Map(ms.map((m) => [m.id, m])), usd: 1e6, minDepositUsd: 10 };
  const f = new PerplFeed({ chainId: 143, wsUrl: 'wss://x' } as PerplConfig, async () => ctx as never);
  const started = f.start();
  await vi.advanceTimersByTimeAsync(10_000); // no data: start gives up waiting, the sockets stay
  await started;
  return f;
}

it('spreads the markets over sockets that each stay inside 16 subscriptions', async () => {
  vi.useFakeTimers({ now: 1_000_000 });
  const syms = ['BTC', 'ETH', 'SOL', 'MON', 'HYPE', 'ZEC', 'LIT', 'VVV', 'PUMP', 'NEAR', 'UNI'];
  const f = await feedOf(syms.map((s, i) => market((i + 1) * 10, s)));
  for (const s of sockets) s.h.open();
  const subs = sockets.map((s) => s.sent[0].subs.map((x: { stream: string }) => x.stream) as string[]);
  assert.equal(sockets.length, 2);
  assert.ok(subs.every((x) => x.length <= 16));
  assert.ok(subs.every((x) => x.includes('heartbeat@143'))); // each socket can tell its own books are current
  assert.deepEqual(subs.flat().filter((x) => x.startsWith('order-book@')).length, 11);
  f.stop();
});

it('a book is stale after a reconnect until it is restated, heartbeats or not, and is asked for again', async () => {
  vi.useFakeTimers({ now: 1_000_000 });
  const f = await feedOf([market(16, 'BTC')]);
  const s = sockets[0];
  let sn = 0;
  const age = () => Date.now() - f.snapshot('BTC')!.updatedAt;
  const heartbeats = (ms: number) => {
    for (let t = 0; t < ms; t += 400) {
      vi.advanceTimersByTime(400);
      s.h.frame({ mt: 100, sn: ++sn });
    }
  };

  s.h.open();
  s.h.frame({ mt: 6, subs: [{ stream: 'order-book@16', sid: 1 }] });
  s.h.frame({ mt: 9, d: { 16: { orl: 850000, mrk: 850000, oi: 0 } } });
  s.h.frame({ mt: 15, sid: 1, bid: [{ p: 849990, s: 1000, o: 1 }], ask: [{ p: 850010, s: 1000, o: 1 }] });
  heartbeats(12_000);
  assert.equal(age(), 0); // live: every frame is news about it
  assert.equal(s.bounced, 0);

  // Reconnect; the order-book subscription fails but heartbeats keep coming. The book must age, not look fresh.
  const lastGood = Date.now();
  s.h.open();
  sn = 0;
  s.h.frame({ mt: 6, subs: [{ stream: 'order-book@16', status: { code: 503, error: 'unavailable' } }] });
  heartbeats(6_000);
  assert.equal(f.snapshot('BTC')!.updatedAt, lastGood);
  assert.ok(age() > 5_000); // past the runner's 5 s cancel
  heartbeats(5_000);
  assert.equal(s.bounced, 1); // asked for again 10 s after the reconnect

  // The new socket restates the book: fresh again.
  s.h.open();
  sn = 0;
  s.h.frame({ mt: 6, subs: [{ stream: 'order-book@16', sid: 2 }] });
  s.h.frame({ mt: 15, sid: 2, bid: [{ p: 849980, s: 1000, o: 1 }], ask: [{ p: 850020, s: 1000, o: 1 }] });
  heartbeats(11_000);
  assert.equal(age(), 0);
  assert.equal(s.bounced, 1);
  f.stop();
});
