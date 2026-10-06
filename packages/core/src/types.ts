// Shared domain types. The web app and the server both import these, so the
// wire format has one definition.

export const MARKETS = ['BTC', 'ETH', 'SOL'] as const;
export type MarketSym = (typeof MARKETS)[number];
export type Side = 'bid' | 'ask';
export type Regime = 'calm' | 'active' | 'storm' | 'stale';
export type Mode = 'paused' | 'maker';
export type PresetName = 'conservative' | 'balanced' | 'active' | 'custom';
export type AgentStatus = 'idle' | 'quoting' | 'paused' | 'killed';
export type KillReason = 'manual' | 'loss_limit' | 'stale_data' | 'order_failures' | 'key_error';
export type DecisionSource = 'governor' | 'fallback' | 'reflex' | 'kill';

export interface PolicyLimits {
  quoteSizeUsd: number;
  maxInventoryUsd: number;
  minHalfSpreadBps: number;
  maxDailyLossUsd: number;
  maxLeverage: number;
}

export interface Policy extends PolicyLimits {
  mode: Mode;
  markets: MarketSym[];
  preset: PresetName;
}

// PRD 5.2. Starting defaults for testnet.
export const PRESETS: Record<Exclude<PresetName, 'custom'>, PolicyLimits> = {
  conservative: { quoteSizeUsd: 50, maxInventoryUsd: 250, minHalfSpreadBps: 6, maxDailyLossUsd: 25, maxLeverage: 2 },
  balanced: { quoteSizeUsd: 100, maxInventoryUsd: 500, minHalfSpreadBps: 4, maxDailyLossUsd: 50, maxLeverage: 3 },
  active: { quoteSizeUsd: 200, maxInventoryUsd: 1000, minHalfSpreadBps: 3, maxDailyLossUsd: 100, maxLeverage: 3 },
};

/** Collateral a policy needs (FR-POL-2): full inventory in every market, carried at the policy's leverage. */
export const balanceNeededUsd = (l: PolicyLimits, markets: number) => (l.maxInventoryUsd * markets) / l.maxLeverage;

/** Conservative limits shrunk to what a balance can carry, for accounts below the smallest preset. Whole dollars, rounded down. */
export function limitsForBalance(balanceUsd: number, markets: number): PolicyLimits {
  const base = PRESETS.conservative;
  const f = Math.max(0, Math.min(1, (balanceUsd * base.maxLeverage) / (base.maxInventoryUsd * markets)));
  return {
    ...base,
    maxInventoryUsd: Math.floor(base.maxInventoryUsd * f),
    quoteSizeUsd: Math.floor(base.quoteSizeUsd * f),
    maxDailyLossUsd: Math.max(1, Math.floor(base.maxDailyLossUsd * f)),
  };
}

// PRD 10.4 output schema. Snake case on purpose: this is the object that gets
// hashed and anchored on-chain, and the LLM is prompted with the same keys.
export interface GovernorParams {
  market: MarketSym;
  enabled: boolean;
  spread_mult: number;
  skew_bias_bps: number;
  size_mult: number;
  max_inventory_usd: number;
  ttl_min: number;
  regime: Regime;
  reason: string;
}

