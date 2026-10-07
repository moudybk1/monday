// Live smoke test for the public half of the Perpl adapter, plus offline sign-in checks (the order
// state machine is replayed in trading.test.ts). Run:
//   cd apps/server && npx tsx src/venue/perpl/smoke.ts
// Exits non-zero if any check fails.

import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { MARKETS } from '@monday/core';
import { VenueError } from '../types';
import { createPerplDriver, type PerplConfig } from './index';
import { parseSecret, signInFrame } from './trading';

const cfg: PerplConfig = {
  apiUrl: process.env.PERPL_API_URL ?? 'https://testnet.perpl.xyz/api',
  wsUrl: process.env.PERPL_WS_URL ?? 'wss://testnet.perpl.xyz',
  chainId: Number(process.env.PERPL_CHAIN_ID ?? 10143),
  rpcUrl: process.env.PERPL_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
  exchangeAddress: (process.env.PERPL_EXCHANGE_ADDRESS ?? '0x1964c32f0be608e7d29302aff5e61268e72080cc') as `0x${string}`,
};
// Any wallet that owns a testnet account, to exercise the positive detectAccount path (override with SMOKE_WALLET).
const KNOWN_WALLET = process.env.SMOKE_WALLET ?? '0x0895B09824d0c7E663C32703aC8c0Db9bffedF8B';

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

// ---- 2. live market data ----
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
