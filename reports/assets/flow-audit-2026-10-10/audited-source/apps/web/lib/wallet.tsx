'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { RainbowKitAuthenticationProvider, RainbowKitProvider, connectorsForWallets, createAuthenticationAdapter, darkTheme, useConnectModal } from '@rainbow-me/rainbowkit';
import { coinbaseWallet, injectedWallet, metaMaskWallet, okxWallet, rabbyWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { parseAbi } from 'viem';
import { monad, monadTestnet } from 'viem/chains';
import { createSiweMessage } from 'viem/siwe';
import { WagmiProvider, createConfig, http, useAccount, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { REGISTRY_ABI, type AppConfig, type Me, type Policy } from '@monday/core';
import { ApiError, api } from './api';

// Follows the NETWORK switch (see next.config.ts). The shell warns if the server disagrees.
export const chain = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? monad : monadTestnet;
// Both chains are registered so the types stay simple; only `chain` is ever used. Your own RPC, if set, serves it.
const rpc = (id: number) => http(id === chain.id ? process.env.NEXT_PUBLIC_MONAD_RPC_URL : undefined);
// Browser wallets always; phone wallets over WalletConnect once a project id is set (free at cloud.reown.com).
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
const wagmiConfig = createConfig({
  chains: [monadTestnet, monad],
  connectors: connectorsForWallets(
    [{ groupName: 'Wallets', wallets: [injectedWallet, rabbyWallet, metaMaskWallet, okxWallet, ...(projectId ? [coinbaseWallet, walletConnectWallet] : [])] }],
    { appName: 'Monday', projectId: projectId || 'unset' },
  ),
  transports: { [monadTestnet.id]: rpc(monadTestnet.id), [monad.id]: rpc(monad.id) },
  ssr: true,
});
export const registryAbi = parseAbi(REGISTRY_ABI);

// The modal wears the app's own tokens, so it follows the light/dark toggle.
const base = darkTheme({ borderRadius: 'small', overlayBlur: 'none' });
const theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: 'var(--accent)', accentColorForeground: 'var(--accent-fg)', modalBackground: 'var(--raised)', modalBorder: 'var(--line-2)',
    modalText: 'var(--fg)', modalTextSecondary: 'var(--fg-2)', modalTextDim: 'var(--fg-3)', generalBorder: 'var(--line)', generalBorderDim: 'var(--line)',
    actionButtonSecondaryBackground: 'var(--raised-2)', closeButton: 'var(--fg-2)', closeButtonBackground: 'var(--raised-2)', menuItemBackground: 'var(--raised-2)',
    profileForeground: 'var(--raised)', modalBackdrop: 'rgb(0 0 0 / 0.55)',
  },
  fonts: { body: 'var(--font-sans)' },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <Auth>{children}</Auth>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/** Connect and Sign-In with Ethereum in one modal. The session is the server's cookie; the modal only creates it. */
function Auth({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const me = useMe();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const adapter = useMemo(() => createAuthenticationAdapter({
    getNonce: async () => (await api<{ nonce: string }>('/auth/nonce', { method: 'POST' })).nonce,
    // Always Monad's chain id: the server checks it, and signing a message works on any network.
    createMessage: ({ nonce, address }) => createSiweMessage({
      address, chainId: chain.id, domain: location.host, nonce, uri: location.origin, version: '1',
      statement: 'Sign in to Monday. This costs no gas and moves no funds.',
    }),
    verify: async ({ message, signature }) => {
      await api('/auth/verify', { method: 'POST', body: { message, signature } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      return true;
    },
    signOut: async () => {
      await api('/auth/logout', { method: 'POST' });
      qc.clear();
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  }), [qc]);
  const wallet = me.data && !me.data.demo ? me.data.wallet.toLowerCase() : null;
  // Another account picked in the wallet: the session belongs to the old one, so drop both and let the modal sign in again.
  useEffect(() => {
    if (wallet && address && address.toLowerCase() !== wallet) void adapter.signOut().then(() => disconnect());
  }, [wallet, address, adapter, disconnect]);
  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={me.isLoading ? 'loading' : wallet ? 'authenticated' : 'unauthenticated'}>
      <RainbowKitProvider theme={theme} initialChain={chain} modalSize="compact" appInfo={{ appName: 'Monday' }}>
        {children}
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}

// While the server is unreachable (usually still starting) keep retrying, so the page connects on its own.
const retryWhileDown = (q: { state: { status: string } }) => (q.state.status === 'error' ? 3_000 : false);

export const useAppConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/config'), staleTime: 60_000, refetchInterval: retryWhileDown });

/** The signed-in user, or null when there is no session. */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me').catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    refetchInterval: retryWhileDown,
  });

export function useSession() {
  const qc = useQueryClient();
  const { openConnectModal } = useConnectModal();
  const { disconnectAsync } = useDisconnect();
  const done = () => qc.invalidateQueries({ queryKey: ['me'] });

  return {
    /** Pick a wallet, then Sign-In with Ethereum, in RainbowKit's modal. No gas, no funds moved. */
    signIn: () => openConnectModal?.(),
    async demo() {
      await api('/auth/demo', { method: 'POST' });
      await done();
    },
    async signOut() {
      await api('/auth/logout', { method: 'POST' });
      await disconnectAsync().catch(() => {});
      qc.clear();
      await done();
    },
  };
}

export interface OnchainPolicy {
  registry: `0x${string}`;
  agent: `0x${string}` | null;
  policy: { policyHash: `0x${string}`; marketsBitmap: number; maxInventoryUsd: number; maxDailyLossUsd: number; maxLeverageX100: number; mode: number; updatedAt: number };
}

export interface PolicyView {
  policy: Policy | null;
  policyHash: string | null;
  onchainTx: string | null;
  /** Saved but not yet in force: waiting for the wallet-signed transaction on Monad. */
  pending: { policy: Policy; policyHash: string; onchain: OnchainPolicy | null } | null;
}

/** Publish the policy to MondayRegistry and authorise the agent, from the user's own wallet. */
export function useRegistry() {
  const { address } = useAccount();
  const pub = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  return {
    canSign: Boolean(address),
    async publish(o: OnchainPolicy, onStep: (s: string) => void): Promise<`0x${string}`> {
      if (!address || !pub) throw new Error('Connect the wallet that owns this account.');
      await switchChainAsync({ chainId: chain.id });
      const p = o.policy;
      onStep('Confirm the policy in your wallet');
      const tx = await writeContractAsync({
        address: o.registry, abi: registryAbi, functionName: 'setPolicy', chainId: chain.id,
        args: [{ ...p, maxInventoryUsd: BigInt(p.maxInventoryUsd), maxDailyLossUsd: BigInt(p.maxDailyLossUsd), updatedAt: BigInt(0) }],
      });
      onStep('Waiting for Monad to confirm');
      await pub.waitForTransactionReceipt({ hash: tx });
      await api('/policy/confirm', { method: 'POST', body: { txHash: tx } });
      if (o.agent) {
        const current = await pub.readContract({ address: o.registry, abi: registryAbi, functionName: 'agentOf', args: [address] });
        if (current.toLowerCase() !== o.agent.toLowerCase()) {
          onStep('Authorise the agent to log decisions');
          const tx2 = await writeContractAsync({ address: o.registry, abi: registryAbi, functionName: 'authorizeAgent', args: [o.agent], chainId: chain.id });
          await pub.waitForTransactionReceipt({ hash: tx2 });
        }
      }
      return tx;
    },
  };
}
