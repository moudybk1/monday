// Public Perpl stats API: protocol overview, open-position risk, liquidations, leaderboard and wallet profiles.
// No session needed. Live chain and REST reads are cached in ./perpl; indexed history comes from ./indexer.

import type { FastifyInstance } from 'fastify';
import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';
import {
  retentionCohorts, spanCoverage, thin, traderDistribution, walletPerformance, weekOf, windowStartDay,
  type PxActivity, type PxCohorts, type PxFlowRow, type PxFlows, type PxLiquidation, type PxMarketRisk, type PxOverview, type PxPosition, type PxSignal, type PxTrade, type PxTrader, type PxTraderStats, type PxWallet,
} from '@monday/core';
import { history, positionSignals } from './history';
import { historyComplete, indexerStatus, KINDS, scanHoles, sdb } from './indexer';
import { accountOf, accounts, addressOf, allPositions, cached, client, dailyVolume, funding, fundingHistory, hyperliquidVolume, meta, positionsOf, statsNet, ticker, tvl } from './perpl';
import { EXCHANGE_ABI } from './exchange-abi';

const DAY = 86_400_000;
const AT_RISK_PCT = 5;
const CURVE_POINTS = 600; // a wallet's PnL curve: enough for any chart width, a few kB instead of one point per fill

const one = <T>(sql: string, ...args: (number | string)[]) => sdb.prepare(sql).get(...args) as T;
const all = <T>(sql: string, ...args: (number | string)[]) => sdb.prepare(sql).all(...args) as T[];
const addressById = (id: number) => one<{ address: string } | undefined>('select address from px_accounts where id = ?', id)?.address ?? null;

const tsAtOrAfter = sdb.prepare('select ts from px_trades where block >= ? order by block limit 1');
// Two index lookups. One query asking for min(block) and max(block) together scans every fill instead: 8 s on 19M
// fills, on the server's main thread, every time the overview refreshed, which stalled the trading socket past Perpl's ping.
const firstBlock = sdb.prepare('select block from px_trades order by block limit 1');
const lastBlock = sdb.prepare('select block from px_trades order by block desc limit 1');
const tsBefore = sdb.prepare('select ts from px_trades where block < ? order by block desc limit 1');
const fillTs = (s: typeof tsAtOrAfter, block: number) => (s.get(block) as { ts: number } | undefined)?.ts ?? null;

