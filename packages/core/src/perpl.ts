// Perpl protocol and wallet analytics (the public Stats pages). Pure: the server indexes Perpl's
// Exchange events and reads its views, these functions turn rows into numbers.

const DAY = 86_400_000;

export type PxTradeKind = 'open' | 'increase' | 'decrease' | 'close' | 'invert' | 'liquidation' | 'fill';

/** One fill of one account, joined with the position event the Exchange emits just before it. */
export interface PxTrade {
  ts: number;
  block: number;
  idx: number; // log index: block and idx identify the fill
  sym: string;
  role: 'maker' | 'taker';
  kind: PxTradeKind;
  side: 'buy' | 'sell';
  long: boolean; // the position's direction after the event
  price: number;
  size: number; // base units
  usd: number;
  fee: number;
  pnl: number; // realised price PnL, before fees and funding
  funding: number; // realised funding PnL, positive is received
}

export interface PxPosition {
  sym: string;
  account: number;
  address?: string;
  long: boolean;
  size: number;
  entry: number;
  mark: number;
  usd: number; // notional at mark
  deposit: number; // collateral posted to the position
  leverage: number; // notional over deposit
  upnl: number;
  liqPrice: number;
  /** How far mark must move against the position before it liquidates, percent of mark. Null: it cannot be liquidated. */
  liqDistancePct: number | null;
}

export interface PxMarketRisk {
  sym: string;
  mark: number;
  longs: number;
  shorts: number;
  longUsd: number;
  shortUsd: number;
  /** Notional within 5% of its liquidation price, per side. */
  atRiskLongUsd: number;
  atRiskShortUsd: number;
}

export interface PxMarketRow {
  id: number;
  sym: string;
  mark: number;
  change24hPct: number | null;
  volume24hUsd: number;
  openInterestUsd: number;
  fundingRate: number; // per interval, fraction
  fundingIntervalMin: number;
  longs: number;
  shorts: number;
  hlVolume24hUsd: number | null; // Hyperliquid, for market share
}

/** How much of a span the indexer has scanned: all of it, some, or none. A scanned span with no events is full. */
export type Coverage = 'full' | 'partial' | 'none';
export type PxWindow = '24h' | '7d' | '30d' | 'all';

export interface PxOverview {
  at: number;
  network: 'mainnet' | 'testnet';
  /**
   * live: the indexer is running and caught up with the chain. lagSec: age of the newest indexed trade.
   * backfillDays: days of history not fully scanned yet; the indexer fills them newest first.
   */
  indexer: { source: 'hypersync' | 'rpc' | 'off'; block: number; head: number; live: boolean; lagSec: number | null; since: number | null; backfillDays: number };
  headline: {
    /** Whether the indexed numbers (fees, traders, flows, liquidations) cover the whole window. */
    complete: Record<PxWindow, boolean>;
    volume24hUsd: number; volume7dUsd: number; volume30dUsd: number; volumeAllUsd: number;
    openInterestUsd: number; tvlUsd: number; accounts: number;
    fees24hUsd: number | null; fees7dUsd: number | null; fees30dUsd: number | null; feesAllUsd: number | null;
    activeTraders24h: number | null; activeTraders7d: number | null; activeTraders30d: number | null;
    netFlow24hUsd: number | null; liquidations24hUsd: number | null; newAccounts24h: number | null;
  };
  markets: PxMarketRow[];
  /** Daily (UTC), oldest first. Volume from Perpl candles (all time); the rest from indexed events, null where the day was never scanned. */
  daily: {
    t: number; volumeUsd: number; byMarket: Record<string, number>; coverage: Coverage;
    feesUsd: number | null; traders: number | null; trades: number | null; newAccounts: number | null;
    depositsUsd: number | null; withdrawalsUsd: number | null; liquidationsUsd: number | null; liqLongUsd: number | null; liqShortUsd: number | null;
  }[];
}

