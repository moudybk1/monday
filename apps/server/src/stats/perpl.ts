// Read side of the public Perpl stats: every market (not only the three Monday trades), Perpl's public REST,
// and the Exchange contract's views. Each source is cached for as long as its data stays useful.

import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { candleScale, liquidationPrice, type PxPosition } from '@monday/core';
import { config, NETWORKS } from '../config';
import { EXCHANGE_ABI } from './exchange-abi';

const net = NETWORKS[config.stats.network];
export const statsNet = {
  network: config.stats.network,
  api: net.perplApi,
  exchange: net.exchange as Address,
  // Monday's own RPC when it serves the same chain; the public one otherwise.
  rpcUrl: config.stats.network === config.network ? config.perpl.rpcUrl : net.rpcUrl,
  explorerUrl: net.explorerUrl,
  hypersync: config.stats.network === 'mainnet' ? 'https://monad.hypersync.xyz' : 'https://monad-testnet.hypersync.xyz',
};
export const client = createPublicClient({ transport: http(statsNet.rpcUrl, { batch: true, retryCount: 2 }) });

/**
 * Fresh for `ttlMs`, then stale-while-revalidate: callers get the last value at once while a single refresh runs in the
 * background, so no request waits on Perpl or the chain once a value has loaded. Only the first call waits. A failed
 * refresh keeps the last good value and is tried again on the next call.
 */
export function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let last: { value: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  const refresh = () => (inflight ??= load()
    .then((value) => {
      last = { value, at: Date.now() };
      return value;
    })
    .finally(() => (inflight = null)));
  return () => {
    if (!last) return refresh();
    if (Date.now() - last.at >= ttlMs) refresh().catch(() => {});
    return Promise.resolve(last.value);
  };
}

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${statsNet.api}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) return (await res.json()) as T;
    if ((res.status !== 429 && res.status !== 503) || attempt === 3) throw new Error(`Perpl GET ${path} -> ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

export interface MarketMeta {
  id: number;
  sym: string;
  px: number; // 10^price decimals
  sz: number; // 10^size decimals
  maintLev: number; // maintenance margin as leverage: 25 means 4%
  fundingIntervalMin: number;
}
export interface Meta {
  usd: number; // 10^collateral decimals
  token: Address;
  markets: Map<number, MarketMeta>;
}

interface Ctx {
  instances: { id: number; address: string; collateral_token_id: number }[];
  tokens: { id?: number; address?: string; decimals: number }[];
  markets: { id: number; instance_id: number; symbol: string; name?: string; funding_interval_sec?: number; config: { price_decimals: number; size_decimals: number; maintenance_margin: number } }[];
}

export const meta = cached(3_600_000, async (): Promise<Meta> => {
  const c = await getJson<Ctx>('/v1/pub/context');
  const inst = c.instances.find((i) => i.address.toLowerCase() === statsNet.exchange.toLowerCase());
  if (!inst) throw new Error(`Perpl context has no exchange at ${statsNet.exchange}`);
  const token = c.tokens.find((t) => t.id === inst.collateral_token_id);
  if (!token?.address) throw new Error('Perpl context has no collateral token');
  const markets = new Map<number, MarketMeta>();
  for (const m of c.markets) {
    if (m.instance_id !== inst.id) continue;
    // Mainnet leaves `symbol` empty for some markets and puts the ticker first in `name`.
    const sym = (m.symbol || (m.name ?? '').split(/\s/)[0] || `#${m.id}`).toUpperCase();
    markets.set(m.id, {
      id: m.id, sym, px: 10 ** m.config.price_decimals, sz: 10 ** m.config.size_decimals,
      maintLev: m.config.maintenance_margin / 100, fundingIntervalMin: Math.round((m.funding_interval_sec ?? 3600) / 60),
    });
  }
  return { usd: 10 ** token.decimals, token: token.address as Address, markets };
});

export interface Tick { mark: number; prev: number; volume24hUsd: number; oi: number; positionsTvlUsd: number }
/** Every market's state, one request, fresh to a few seconds. */
export const ticker = cached(5_000, async (): Promise<Map<number, Tick>> => {
  const [m, t] = await Promise.all([meta(), getJson<{ d: Record<string, { mrk: number; prv: number; dva: string; oi: number; tvl: string }> }>('/v1/market-data/ticker')]);
  const out = new Map<number, Tick>();
  for (const [id, s] of Object.entries(t.d)) {
    const mk = m.markets.get(Number(id));
    if (!mk) continue;
    out.set(mk.id, { mark: s.mrk / mk.px, prev: s.prv / mk.px, volume24hUsd: Number(s.dva) / m.usd, oi: s.oi / mk.sz, positionsTvlUsd: Number(s.tvl) / m.usd });
  }
  return out;
});

type Candles = { d?: { t: number; v?: string }[] };
const scales = new Map<number, number>();

/**
 * Daily traded volume per market since Perpl launched, from its own candles. `v` is wire price x wire size, so it
 * scales by px * sz, then by each market's calibration against the ticker (see candleScale: ETH's candles are 10x).
 */
export const dailyVolume = cached(10 * 60_000, async (): Promise<Map<number, { t: number; usd: number }[]>> => {
  const [m, t] = await Promise.all([meta(), ticker()]);
  const now = Date.now();
  const from = Date.UTC(2025, 0, 1); // before mainnet launch; 1,024 daily candles per call covers it
  const out = new Map<number, { t: number; usd: number }[]>();
  await Promise.all([...m.markets.values()].map(async (mk) => {
    const unit = mk.px * mk.sz;
    const [days, hours] = await Promise.all([
      getJson<Candles>(`/v1/market-data/${mk.id}/candles/86400/${from}-${now}`),
      getJson<Candles>(`/v1/market-data/${mk.id}/candles/3600/${now - 86_400_000}-${now}`),
    ]);
    const hourly = (hours.d ?? []).reduce((s, c) => s + Number(c.v ?? 0), 0) / unit;
    const scale = candleScale(hourly, t.get(mk.id)?.volume24hUsd ?? 0);
    if (scale !== (scales.get(mk.id) ?? 1)) console.warn(JSON.stringify({ service: 'stats', event: 'candle_scale', market: mk.sym, scale }));
    scales.set(mk.id, scale);
    out.set(mk.id, (days.d ?? []).map((c) => ({ t: c.t, usd: Number(c.v ?? 0) / unit / scale })));
  }));
  return out;
});

