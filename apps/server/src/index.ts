// Boot. One process hosts the collector, the runners and the API.
// The PRD splits these into three services. Split when one box is not enough.

import { PRESETS, type MarketSym, type Policy } from '@monday/core';
import { buildApi } from './api';
import { chainEnabled, queueDepth, resumeChainLog, verifyRpc } from './chain';
import { Collector } from './collector';
import { config } from './config';
import { db, event, simStore, unseal, upsertUser } from './db';
import { computeEvidence, evidence, nansenK } from './evidence';
import { hlAgeMs, startHyperliquid } from './hyperliquid';
import { startIndexer } from './stats/indexer';
import { llmEnabled } from './governor';
import { Runner } from './runner';
import { createPaperDriver } from './venue/paper';
import { SimWorld } from './venue/sim';
import type { VenueDriver } from './venue/types';

// Simulated accounts keep their balance and positions in SQLite, so a restart does not reset them to $1,000.
const world = config.venue === 'sim' ? new SimWorld(undefined, simStore) : null;
const live = world ? null : (await import('./venue/perpl/index')).createPerplDriver(config.perpl);
const driver: VenueDriver = world ?? (config.venue === 'paper' ? createPaperDriver(live!, simStore) : live!);
// Demo accounts and the quoting house account exist wherever orders are simulated.
const simulatedOrders = driver.kind !== 'perpl';
const collector = new Collector(world);

function notify(text: string) {
  if (!config.telegram.token || !config.telegram.chatId) return;
  void fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: config.telegram.chatId, text }),
  }).catch(() => {});
}

const runners = new Map<number, Runner>();
const HOUSE_WALLET = '0x00000000000000000000000000000000000da7a0';
let house: Runner | null = null;

/** A runner exists once a user has both an active key and a policy. */
function runnerFor(userId: number): Runner | null {
  const hit = runners.get(userId);
  if (hit) return hit;
  const row = db.prepare(
    "select u.wallet, c.account_id, c.enc, c.iv, c.tag, p.json from users u join perpl_credentials c on c.user_id = u.id and c.status = 'active' join policies p on p.user_id = u.id and p.json is not null where u.id = ?",
  ).get(userId) as { wallet: string; account_id: number; enc: Uint8Array; iv: Uint8Array; tag: Uint8Array; json: string } | undefined;
  if (!row) return null;
  const r = new Runner(userId, row.wallet, row.account_id, JSON.parse(row.json) as Policy, {
    driver, collector, k: nansenK, notify,
    // Decrypted only here, in memory, when a session opens (PRD 17.2).
    creds: () => ({ wallet: row.wallet, accountId: row.account_id, ...(JSON.parse(unseal(row)) as { token: string; secret: string }) }),
  });
  runners.set(userId, r);
  return r;
}
function dropRunner(userId: number) {
  runners.get(userId)?.dispose();
  runners.delete(userId);
}

// Anything that touches the chain must be on the chain NETWORK names.
if (!world || chainEnabled) await verifyRpc();
await driver.feed.start();
await collector.start();
if (!world) startHyperliquid((t) => collector.onHyperliquidTrade(t)); // mids for the blend, and the smart-money tape
startIndexer(); // public Perpl stats: on in every mode, it reads Perpl mainnet whatever Monday trades

if (simulatedOrders) {
  // The house account quotes from boot so the landing page shows a live agent (on the real book in paper mode).
  const uid = upsertUser(HOUSE_WALLET);
  const policy: Policy = { mode: 'maker', markets: ['BTC', 'ETH', 'SOL'] as MarketSym[], preset: 'balanced', ...PRESETS.balanced };
  house = new Runner(uid, HOUSE_WALLET, 1, policy, { driver, collector, k: nansenK, notify, creds: () => ({ wallet: HOUSE_WALLET, accountId: 1, token: 'house', secret: 'house' }) });
  await house.start();
} else {
  // Live: an idle runner still assembles book and signal for the public preview; it never trades.
  const policy: Policy = { mode: 'paused', markets: ['BTC', 'ETH', 'SOL'] as MarketSym[], preset: 'balanced', ...PRESETS.balanced };
  house = new Runner(0, HOUSE_WALLET, 0, policy, { driver, collector, k: nansenK, notify, creds: () => { throw new Error('preview runner has no credentials'); } });
}

// Resume agents that were quoting when the process last stopped (reconcile, then quote).
for (const a of db.prepare("select user_id from agents where status = 'quoting'").all() as { user_id: number }[]) {
  const r = runnerFor(a.user_id);
  if (r) void r.start().catch((e) => event(a.user_id, 'error', { resume: String(e) }));
}
// A kill or pause whose cancel or flatten never reached Perpl is still owed: finish it, whatever the restart interrupted.
for (const a of db.prepare("select user_id from agents where owed is not null and status != 'quoting'").all() as { user_id: number }[]) {
  void runnerFor(a.user_id)?.resumeCleanup();
}
resumeChainLog();

// Request and minute records are for tracing and replay; two weeks is plenty.
const prune = () => {
  const cut = Date.now() - 14 * 86_400_000;
  db.prepare('delete from quote_events where sent_at < ?').run(cut);
  db.prepare('delete from market_minutes where minute < ?').run(Math.floor(cut / 60_000));
};
prune();
setInterval(prune, 6 * 3_600_000).unref();

setInterval(() => {
  house?.tick();
  for (const r of runners.values()) r.tick();
}, 1000);

// Demo runners live in memory; evict the ones nobody has looked at for an hour.
setInterval(() => {
  if (!simulatedOrders) return;
  for (const [uid, r] of runners) if (Date.now() - r.lastSeenAt > 3_600_000) dropRunner(uid);
}, 60_000).unref();

const refreshEvidence = () => void computeEvidence(driver, collector).catch((e) => console.error(JSON.stringify({ service: 'evidence', event: 'failed', error: String(e) })));
setTimeout(refreshEvidence, world ? 50 : 20_000);
setInterval(refreshEvidence, 3_600_000).unref();

const app = await buildApi({
  driver, world, house: () => house, runnerFor, dropRunner,
  health: () => ({
    ok: true, at: Date.now(), network: config.network, realFunds: config.realFunds, venue: driver.kind, smartMoney: collector.kind, signalAgeMs: Number.isFinite(collector.ageMs) ? collector.ageMs : null, signalStale: collector.stale, smartMoneyLive: collector.liveSeen,
    collectorError: collector.lastError, hyperliquidAgeMs: world ? null : hlAgeMs(), marketDataAgeMs: Date.now() - (driver.feed.snapshot('BTC')?.updatedAt ?? 0), runners: runners.size, llm: llmEnabled,
    chainLog: chainEnabled, chainQueue: queueDepth(), evidenceAt: evidence()?.at ?? null,
  }),
});
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(JSON.stringify({ service: 'monday', event: 'listening', port: config.port, network: config.network, venue: driver.kind, realFunds: config.realFunds, caps: config.caps, smartMoney: collector.kind, llm: llmEnabled, chainLog: chainEnabled }));

// Never leave quotes resting on a book nobody is watching.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => {
  setTimeout(() => process.exit(0), 3_000).unref();
  void Promise.allSettled([...runners.values(), ...(house ? [house] : [])].map((r) => r.shutdown())).then(() => process.exit(0));
});