/** One market every five minutes: open interest, how it splits by side, funding and mark. */
export interface PxSnapshot { t: number; mark: number; oiUsd: number; longUsd: number; shortUsd: number; longs: number; shorts: number; funding: number }
export interface PxHistory {
  days: number;
  /** When sampling began: the series cannot reach further back. */
  since: number | null;
  every: number;
  total: { t: number; oiUsd: number; tvlUsd: number; accounts: number }[];
  markets: Record<string, PxSnapshot[]>;
}
/** Funding per interval (a fraction), from Perpl's own history. */
export interface PxFunding { days: number; markets: Record<string, { intervalMin: number; points: { t: number; rate: number }[] }> }
/** Fills by UTC weekday (0 is Sunday) and hour over the last `days` days. */
export interface PxActivity { days: number; since: number; cells: { dow: number; hour: number; trades: number; usd: number }[]; trades: number; usd: number }
export interface PxFlowRow { account: number; address: string | null; usd: number; n: number; lastTs: number }
/** Every active account's result over a window: who made money, how it is spread, and how concentrated volume is. */
export interface PxTraderStats {
  days: number;
  accounts: number;
  profitable: number;
  losing: number;
  /** Accounts that traded but realised nothing (open positions only). */
  flat: number;
  medianNetUsd: number | null;
  meanNetUsd: number | null;
  /** Accounts by net PnL, biggest losses first. */
  buckets: { label: string; lo: number; hi: number; n: number }[];
  volumeUsd: number;
  top10Share: number;
  top50Share: number;
}
/** Traders by the week of their first fill, and the share that traded again one, two and four weeks later. */
export interface PxCohort { week: number; coverage: Coverage; size: number; retained: (number | null)[] }
export interface PxCohorts { offsets: number[]; cohorts: PxCohort[] }
/** Something worth a second look: a large deposit or withdrawal, a liquidation, a large position opened or closed. */
export interface PxSignal { ts: number; kind: 'deposit' | 'withdraw' | 'liquidation' | 'open' | 'close'; account: number; address: string | null; sym?: string; long?: boolean; usd: number; pnl?: number }
export interface PxFlows { days: number; depositsUsd: number; withdrawalsUsd: number; depositors: number; withdrawers: number; deposits: PxFlowRow[]; withdrawals: PxFlowRow[] }

export interface PxLiquidation {
  ts: number;
  sym: string;
  account: number;
  address: string | null;
  long: boolean;
  size: number;
  usd: number;
  mark: number;
  pnl: number;
}

export interface PxTrader {
  account: number;
  address: string | null;
  volumeUsd: number;
  netUsd: number;
  trades: number;
}

export interface WalletSide { closes: number; wins: number; netUsd: number; volumeUsd: number }
export interface WalletPerformance {
  trades: number;
  closes: number;
  volumeUsd: number;
  makerVolumeUsd: number;
  feesUsd: number;
  fundingUsd: number;
  pnlUsd: number; // price PnL
  netUsd: number; // price PnL + funding - fees
  winRate: number | null;
  /** Gross wins over gross losses. Null without a losing close: then a winRate of 1 means no losses at all. */
  profitFactor: number | null;
  grossWinUsd: number;
  grossLossUsd: number;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  largestWinUsd: number;
  largestLossUsd: number;
  maxDrawdownUsd: number;
  longestWin: number;
  longestLoss: number;
  avgHoldMin: number | null;
  firstTs: number | null;
  lastTs: number | null;
  /** Realised results by the side of the position, as the Exchange reports it on each fill. */
  sides: { long: WalletSide; short: WalletSide };
  byMarket: { sym: string; trades: number; closes: number; wins: number; volumeUsd: number; feesUsd: number; netUsd: number }[];
  /** Per UTC day with at least one fill, oldest first. `day` is the UTC midnight in ms. */
  daily: { day: number; trades: number; closes: number; wins: number; volumeUsd: number; netUsd: number }[];
  /** Fills by UTC hour of day, 24 counts. */
  hours: number[];
  /** Cumulative net PnL after each trade. */
  curve: { t: number; v: number }[];
}

