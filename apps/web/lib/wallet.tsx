'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { RainbowKitAuthenticationProvider, RainbowKitProvider, connectorsForWallets, createAuthenticationAdapter, darkTheme, useConnectModal } from '@rainbow-me/rainbowkit';
import { coinbaseWallet, injectedWallet, metaMaskWallet, okxWallet, rabbyWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { parseAbi } from 'viem';
import { arbitrum, base as baseChain, bsc, mainnet, monad, monadTestnet, optimism, polygon } from 'viem/chains';
import { createSiweMessage } from 'viem/siwe';
import { WagmiProvider, createConfig, http, useAccount, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { REGISTRY_ABI, type AppConfig, type Me, type Policy } from '@monday/core';
import { ACCOUNT_CHANGED, ApiError, api } from './api';

// Follows the NETWORK switch (see next.config.ts). The shell warns if the server disagrees.
export const chain = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? monad : monadTestnet;
// Both chains are registered so the types stay simple; only `chain` is ever used. Your own RPC, if set, serves it.
const rpc = (id: number) => http(id === chain.id ? process.env.NEXT_PUBLIC_MONAD_RPC_URL : undefined);
// Browser wallets always; phone wallets over WalletConnect once a project id is set (free at cloud.reown.com).
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
export const walletConnectReady = Boolean(projectId);
// Sign-in only. RainbowKit signs only on a chain listed here, and a phone wallet over WalletConnect that has no Monad yet
// connects on its own network and, when it cannot add Monad, stays there: the Sign button then did nothing and no request
// reached the wallet (2026-10-12). The message is the same on any network (Monad's chain id is inside it, and the server
// checks that), and nothing is ever sent or read on these.
const signIn = [mainnet, baseChain, arbitrum, bsc, polygon, optimism] as const;
const wagmiConfig = createConfig({
  // The app's chain first: a phone wallet over WalletConnect is offered it before any other.
  chains: chain.id === monad.id ? [monad, monadTestnet, ...signIn] : [monadTestnet, monad, ...signIn],
  connectors: connectorsForWallets(
    // A named wallet that is not installed falls back to WalletConnect, which hangs without a project id. Without one,
    // only the browser's own wallet is offered; installed extensions still show by name through EIP-6963.
    [{ groupName: 'Wallets', wallets: projectId ? [injectedWallet, rabbyWallet, metaMaskWallet, okxWallet, coinbaseWallet, walletConnectWallet] : [injectedWallet] }],
    { appName: 'Monday', projectId: projectId || 'unset' },
  ),
  transports: {
    [monadTestnet.id]: rpc(monadTestnet.id), [monad.id]: rpc(monad.id),
    [mainnet.id]: http(), [baseChain.id]: http(), [arbitrum.id]: http(), [bsc.id]: http(), [polygon.id]: http(), [optimism.id]: http(),
  },
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

/** Tabs share one session cookie, so a sign-in or sign-out in one tab is announced to the others. */
const authChannel = () => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('monday-auth'));
const announce = () => {
  const ch = authChannel();
  ch?.postMessage('changed');
  ch?.close();
};

/** Connect and Sign-In with Ethereum in one modal. The session is the server's cookie; the modal only creates it. */
function Auth({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const me = useMe();
  // Another tab signed in or out, or the server refused an action for the account shown here: drop every private
  // answer and ask again who is signed in. resetQueries, not clear: clear only empties the cache, and a page already
  // showing the old account would keep showing it.
  useEffect(() => {
    const reset = () => void qc.resetQueries();
    const ch = authChannel();
    if (ch) ch.onmessage = reset;
    window.addEventListener(ACCOUNT_CHANGED, reset);
    return () => {
      ch?.close();
      window.removeEventListener(ACCOUNT_CHANGED, reset);
    };
  }, [qc]);
  const { address, chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const adapter = useMemo(() => createAuthenticationAdapter({
    getNonce: async () => (await api<{ nonce: string }>('/auth/nonce', { method: 'POST' })).nonce,
    // Always Monad's chain id: the server checks it, and signing a message works on any network.
    createMessage: ({ nonce, address }) => createSiweMessage({
      address, chainId: chain.id, domain: location.host, nonce, uri: location.origin, version: '1',
      statement: 'Sign in to Monday. This costs no gas and moves no funds.',
    }),
    verify: async ({ message, signature }) => {
      await api('/auth/verify', { method: 'POST', body: { message, signature } });
      announce();
      await qc.invalidateQueries({ queryKey: ['me'] });
      return true;
    },
    signOut: async () => {
      await api('/auth/logout', { method: 'POST' });
      announce();
      await qc.resetQueries();
    },
  }), [qc]);
  const wallet = me.data && !me.data.demo ? me.data.wallet.toLowerCase() : null;
  // Another account picked in the wallet: the session belongs to the old one, so drop both and let the modal sign in again.
  useEffect(() => {
    if (wallet && address && address.toLowerCase() !== wallet) void adapter.signOut().then(() => disconnect());
  }, [wallet, address, adapter, disconnect]);
  // Connected elsewhere (see signIn above): ask the wallet once more to switch to Monad, adding it if it does not know it.
  // Signing in works on either; Monad is where the rest of the app expects the wallet.
  useEffect(() => {
    if (isConnected && !wallet && chainId !== undefined && chainId !== chain.id) switchChain({ chainId: chain.id });
  }, [isConnected, wallet, chainId, switchChain]);
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
      announce();
      await done();
    },
    async signOut() {
      await api('/auth/logout', { method: 'POST' });
      announce();
      await disconnectAsync().catch(() => {});
      await qc.resetQueries();
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

/** Whether this wallet has authorised Monday's agent to log its decisions in the registry. Undefined while unknown. */
export function useAgentAuthorized(registry: `0x${string}` | null | undefined, agent: `0x${string}` | null | undefined) {
  const { address } = useAccount();
  const pub = usePublicClient({ chainId: chain.id });
  return useQuery({
    queryKey: ['agent-of', registry, agent, address],
    enabled: Boolean(registry && agent && address && pub),
    queryFn: async () => (await pub!.readContract({ address: registry!, abi: registryAbi, functionName: 'agentOf', args: [address!] })).toLowerCase() === agent!.toLowerCase(),
  }).data;
}

/**
 * Two wallet steps on Monad: publish the policy to MondayRegistry, then, the first time only, authorise the agent to
 * log decisions. Each step can be retried on its own: a declined second step leaves the published policy in force.
 */
export function useRegistry() {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const pub = usePublicClient({ chainId: chain.id });
  const qc = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const authorize = async (registry: `0x${string}`, agent: `0x${string}`, onStep: (s: string) => void) => {
    if (!address || !pub) throw new Error('Connect the wallet that owns this account.');
    await switchChainAsync({ chainId: chain.id });
    onStep('Authorise the agent to log decisions');
    const tx = await writeContractAsync({ address: registry, abi: registryAbi, functionName: 'authorizeAgent', args: [agent], chainId: chain.id });
    onStep('Waiting for Monad to confirm');
    await pub.waitForTransactionReceipt({ hash: tx });
    await qc.invalidateQueries({ queryKey: ['agent-of'] });
  };

  return {
    /** A wallet is connected. The session belongs to it: the shell signs out if another one is picked. */
    canSign: Boolean(address),
    /** Open the wallet modal to connect again, when the session is valid but the wallet connection was lost. */
    reconnect: () => openConnectModal?.(),
    authorize,
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
          try {
            await authorize(o.registry, o.agent, onStep);
          } catch {
            throw new Error('Your limits are published on Monad and in force. Authorising the agent to log decisions did not finish: use Authorise agent to complete it.');
          }
        }
      }
      return tx;
    },
  };
}
