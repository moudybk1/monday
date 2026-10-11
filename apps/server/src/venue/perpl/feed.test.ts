// Offline replay of market-data frames into a feed that never opens a socket.

import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import type { PerplConfig } from './index';
import { PerplFeed } from './feed';

afterEach(() => vi.useRealTimers());

it('a book is stale after a reconnect until it is restated, heartbeats or not, and is asked for again', () => {
  vi.useFakeTimers({ now: 1_000_000 });
  const f = new PerplFeed({ chainId: 143 } as PerplConfig, async () => ({}) as never) as any;
  const btc = { id: 16, px: 10, sz: 1e5, spec: { sym: 'BTC' } };
  f.ctx = { markets: { BTC: btc }, byId: new Map([[16, btc]]) };
  let bounced = 0;
  f.link = { send: () => true, bounce: () => bounced++, ok() {}, stop() {} };
  const age = () => Date.now() - f.snapshot('BTC').updatedAt;
  const heartbeats = (ms: number) => {
    for (let t = 0; t < ms; t += 400) {
      vi.advanceTimersByTime(400);
      f.onFrame({ mt: 100, sn: (f.lastSn ?? 0) + 1 });
    }
  };

  f.onOpen();
  f.onFrame({ mt: 6, subs: [{ stream: 'order-book@16', sid: 1 }] });
  f.onFrame({ mt: 9, d: { 16: { orl: 850000, mrk: 850000, oi: 0 } } });
  f.onFrame({ mt: 15, sid: 1, bid: [{ p: 849990, s: 1000, o: 1 }], ask: [{ p: 850010, s: 1000, o: 1 }] });
  heartbeats(12_000);
  assert.equal(age(), 0); // live: every frame is news about it
  assert.equal(bounced, 0);

  // Reconnect; the order-book subscription fails but heartbeats keep coming. The book must age, not look fresh.
  const lastGood = Date.now();
  f.onOpen();
  f.onFrame({ mt: 6, subs: [{ stream: 'order-book@16', status: { code: 503, error: 'unavailable' } }] });
  heartbeats(6_000);
  assert.equal(f.snapshot('BTC').updatedAt, lastGood);
  assert.ok(age() > 5_000); // past the runner's 5 s cancel
  heartbeats(5_000);
  assert.equal(bounced, 1); // asked for again 10 s after the reconnect

  // The new socket restates the book: fresh again.
  f.onOpen();
  f.onFrame({ mt: 6, subs: [{ stream: 'order-book@16', sid: 2 }] });
  f.onFrame({ mt: 15, sid: 2, bid: [{ p: 849980, s: 1000, o: 1 }], ask: [{ p: 850020, s: 1000, o: 1 }] });
  heartbeats(11_000);
  assert.equal(age(), 0);
  assert.equal(bounced, 1);
  f.stop();
});