/** First indexed block at or after `ts`. Blocks and timestamps rise together, so a binary search on the primary key finds it. */
function blockAt(ts: number): number {
  const first = firstBlock.get() as { block: number } | undefined;
  const last = lastBlock.get() as { block: number } | undefined;
  if (!first || !last) return 0;
  let lo = first.block, hi = last.block;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = fillTs(tsAtOrAfter, mid);
    if (t != null && t < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The scanned history in time: each unscanned block range becomes a gap from the last fill before it to the first fill
 * after it (fills are the clock; on mainnet they are seconds apart). A hole from block 0 means history starts after it.
 */
function coverage(now: number, live: boolean, latestTs: number | null) {
  let start: number | null = 0;
  const gaps: { from: number; to: number }[] = [];
  for (const h of scanHoles()) {
    const to = fillTs(tsAtOrAfter, h.hi) ?? now;
    if (h.lo === 0) start = to;
    else gaps.push({ from: fillTs(tsBefore, h.lo) ?? to, to });
  }
  return { start: latestTs == null ? null : start, end: live ? now : latestTs ?? 0, gaps };
}

/** The indexer's progress right now: live when within about two minutes of the chain, and the time span it covers. */
function progress(now: number) {
  const latest = one<{ ts: number } | undefined>('select ts from px_trades order by block desc limit 1');
  const ix = indexerStatus(now);
  const live = ix.source !== 'off' && now - ix.at < 120_000 && ix.head > 0 && ix.head - ix.block < 300;
  return { latest, ix, live, cov: coverage(now, live, latest?.ts ?? null) };
}

const overview = cached(10_000, async (): Promise<PxOverview> => {
  const now = Date.now();
  const [m, t, dv, f, tvlUsd, accts, hl, positions] = await Promise.all([
    meta(), ticker(), dailyVolume(), funding(), tvl(), accounts(), hyperliquidVolume().catch(() => null), allPositions().catch(() => [] as PxPosition[]),
  ]);

  // Daily volume from Perpl's candles: every day since launch.
  const days = new Map<number, Omit<PxOverview['daily'][number], 'coverage'>>();
  for (const [id, series] of dv) {
    const sym = m.markets.get(id)!.sym;
    for (const c of series) {
      const d = days.get(c.t) ?? {
        t: c.t, volumeUsd: 0, byMarket: {} as Record<string, number>, feesUsd: null, traders: null, trades: null, newAccounts: null,
        depositsUsd: null, withdrawalsUsd: null, liquidationsUsd: null, liqLongUsd: null, liqShortUsd: null,
      };
      d.volumeUsd += c.usd;
      d.byMarket[sym] = (d.byMarket[sym] ?? 0) + c.usd;
      days.set(c.t, d);
    }
  }
  // Indexed history on top, from the day the indexer starts.
  for (const r of all<{ day: number; fees: number; traders: number; trades: number }>('select day, sum(fees) fees, sum(account != 0) traders, sum(trades) trades from px_day group by day')) {
    const d = days.get(r.day * DAY);
    if (d) Object.assign(d, { feesUsd: r.fees, traders: r.traders, trades: r.trades });
  }
  for (const r of all<{ day: number; n: number }>('select ts / 86400000 day, count(*) n from px_accounts where ts is not null group by day')) {
    const d = days.get(r.day * DAY);
    if (d) d.newAccounts = r.n;
  }
  for (const r of all<{ day: number; dep: number; wd: number }>('select ts / 86400000 day, sum(case when deposit = 1 then usd else 0 end) dep, sum(case when deposit = 0 then usd else 0 end) wd from px_flows group by day')) {
    const d = days.get(r.day * DAY);
    if (d) Object.assign(d, { depositsUsd: r.dep, withdrawalsUsd: r.wd });
  }
  for (const r of all<{ day: number; usd: number; longUsd: number }>('select ts / 86400000 day, sum(size * mark) usd, sum(case when long = 1 then size * mark else 0 end) longUsd from px_liqs group by day')) {
    const d = days.get(r.day * DAY);
    if (d) Object.assign(d, { liquidationsUsd: r.usd, liqLongUsd: r.longUsd, liqShortUsd: r.usd - r.longUsd });
  }
  const { latest, ix, live, cov } = progress(now);
  // Indexed numbers only where the day was scanned: a scanned day with no events is a real zero, an unscanned one is unknown.
  const daily = [...days.values()].sort((a, b) => a.t - b.t).map((d) => {
    const c = spanCoverage(d.t, Math.min(d.t + DAY, now), cov);
    return c === 'none' ? { ...d, coverage: c } : {
      ...d, coverage: c, feesUsd: d.feesUsd ?? 0, traders: d.traders ?? 0, trades: d.trades ?? 0, newAccounts: d.newAccounts ?? 0,
      depositsUsd: d.depositsUsd ?? 0, withdrawalsUsd: d.withdrawalsUsd ?? 0, liquidationsUsd: d.liquidationsUsd ?? 0, liqLongUsd: d.liqLongUsd ?? 0, liqShortUsd: d.liqShortUsd ?? 0,
    };
  });
  // Every period is whole UTC days with today included (7D = 7 daily buckets), except 24H, which is rolling everywhere.
  const firstDay = (n: number) => windowStartDay(now, n);
  const vol = (n: number) => daily.filter((d) => d.t >= firstDay(n) * DAY).reduce((s, d) => s + d.volumeUsd, 0);
  const full = (from: number) => spanCoverage(from, now, cov) === 'full';

  const since = one<{ d: number | null }>('select min(day) d from px_day').d;
  const indexed = since != null;
  const feesDays = (n: number) => one<{ f: number | null }>('select sum(fees) f from px_day where day >= ?', firstDay(n)).f ?? 0;
  const tradersDays = (n: number) => one<{ n: number }>('select count(distinct account) n from px_day where day >= ? and account != 0', firstDay(n)).n;
  const last24 = one<{ fees: number | null; traders: number }>('select sum(fee) fees, count(distinct account) traders from px_trades where block >= ? and account != 0', blockAt(now - DAY));
  const flow24 = one<{ net: number | null }>('select sum(case when deposit = 1 then usd else -usd end) net from px_flows where ts >= ?', now - DAY);
  const liq24 = one<{ usd: number | null }>('select sum(size * mark) usd from px_liqs where ts >= ?', now - DAY);
  const new24 = one<{ n: number }>('select count(*) n from px_accounts where ts >= ?', now - DAY);

  const counts = new Map<string, { longs: number; shorts: number }>();
  for (const p of positions) {
    const c = counts.get(p.sym) ?? { longs: 0, shorts: 0 };
    if (p.long) c.longs++;
    else c.shorts++;
    counts.set(p.sym, c);
  }

  return {
    at: now,
    network: statsNet.network,
    // Live is the indexer's own progress (head within ~2 minutes of Monad blocks), not the last trade: a quiet market is not a stale index.
    indexer: {
      source: ix.source, block: ix.block, head: ix.head, live, lagSec: latest ? Math.max(0, (now - latest.ts) / 1000) : null, since: since != null ? since * DAY : null,
      backfillDays: daily.filter((d) => d.coverage !== 'full').length,
    },
    headline: {
      complete: { '24h': full(now - DAY), '7d': full(firstDay(7) * DAY), '30d': full(firstDay(30) * DAY), all: full(daily[0]?.t ?? now) },
      volume24hUsd: [...t.values()].reduce((s, x) => s + x.volume24hUsd, 0), volume7dUsd: vol(7), volume30dUsd: vol(30), volumeAllUsd: vol(100_000),
      openInterestUsd: [...t.values()].reduce((s, x) => s + x.oi * x.mark, 0), tvlUsd, accounts: accts,
      fees24hUsd: indexed ? last24.fees ?? 0 : null, fees7dUsd: indexed ? feesDays(7) : null, fees30dUsd: indexed ? feesDays(30) : null, feesAllUsd: indexed ? feesDays(100_000) : null,
      activeTraders24h: indexed ? last24.traders : null, activeTraders7d: indexed ? tradersDays(7) : null, activeTraders30d: indexed ? tradersDays(30) : null,
      netFlow24hUsd: indexed ? flow24.net ?? 0 : null, liquidations24hUsd: indexed ? liq24.usd ?? 0 : null, newAccounts24h: indexed ? new24.n : null,
    },
    markets: [...m.markets.values()].map((mk) => {
      const x = t.get(mk.id);
      const c = counts.get(mk.sym) ?? { longs: 0, shorts: 0 };
      return {
        id: mk.id, sym: mk.sym, mark: x?.mark ?? 0, change24hPct: x && x.prev > 0 ? (x.mark / x.prev - 1) * 100 : null, volume24hUsd: x?.volume24hUsd ?? 0,
        openInterestUsd: x ? x.oi * x.mark : 0, fundingRate: f.get(mk.id) ?? 0, fundingIntervalMin: mk.fundingIntervalMin, longs: c.longs, shorts: c.shorts,
        hlVolume24hUsd: hl?.get(mk.sym) ?? null,
      };
    }).sort((a, b) => b.volume24hUsd - a.volume24hUsd),
    daily,
  };
});

const BUCKETS = 20; // liquidation map: 1% buckets out to 20% either side of mark

const risk = cached(30_000, async () => {
  const positions = await allPositions();
  const markets = new Map<string, PxMarketRisk & { map: { pct: number; longUsd: number; shortUsd: number }[] }>();
  for (const p of positions) {
    const r = markets.get(p.sym) ?? {
      sym: p.sym, mark: p.mark, longs: 0, shorts: 0, longUsd: 0, shortUsd: 0, atRiskLongUsd: 0, atRiskShortUsd: 0,
      map: Array.from({ length: BUCKETS }, (_, i) => ({ pct: i + 1, longUsd: 0, shortUsd: 0 })),
    };
    if (p.long) { r.longs++; r.longUsd += p.usd; } else { r.shorts++; r.shortUsd += p.usd; }
    markets.set(p.sym, r);
    const d = p.liqDistancePct;
    if (d == null) continue; // over-collateralised: never liquidates
    if (d < AT_RISK_PCT) { if (p.long) r.atRiskLongUsd += p.usd; else r.atRiskShortUsd += p.usd; }
    // Where liquidations sit: longs below mark, shorts above, by distance from mark.
    const b = Math.floor(Math.max(0, d));
    if (b < BUCKETS) { if (p.long) r.map[b].longUsd += p.usd; else r.map[b].shortUsd += p.usd; }
  }
  const named = (p: PxPosition): PxPosition => ({ ...p, address: addressById(p.account) ?? undefined });
  return {
    at: Date.now(),
    positions: positions.length,
    markets: [...markets.values()].sort((a, b) => b.longUsd + b.shortUsd - a.longUsd - a.shortUsd),
    nearest: positions.filter((p) => p.usd >= 10 && p.liqDistancePct != null).sort((a, b) => a.liqDistancePct! - b.liqDistancePct!).slice(0, 25).map(named),
    largest: [...positions].sort((a, b) => b.usd - a.usd).slice(0, 25).map(named),
  };
});

async function resolve(q: string): Promise<{ account: number; address: Address | null } | null> {
  if (/^\d+$/.test(q)) {
    const id = Number(q);
    const address = (addressById(id) as Address | null) ?? (await addressOf(id));
    return address || one<{ n: number }>('select count(*) n from px_trades where account = ?', id).n ? { account: id, address } : null;
  }
  if (!isAddress(q)) return null;
  const a = await accountOf(getAddress(q));
  return a ? { account: Number(a.accountId), address: getAddress(q) } : null;
}

const TRADE_CAP = 100_000; // performance is computed over at most the newest 100k fills of a wallet

async function wallet(q: string): Promise<PxWallet | null> {
  const r = await resolve(q);
  if (!r) return null;
  const m = await meta();
  const [info, positions] = await Promise.all([
    client.readContract({ address: statsNet.exchange, abi: EXCHANGE_ABI, functionName: 'getAccountById', args: [BigInt(r.account)] }),
    positionsOf(r.account),
  ]);
  const rows = all<Record<string, number>>('select * from px_trades where account = ? order by block desc, idx desc limit ?', r.account, TRADE_CAP);
  const trades: PxTrade[] = rows.map((x) => {
    const kind = KINDS[x.kind];
    const long = x.long === 1;
    const buy = kind === 'open' || kind === 'increase' || (kind === 'invert' || kind === 'fill') ? long : !long;
    return {
      ts: x.ts, block: x.block, idx: x.idx, sym: m.markets.get(x.perp)?.sym ?? `#${x.perp}`, role: x.taker ? 'taker' : 'maker', kind, side: buy ? 'buy' : 'sell', long,
      price: x.price, size: x.size, usd: x.price * x.size, fee: x.fee, pnl: x.pnl, funding: x.funding,
    };
  });
  const balance = Number(info.balanceCNS) / m.usd;
  const performance = walletPerformance(trades);
  // Standing among every account active in the last 30 days, from the same rows as the leaderboard.
  const peers = await aggregate(RANK_DAYS)();
  const mine = peers.find((a) => a.account === r.account);
  const pct = (f: (a: AggRow) => number) => (mine ? peers.filter((a) => f(a) > f(mine)).length / peers.length : null);
  const rank = { days: RANK_DAYS, accounts: peers.length, volumePct: pct((a) => a.volume), pnlPct: pct((a) => a.net) };
  // Performance reads at most TRADE_CAP fills; say how many there are, so a busy wallet is never shown as complete.
  const total = rows.length < TRADE_CAP ? rows.length : one<{ n: number }>('select count(*) n from px_trades where account = ?', r.account).n;
  return {
    network: statsNet.network, address: r.address ?? '', account: r.account, balanceUsd: balance, lockedUsd: Number(info.lockedBalanceCNS) / m.usd, frozen: info.frozen !== 0,
    equityUsd: balance + positions.reduce((s, p) => s + p.deposit + p.upnl, 0), positions,
    performance: { ...performance, curve: thin(performance.curve, CURVE_POINTS) }, trades: trades.slice(0, 300),
    flows: all<{ ts: number; deposit: number; usd: number }>('select ts, deposit, usd from px_flows where account = ? order by ts desc limit 200', r.account).map((f) => ({ ts: f.ts, kind: f.deposit ? 'deposit' : 'withdraw', usd: f.usd })),
    fills: { total, used: rows.length, since: trades.at(-1)?.ts ?? null },
    historyComplete: historyComplete() && total <= rows.length,
    rank,
  };
}

/** A profile is polled every 15 s by each viewer; reading up to 100k fills and the chain once per 10 s per wallet is enough. */
const wallets = new Map<string, { at: number; data: Promise<PxWallet | null> }>();
function walletCached(q: string): Promise<PxWallet | null> {
  const hit = wallets.get(q);
  if (hit && Date.now() - hit.at < 10_000) return hit.data;
  const data = wallet(q);
  wallets.delete(q); // re-insert at the end: the map's order is its age
  wallets.set(q, { at: Date.now(), data });
  data.catch(() => wallets.delete(q));
  if (wallets.size > 500) wallets.delete(wallets.keys().next().value!);
  return data;
}

const LIQ_ROWS = 200;
/** The newest liquidations, read once per 5 s whatever the number of viewers; each request takes the rows it asked for. */
const latestLiquidations = cached(5_000, async (): Promise<PxLiquidation[]> => {
  const m = await meta();
  return all<Record<string, number>>('select * from px_liqs order by block desc, idx desc limit ?', LIQ_ROWS).map((l) => ({
    ts: l.ts, sym: m.markets.get(l.perp)?.sym ?? `#${l.perp}`, account: l.account, address: addressById(l.account), long: l.long === 1, size: l.size, usd: l.size * l.mark, mark: l.mark, pnl: l.pnl,
  }));
});

type AggRow = { account: number; volume: number; net: number; trades: number };
const RANK_DAYS = 30;
const aggregates = new Map<number, () => Promise<AggRow[]>>();
/** One row per account active in the window: the base of the leaderboard, the distribution and every wallet's rank. */
function aggregate(days: number) {
  let f = aggregates.get(days);
  if (!f) {
    f = cached(60_000, async () => all<AggRow>('select account, sum(volume) volume, sum(net) net, sum(trades) trades from px_day where day >= ? and account != 0 group by account', windowStartDay(Date.now(), days)));
    aggregates.set(days, f);
  }
  return f;
}

const statsBoards = new Map<number, () => Promise<PxTraderStats>>();
function traderStats(days: number) {
  let f = statsBoards.get(days);
  if (!f) {
    f = cached(60_000, async (): Promise<PxTraderStats> => ({ days, ...traderDistribution((await aggregate(days)()).map((a) => ({ volumeUsd: a.volume, netUsd: a.net }))) }));
    statsBoards.set(days, f);
  }
  return f();
}

const COHORT_OFFSETS = [1, 2, 4];
/** Weekly cohorts over the whole indexed history; a cohort whose week is not fully indexed says so. */
const cohorts = cached(10 * 60_000, async (): Promise<PxCohorts> => {
  const now = Date.now();
  const { cov } = progress(now);
  const first = new Map(all<{ account: number; d: number }>('select account, min(day) d from px_day where account != 0 group by account').map((r) => [r.account, r.d]));
  const active = new Map<number, Set<number>>();
  for (const r of all<{ account: number; w: number }>('select distinct account, (day + 3) / 7 w from px_day where account != 0')) (active.get(r.account) ?? active.set(r.account, new Set()).get(r.account)!).add(r.w);
  const week = 7 * DAY;
  const weekCoverage = (start: number) => spanCoverage(start, Math.min(start + week, now), cov);
  return {
    offsets: COHORT_OFFSETS,
    // A later week that was never indexed cannot show anyone back: blank, not zero.
    cohorts: retentionCohorts(first, active, weekOf(Math.floor(now / DAY)), 12, COHORT_OFFSETS).map((c) => ({
      ...c, coverage: weekCoverage(c.week), retained: c.retained.map((v, i) => (v != null && weekCoverage(c.week + COHORT_OFFSETS[i] * week) === 'none' ? null : v)),
    })),
  };
});

const SIGNAL_DAYS = 7;
/** The feed: the week's largest deposits, withdrawals and liquidations, and large positions seen opening or closing. */
const signals = cached(10_000, async (): Promise<PxSignal[]> => {
  const m = await meta();
  const since = Date.now() - SIGNAL_DAYS * DAY;
  const flows = all<{ ts: number; account: number; deposit: number; usd: number }>('select ts, account, deposit, usd from px_flows where ts >= ? order by usd desc limit 30', since)
    .map((f): PxSignal => ({ ts: f.ts, kind: f.deposit ? 'deposit' : 'withdraw', account: f.account, address: null, usd: f.usd }));
  const liqs = all<{ ts: number; perp: number; account: number; long: number; size: number; mark: number; pnl: number }>('select ts, perp, account, long, size, mark, pnl from px_liqs where ts >= ? order by size * mark desc limit 20', since)
    .map((l): PxSignal => ({ ts: l.ts, kind: 'liquidation', account: l.account, address: null, sym: m.markets.get(l.perp)?.sym ?? `#${l.perp}`, long: l.long === 1, usd: l.size * l.mark, pnl: l.pnl }));
  return [...flows, ...liqs, ...positionSignals()].sort((a, b) => b.ts - a.ts).slice(0, 40).map((x) => ({ ...x, address: x.address ?? addressById(x.account) }));
});

/** Leaderboard windows, in whole UTC days with today included, the same days as the overview's 7D and 30D. */
const TRADER_DAYS = [1, 7, 30, 90, 365];
const boards = new Map<string, () => Promise<PxTrader[]>>();
function leaderboard(days: number, sort: 'net' | 'volume' | 'loss') {
  const key = `${days}:${sort}`;
  let board = boards.get(key);
  if (!board) {
    const order = sort === 'volume' ? 'volume desc' : sort === 'loss' ? 'net asc' : 'net desc';
    board = cached(30_000, async () => all<{ account: number; volume: number; net: number; trades: number }>(
      `select account, sum(volume) volume, sum(net) net, sum(trades) trades from px_day where day >= ? and account != 0 group by account order by ${order} limit 25`,
      windowStartDay(Date.now(), days),
    ).map((t) => ({ account: t.account, address: addressById(t.account), volumeUsd: t.volume, netUsd: t.net, trades: t.trades })));
    boards.set(key, board);
  }
  return board;
}

const ACTIVITY_DAYS = 7;
/**
 * When Perpl trades: taker fills by UTC weekday and hour over the last week. Every fill has a taker row and a maker row,
 * so taker rows alone count each trade once. ponytail: one 7-day scan of px_trades (about a second) every 10 minutes,
 * on this process's thread; an hourly rollup table if it ever shows in the API's latency.
 */
const activity = cached(10 * 60_000, async (): Promise<PxActivity> => {
  const now = Date.now();
  const since = now - ACTIVITY_DAYS * DAY;
  const cells = all<{ dow: number; hour: number; trades: number; usd: number }>(
    'select (ts / 86400000 + 4) % 7 dow, (ts / 3600000) % 24 hour, count(*) trades, sum(price * size) usd from px_trades where block >= ? and taker = 1 group by dow, hour',
    blockAt(since),
  );
  return { days: ACTIVITY_DAYS, since, cells, trades: cells.reduce((s, c) => s + c.trades, 0), usd: cells.reduce((s, c) => s + c.usd, 0) };
});

const FLOW_DAYS = [1, 7, 30];
const flowBoards = new Map<number, () => Promise<PxFlows>>();
/** Who moved collateral: the accounts behind the window's largest deposits and withdrawals. */
function flows(days: number) {
  let f = flowBoards.get(days);
  if (!f) {
    f = cached(30_000, async (): Promise<PxFlows> => {
      const since = Date.now() - days * DAY;
      const side = (deposit: 0 | 1): PxFlowRow[] => all<{ account: number; usd: number; n: number; lastTs: number }>(
        'select account, sum(usd) usd, count(*) n, max(ts) lastTs from px_flows where ts >= ? and deposit = ? group by account order by usd desc limit 10', since, deposit,
      ).map((r) => ({ ...r, address: addressById(r.account) }));
      const tot = one<{ dep: number | null; wd: number | null; depositors: number; withdrawers: number }>(
        'select sum(case when deposit = 1 then usd end) dep, sum(case when deposit = 0 then usd end) wd, count(distinct case when deposit = 1 then account end) depositors, count(distinct case when deposit = 0 then account end) withdrawers from px_flows where ts >= ?', since,
      );
      return { days, depositsUsd: tot.dep ?? 0, withdrawalsUsd: tot.wd ?? 0, depositors: tot.depositors, withdrawers: tot.withdrawers, deposits: side(1), withdrawals: side(0) };
    });
    flowBoards.set(days, f);
  }
  return f();
}

export function registerStats(app: FastifyInstance) {
  // Load once at boot, so the first visitor gets numbers at once (every later refresh happens in the background).
  void overview().catch(() => {});
  void risk().catch(() => {});
  app.get('/api/stats/overview', () => overview());
  app.get('/api/stats/risk', () => risk());
  app.get('/api/stats/liquidations', async (req): Promise<PxLiquidation[]> => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(LIQ_ROWS).default(50) }).parse(req.query);
    return (await latestLiquidations()).slice(0, limit);
  });
  app.get('/api/stats/traders', async (req): Promise<PxTrader[]> => {
    const q = z.object({ days: z.coerce.number().int().refine((d) => TRADER_DAYS.includes(d), `days must be one of ${TRADER_DAYS.join(', ')}`).default(7), sort: z.enum(['net', 'volume', 'loss']).default('net') }).parse(req.query);
    return leaderboard(q.days, q.sort)();
  });
  app.get('/api/stats/history', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().refine((d) => [1, 7, 30].includes(d), 'days must be 1, 7 or 30').default(7) }).parse(req.query);
    return history(days);
  });
  app.get('/api/stats/funding', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().refine((d) => [7, 30].includes(d), 'days must be 7 or 30').default(7) }).parse(req.query);
    return fundingHistory(days);
  });
  app.get('/api/stats/activity', () => activity());
  app.get('/api/stats/traders/stats', async (req): Promise<PxTraderStats> => {
    const { days } = z.object({ days: z.coerce.number().int().refine((d) => TRADER_DAYS.includes(d), `days must be one of ${TRADER_DAYS.join(', ')}`).default(30) }).parse(req.query);
    return traderStats(days);
  });
  app.get('/api/stats/cohorts', () => cohorts());
  app.get('/api/stats/signals', () => signals());
  app.get('/api/stats/flows', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().refine((d) => FLOW_DAYS.includes(d), `days must be one of ${FLOW_DAYS.join(', ')}`).default(1) }).parse(req.query);
    return flows(days);
  });
  app.get('/api/stats/wallet/:q', async (req, reply) => {
    const q = String((req.params as { q: string }).q).trim().toLowerCase();
    const w = await walletCached(q);
    if (!w) return reply.status(404).send({ error: 'not_found', message: 'No Perpl account for that address or account id.' });
    return w;
  });
}
