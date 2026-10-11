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
/** One account in the screener: its results over the window, how it trades, and its last two weeks day by day. */
export interface PxScreenRow {
  account: number;
  address: string | null;
  volumeUsd: number;
  netUsd: number;
  feesUsd: number;
  trades: number;
  closes: number;
  wins: number;
  grossWinUsd: number;
  grossLossUsd: number;
  makerVolumeUsd: number;
  activeDays: number;
  /** UTC day (ms) of the last fill in the window. */
  lastDay: number;
  /** Net PnL per UTC day over the last 14 days, oldest first; null for a day without a fill. */
  daily: (number | null)[];
  /** Consecutive profitable (positive) or losing (negative) active days, ending at the last active day. */
  streak: number;
  liquidations: number;
  liquidatedUsd: number;
}
export interface PxScreen { days: number; at: number; rows: PxScreenRow[] }
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
  /** Every time the Exchange closed one of this wallet's positions, newest first. */
  liquidations: { ts: number; sym: string; long: boolean; usd: number; pnl: number }[];
}

/** The streak a day series ends on: +n for n profitable days in a row, -n for losing ones; days without fills are skipped. */
export function streakOf(daily: (number | null)[]): number {
  const active = daily.filter((v): v is number => v != null && v !== 0);
  if (!active.length) return 0;
  const sign = Math.sign(active[active.length - 1]);
  let n = 0;
  for (let i = active.length - 1; i >= 0 && Math.sign(active[i]) === sign; i--) n++;
  return sign * n;
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

// "Ask Monday": a typed question becomes one action on the analytics pages. The quick resolver below handles the
// common shapes without a model (an address, a market, a preset); anything else goes to the model with the same schema.

export const ASK_METRICS = ['volume', 'oi', 'tvl', 'fees', 'traders', 'accounts', 'flows', 'liqs', 'funding', 'skew', 'fills'] as const;
export const ASK_PRESETS = ['all', 'winners', 'streaks', 'whales', 'makers', 'takers', 'liquidated', 'losers'] as const;
export const ASK_SORTS = ['netUsd', 'winRate', 'profitFactor', 'volumeUsd', 'trades', 'makerShare', 'activeDays', 'streak', 'liquidatedUsd', 'avgTradeUsd'] as const;
export type AskMetric = (typeof ASK_METRICS)[number];
export type AskPreset = (typeof ASK_PRESETS)[number];
export type AskSort = (typeof ASK_SORTS)[number];
export type AskDays = 1 | 7 | 30 | 90;
export type AskIntent =
  | { kind: 'wallet'; q: string }
  | { kind: 'market'; sym: string }
  | { kind: 'metric'; metric: AskMetric; sym?: string; range?: 7 | 30 | 90 | 0 }
  | { kind: 'screen'; days?: AskDays; preset?: AskPreset; minVolume?: number; minCloses?: number; sort?: AskSort; dir?: 'asc' | 'desc' }
  | { kind: 'compare'; wallets: string[] }
  | { kind: 'top'; days: AskDays; sort: 'net' | 'volume' | 'loss'; n: number }
  | { kind: 'tab'; tab: 'perpl' | 'screener' | 'compare' | 'monday' }
  | { kind: 'unknown'; reason: string };

const WALLET_RE = /^(0x[0-9a-f]{40}|#?\d{1,8})$/i;
const usdOf = (s: string) => { const m = /\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/i.exec(s); return m ? Number(m[1]) * (m[2]?.toLowerCase() === 'm' ? 1e6 : m[2] ? 1e3 : 1) : null; };

const WONDERING = /\b(will|would|should|could|predict|forecast|why|how|price|tomorrow|next (week|month)|explain|what is|what's|mean)\b/;
/** A question that wonders, predicts or asks for advice: never something to guess an action for. */
export const isWondering = (q: string) => WONDERING.test(` ${q.toLowerCase()} `);

/**
 * The shapes a reader types most, resolved at once. Null means the model should read it: a long or wondering sentence
 * is left to the model unless `loose` (no model available), when the best guess is better than nothing.
 */
export function quickAsk(raw: string, markets: string[], loose = false): AskIntent | null {
  const q = raw.trim();
  if (!q) return null;
  if (WALLET_RE.test(q)) return { kind: 'wallet', q: q.replace(/^#/, '') };
  const t = ` ${q.toLowerCase().replace(/[^\w$.#]+/g, ' ')} `;
  const sym = markets.find((m) => t.includes(` ${m.toLowerCase()} `));
  if (sym && q.trim().toUpperCase() === sym) return { kind: 'market', sym };
  if (!loose && (t.trim().split(' ').length > 8 || WONDERING.test(t))) return null;
  const ids = q.match(/0x[0-9a-f]{40}|(?<![\w.$])#?\d{1,8}(?![\w.%])/gi)?.map((x) => x.replace(/^#/, '')) ?? [];
  if (/\b(compare|vs|versus|against)\b/.test(t) && ids.length >= 2) return { kind: 'compare', wallets: ids.slice(0, 4) };

  const days: AskDays | undefined = /\btoday\b/.test(t) ? 1 : /\b(7 ?d|week|7 days)\b/.test(t) ? 7 : /\b(30 ?d|month|30 days)\b/.test(t) ? 30 : /\b(90 ?d|quarter|3 months|90 days)\b/.test(t) ? 90 : undefined;
  const top = /\btop (\d{1,2})\b/.exec(t);
  if (/\bcompare\b/.test(t) && top) return { kind: 'top', days: days ?? 7, sort: /\b(loser|losing|worst)/.test(t) ? 'loss' : /\b(volume|active|biggest traders)\b/.test(t) ? 'volume' : 'net', n: Math.min(4, Math.max(2, Number(top[1]))) };

  const preset: AskPreset | undefined = /\bwhale/.test(t) ? 'whales' : /\b(market ?maker|makers?|mm)\b/.test(t) ? 'makers' : /\btakers?\b/.test(t) ? 'takers'
    : /\bliquidated\b/.test(t) ? 'liquidated' : /\bstreak/.test(t) ? 'streaks' : /\b(winner|consistent|profitable)/.test(t) ? 'winners' : /\b(loser|losing|worst)/.test(t) ? 'losers' : undefined;
  const screenish = preset || /\b(wallets?|traders?|accounts?|screen|who)\b/.test(t);
  const minVolume = /\b(over|above|more than|min(?:imum)?|at least)\s+\$?\d/.test(t) && /\bvolume\b/.test(t) ? usdOf(t.slice(t.search(/\b(over|above|more than|min(?:imum)?|at least)\b/))) ?? undefined : undefined;
  if (screenish && (preset || days || minVolume)) return { kind: 'screen', days, preset: preset ?? 'all', minVolume };

  const metric: AskMetric | undefined = /\bfunding\b/.test(t) ? 'funding' : /\b(open interest|oi)\b/.test(t) ? 'oi' : /\btvl\b/.test(t) ? 'tvl' : /\b(fees?|revenue)\b/.test(t) ? 'fees'
    : /\b(long ?short|skew|positioning)\b/.test(t) ? 'skew' : /\bliquidations?\b/.test(t) ? 'liqs' : /\b(flows?|deposits?|withdrawals?)\b/.test(t) ? 'flows' : /\b(new accounts?|signups?|growth)\b/.test(t) ? 'accounts'
    : /\b(active )?traders\b/.test(t) ? 'traders' : /\bfills?\b/.test(t) ? 'fills' : /\bvolume\b/.test(t) ? 'volume' : undefined;
  if (metric) return { kind: 'metric', metric, sym, range: days === 7 ? 7 : days === 30 ? 30 : days === 90 ? 90 : undefined };
  if (sym) return { kind: 'market', sym };
  if (/\bscreener\b/.test(t)) return { kind: 'tab', tab: 'screener' };
  return null;
}
