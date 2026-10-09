// Environment. Everything external is optional: with no .env at all the server
// runs a fully simulated market. Each key you add switches one piece to live.

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const env = (k: string, d = '') => (process.env[k] ?? '').trim() || d;
const num = (k: string, d: number) => (Number.isFinite(Number(env(k))) && env(k) !== '' ? Number(env(k)) : d);

// One switch picks the chain and every Perpl address together, so they cannot disagree.
// Values checked against Perpl's live /pub/context for each network.
export const NETWORKS = {
  testnet: {
    name: 'Monad testnet', chainId: 10143, rpcUrl: 'https://testnet-rpc.monad.xyz', explorerUrl: 'https://testnet.monadscan.com',
    perplApi: 'https://testnet.perpl.xyz/api', perplWs: 'wss://testnet.perpl.xyz', perplApp: 'https://testnet.perpl.xyz',
    exchange: '0x1964c32f0be608e7d29302aff5e61268e72080cc',
  },
  mainnet: {
    name: 'Monad mainnet', chainId: 143, rpcUrl: 'https://rpc.monad.xyz', explorerUrl: 'https://monadscan.com',
    perplApi: 'https://app.perpl.xyz/api', perplWs: 'wss://app.perpl.xyz', perplApp: 'https://app.perpl.xyz',
    exchange: '0x34b6552d57a35a1d042ccae1951bd1c370112a6f',
  },
} as const;

const network = env('NETWORK', 'testnet') === 'mainnet' ? 'mainnet' : 'testnet';
const net = NETWORKS[network];
// sim: everything simulated. paper: Perpl's real market data, simulated orders. perpl: live orders.
const venue = (['perpl', 'paper'] as const).find((v) => v === env('VENUE', 'sim')) ?? 'sim';
const nansenKey = env('NANSEN_API_KEY');
const prod = env('NODE_ENV') === 'production';
// The only overridable network value: your own RPC endpoint. Its chain id is verified at boot.
const rpcUrl = env('MONAD_RPC_URL', net.rpcUrl);
/** Real orders with real collateral. Everything that guards money keys off this. */
const realFunds = network === 'mainnet' && venue === 'perpl';

export const config = {
  prod,
  port: num('PORT', 3001),
  webOrigin: env('WEB_ORIGIN', 'http://localhost:3000'),
  sessionSecret: env('SESSION_SECRET', prod ? '' : 'monday-dev-session-secret'),
  masterKey: env('MONDAY_MASTER_KEY'),
  databasePath: env('DATABASE_PATH', venue === 'sim' && !nansenKey ? ':memory:' : resolve(process.cwd(), `data/monday-${venue === 'sim' ? 'sim' : venue === 'paper' ? `paper-${network}` : network}.sqlite`)),

  network: network as 'testnet' | 'mainnet',
  networkName: net.name,
  realFunds,
  venue: venue as 'sim' | 'paper' | 'perpl',
  perpl: { apiUrl: net.perplApi, wsUrl: net.perplWs, chainId: net.chainId, rpcUrl, exchangeAddress: net.exchange as `0x${string}`, appUrl: net.perplApp },
  budgetPerMin: num('TRADING_REQ_BUDGET_PER_MIN', 40),

  // Operator ceilings on what any user's policy may ask for while real money is at stake.
  // They start at the Conservative preset: prove the system small, then raise them on purpose.
  caps: realFunds ? { quoteSizeUsd: num('CAP_QUOTE_USD', 50), maxInventoryUsd: num('CAP_INVENTORY_USD', 250), maxDailyLossUsd: num('CAP_DAILY_LOSS_USD', 25) } : null,

  // Smart-money source: real Nansen when a key is set; the simulator only when the
  // venue is simulated too. Live orders are never driven by simulated signals.
  smartMoney: (nansenKey ? 'nansen' : venue === 'sim' ? 'sim' : 'none') as 'nansen' | 'sim' | 'none',
  nansen: {
    apiUrl: env('NANSEN_API_URL', 'https://api.nansen.ai'),
    apiKey: nansenKey,
    pollSeconds: num('NANSEN_POLL_SECONDS', 120),
  },

  llm: {
    provider: env('LLM_PROVIDER', 'anthropic') as 'anthropic' | 'openai-compatible' | 'claude-code',
    baseUrl: env('LLM_BASE_URL'),
    apiKey: env('LLM_API_KEY'),
    model: env('LLM_MODEL'),
  },
  governorIntervalMin: num('GOVERNOR_INTERVAL_MIN', 15),

  chain: {
    rpcUrl,
    chainId: net.chainId,
    registry: env('MONDAY_REGISTRY_ADDRESS') as `0x${string}` | '',
    loggerKey: env('AGENT_LOGGER_PRIVATE_KEY') as `0x${string}` | '',
    explorerUrl: net.explorerUrl,
  },
  apiPublicUrl: env('API_PUBLIC_URL', `http://localhost:${num('PORT', 3001)}`),

  telegram: { token: env('TELEGRAM_BOT_TOKEN'), chatId: env('TELEGRAM_CHAT_ID') },

  // Public Perpl stats pages. Mainnet by default, whatever network Monday itself trades on: that is where Perpl's users are.
  stats: {
    network: (env('STATS_NETWORK', 'mainnet') === 'testnet' ? 'testnet' : 'mainnet') as 'testnet' | 'mainnet',
    // Envio HyperSync (app.envio.dev/api-tokens): full event history in minutes. Without it the indexer follows the chain
    // from a few hours back over plain RPC.
    envioToken: env('ENVIO_API_TOKEN'),
  },
};

if (prod && !config.sessionSecret) throw new Error('SESSION_SECRET is required in production.');
if (config.venue === 'perpl' && !config.masterKey) throw new Error('MONDAY_MASTER_KEY is required when VENUE=perpl (it encrypts stored Perpl keys).');
// Trading real money must be a deliberate act, not a leftover line in a .env file.
if (realFunds && env('ALLOW_REAL_FUNDS') !== 'yes') {
  throw new Error('NETWORK=mainnet with VENUE=perpl places real orders with real funds. Set ALLOW_REAL_FUNDS=yes to confirm, or use NETWORK=testnet.');
}
if (realFunds && !env('SESSION_SECRET')) throw new Error('SESSION_SECRET is required when trading real funds.');
// Simulated orders only (never the live venue, which refuses to start without a key): a fixed development key, so the
// demo keys stored in a paper database still open after a restart. In production a random key dies with the process.
if (!config.masterKey) config.masterKey = prod ? randomBytes(32).toString('base64') : 'monday-dev-master-key-simulated-orders-only';

export type Config = typeof config;