export const funding = cached(60_000, async (): Promise<Map<number, number>> => {
  const [m, r] = await Promise.all([meta(), getJson<{ d?: Record<string, { rate: number }[]> }>(`/v1/market-data/funding/${Date.now() - 6 * 3_600_000}-${Date.now()}`).catch(() => ({ d: {} as Record<string, { rate: number }[]> }))]);
  const out = new Map<number, number>();
  for (const [id, evs] of Object.entries(r.d ?? {})) if (m.markets.has(Number(id)) && evs.length) out.set(Number(id), evs[evs.length - 1].rate / 1e6);
  return out;
});

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
/** Collateral the Exchange holds: free balances, position deposits and insurance together. */
export const tvl = cached(30_000, async () => {
  const m = await meta();
  const bal = await client.readContract({ address: m.token, abi: ERC20, functionName: 'balanceOf', args: [statsNet.exchange] });
  return Number(bal) / m.usd;
});

export const accounts = cached(60_000, async () => Number(await client.readContract({ address: statsNet.exchange, abi: EXCHANGE_ABI, functionName: 'numberOfAccounts' })));

/** Hyperliquid 24h notional volume per coin, for market-share context. */
export const hyperliquidVolume = cached(5 * 60_000, async (): Promise<Map<string, number>> => {
  const res = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }), signal: AbortSignal.timeout(10_000) });
  const [m, ctxs] = (await res.json()) as [{ universe: { name: string }[] }, { dayNtlVlm: string }[]];
  return new Map(m.universe.map((u, i) => [u.name.toUpperCase(), Number(ctxs[i]?.dayNtlVlm ?? 0)]));
});

type RawPosition = { accountId: bigint; positionType: number; depositCNS: bigint; pricePNS: bigint; lotLNS: bigint; premiumPnlCNS: bigint };

export function toPosition(mk: MarketMeta, usd: number, p: RawPosition, mark: number): PxPosition {
  const long = p.positionType === 0;
  const size = Number(p.lotLNS) / mk.sz;
  const entry = Number(p.pricePNS) / mk.px;
  const deposit = Number(p.depositCNS) / usd;
  const premium = Number(p.premiumPnlCNS) / usd;
  const liq = liquidationPrice(long, entry, size, deposit, premium, mk.maintLev);
  const upnl = (long ? 1 : -1) * (mark - entry) * size + premium;
  return {
    sym: mk.sym, account: Number(p.accountId), long, size, entry, mark, usd: size * mark, deposit,
    leverage: deposit > 0 ? (size * mark) / deposit : 0, upnl, liqPrice: liq,
    liqDistancePct: liq > 0 && mark > 0 ? (long ? (mark - liq) / mark : (liq - mark) / mark) * 100 : null,
  };
}

/** Every open position on the exchange, walked page by page through the Exchange's position list. */
export const allPositions = cached(30_000, async (): Promise<PxPosition[]> => {
  const [m, t] = await Promise.all([meta(), ticker()]);
  const out: PxPosition[] = [];
  await Promise.all([...m.markets.values()].map(async (mk) => {
    let start = 0n;
    for (let page = 0; page < 200; page++) {
      const [ps, , markPNS] = await client.readContract({ address: statsNet.exchange, abi: EXCHANGE_ABI, functionName: 'getPositionsV2', args: [BigInt(mk.id), start, 100n] });
      const mark = t.get(mk.id)?.mark ?? Number(markPNS) / mk.px;
      for (const p of ps) if (p.lotLNS > 0n) out.push(toPosition(mk, m.usd, p, mark));
      const next = ps.at(-1)?.nextNodeId ?? 0n;
      if (ps.length < 100 || next === 0n) break;
      start = next; // the next page starts at this node
    }
  }));
  return out;
});

export async function accountOf(address: Address) {
  try {
    const a = await client.readContract({ address: statsNet.exchange, abi: EXCHANGE_ABI, functionName: 'getAccountByAddr', args: [address] });
    return a.accountId === 0n ? null : a;
  } catch {
    return null; // the Exchange reverts for an address with no account
  }
}

export async function addressOf(accountId: number): Promise<Address | null> {
  try {
    const a = await client.readContract({ address: statsNet.exchange, abi: EXCHANGE_ABI, functionName: 'getAccountById', args: [BigInt(accountId)] });
    return a.accountId === 0n ? null : a.accountAddr;
  } catch {
    return null;
  }
}

/** One account's open positions, read live from the Exchange (one call per market, batched). */
export async function positionsOf(accountId: number): Promise<PxPosition[]> {
  const [m, t] = await Promise.all([meta(), ticker()]);
  const rows = await Promise.all([...m.markets.values()].map(async (mk) => {
    const [p] = await client.readContract({ address: statsNet.exchange, abi: EXCHANGE_ABI, functionName: 'getPositionV2', args: [BigInt(mk.id), BigInt(accountId)] });
    return p.lotLNS > 0n ? toPosition(mk, m.usd, p, t.get(mk.id)?.mark ?? 0) : null;
  }));
  return rows.filter((p): p is PxPosition => p !== null);
}
