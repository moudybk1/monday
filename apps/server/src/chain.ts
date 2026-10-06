// On-chain decision log (PRD 9.1 chain log queue, 13). One job at a time from
// the agent's logging wallet, so nonces stay ordered.

import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { REGISTRY_ABI } from '@monday/core';
import { config } from './config';
import { event } from './db';

export const registryAbi = parseAbi(REGISTRY_ABI);
const c = config.chain;
export const chainEnabled = Boolean(c.registry && c.loggerKey && c.rpcUrl);

const chain = defineChain({ id: c.chainId, name: config.networkName, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [c.rpcUrl] } } });
const account = chainEnabled ? privateKeyToAccount(c.loggerKey as Hex) : null;
const pub = createPublicClient({ chain, transport: http() });
const wallet = account ? createWalletClient({ account, chain, transport: http() }) : null;
export const agentAddress = account?.address ?? null;

/** Refuse to run against an RPC endpoint that serves a different chain than NETWORK says. */
export async function verifyRpc() {
  const id = await pub.getChainId();
  if (id !== c.chainId) throw new Error(`MONAD_RPC_URL serves chain ${id}, but NETWORK=${config.network} expects chain ${c.chainId}.`);
}

type Job =
  | { kind: 'decision'; user: Hex; market: number; paramsHash: Hex; evidenceHash: Hex; regime: number; uri: string; done: (tx: string, onchainId: number | null) => void }
  | { kind: 'kill'; user: Hex; reason: number; evidenceHash: Hex; done: (tx: string, onchainId: number | null) => void };

const queue: Job[] = [];
let pumping = false;
const authorized = new Map<string, { ok: boolean; at: number }>();

/** Has this user authorised our logging wallet in the registry? Cached for a minute. */
export async function isAuthorized(user: Hex): Promise<boolean> {
  if (!chainEnabled) return false;
  const hit = authorized.get(user);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  let ok = false;
  try {
    const agent = await pub.readContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'agentOf', args: [user] });
    ok = agent.toLowerCase() === account!.address.toLowerCase();
  } catch {
    ok = false;
  }
  authorized.set(user, { ok, at: Date.now() });
  return ok;
}

export function enqueue(job: Job) {
  if (!chainEnabled) return;
  queue.push(job);
  if (!pumping) void pump();
}
export const queueDepth = () => queue.length;

async function pump() {
  pumping = true;
  while (queue.length) {
    const job = queue[0];
    let sent = false;
    // A user who has not authorised the agent would only make the transaction revert.
    if (await isAuthorized(job.user)) {
      for (let attempt = 0; attempt < 4 && !sent; attempt++) {
        try {
          const hash = job.kind === 'decision'
            ? await wallet!.writeContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'logDecision', args: [job.user, job.market, job.paramsHash, job.evidenceHash, job.regime, job.uri] })
            : await wallet!.writeContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'logKill', args: [job.user, job.reason, job.evidenceHash] });
          const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
          if (receipt.status !== 'success') throw new Error('reverted');
          const logs = parseEventLogs({ abi: registryAbi, logs: receipt.logs, eventName: 'DecisionLogged' });
          job.done(hash, logs[0] ? Number(logs[0].args.decisionId) : null);
          sent = true;
        } catch (e) {
          console.error(JSON.stringify({ service: 'chain', event: 'log_failed', attempt, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }));
          await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
        }
      }
      if (!sent) event(null, 'chain_log_dropped', { kind: job.kind, user: job.user });
    }
    queue.shift();
  }
  pumping = false;
}

/** The policy hash the registry currently holds for this user, or null if it cannot be read. */
export async function onchainPolicyHash(user: Hex): Promise<string | null> {
  if (!c.registry) return null;
  try {
    const p = await pub.readContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'policyOf', args: [user] });
    return p.policyHash.toLowerCase();
  } catch {
    return null;
  }
}
