// Public Perpl stats API: protocol overview, open-position risk, liquidations, leaderboard and wallet profiles.
// No session needed. Live chain and REST reads are cached in ./perpl; indexed history comes from ./indexer.

import type { FastifyInstance } from 'fastify';
import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';
import { walletPerformance, type PxLiquidation, type PxMarketRisk, type PxOverview, type PxPosition, type PxTrade, type PxTrader, type PxWallet } from '@monday/core';
import { historyComplete, indexerStatus, KINDS, sdb } from './indexer';
import { accountOf, accounts, addressOf, allPositions, client, dailyVolume, funding, hyperliquidVolume, meta, positionsOf, statsNet, ticker, tvl } from './perpl';
import { EXCHANGE_ABI } from './exchange-abi';

const DAY = 86_400_000;
const AT_RISK_PCT = 5;

function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let p: Promise<T> | null = null;
  return () => {
    if (p && Date.now() - at < ttlMs) return p;
    at = Date.now();
    p = load();
    p.catch(() => (p = null));
    return p;
  };
}

const one = <T>(sql: string, ...args: (number | string)[]) => sdb.prepare(sql).get(...args) as T;
const all = <T>(sql: string, ...args: (number | string)[]) => sdb.prepare(sql).all(...args) as T[];
const addressById = (id: number) => one<{ address: string } | undefined>('select address from px_accounts where id = ?', id)?.address ?? null;