export interface MarketSpec {
  sym: MarketSym;
  marketId: number;
  priceTick: number;
  sizeStep: number;
  makerFeeBps: number;
  takerFeeBps: number;
  maxLeverage: number;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface SmartTrade {
  hash: string;
  sym: MarketSym;
  action: string; // Nansen: Open | Add | Reduce | Close (read with side). Simulator: "Buy - Open Long"
  side: 'Long' | 'Short';
  valueUsd: number;
  priceUsd: number;
  amount: number;
  type: string; // Market | Limit
  trader: string;
  label: string;
  ts: number; // block timestamp, ms
  fetchedAt: number;
}

export interface WindowSignal {
  netUsd: number;
  grossUsd: number;
  imbalance: number; // -1..1
  z: number;
  n: number;
}

export interface MarketSignal {
  sym: MarketSym;
  at: number;
  stale: boolean;
  S: number;
  w5: WindowSignal;
  w15: WindowSignal;
  w60: WindowSignal;
}

export interface QuoteTarget {
  price: number;
  size: number;
}

export interface ReflexState {
  side: Side; // the side smart money is hitting, i.e. the side Monday protects
  action: 'pull' | 'widen';
  until: number;
  z: number;
  triggerHashes: string[];
}

export interface Fill {
  id: string;
  sym: MarketSym;
  side: Side;
  price: number;
  size: number;
  feeUsd: number;
  isMaker: boolean;
  ts: number;
  regime: Regime;
  markout1mBps: number | null;
  markout5mBps: number | null;
}

export interface Decision {
  id: number;
  at: number;
  market: MarketSym;
  source: DecisionSource;
  regime: Regime | 'reflex' | 'killed';
  params: Record<string, unknown>;
  reason: string;
  paramsHash: string;
  evidenceHash: string;
  llmModel: string | null;
  txHash: string | null;
  onchainId: number | null;
}

export interface DecisionRecord extends Decision {
  wallet: string;
  evidence: Record<string, unknown>;
}

export interface MarketState {
  sym: MarketSym;
  spec: MarketSpec;
  mark: number;
  oracle: number;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  bids: BookLevel[];
  asks: BookLevel[];
  fundingRate: number;
  dataAgeMs: number;
  sigma1mBps: number;
  quotes: { bid: QuoteTarget | null; ask: QuoteTarget | null };
  model: { ref: number; center: number; halfBps: number; skewInvBps: number; skewNanBps: number; q: number } | null;
  position: { size: number; entryPrice: number; notionalUsd: number; unrealizedUsd: number };
  params: GovernorParams;
  paramsSource: DecisionSource;
  reflex: ReflexState | null;
  signal: MarketSignal | null;
  trades: SmartTrade[];
  priceSeries: { t: number; p: number; bid: number | null; ask: number | null }[];
}

export interface Alert {
  id: string;
  at: number;
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

export interface DashboardState {
  at: number;
  sim: boolean;
  status: AgentStatus;
  killReason: KillReason | null;
  startedAt: number | null;
  policy: Policy;
  account: { id: number; balanceUsd: number; equityUsd: number };
  pnl: { todayUsd: number; realizedUsd: number; unrealizedUsd: number; feesUsd: number; lossLimitUsedPct: number };
  health: { marketDataAgeMs: number; signalAgeMs: number; budgetRemaining: number; budgetPerMin: number; venueConnected: boolean; llm: boolean; llmFailing: boolean; chain: boolean };
  markets: Partial<Record<MarketSym, MarketState>>;
  equity: { t: number; v: number }[];
  fills: Fill[];
  decisions: Decision[];
  alerts: Alert[];
}

export const REGIME_CODE: Record<string, number> = { calm: 0, active: 1, storm: 2, stale: 3, reflex: 4 };
export const KILL_CODE: Record<KillReason, number> = { manual: 0, loss_limit: 1, stale_data: 2, order_failures: 3, key_error: 4 };
export const MARKET_BIT: Record<MarketSym, number> = { BTC: 0, ETH: 1, SOL: 2 };

// Human-readable ABI of MondayRegistry (PRD 13.1). Each app runs it through viem's parseAbi.
export const REGISTRY_ABI = [
  'struct Policy { bytes32 policyHash; uint32 marketsBitmap; uint64 maxInventoryUsd; uint64 maxDailyLossUsd; uint16 maxLeverageX100; uint8 mode; uint64 updatedAt; }',
  'function setPolicy(Policy p)',
  'function authorizeAgent(address agent)',
  'function revokeAgent()',
  'function logDecision(address user, uint32 market, bytes32 paramsHash, bytes32 evidenceHash, uint8 regime, string uri)',
  'function logKill(address user, uint8 reason, bytes32 evidenceHash)',
  'function policyOf(address user) view returns (Policy)',
  'function agentOf(address user) view returns (address)',
  'function decisionCount(address user) view returns (uint256)',
  'event PolicySet(address indexed user, bytes32 policyHash, uint32 marketsBitmap, uint64 maxInventoryUsd, uint64 maxDailyLossUsd, uint16 maxLeverageX100, uint8 mode)',
  'event AgentAuthorized(address indexed user, address indexed agent)',
  'event DecisionLogged(address indexed user, uint32 indexed market, uint256 indexed decisionId, bytes32 paramsHash, bytes32 evidenceHash, uint8 regime, string uri)',
  'event KillLogged(address indexed user, uint8 reason, bytes32 evidenceHash)',
] as const;

// ---- evidence page (PRD 19) ----
export interface EventStudy {
  sym: MarketSym;
  samples: number;
  /** Spearman correlation of the z-score over `window` minutes against the forward return over `horizon` minutes. */
  grid: { window: number; horizon: number; rho: number; lo: number; hi: number; n: number }[];
  /** 15-minute z-score deciles against the next 15 minutes of return. */
  deciles: { decile: number; meanZ: number; meanRetBps: number; n: number }[];
  hit: { n: number; rate: number };
  skewEnabled: boolean;
}

export interface ReplayArm {
  pnlUsd: number;
  feesUsd: number;
  fills: number;
  markout1mBps: number;
  markout5mBps: number;
  adverseUsd: number;
  inventoryStdUsd: number;
  maxDrawdownUsd: number;
  quotedPct: number;
  curve: { t: number; v: number }[];
}

export interface Replay {
  sym: MarketSym;
  from: number;
  to: number;
  naive: ReplayArm;
  monday: ReplayArm;
  reflexPulls: number;
}

export interface Evidence {
  at: number;
  synthetic: boolean;
  smartMoneySource: string;
  priceSource: string;
  lagMs: number;
  policy: PolicyLimits;
  studies: Partial<Record<MarketSym, EventStudy>>;
  replays: Partial<Record<MarketSym, Replay>>;
}

export interface AppConfig {
  sim: boolean;
  network: 'testnet' | 'mainnet';
  networkName: string;
  /** Mainnet with the live venue: real orders, real collateral. */
  realFunds: boolean;
  /** Operator ceilings on policies while real funds are at stake. */
  caps: Pick<PolicyLimits, 'quoteSizeUsd' | 'maxInventoryUsd' | 'maxDailyLossUsd'> | null;
  smartMoney: 'nansen' | 'sim' | 'none';
  chainId: number;
  registry: string | null;
  agentAddress: string | null;
  explorerUrl: string;
  perplAppUrl: string;
  minDepositUsd: number;
  llm: boolean;
  specs: Partial<Record<MarketSym, MarketSpec>>;
}

export interface Me {
  wallet: string;
  demo: boolean;
  accountId: number | null;
  hasKey: boolean;
  keyStatus: string | null;
  policy: Policy | null;
  policyHash: string | null;
  policyTx: string | null;
  /** A changed policy is waiting for the wallet-signed Monad transaction. */
  policyPending: boolean;
  status: AgentStatus;
}
