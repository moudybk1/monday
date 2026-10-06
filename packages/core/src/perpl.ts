// Perpl protocol and wallet analytics (the public Stats pages). Pure: the server indexes Perpl's
// Exchange events and reads its views, these functions turn rows into numbers.

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
  /** How far mark must move against the position before it liquidates, percent of mark. */
  liqDistancePct: number;
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

export interface PxOverview {
  at: number;
  network: 'mainnet' | 'testnet';
  indexer: { source: 'hypersync' | 'rpc' | 'off'; block: number; head: number; lagSec: number | null; since: number | null };
  headline: {
    volume24hUsd: number; volume7dUsd: number; volume30dUsd: number; volumeAllUsd: number;
    openInterestUsd: number; tvlUsd: number; accounts: number;
    fees24hUsd: number | null; fees7dUsd: number | null; fees30dUsd: number | null; feesAllUsd: number | null;
    activeTraders24h: number | null; activeTraders7d: number | null; activeTraders30d: number | null;
    netFlow24hUsd: number | null; liquidations24hUsd: number | null;
  };
  markets: PxMarketRow[];
  /** Daily, oldest first. Volume from Perpl candles (all time); the rest from indexed events. */
  daily: { t: number; volumeUsd: number; byMarket: Record<string, number>; feesUsd: number | null; traders: number | null; depositsUsd: number | null; withdrawalsUsd: number | null; liquidationsUsd: number | null }[];
}

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

export interface WalletPerformance {
  trades: number;
  closes: number;
  volumeUsd: number;
  feesUsd: number;
  fundingUsd: number;
  pnlUsd: number; // price PnL
  netUsd: number; // price PnL + funding - fees
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdownUsd: number;
  longestWin: number;
  longestLoss: number;
  avgHoldMin: number | null;
  firstTs: number | null;
  lastTs: number | null;
  byMarket: { sym: string; trades: number; volumeUsd: number; netUsd: number }[];
  /** Cumulative net PnL after each trade. */
  curve: { t: number; v: number }[];
}

export interface PxWallet {
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
  /** False while the indexer has not reached this wallet's history yet, or runs without HyperSync. */
  historyComplete: boolean;
}

/** Perpl's liquidation price (dex-sdk Position::liquidation_price): entry moved by the margin above maintenance, per unit. */
export function liquidationPrice(long: boolean, entry: number, size: number, deposit: number, premiumPnl: number, maintLeverage: number): number {
  if (!(size > 0) || !(maintLeverage > 0)) return 0;
  const mmr = (entry * size) / maintLeverage;
  const px = entry + ((long ? 1 : -1) * (mmr - deposit - premiumPnl)) / size;
  return Math.max(0, px);
}

const REALISING: PxTradeKind[] = ['decrease', 'close', 'invert', 'liquidation'];

/** Win rate, profit factor, drawdown, streaks and hold time from one wallet's trades. */
export function walletPerformance(trades: PxTrade[]): WalletPerformance {
  const ts = [...trades].sort((a, b) => a.ts - b.ts || a.block - b.block);
  let cum = 0, peak = 0, dd = 0, gross = 0, grossLoss = 0, wins = 0, closes = 0, run = 0, longestWin = 0, longestLoss = 0;
  const curve: WalletPerformance['curve'] = [];
  const opened = new Map<string, number>();
  const holds: number[] = [];
  const markets = new Map<string, { sym: string; trades: number; volumeUsd: number; netUsd: number }>();
  for (const t of ts) {
    const net = t.pnl + t.funding - t.fee;
    cum += net;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    curve.push({ t: t.ts, v: cum });
    const m = markets.get(t.sym) ?? { sym: t.sym, trades: 0, volumeUsd: 0, netUsd: 0 };
    m.trades++;
    m.volumeUsd += t.usd;
    m.netUsd += net;
    markets.set(t.sym, m);

    if (REALISING.includes(t.kind)) {
      closes++;
      if (net > 0) {
        wins++;
        gross += net;
        run = run > 0 ? run + 1 : 1;
      } else {
        grossLoss -= net;
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
  return {
    trades: ts.length,
    closes,
    volumeUsd: ts.reduce((s, t) => s + t.usd, 0),
    feesUsd: ts.reduce((s, t) => s + t.fee, 0),
    fundingUsd: ts.reduce((s, t) => s + t.funding, 0),
    pnlUsd: ts.reduce((s, t) => s + t.pnl, 0),
    netUsd: cum,
    winRate: closes ? wins / closes : null,
    profitFactor: grossLoss > 0 ? gross / grossLoss : gross > 0 ? Infinity : null,
    maxDrawdownUsd: dd,
    longestWin,
    longestLoss,
    avgHoldMin: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length / 60_000 : null,
    firstTs: ts[0]?.ts ?? null,
    lastTs: ts.at(-1)?.ts ?? null,
    byMarket: [...markets.values()].sort((a, b) => b.netUsd - a.netUsd),
    curve,
  };
}