/** First indexed block at or after `ts`. Blocks and timestamps rise together, so a binary search on the primary key finds it. */
function blockAt(ts: number): number {
  const b = one<{ lo: number | null; hi: number | null }>('select min(block) lo, max(block) hi from px_trades');
  if (b.lo == null || b.hi == null) return 0;
  let lo = b.lo, hi = b.hi;
  const tsFrom = sdb.prepare('select ts from px_trades where block >= ? order by block limit 1');
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = tsFrom.get(mid) as { ts: number } | undefined;
    if (r && r.ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const overview = cached(10_000, async (): Promise<PxOverview> => {
  const now = Date.now();
  const [m, t, dv, f, tvlUsd, accts, hl, positions] = await Promise.all([
    meta(), ticker(), dailyVolume(), funding(), tvl(), accounts(), hyperliquidVolume().catch(() => null), allPositions().catch(() => [] as PxPosition[]),
  ]);

  // Daily volume from Perpl's candles: every day since launch.
  const days = new Map<number, PxOverview['daily'][number]>();
  for (const [id, series] of dv) {
    const sym = m.markets.get(id)!.sym;
    for (const c of series) {
      const d = days.get(c.t) ?? { t: c.t, volumeUsd: 0, byMarket: {}, feesUsd: null, traders: null, depositsUsd: null, withdrawalsUsd: null, liquidationsUsd: null };
      d.volumeUsd += c.usd;
      d.byMarket[sym] = (d.byMarket[sym] ?? 0) + c.usd;
      days.set(c.t, d);
    }
  }
  // Indexed history on top, from the day the indexer starts.
  for (const r of all<{ day: number; fees: number; traders: number }>('select day, sum(fees) fees, sum(account != 0) traders from px_day group by day')) {
    const d = days.get(r.day * DAY);
    if (d) Object.assign(d, { feesUsd: r.fees, traders: r.traders });
  }
  for (const r of all<{ day: number; dep: number; wd: number }>('select ts / 86400000 day, sum(case when deposit = 1 then usd else 0 end) dep, sum(case when deposit = 0 then usd else 0 end) wd from px_flows group by day')) {
    const d = days.get(r.day * DAY);
    if (d) Object.assign(d, { depositsUsd: r.dep, withdrawalsUsd: r.wd });
  }
  for (const r of all<{ day: number; usd: number }>('select ts / 86400000 day, sum(size * mark) usd from px_liqs group by day')) {
    const d = days.get(r.day * DAY);
    if (d) d.liquidationsUsd = r.usd;
  }
  const daily = [...days.values()].sort((a, b) => a.t - b.t);
  const vol = (ms: number) => daily.filter((d) => d.t >= now - ms).reduce((s, d) => s + d.volumeUsd, 0);

  const since = one<{ d: number | null }>('select min(day) d from px_day').d;
  const indexed = since != null;
  const dayCut = (n: number) => Math.floor((now - n * DAY) / DAY);
  const feesDays = (n: number) => one<{ f: number | null }>('select sum(fees) f from px_day where day >= ?', dayCut(n)).f ?? 0;
  const tradersDays = (n: number) => one<{ n: number }>('select count(distinct account) n from px_day where day >= ? and account != 0', dayCut(n)).n;
  const b24 = blockAt(now - DAY);
  const last24 = one<{ fees: number | null; traders: number }>('select sum(fee) fees, count(distinct account) traders from px_trades where block >= ? and account != 0', b24);
  const flow24 = one<{ net: number | null }>('select sum(case when deposit = 1 then usd else -usd end) net from px_flows where ts >= ?', now - DAY);
  const liq24 = one<{ usd: number | null }>('select sum(size * mark) usd from px_liqs where ts >= ?', now - DAY);
  const latest = one<{ ts: number } | undefined>('select ts from px_trades order by block desc limit 1');
  const ix = indexerStatus(now);

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
    indexer: { source: ix.source, block: ix.block, head: ix.head, live: ix.source !== 'off' && now - ix.at < 120_000 && ix.head > 0 && ix.head - ix.block < 300, lagSec: latest ? Math.max(0, (now - latest.ts) / 1000) : null, since: since != null ? since * DAY : null },
    headline: {
      volume24hUsd: [...t.values()].reduce((s, x) => s + x.volume24hUsd, 0), volume7dUsd: vol(7 * DAY), volume30dUsd: vol(30 * DAY), volumeAllUsd: vol(Infinity),
      openInterestUsd: [...t.values()].reduce((s, x) => s + x.oi * x.mark, 0), tvlUsd, accounts: accts,
      fees24hUsd: indexed ? last24.fees ?? 0 : null, fees7dUsd: indexed ? feesDays(7) : null, fees30dUsd: indexed ? feesDays(30) : null, feesAllUsd: indexed ? feesDays(100_000) : null,
      activeTraders24h: indexed ? last24.traders : null, activeTraders7d: indexed ? tradersDays(7) : null, activeTraders30d: indexed ? tradersDays(30) : null,
      netFlow24hUsd: indexed ? flow24.net ?? 0 : null, liquidations24hUsd: indexed ? liq24.usd ?? 0 : null,
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
    if (p.liqDistancePct < AT_RISK_PCT) { if (p.long) r.atRiskLongUsd += p.usd; else r.atRiskShortUsd += p.usd; }
    // Where liquidations sit: longs below mark, shorts above, by distance from mark.
    const b = Math.floor(Math.max(0, p.liqDistancePct));
    if (b < BUCKETS) { if (p.long) r.map[b].longUsd += p.usd; else r.map[b].shortUsd += p.usd; }
    markets.set(p.sym, r);
  }
  const named = (p: PxPosition): PxPosition => ({ ...p, address: addressById(p.account) ?? undefined });
  return {
    at: Date.now(),
    positions: positions.length,
    markets: [...markets.values()].sort((a, b) => b.longUsd + b.shortUsd - a.longUsd - a.shortUsd),
    nearest: positions.filter((p) => p.usd >= 10).sort((a, b) => a.liqDistancePct - b.liqDistancePct).slice(0, 25).map(named),
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
  return {
    address: r.address ?? '', account: r.account, balanceUsd: balance, lockedUsd: Number(info.lockedBalanceCNS) / m.usd, frozen: info.frozen !== 0,
    equityUsd: balance + positions.reduce((s, p) => s + p.deposit + p.upnl, 0), positions,
    performance: walletPerformance(trades), trades: trades.slice(0, 300),
    flows: all<{ ts: number; deposit: number; usd: number }>('select ts, deposit, usd from px_flows where account = ? order by ts desc limit 200', r.account).map((f) => ({ ts: f.ts, kind: f.deposit ? 'deposit' : 'withdraw', usd: f.usd })),
    historyComplete: historyComplete(),
  };
}

export function registerStats(app: FastifyInstance) {
  app.get('/api/stats/overview', () => overview());
  app.get('/api/stats/risk', () => risk());
  app.get('/api/stats/liquidations', async (req): Promise<PxLiquidation[]> => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const m = await meta();
    return all<Record<string, number>>('select * from px_liqs order by block desc, idx desc limit ?', limit).map((l) => ({
      ts: l.ts, sym: m.markets.get(l.perp)?.sym ?? `#${l.perp}`, account: l.account, address: addressById(l.account), long: l.long === 1, size: l.size, usd: l.size * l.mark, mark: l.mark, pnl: l.pnl,
    }));
  });
  app.get('/api/stats/traders', async (req): Promise<PxTrader[]> => {
    const { days, sort } = z.object({ days: z.coerce.number().int().min(1).max(3650).default(7), sort: z.enum(['net', 'volume', 'loss']).default('net') }).parse(req.query);
    const order = sort === 'volume' ? 'volume desc' : sort === 'loss' ? 'net asc' : 'net desc';
    return all<{ account: number; volume: number; net: number; trades: number }>(
      `select account, sum(volume) volume, sum(net) net, sum(trades) trades from px_day where day >= ? and account != 0 group by account order by ${order} limit 25`,
      Math.floor((Date.now() - days * DAY) / DAY),
    ).map((t) => ({ account: t.account, address: addressById(t.account), volumeUsd: t.volume, netUsd: t.net, trades: t.trades }));
  });
  app.get('/api/stats/wallet/:q', async (req, reply) => {
    const q = String((req.params as { q: string }).q).trim();
    const w = await wallet(q);
    if (!w) return reply.status(404).send({ error: 'not_found', message: 'No Perpl account for that address or account id.' });
    return w;
  });
}
