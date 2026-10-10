// Open interest, its long/short split, funding and TVL have no event history on chain: they are read live. This samples
// them every five minutes into the stats database, so the pages can draw them over time from the day sampling began.

import { thin, type PxHistory, type PxSignal, type PxSnapshot } from '@monday/core';
import { sdb } from './indexer';
import { accounts, allPositions, funding, meta, ticker, tvl } from './perpl';

export const EVERY = 5 * 60_000;
const POINTS = 400; // per series in a response: enough for any chart width
const SIGNAL_USD = 50_000; // a position this large appearing or disappearing between two samples is worth a line in the feed
const SIGNALS_KEPT = 200;

// Large positions opened and closed, found by comparing one sample of every open position with the previous one.
// ponytail: kept in this process's memory, so the list starts empty on each restart; a table if that ever matters.
const signals: PxSignal[] = [];
let lastSeen: Map<string, { usd: number; sym: string; account: number; long: boolean }> | null = null;
export const positionSignals = (): PxSignal[] => [...signals].reverse();

sdb.exec(`
create table if not exists px_snap (ts integer, perp integer, mark real, oi_usd real, long_usd real, short_usd real, longs integer, shorts integer, funding real, primary key (ts, perp));
create table if not exists px_snap_total (ts integer primary key, oi_usd real, tvl_usd real, accounts integer);
`);
const insSnap = sdb.prepare('insert or ignore into px_snap (ts, perp, mark, oi_usd, long_usd, short_usd, longs, shorts, funding) values (?,?,?,?,?,?,?,?,?)');
const insTotal = sdb.prepare('insert or ignore into px_snap_total (ts, oi_usd, tvl_usd, accounts) values (?,?,?,?)');

async function sample() {
  const at = Math.floor(Date.now() / EVERY) * EVERY;
  const [m, t, positions, tvlUsd, f, accts] = await Promise.all([meta(), ticker(), allPositions(), tvl(), funding(), accounts()]);
  const split = new Map<string, { longUsd: number; shortUsd: number; longs: number; shorts: number }>();
  for (const p of positions) {
    const c = split.get(p.sym) ?? { longUsd: 0, shortUsd: 0, longs: 0, shorts: 0 };
    if (p.long) { c.longUsd += p.usd; c.longs++; } else { c.shortUsd += p.usd; c.shorts++; }
    split.set(p.sym, c);
  }
  const seen = new Map(positions.map((p) => [`${p.account}:${p.sym}`, { usd: p.usd, sym: p.sym, account: p.account, long: p.long }]));
  if (lastSeen) {
    for (const [k, p] of seen) if (!lastSeen.has(k) && p.usd >= SIGNAL_USD) signals.push({ ts: at, kind: 'open', account: p.account, address: null, sym: p.sym, long: p.long, usd: p.usd });
    for (const [k, p] of lastSeen) if (!seen.has(k) && p.usd >= SIGNAL_USD) signals.push({ ts: at, kind: 'close', account: p.account, address: null, sym: p.sym, long: p.long, usd: p.usd });
    if (signals.length > SIGNALS_KEPT) signals.splice(0, signals.length - SIGNALS_KEPT);
  }
  lastSeen = seen;
  let oiTotal = 0;
  sdb.exec('begin');
  try {
    for (const mk of m.markets.values()) {
      const x = t.get(mk.id);
      if (!x) continue;
      const oi = x.oi * x.mark;
      oiTotal += oi;
      const c = split.get(mk.sym) ?? { longUsd: 0, shortUsd: 0, longs: 0, shorts: 0 };
      insSnap.run(at, mk.id, x.mark, oi, c.longUsd, c.shortUsd, c.longs, c.shorts, f.get(mk.id) ?? 0);
    }
    insTotal.run(at, oiTotal, tvlUsd, accts);
    sdb.exec('commit');
  } catch (e) {
    sdb.exec('rollback');
    throw e;
  }
}

/** One sample now, then one every five minutes. A failed sample is logged and the next one tried on time. */
export function startSnapshots() {
  const tick = () => sample().catch((e: unknown) => console.warn(JSON.stringify({ service: 'stats', event: 'snapshot_failed', error: e instanceof Error ? e.message : String(e) })));
  void tick();
  setInterval(tick, EVERY).unref();
}

const selTotal = sdb.prepare('select ts, oi_usd, tvl_usd, accounts from px_snap_total where ts >= ? order by ts');
const selSnap = sdb.prepare('select ts, perp, mark, oi_usd, long_usd, short_usd, longs, shorts, funding from px_snap where ts >= ? order by ts');
const selSince = sdb.prepare('select min(ts) t from px_snap_total');

export async function history(days: number): Promise<PxHistory> {
  const m = await meta();
  const from = Date.now() - days * 86_400_000;
  const markets: Record<string, PxSnapshot[]> = {};
  for (const r of selSnap.all(from) as { ts: number; perp: number; mark: number; oi_usd: number; long_usd: number; short_usd: number; longs: number; shorts: number; funding: number }[]) {
    const sym = m.markets.get(r.perp)?.sym;
    if (!sym) continue;
    (markets[sym] ??= []).push({ t: r.ts, mark: r.mark, oiUsd: r.oi_usd, longUsd: r.long_usd, shortUsd: r.short_usd, longs: r.longs, shorts: r.shorts, funding: r.funding });
  }
  for (const k of Object.keys(markets)) markets[k] = thin(markets[k], POINTS);
  return {
    days,
    since: (selSince.get() as { t: number | null }).t,
    every: EVERY,
    total: thin((selTotal.all(from) as { ts: number; oi_usd: number; tvl_usd: number; accounts: number }[]).map((r) => ({ t: r.ts, oiUsd: r.oi_usd, tvlUsd: r.tvl_usd, accounts: r.accounts })), POINTS),
    markets,
  };
}