export interface PxWallet {
  network: 'mainnet' | 'testnet';
  address: string;
  account: number | null;
  balanceUsd: number;
  lockedUsd: number;
  frozen: boolean;
  equityUsd: number; // balance + position deposits + unrealised PnL
  positions: PxPosition[];
  performance: WalletPerformance;
  trades: PxTrade[]; // newest first, capped
  flows: { ts: number; kind: 'deposit' | 'withdraw'; usd: number }[];
  /** The fills behind `performance`: the newest `used` of `total` indexed, starting at `since`. */
  fills: { total: number; used: number; since: number | null };
  /** True only when the exchange's history is fully indexed and `performance` covers every one of this wallet's fills. */
  historyComplete: boolean;
  /** Where this wallet stands among every account active in the last `days` days: 0.04 means the top 4%. Null: not active. */
  rank: { days: number; accounts: number; volumePct: number | null; pnlPct: number | null };
}

/** A block range [lo, hi) the indexer has scanned end to end. */
export interface BlockRange {
  lo: number;
  hi: number;
}

/** Ranges below `below` that were never scanned, oldest first: everything back to block 0 counts. */
export function holesOf(ranges: BlockRange[], below: number): BlockRange[] {
  const out: BlockRange[] = [];
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.lo - b.lo)) {
    if (at >= below) break;
    if (r.lo > at) out.push({ lo: at, hi: Math.min(r.lo, below) });
    at = Math.max(at, r.hi);
  }
  if (at < below) out.push({ lo: at, hi: below });
  return out;
}

/**
 * How much of the time span [from, to) the indexed history covers. `start` and `end` bound what was scanned (start null:
 * nothing yet), `gaps` are unscanned spans inside them.
 */
export function spanCoverage(from: number, to: number, c: { start: number | null; end: number; gaps: { from: number; to: number }[] }): Coverage {
  if (c.start == null || to <= c.start || from >= c.end) return 'none';
  let missing = Math.max(0, c.start - from) + Math.max(0, to - c.end);
  for (const g of c.gaps) missing += Math.max(0, Math.min(to, g.to, c.end) - Math.max(from, g.from, c.start));
  return missing <= 0 ? 'full' : missing >= to - from ? 'none' : 'partial';
}

/** First UTC day (days since epoch) of an n-day window ending today. Today is one of the n days, so 7D is 7 buckets. */
export const windowStartDay = (now: number, days: number): number => Math.floor(now / DAY) - (days - 1);

/**
 * The factor Perpl's candle volume overstates a market by. Candle `v` should be traded notional in wire units, but for
 * some markets (ETH on mainnet: exactly 10x, checked against on-chain fills back to May 2026) it is off by a power of
 * ten. Calibrated against the ticker's 24h volume, which matches the trades; anything not within 20% of a power of ten
 * is left alone, since a real difference (a volume spike at the window edge) must not be "corrected".
 */
export function candleScale(candle24hUsd: number, ticker24hUsd: number): number {
  if (!(ticker24hUsd >= 10_000) || !(candle24hUsd > 0)) return 1; // too thin to compare
  const exp = Math.log10(candle24hUsd / ticker24hUsd);
  return Math.abs(exp - Math.round(exp)) <= Math.log10(1.2) ? 10 ** Math.round(exp) : 1;
}

/** At most `max` points, evenly spaced, keeping the first and the last. */
export function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

/** Perpl's liquidation price (dex-sdk Position::liquidation_price): entry moved by the margin above maintenance, per unit. */
export function liquidationPrice(long: boolean, entry: number, size: number, deposit: number, premiumPnl: number, maintLeverage: number): number {
  if (!(size > 0) || !(maintLeverage > 0)) return 0;
  const mmr = (entry * size) / maintLeverage;
  const px = entry + ((long ? 1 : -1) * (mmr - deposit - premiumPnl)) / size;
  return Math.max(0, px);
}

