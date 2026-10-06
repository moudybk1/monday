'use client';

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { parseAbi } from 'viem';
import { monad, monadTestnet } from 'viem/chains';
import { createSiweMessage } from 'viem/siwe';
import { WagmiProvider, createConfig, http, injected, useConnect, useConnection, useDisconnect, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi';
import { REGISTRY_ABI, type AppConfig, type Me, type Policy } from '@monday/core';
import { ApiError, api } from './api';

// Follows the NETWORK switch (see next.config.ts). The shell warns if the server disagrees.
export const chain = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? monad : monadTestnet;
// Both chains are registered so the types stay simple; only `chain` is ever used. Your own RPC, if set, serves it.
const rpc = (id: number) => http(id === chain.id ? process.env.NEXT_PUBLIC_MONAD_RPC_URL : undefined);
const wagmiConfig = createConfig({
  chains: [monadTestnet, monad],
  connectors: [injected()],
  transports: { [monadTestnet.id]: rpc(monadTestnet.id), [monad.id]: rpc(monad.id) },
  ssr: true,
});
export const registryAbi = parseAbi(REGISTRY_ABI);

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
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
  const { address } = useConnection();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const done = () => qc.invalidateQueries({ queryKey: ['me'] });

  return {
    hasWallet: typeof window !== 'undefined' && 'ethereum' in window,
    /** Connect, switch to Monad, then Sign-In with Ethereum. No gas, no funds moved. */
    async signIn() {
      let account = address;
      if (!account) {
        const connector = connectors[0];
        if (!connector) throw new Error('No browser wallet found. Install one, or use the demo account.');
        account = (await connectAsync({ connector, chainId: chain.id })).accounts[0];
      }
      await switchChainAsync({ chainId: chain.id }).catch(() => {});
      const { nonce } = await api<{ nonce: string }>('/auth/nonce', { method: 'POST' });
      const message = createSiweMessage({
        address: account, chainId: chain.id, domain: location.host, nonce, uri: location.origin, version: '1',
        statement: 'Sign in to Monday. This costs no gas and moves no funds.',
      });
      const signature = await signMessageAsync({ message });
      await api('/auth/verify', { method: 'POST', body: { message, signature } });
      await done();
    },
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
  const { address } = useConnection();
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
