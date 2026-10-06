// Live Perpl adapter: the VenueDriver the rest of the server talks to when
// VENUE=perpl. Protocol reference: https://github.com/PerplFoundation/api-docs

import { BaseError, ContractFunctionRevertedError, createPublicClient, http, parseAbi } from 'viem';
import type { VenueCredentials, VenueDriver } from '../types';
import { PerplFeed } from './feed';
import { loadContext, type PerplContext } from './rest';
import { PerplVenue } from './trading';

export interface PerplConfig {
  apiUrl: string; // e.g. https://testnet.perpl.xyz/api
  wsUrl: string; // e.g. wss://testnet.perpl.xyz
  chainId: number; // 10143 testnet
  rpcUrl: string; // https://testnet-rpc.monad.xyz
  exchangeAddress: `0x${string}`; // 0x1964c32f0be608e7d29302aff5e61268e72080cc on testnet
}

// From PerplFoundation/dex-sdk crates/sdk/abi/dex/Exchange.json. The README's `(uint256)` cast signature is
// shorthand: the function returns the whole AccountInfo struct.
const EXCHANGE_ABI = parseAbi([
  'struct PositionBitMap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }',
  'struct AccountInfo { uint256 accountId; uint256 balanceCNS; uint256 lockedBalanceCNS; uint8 frozen; address accountAddr; PositionBitMap positions; }',
  'function getAccountByAddr(address accountAddress) view returns (AccountInfo accountInfo)',
]);

export function createPerplDriver(cfg: PerplConfig): VenueDriver {
  let ctx: PerplContext | null = null;
  let loading: Promise<PerplContext> | null = null;
  // Loaded once and shared by the feed and every venue. Never refreshed; restart (or subscribe to
  // market-config, mt 8) if Perpl changes decimals, fees or TTLs under a running server.
  const context = () =>
    (loading ??= loadContext(cfg).then(
      (c) => (ctx = c),
      (e) => {
        loading = null;
        throw e;
      },
    ));
  const chain = createPublicClient({ transport: http(cfg.rpcUrl) });

  return {
    kind: 'perpl',
    feed: new PerplFeed(cfg, context),

    async detectAccount(wallet: string) {
      const { usd } = await context();
      try {
        const info = await chain.readContract({
          address: cfg.exchangeAddress,
          abi: EXCHANGE_ABI,
          functionName: 'getAccountByAddr',
          args: [wallet.toLowerCase() as `0x${string}`],
        });
        if (info.accountId === 0n) return null;
        return { accountId: Number(info.accountId), balanceUsd: Number(info.balanceCNS) / usd };
      } catch (e) {
        // The contract reverts for an address with no account. Anything else (RPC down, bad address) is a real error.
        if (e instanceof BaseError && e.walk((cause) => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return null;
        throw e;
      }
    },

    minDepositUsd() {
      if (!ctx) throw new Error('Perpl context is not loaded yet: await feed.start() first');
      return ctx.minDepositUsd;
    },

    open: (creds: VenueCredentials) => new PerplVenue(cfg, context, creds),
  };
}