const REALISING: PxTradeKind[] = ['decrease', 'close', 'invert', 'liquidation'];

/** Win rate, profit factor, drawdown, streaks, hold time and the splits (side, market, day, hour) from one wallet's trades. */
export function walletPerformance(trades: PxTrade[]): WalletPerformance {
  const ts = [...trades].sort((a, b) => a.ts - b.ts || a.block - b.block);
  let cum = 0, peak = 0, dd = 0, gross = 0, grossLoss = 0, wins = 0, closes = 0, run = 0, longestWin = 0, longestLoss = 0;
  let largestWin = 0, largestLoss = 0, makerVolume = 0;
  const curve: WalletPerformance['curve'] = [];
  const opened = new Map<string, number>();
  const holds: number[] = [];
  const markets = new Map<string, WalletPerformance['byMarket'][number]>();
  const days = new Map<number, WalletPerformance['daily'][number]>();
  const hours = Array.from({ length: 24 }, () => 0);
  const side = (): WalletSide => ({ closes: 0, wins: 0, netUsd: 0, volumeUsd: 0 });
  const sides = { long: side(), short: side() };
  for (const t of ts) {
    const net = t.pnl + t.funding - t.fee;
    cum += net;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    curve.push({ t: t.ts, v: cum });
    if (t.role === 'maker') makerVolume += t.usd;
    hours[new Date(t.ts).getUTCHours()]++;
    const m = markets.get(t.sym) ?? { sym: t.sym, trades: 0, closes: 0, wins: 0, volumeUsd: 0, feesUsd: 0, netUsd: 0 };
    const day = Math.floor(t.ts / DAY) * DAY;
    const d = days.get(day) ?? { day, trades: 0, closes: 0, wins: 0, volumeUsd: 0, netUsd: 0 };
    const s = t.long ? sides.long : sides.short;
    m.trades++;
    d.trades++;
    for (const x of [m, d, s]) {
      x.volumeUsd += t.usd;
      x.netUsd += net;
    }
    m.feesUsd += t.fee;
    markets.set(t.sym, m);
    days.set(day, d);

    if (REALISING.includes(t.kind)) {
      closes++;
      m.closes++;
      d.closes++;
      s.closes++;
      if (net > 0) {
        wins++;
        m.wins++;
        d.wins++;
        s.wins++;
        gross += net;
        largestWin = Math.max(largestWin, net);
        run = run > 0 ? run + 1 : 1;
      } else {
        grossLoss -= net;
        largestLoss = Math.max(largestLoss, -net);
        run = run < 0 ? run - 1 : -1;
      }
      longestWin = Math.max(longestWin, run);
      longestLoss = Math.max(longestLoss, -run);
    }
    // Hold time: from the trade that opened a position to the one that took it to zero (an invert does both).
    const open = opened.get(t.sym);
    if ((t.kind === 'close' || t.kind === 'liquidation' || t.kind === 'invert') && open != null) {
      holds.push(t.ts - open);
      opened.delete(t.sym);
    }
    if (t.kind === 'open' || t.kind === 'invert') opened.set(t.sym, t.ts);
  }
  const losses = closes - wins;
  return {
    trades: ts.length,
    closes,
    volumeUsd: ts.reduce((s, t) => s + t.usd, 0),
    makerVolumeUsd: makerVolume,
    feesUsd: ts.reduce((s, t) => s + t.fee, 0),
    fundingUsd: ts.reduce((s, t) => s + t.funding, 0),
    pnlUsd: ts.reduce((s, t) => s + t.pnl, 0),
    netUsd: cum,
    winRate: closes ? wins / closes : null,
    profitFactor: grossLoss > 0 ? gross / grossLoss : null, // Infinity would not survive JSON
    grossWinUsd: gross,
    grossLossUsd: grossLoss,
    avgWinUsd: wins ? gross / wins : null,
    avgLossUsd: losses ? grossLoss / losses : null,
    largestWinUsd: largestWin,
    largestLossUsd: largestLoss,
    maxDrawdownUsd: dd,
    longestWin,
    longestLoss,
    avgHoldMin: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length / 60_000 : null,
    firstTs: ts[0]?.ts ?? null,
    lastTs: ts.at(-1)?.ts ?? null,
    sides,
    byMarket: [...markets.values()].sort((a, b) => b.netUsd - a.netUsd),
    daily: [...days.values()].sort((a, b) => a.day - b.day),
    hours,
    curve,
  };
}

