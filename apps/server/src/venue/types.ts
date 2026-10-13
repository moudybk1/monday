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
  /**
   * Candles, oldest first: 1-minute by default (volatility warm-up, the volume cap, the Smart Trader study). `resSec` asks
   * for wider ones (the chart's 5m to 1D); a feed that only has minutes may return those, and the API aggregates them.
   */
  candles(sym: MarketSym, fromMs: number, toMs: number, resSec?: number): Promise<Candle[]>;
  /** Real trades as they print, by taker side. Only Perpl's feed has a tape; paper trading fills against it. */
  onTrade?(cb: (t: TapeTrade) => void): void;
}

export interface TapeTrade {
  sym: MarketSym;
  price: number;
  size: number; // base units
  side: 'buy' | 'sell'; // the taker's side
  ts?: number; // when it printed; the receive time when the feed does not say
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
  /** Collateral the venue holds for this position, when it reports one (Perpl does); its leverage is notional over this. */
  marginUsd?: number;
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
  /** Not one of Monday's orders (a trade placed by hand on the same account). Only the live venue can tell. */
  external?: boolean;
  /** The order that filled (`${market}:${order id}` on Perpl), so a plan can claim its own fills. */
  orderKey?: string;
}

/**
 * An order a plan places (Agentic Trade, TWAP). Never one of Monday's quotes: a Stop and a restart leave it alone,
 * only a Kill sweeps it.
 */
export interface OrderSpec {
  sym: MarketSym;
  /** bid buys, ask sells. */
  side: Side;
  /** Base units. */
  size: number;
  leverage: number;
  /** A limit price. Without one the order is a market order: IOC, filled at most `slippageBps` from the price. */
  price?: number;
  /** A limit order that only rests on the book (PostOnly). Without it a limit order takes what it can at once (IOC). */
  postOnly?: boolean;
  slippageBps?: number;
  /** A reduce-only close of this market's position: clamped to its size, and dropped by the venue once it is closed. */
  close?: boolean;
  /** Not sent to the book until the mark reaches this price: gte at or above it, lte at or below. */
  trigger?: { price: number; when: 'gte' | 'lte' };
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
  /**
   * Cancel resting orders. `onlyOwn`: Monday's quotes only, so a Stop or a restart leaves the orders the user placed by
   * hand (their own stop losses and take profits) alone. A kill sweeps everything before it closes the positions.
   */
  cancelAll(onlyOwn?: boolean): Promise<void>;
  /** Close every position with reduce-only market orders. */
  flatten(): Promise<void>;
  /** Place a plan's order. Resolves with its key once the venue has it (an IOC may already be done by then). */
  placeOrder(o: OrderSpec): Promise<string>;
  cancelOrder(key: string): Promise<void>;
  /** The order is still working: resting, partly filled, or waiting for its trigger. */
  working(key: string): boolean;
  on<E extends keyof VenueEvents>(event: E, cb: VenueEvents[E]): void;
  /** Simulated accounts only: save balance and positions. Called inside the transaction that records a fill. */
  persist?(): void;
  /** Requests this venue has sent on its own count since connect: retries, keep-alives, sweeps. They spend the same rate limit. */
  requests?(): number;
  /**
   * A fill's position update has not arrived yet (Perpl sends them apart): until it does, the account's balance is off
   * by that position's margin and a position may exist that `flatten` cannot see. Venues that update both at once omit it.
   */
  settling?(): boolean;
}

export interface VenueCredentials {
  wallet: string;
  accountId: number;
  token: string;
  secret: string;
}

/** Everything the rest of the server needs from an execution venue. */
/** Monday's resting orders on an account (`${mkt}:${oid}`), kept across restarts so a crash does not orphan its quotes. */
export interface OwnOrders {
  load(): string[];
  save(keys: string[]): void;
}

export interface VenueDriver {
  kind: 'sim' | 'paper' | 'perpl';
  feed: MarketFeed;
  /** Does this wallet own an exchange account? Onboarding step 2. */
  detectAccount(wallet: string): Promise<{ accountId: number; balanceUsd: number } | null>;
  minDepositUsd(): number;
  /** `own` remembers which resting orders are Monday's. Without it (a key check) nothing on the account is Monday's. */
  open(creds: VenueCredentials, own?: OwnOrders): Venue;
}
