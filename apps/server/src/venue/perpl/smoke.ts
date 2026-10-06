// Live smoke test for the public half of the Perpl adapter, plus offline checks of the
// parts that need no key. Run:
//   cd apps/server && npx tsx src/venue/perpl/smoke.ts
// Exits non-zero if any check fails.

import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { MARKETS } from '@monday/core';
import { VenueError } from '../types';
import { createPerplDriver, type PerplConfig } from './index';
import { parseSecret, PerplVenue, signInFrame } from './trading';

const cfg: PerplConfig = {
  apiUrl: process.env.PERPL_API_URL ?? 'https://testnet.perpl.xyz/api',
  wsUrl: process.env.PERPL_WS_URL ?? 'wss://testnet.perpl.xyz',
  chainId: Number(process.env.PERPL_CHAIN_ID ?? 10143),
  rpcUrl: process.env.PERPL_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
  exchangeAddress: (process.env.PERPL_EXCHANGE_ADDRESS ?? '0x1964c32f0be608e7d29302aff5e61268e72080cc') as `0x${string}`,
};
// Any wallet that owns a testnet account, to exercise the positive detectAccount path (override with SMOKE_WALLET).
const KNOWN_WALLET = process.env.SMOKE_WALLET ?? '0x0895B09824d0c7E663C32703aC8c0Db9bffedF8B';

const tick = () => new Promise((r) => setImmediate(r));
let failures = 0;
async function check(name: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

// ---- 1. sign-in encoding, with a throwaway key ----
console.log('sign-in frame (throwaway Ed25519 key)');
const pair = generateKeyPairSync('ed25519');
const seed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32); // the raw 32-byte key Perpl hands out
const frame = signInFrame(cfg.chainId, 'throwaway-token', parseSecret(seed.toString('hex')), 1_700_000_000_000);
const canonical = `${cfg.chainId}\ntrading-ws-signin\n${frame.timestamp}\n${frame.nonce}`;
await check('frame shape matches ApiKeySignIn', () => {
  assert.deepEqual(Object.keys(frame), ['mt', 'chain_id', 'api_key', 'timestamp', 'nonce', 'signature']);
  assert.equal(frame.mt, 29);
  assert.equal(frame.timestamp, '1700000000000');
  assert.match(frame.nonce, /^[A-Za-z0-9_-]{22}$/); // 16 random bytes, base64url, no padding
  assert.match(frame.signature, /^[A-Za-z0-9_-]{86}$/); // 64-byte signature, base64url, no padding
});
await check('signature verifies over the documented canonical string', () => {
  assert.ok(verify(null, Buffer.from(canonical), pair.publicKey, Buffer.from(frame.signature, 'base64url')));
  assert.ok(!verify(null, Buffer.from(canonical + 'x'), pair.publicKey, Buffer.from(frame.signature, 'base64url')));
});
await check('same signature as @noble (the library the official examples use)', async () => {
  // Ed25519 is deterministic, so node:crypto and noble must agree byte for byte on the same seed.
  // noble is only a transitive dependency (via viem), hence the indirect import and the skip.
  const noble = '@noble/curves/ed25519';
  const mod = await import(noble).catch(() => null);
  if (!mod) return console.log('        (skipped: @noble/curves not installed)');
  assert.equal(Buffer.from(mod.ed25519.sign(Buffer.from(canonical), seed)).toString('base64url'), frame.signature);
});
await check('secret accepted as hex, 0x-hex, 64-byte hex, base64 and PEM; junk is bad_signature', () => {
  const pub = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const forms = [seed.toString('hex'), `0x${seed.toString('hex')}`, Buffer.concat([seed, pub]).toString('hex'), seed.toString('base64'), pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string];
  for (const form of forms) assert.equal(signInFrame(1, 't', parseSecret(form), 1).signature.length, 86);
  assert.throws(() => parseSecret('not-a-key'), (e) => e instanceof VenueError && e.code === 'bad_signature');
});

// ---- 2. order bookkeeping, offline: replay documented frames into a venue that never opens a socket ----
console.log('trading state machine (offline replay of documented frames)');
await check('adoption, change-not-cancel, dedupe, fills, positions, balance', async () => {
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
  assert.deepEqual(fills, [{ id: 'ab:4:9', sym: 'BTC', side: 'ask', price: 85000, size: 0.2, feeUsd: 0.765, realizedUsd: 200, isMaker: true, ts: 1_700_000_000_000 }]);

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
  assert.deepEqual([sent[4].t, sent[4].p, sent[4].s, sent[4].fl, sent[4].lp], [4, 0, 10000, 4, 4]);
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
  assert.equal(v.onClosed(1011, 'failed to process'), false);
  assert.deepEqual(errors, ['fatal']);
  assert.equal(v.connected(), false);
});

