// Offline replay of documented Perpl trading frames into a venue that never opens a socket.
// The live half (market data, candles, account lookup) is smoke.ts.

import assert from 'node:assert/strict';
import { it } from 'vitest';
import { VenueError } from '../types';
import type { PerplConfig } from './index';
import { PerplVenue } from './trading';

const cfg = { apiUrl: '', wsUrl: '', chainId: 10143, rpcUrl: '', exchangeAddress: '0x' } as PerplConfig;
const tick = () => new Promise((r) => setImmediate(r));

it('adoption, change-not-cancel, dedupe, fills, positions, balance', async () => {
  const sent: any[] = [];
  const v = new PerplVenue(cfg, async () => ({}) as never, { wallet: '0x', accountId: 7, token: 't', secret: 's' }) as any;
  const btc = { id: 16, px: 10, sz: 1e5, ttlBlocks: 20, spec: { sym: 'BTC' } };
  v.ctx = { markets: { BTC: btc }, byId: new Map([[16, btc]]), usd: 1e6, minDepositUsd: 100 };
  v.link = { send: (f: any) => (sent.push(f), true), bounce() {}, ok() {}, stop() {} };
  const fills: any[] = [];
  v.on('fill', (f: any) => fills.push(f));

  // Sign-in snapshots: an account, one resting bid (adopted) plus a duplicate bid (stray), a 0.5 BTC long.
  v.onFrame({ mt: 19, sn: 100, addr: '0x', as: [{ id: 7, lfr: 41, b: '900000000', fw: true }] });
  v.onFrame({ mt: 23, d: [
    { acc: 7, mkt: 16, oid: 5, rq: 40, st: 2, t: 1, p: 850000, os: 1000, fs: 0, fl: 1 },
    { acc: 7, mkt: 16, oid: 6, rq: 41, st: 2, t: 1, p: 849000, os: 1000, fs: 0, fl: 1 },
  ] });
  v.onFrame({ mt: 26, d: [{ acc: 7, mkt: 16, pid: 3, st: 1, sd: 1, s: 50000, ep: 840000, c: '100000000' }] });
  assert.equal(v.connected(), true);
  assert.deepEqual(v.quote('BTC', 'bid'), { price: 85000, size: 0.01 });
  assert.equal(v.quote('BTC', 'ask'), null);
  assert.deepEqual(v.position('BTC'), { size: 0.5, entryPrice: 84000 });
  assert.deepEqual(v.account(), { accountId: 7, balanceUsd: 1000, canTrade: true }); // 900 free + 100 position collateral
  assert.deepEqual(sent.map((f) => [f.t, f.oid, f.rq, f.sn]), [[5, 6, 42, 1]]); // stray cancelled; rq seeded from lfr 41
  v.onFrame({ mt: 100, sn: 101, h: 5000 });

  // Resting bid + new target -> Change (t 7), PostOnly, leverage in hundredths, lb = head + ttl.
  const change = v.setQuote('BTC', 'bid', { price: 85010.5, size: 0.02 }, 3);
  await tick();
  assert.deepEqual(sent[1], { mt: 22, sn: 2, rq: 43, acc: 7, mkt: 16, t: 7, oid: 5, p: 850105, s: 2000, fl: 1, lv: 300, lb: 5020 });
  v.onFrame({ mt: 3, sid: 100, cid: 2, status: { code: 0 } });
  v.onFrame({ mt: 24, d: [{ acc: 7, mkt: 16, oid: 5, rq: 43, st: 2, sr: 31, t: 1, p: 850105, os: 2000, fs: 0 }] });
  await change;
  v.onFrame({ mt: 24, d: [{ acc: 7, mkt: 16, oid: 5, rq: 43, st: 7, sr: 32 }] }); // late duplicate failure: ignored
  assert.deepEqual(v.quote('BTC', 'bid'), { price: 85010.5, size: 0.02 });

  // No resting ask -> OpenShort; a PostOnly cross comes back as crosses_book.
  const ask = v.setQuote('BTC', 'ask', { price: 85000, size: 0.01 }, 3);
  await tick();
  assert.deepEqual([sent[2].t, sent[2].fl, sent[2].oid], [2, 1, undefined]);
  v.onFrame({ mt: 24, d: [{ acc: 7, mkt: 16, oid: 0, rq: sent[2].rq, st: 7, sr: 13 }] });
  await assert.rejects(ask, (e) => e instanceof VenueError && e.code === 'crosses_book');

  // Gateway refusal on mt 3: 403 is a read-only key.
  const refused = v.setQuote('BTC', 'ask', { price: 86000, size: 0.01 }, 3);
  await tick();
  v.onFrame({ mt: 3, sid: 100, cid: sent[3].sn, status: { code: 403, error: 'api key lacks trade scope' } });
  await assert.rejects(refused, (e) => e instanceof VenueError && e.code === 'read_only_key');
  assert.equal(v.account().canTrade, false);

  // An ask (CloseLong fill here) of 0.2 against the 0.5 long at 84,000: realised (85,000 - 84,000) * 0.2 = 200.
  const fill = { acc: 7, mkt: 16, oid: 9, t: 3, l: 1, p: 850000, s: 20000, f: '765000', at: { b: 5001, t: 1_700_000_000_000, txid: 'ab', l: 4 } };
  v.onFrame({ mt: 25, d: [fill] });
  v.onFrame({ mt: 25, d: [fill] }); // duplicate delivery
  assert.deepEqual(fills, [{ id: 'perpl:7:ab:4:9', sym: 'BTC', side: 'ask', price: 85000, size: 0.2, feeUsd: 0.765, realizedUsd: 200, isMaker: true, ts: 1_700_000_000_000, external: true }]); // oid 9 was never Monday's

  // The bid fills completely (r: true) -> slot empties; target null with nothing resting sends nothing.
  v.onFrame({ mt: 24, d: [{ acc: 7, mkt: 16, oid: 5, rq: 43, st: 4, sr: 22, r: true }] });
  assert.equal(v.quote('BTC', 'bid'), null);
  await v.setQuote('BTC', 'bid', null, 3);
  assert.equal(sent.length, 4);

  // Inversion: the long closes and a short opens under a new position id, delivered open-first.
  v.onFrame({ mt: 27, d: [{ acc: 7, mkt: 16, pid: 4, st: 1, sd: 2, s: 10000, ep: 851000, c: '20000000' }, { acc: 7, mkt: 16, pid: 3, st: 2, sd: 1, s: 0, ep: 840000, c: '0' }] });
  assert.deepEqual(v.position('BTC'), { size: -0.1, entryPrice: 85100 });

  // flatten -> CloseShort, market (p 0) IOC, linked to the position; resolves on the first non-failure status.
  const flat = v.flatten();
  assert.deepEqual([sent[4].t, sent[4].p, sent[4].s, sent[4].fl, sent[4].lp, sent[4].lb], [4, 0, 10000, 4, 4, 0]); // lb 0: Perpl's own TTL
  v.onFrame({ mt: 24, d: [{ acc: 7, mkt: 16, oid: 11, rq: sent[4].rq, st: 4, sr: 43, r: true }] });
  setTimeout(() => v.onFrame({ mt: 27, d: [{ acc: 7, mkt: 16, pid: 4, st: 2, sd: 2, s: 0, ep: 851000, c: '0' }] }), 150); // position update trails
  await flat;
  assert.deepEqual(v.position('BTC'), { size: 0, entryPrice: 0 });

  // A skipped heartbeat forces a resync; a 1011 close is fatal and reported once.
  let bounced = 0;
  v.link.bounce = () => bounced++;
  v.onFrame({ mt: 100, sn: 103, h: 5002 });
  assert.equal(bounced, 1);
  const errors: string[] = [];
  v.on('error', (e: VenueError) => errors.push(e.code));
  assert.equal(v.onClosed(1008, 'ping timeout'), true); // a missed pong: reconnect, not a rate limit
  assert.equal(v.onClosed(1008, 'too many requests'), true);
  assert.equal(v.onClosed(1011, 'failed to process'), false);
  assert.deepEqual(errors, ['disconnected', 'rate_limited', 'fatal']);
  assert.equal(v.connected(), false);
});
