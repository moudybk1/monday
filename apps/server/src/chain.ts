// On-chain decision log (PRD 9.1 chain log queue, 13). Jobs live in SQLite
// (pending -> submitted -> confirmed | failed) and go out one at a time from
// the agent's logging wallet, so nonces stay ordered. Logging never blocks the
// order path: a decision is acted on first and anchored when Monad allows.

import { TransactionNotFoundError, TransactionReceiptNotFoundError, createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs, type Hex, type TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { REGISTRY_ABI, type AnchorStatus } from '@monday/core';
import { config } from './config';
import { db, event } from './db';

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

export type Job =
  | { kind: 'decision'; user: Hex; market: number; paramsHash: Hex; evidenceHash: Hex; regime: number; uri: string }
  | { kind: 'kill'; user: Hex; reason: number; evidenceHash: Hex };

interface JobRow { id: number; decision_id: number | null; payload: string; status: string; tx_hash: string | null; attempts: number }

const MAX_ATTEMPTS = 4;
let pumping = false;
const authorized = new Map<string, { ok: boolean; at: number }>();
/** Anchoring state by decision id, for the dashboard. Loaded at boot, updated by the pump. */
const anchors = new Map<number, { status: AnchorStatus; tx: string | null; onchainId: number | null }>();
export const anchorOf = (decisionId: number) => anchors.get(decisionId) ?? null;

/**
 * Has this user authorised our logging wallet in the registry? Cached for a minute. An RPC failure throws instead of
 * answering "no": the job then retries, rather than being skipped for good over a bad RPC minute.
 */
export async function isAuthorized(user: Hex): Promise<boolean> {
  if (!chainEnabled) return false;
  const hit = authorized.get(user);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  const agent = await pub.readContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'agentOf', args: [user] });
  const ok = agent.toLowerCase() === account!.address.toLowerCase();
  authorized.set(user, { ok, at: Date.now() });
  return ok;
}

/** A lookup that answers "no such transaction" as null, and lets any other failure (an RPC outage) throw. */
const unlessMissing = <T>(p: Promise<T>): Promise<T | null> =>
  p.catch((e) => {
    if (e instanceof TransactionReceiptNotFoundError || e instanceof TransactionNotFoundError) return null;
    throw e;
  });

/** Queue a decision for Monad. Stored first, so a restart or a bad RPC hour cannot lose it. */
export function enqueue(job: Job, decisionId: number | null) {
  if (!chainEnabled) return;
  const now = Date.now();
  db.prepare("insert into chain_jobs (decision_id, kind, payload, status, created_at, updated_at) values (?,?,?,'pending',?,?)").run(decisionId, job.kind, JSON.stringify(job), now, now);
  if (decisionId != null) anchors.set(decisionId, { status: 'pending', tx: null, onchainId: null });
  void pump();
}
export const queueDepth = () => (db.prepare("select count(*) n from chain_jobs where status in ('pending', 'submitted')").get() as { n: number }).n;

/** Boot: pick up whatever was pending or sent when the process last stopped. */
export function resumeChainLog() {
  const statusOf = (s: string): AnchorStatus => (s === 'confirmed' ? 'confirmed' : s === 'failed' ? 'failed' : s === 'skipped' ? 'off' : 'pending');
  for (const r of db.prepare('select j.decision_id, j.status, j.tx_hash, d.onchain_id from chain_jobs j left join decisions d on d.id = j.decision_id where j.decision_id is not null order by j.id desc limit 2000').all() as { decision_id: number; status: string; tx_hash: string | null; onchain_id: number | null }[]) {
    anchors.set(r.decision_id, { status: statusOf(r.status), tx: r.status === 'confirmed' ? r.tx_hash : null, onchainId: r.onchain_id });
  }
  if (chainEnabled) void pump();
}

// One job at a time from one wallet, so nonces stay ordered.
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const row = db.prepare("select * from chain_jobs where status in ('pending', 'submitted') order by id limit 1").get() as JobRow | undefined;
      if (!row) break;
      await run(row);
    }
  } finally {
    pumping = false;
  }
}

async function run(row: JobRow) {
  const job = JSON.parse(row.payload) as Job;
  const mark = (status: string, tx: string | null, error: string | null, attempts = row.attempts) =>
    db.prepare('update chain_jobs set status = ?, tx_hash = coalesce(?, tx_hash), attempts = ?, error = ?, updated_at = ? where id = ?').run(status, tx, attempts, error, Date.now(), row.id);
  try {
    if (row.tx_hash) {
      // Sent before, perhaps by a process that has since restarted. Look for it before sending again, so a retry
      // never logs the same decision twice. Only a transaction the node no longer knows is sent again.
      const hash = row.tx_hash as Hex;
      const receipt = await unlessMissing(pub.getTransactionReceipt({ hash }))
        ?? (await unlessMissing(pub.getTransaction({ hash })) ? await pub.waitForTransactionReceipt({ hash, timeout: 60_000 }) : null);
      if (receipt) return settle(row, receipt, mark);
    }
    // A user who has not authorised the agent would only make the transaction revert.
    if (!(await isAuthorized(job.user))) {
      mark('skipped', null, 'agent not authorised');
      if (row.decision_id != null) anchors.set(row.decision_id, { status: 'off', tx: null, onchainId: null });
      return;
    }
    const hash = job.kind === 'decision'
      ? await wallet!.writeContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'logDecision', args: [job.user, job.market, job.paramsHash, job.evidenceHash, job.regime, job.uri] })
      : await wallet!.writeContract({ address: c.registry as Hex, abi: registryAbi, functionName: 'logKill', args: [job.user, job.reason, job.evidenceHash] });
    mark('submitted', hash, null); // stored before waiting: a crash from here on finds it on the next boot
    return settle(row, await pub.waitForTransactionReceipt({ hash, timeout: 60_000 }), mark);
  } catch (e) {
    const attempts = row.attempts + 1;
    const error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.error(JSON.stringify({ service: 'chain', event: 'log_failed', attempt: attempts, error }));
    if (attempts >= MAX_ATTEMPTS) {
      mark('failed', null, error, attempts);
      if (row.decision_id != null) anchors.set(row.decision_id, { status: 'failed', tx: null, onchainId: null });
      event(null, 'chain_log_dropped', { kind: job.kind, user: job.user, decisionId: row.decision_id });
      return;
    }
    mark(row.status, null, error, attempts);
    await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempts));
  }
}

function settle(row: JobRow, receipt: TransactionReceipt, mark: (status: string, tx: string | null, error: string | null) => unknown) {
  if (receipt.status !== 'success') {
    mark('failed', receipt.transactionHash, 'reverted');
    if (row.decision_id != null) anchors.set(row.decision_id, { status: 'failed', tx: null, onchainId: null });
    return;
  }
  const logs = parseEventLogs({ abi: registryAbi, logs: receipt.logs, eventName: 'DecisionLogged' });
  const onchainId = logs[0] ? Number(logs[0].args.decisionId) : null;
  mark('confirmed', receipt.transactionHash, null);
  if (row.decision_id == null) return;
  db.prepare('update decisions set tx_hash = ?, onchain_id = ? where id = ?').run(receipt.transactionHash, onchainId, row.decision_id);
  anchors.set(row.decision_id, { status: 'confirmed', tx: receipt.transactionHash, onchainId });
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