const BUCKET_EDGES = [-Infinity, -10_000, -1_000, -100, -10, 0, 10, 100, 1_000, 10_000, Infinity];
const edgeLabel = (v: number) => (Math.abs(v) >= 1000 ? `${v < 0 ? '-' : ''}$${Math.abs(v) / 1000}k` : `${v < 0 ? '-' : ''}$${Math.abs(v)}`);

/** Who made money over a window, from one row per active account. Accounts that realised nothing are counted flat. */
export function traderDistribution(rows: { volumeUsd: number; netUsd: number }[]): Omit<PxTraderStats, 'days'> {
  const nets = rows.map((r) => r.netUsd).filter((n) => n !== 0).sort((a, b) => a - b);
  const profitable = nets.filter((n) => n > 0).length;
  const buckets = BUCKET_EDGES.slice(0, -1).map((lo, i) => {
    const hi = BUCKET_EDGES[i + 1];
    const label = lo === -Infinity ? `under ${edgeLabel(hi)}` : hi === Infinity ? `over ${edgeLabel(lo)}` : `${edgeLabel(lo)} to ${edgeLabel(hi)}`;
    return { label, lo, hi, n: nets.filter((n) => n > lo && n <= hi).length };
  });
  const vols = rows.map((r) => r.volumeUsd).sort((a, b) => b - a);
  const volumeUsd = vols.reduce((a, b) => a + b, 0);
  const share = (k: number) => (volumeUsd ? vols.slice(0, k).reduce((a, b) => a + b, 0) / volumeUsd : 0);
  const mid = nets.length >> 1;
  return {
    accounts: rows.length, profitable, losing: nets.length - profitable, flat: rows.length - nets.length,
    medianNetUsd: nets.length ? (nets.length % 2 ? nets[mid] : (nets[mid - 1] + nets[mid]) / 2) : null,
    meanNetUsd: nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : null,
    buckets, volumeUsd, top10Share: share(10), top50Share: share(50),
  };
}

/** Week number of a UTC day (days since epoch), with weeks starting on Monday. */
export const weekOf = (day: number) => Math.floor((day + 3) / 7);
export const weekStart = (week: number) => (week * 7 - 3) * DAY;

/**
 * Weekly cohorts: accounts by the week of their first fill, and the share active again `offsets` weeks later. A week
 * that has not arrived yet is null. Newest cohort first.
 */
export function retentionCohorts(firstDay: Map<number, number>, activeWeeks: Map<number, Set<number>>, thisWeek: number, count = 12, offsets = [1, 2, 4]): Omit<PxCohort, 'coverage'>[] {
  const members = new Map<number, number[]>();
  for (const [account, day] of firstDay) {
    const w = weekOf(day);
    members.set(w, [...(members.get(w) ?? []), account]);
  }
  const out: Omit<PxCohort, 'coverage'>[] = [];
  for (let w = thisWeek; w > thisWeek - count; w--) {
    const m = members.get(w) ?? [];
    out.push({
      week: weekStart(w), size: m.length,
      retained: offsets.map((k) => (w + k > thisWeek ? null : m.length ? m.filter((a) => activeWeeks.get(a)?.has(w + k)).length / m.length : 0)),
    });
  }
  return out;
}