// ---- 3. live market data ----
console.log(`market data (${cfg.wsUrl})`);
const driver = createPerplDriver(cfg);
await driver.feed.start();
await new Promise((r) => setTimeout(r, 10_000));

console.log(`  min deposit: $${driver.minDepositUsd()}`);
const specs = driver.feed.specs();
for (const sym of MARKETS) console.log(`  spec ${JSON.stringify(specs[sym])}`);

for (const sym of MARKETS) {
  const s = driver.feed.snapshot(sym);
  await check(`${sym} snapshot`, () => {
    assert.ok(s, 'no snapshot');
    const age = Date.now() - s.updatedAt;
    console.log(`        ${sym} bid ${s.bestBid} / ask ${s.bestAsk}  mid ${s.mid}  mark ${s.mark}  oracle ${s.oracle}  levels ${s.bids.length}/${s.asks.length}  funding ${s.fundingRate}  OI ${s.openInterest}  age ${age} ms`);
    console.log(`        top bids ${s.bids.slice(0, 3).map((l) => `${l.size}@${l.price}`).join(', ')} | top asks ${s.asks.slice(0, 3).map((l) => `${l.size}@${l.price}`).join(', ')}`);
    assert.ok(s.bestBid !== null && s.bestAsk !== null && s.mid !== null, 'empty side');
    assert.ok(s.bestBid < s.bestAsk, 'crossed book');
    assert.ok(s.bids.every((l, i) => i === 0 || l.price < s.bids[i - 1].price), 'bids not sorted best-first');
    assert.ok(s.asks.every((l, i) => i === 0 || l.price > s.asks[i - 1].price), 'asks not sorted best-first');
    assert.ok([...s.bids, ...s.asks].every((l) => l.size > 0), 'zero-size level left in the book');
    assert.ok(s.bids.length <= 15 && s.asks.length <= 15, 'more than 15 levels');
    assert.ok(Math.abs(s.mark / s.mid - 1) < 0.02 && Math.abs(s.oracle / s.mid - 1) < 0.02, 'mark/oracle far from mid');
    assert.ok(age < 5_000, `stale: ${age} ms`);
  });
}

console.log('candles (REST)');
await check('last 30 one-minute BTC candles', async () => {
  const now = Date.now();
  const cs = await driver.feed.candles('BTC', now - 30 * 60_000, now);
  console.log(`        ${cs.length} candles, ${new Date(cs[0]?.t).toISOString()} .. ${new Date(cs.at(-1)!.t).toISOString()}, last close ${cs.at(-1)!.c}`);
  assert.ok(cs.length >= 25 && cs.length <= 31, `expected about 30, got ${cs.length}`);
  assert.ok(cs.every((c, i) => i === 0 || c.t > cs[i - 1].t), 'not oldest-first');
  assert.ok(cs.every((c) => c.l <= c.o && c.l <= c.c && c.h >= c.o && c.h >= c.c), 'OHLC inconsistent');
  const mid = driver.feed.snapshot('BTC')?.mid;
  assert.ok(mid && Math.abs(cs.at(-1)!.c / mid - 1) < 0.02, 'last close far from mid');
});
await check('paging across the 1,024-candle limit (3,000 minutes)', async () => {
  const to = Math.floor(Date.now() / 60_000) * 60_000;
  const cs = await driver.feed.candles('BTC', to - 3000 * 60_000, to);
  console.log(`        ${cs.length} candles over 3 requests`);
  assert.ok(cs.length > 2048 && cs.length <= 3000, `got ${cs.length}`);
  assert.ok(cs.every((c, i) => i === 0 || c.t > cs[i - 1].t), 'duplicates or disorder across pages');
});

console.log(`account detection (${cfg.rpcUrl})`);
await check('zero address has no account -> null', async () => assert.equal(await driver.detectAccount('0x0000000000000000000000000000000000000000'), null));
await check('random address has no account -> null', async () => assert.equal(await driver.detectAccount('0x00000000000000000000000000000000000000ab'), null));
await check('a wallet with an account is decoded', async () => {
  const a = await driver.detectAccount(KNOWN_WALLET);
  console.log(`        ${KNOWN_WALLET} -> ${JSON.stringify(a)}`);
  assert.ok(a && a.accountId > 0 && Number.isFinite(a.balanceUsd) && a.balanceUsd >= 0);
});

driver.feed.stop();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
