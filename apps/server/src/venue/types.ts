// The seam between Monday and the outside world. Implementations: a simulator (default), the
// live Perpl adapter, and paper trading (Perpl's real feed with simulated orders). Nothing above
// this file knows which one it is talking to.

import type { BookLevel, MarketSpec, MarketSym, QuoteTarget, Side } from '@monday/core';

export interface MarketSnapshot {
  sym: MarketSym;
  mark: number;
  oracle: number;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  bids: BookLevel[]; // best first, top ~15 levels, sizes in base units
  asks: BookLevel[];
  fundingRate: number; // per funding interval, as a fraction
  openInterest: number; // base units
  updatedAt: number; // ms epoch of the last heartbeat or message for this market
}

export interface Candle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number; // traded notional in USD; the simulator does not report it
}

/** Public market data. One instance is shared by every runner. */
export interface MarketFeed {
  start(): Promise<void>;
  stop(): void;
  specs(): Partial<Record<MarketSym, MarketSpec>>;
  snapshot(sym: MarketSym): MarketSnapshot | null;
  /** 1-minute candles, oldest first. Used for volatility warm-up, the volume cap and the evidence page. */
  candles(sym: MarketSym, fromMs: number, toMs: number): Promise<Candle[]>;
}

export type VenueErrorCode =
  | 'bad_signature' // token or secret wrong
  | 'read_only_key' // key lacks trade scope
  | 'no_account' // wallet has no exchange account
  | 'revoked' // key was valid, now rejected (401 / close 3401)
  | 'rate_limited' // close 1008
  | 'crosses_book'
  | 'rejected' // any other order-level rejection
  | 'disconnected'
  | 'fatal'; // bad frame or wrong account (close 1011): stop and alert

export class VenueError extends Error {
  constructor(public code: VenueErrorCode, message: string) {
    super(message);
  }
}

export interface VenueAccount {
  accountId: number;
  balanceUsd: number; // collateral balance
  canTrade: boolean;
}

export interface VenuePosition {
  size: number; // signed base units, long positive
  entryPrice: number;
}

export interface VenueFill {
  id: string;
  sym: MarketSym;
  side: Side; // bid = Monday bought, ask = Monday sold
  price: number;
  size: number;
  feeUsd: number;
  realizedUsd: number; // PnL realised by this fill, before fees
  isMaker: boolean;
  ts: number;
}

export interface VenueEvents {
  fill: (f: VenueFill) => void;
  /** The socket dropped or the key died. `fatal` errors mean the runner must stop. */
  error: (e: VenueError) => void;
}

/**
 * Trading for one user account. The venue owns order-level mechanics (open vs
 * change vs cancel, request ids, reconciliation after reconnect); the runner
 * owns strategy, requote thresholds and the request budget.
 */
export interface Venue {
  /** Sign in and load snapshots. Throws VenueError. */
  connect(): Promise<VenueAccount>;
  close(): void;
  connected(): boolean;
  account(): VenueAccount;
  position(sym: MarketSym): VenuePosition;
  /** The venue-confirmed resting quote for a side, or null. */
  quote(sym: MarketSym, side: Side): QuoteTarget | null;
  /**
   * Make the resting PostOnly quote on this side equal `target` (null cancels it).
   * Costs one request. Resolves when the venue accepts, rejects with VenueError.
   */
  setQuote(sym: MarketSym, side: Side, target: QuoteTarget | null, leverage: number): Promise<void>;
  cancelAll(): Promise<void>;
  /** Close every position with reduce-only market orders. */
  flatten(): Promise<void>;
  on<E extends keyof VenueEvents>(event: E, cb: VenueEvents[E]): void;
}

export interface VenueCredentials {
  wallet: string;
  accountId: number;
  token: string;
  secret: string;
}

/** Everything the rest of the server needs from an execution venue. */
export interface VenueDriver {
  kind: 'sim' | 'paper' | 'perpl';
  feed: MarketFeed;
  /** Does this wallet own an exchange account? Onboarding step 2. */
  detectAccount(wallet: string): Promise<{ accountId: number; balanceUsd: number } | null>;
  minDepositUsd(): number;
  open(creds: VenueCredentials): Venue;
}
