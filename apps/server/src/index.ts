// Boot. One process hosts the collector, the runners and the API.
// The PRD splits these into three services. Split when one box is not enough.

import { PRESETS, type MarketSym, type Policy } from '@monday/core';
import { buildApi } from './api';
import { chainEnabled, queueDepth, resumeChainLog, verifyRpc } from './chain';
import { Collector } from './collector';
import { config } from './config';
import { db, simStore, unseal, upsertUser } from './db';
import { computeEvidence, evidence, nansenK } from './evidence';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { hlAgeMs, startHyperliquid } from './hyperliquid';
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
// Public Perpl stats (indexing and /api/stats) run in their own process, stats/run.ts (npm run indexer, also started by
// npm run dev and npm start): their synchronous SQLite work must never stall this event loop past Perpl's ping (1008).
// A stalled event loop misses Perpl's pings and drops the trading socket. Say so when it happens.
const loopLag = monitorEventLoopDelay({ resolution: 50 });
loopLag.enable();
setInterval(() => {
  const maxMs = loopLag.max / 1e6;
  if (maxMs > 1_000) console.error(JSON.stringify({ service: 'monday', event: 'event_loop_stall', maxMs: Math.round(maxMs) }));
  loopLag.reset();
}, 30_000).unref();

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

// Never leave quotes resting on a book nobody is watching: on a stop or a crash, cancel first, then exit. Installed
// before any agent resumes, so a signal during boot cancels too. Run real funds with `npm start`, not a watcher:
// `tsx watch` force-kills 5 s after its SIGTERM, which can cut a cancel short.
let ticker: ReturnType<typeof setInterval> | undefined;
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  clearInterval(ticker);
  setTimeout(() => process.exit(code), 10_000).unref(); // a cancel waits for in-flight requests, which end within Perpl's order TTL
  void Promise.allSettled([...runners.values(), ...(house ? [house] : [])].map((r) => r.shutdown())).then(() => process.exit(code));
}
// SIGHUP: the terminal running the server was closed (or the app hosting it quit). Cancel first then too.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => stop(0));
process.on('uncaughtException', (e) => {
  console.error(JSON.stringify({ service: 'monday', event: 'crash', error: e.stack ?? String(e) }));
  stop(1);
});
// A stray rejection (an RPC read, a fetch) is logged, not a reason to drop every runner's book.
process.on('unhandledRejection', (e) => console.error(JSON.stringify({ service: 'monday', event: 'unhandled_rejection', error: e instanceof Error ? e.stack : String(e) })));

// Agents that were quoting when the process last stopped: creating the runner is enough. Its tick resumes it (reconcile,
// then quote) and keeps retrying every 10 s while Perpl is unreachable, until it works or the user stops it.
for (const a of db.prepare("select user_id from agents where status = 'quoting'").all() as { user_id: number }[]) runnerFor(a.user_id);
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

// One runner's bug must not stop the others. A quoting runner whose tick throws is killed: fail closed.
ticker = setInterval(() => {
  for (const r of [house, ...runners.values()]) {
    try {
      r?.tick();
    } catch (e) {
      console.error(JSON.stringify({ service: 'runner', user: r?.userId, event: 'tick_failed', error: e instanceof Error ? e.stack : String(e) }));
      if (r?.status === 'quoting') void r.kill('order_failures').catch(() => {});
    }
  }
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
// On a VPS nobody watches the terminal: a start you did not cause is a crash or a reboot, and agents that were quoting resume.
notify(`Monday server started on ${config.networkName}${config.realFunds ? ' with real funds' : ''}. Agents that were quoting resume.`);
console.log(JSON.stringify({ service: 'monday', event: 'listening', port: config.port, network: config.network, venue: driver.kind, realFunds: config.realFunds, caps: config.caps, smartMoney: collector.kind, llm: llmEnabled, chainLog: chainEnabled }));

