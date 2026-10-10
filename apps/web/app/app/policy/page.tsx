'use client';

import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Policy, PolicyLimits } from '@monday/core';
import { PolicyForm, draftFrom, draftOk, toBody, type PolicyDraft } from '@/components/policy-form';
import { Button, Notice, Panel, Skeleton, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { shortHash } from '@/lib/format';
import { useAgentAuthorized, useAppConfig, useMe, useRegistry, type PolicyView } from '@/lib/wallet';

export default function PolicyPage() {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const qc = useQueryClient();
  const router = useRouter();
  const registry = useRegistry();
  const authorized = useAgentAuthorized(me.demo ? null : (cfg?.registry as `0x${string}` | null | undefined), cfg?.agentAddress as `0x${string}` | null | undefined);
  const view = useQuery({ queryKey: ['policy'], queryFn: () => api<PolicyView>('/policy') });
  const balance = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<{ balanceUsd: number | null }>('/perpl/account') }).data?.balanceUsd ?? null;
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const disconnect = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (view.data && !draft) setDraft(draftFrom(view.data.pending?.policy ?? view.data.policy));
  }, [view.data, draft]);
  if (!draft || !view.data) return <div className="grid gap-4 py-8"><Skeleton className="h-8 w-56" /><Skeleton className="h-96" /></div>;

  const specs = cfg?.specs ?? {};
  const caps = cfg?.caps ?? null;
  const pending = view.data.pending;
  // Three states a reader must tell apart: edits not saved, saved but waiting for the wallet, and saved and in force.
  const savedPolicy = pending?.policy ?? view.data.policy;
  const unsaved = !sameLimits(savedPolicy, draft);
  const mustSign = Boolean(cfg?.registry) && !me.demo;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['policy'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
  const failed = async (e: unknown) => {
    const msg = e instanceof Error ? e.message.split('\n')[0] : 'Could not save.';
    await qc.invalidateQueries({ queryKey: ['policy'] });
    setNote({ ok: false, text: /rejected|denied/i.test(msg) ? 'You declined the transaction. The settings in force stay as they were until you sign.' : msg });
  };
  const save = async () => {
    setNote(null);
    setBusy('Saving');
    try {
      const res = await api<PolicyView>('/policy', { method: 'PUT', body: toBody(draft) });
      // The server refits a template to the balance it reads now: show exactly what it saved.
      setDraft(draftFrom(res.pending?.policy ?? res.policy));
      if (res.pending?.onchain) await registry.publish(res.pending.onchain, setBusy);
      await refresh();
      setNote({ ok: true, text: res.pending ? 'Published on Monad. Monday uses the new settings from its next tick.' : 'Saved. Monday uses the new settings from its next tick.' });
    } catch (e) {
      await failed(e);
    } finally {
      setBusy(null);
    }
  };
  // A saved policy waiting for the wallet: sign that one again, never save a new one.
  const sign = async () => {
    if (!pending?.onchain) return;
    setNote(null);
    try {
      await registry.publish(pending.onchain, setBusy);
      await refresh();
      setNote({ ok: true, text: 'Published on Monad. Monday uses the new settings from its next tick.' });
    } catch (e) {
      await failed(e);
    } finally {
      setBusy(null);
    }
  };
  const authorize = async () => {
    setNote(null);
    try {
      await registry.authorize(cfg!.registry as `0x${string}`, cfg!.agentAddress as `0x${string}`, setBusy);
      setNote({ ok: true, text: 'Agent authorised. Its decisions are logged on Monad from now on.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed.';
      setNote({ ok: false, text: /rejected|denied/i.test(msg) ? 'You declined the authorisation. Decisions stay off-chain until you authorise.' : msg });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setNote(null);
    try {
      await api('/credentials', { method: 'DELETE' });
    } catch (e) {
      // e.g. Monday is still cancelling orders: say so instead of looking disconnected.
      return setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not disconnect.' });
    }
    await qc.invalidateQueries({ queryKey: ['me'] });
    router.push('/app/onboarding');
  };

  const ready = draftOk(draft, balance, caps, specs);
  const action = unsaved
    ? <Button size="lg" className="w-full" onClick={save} disabled={busy !== null || !ready}>{busy ?? (mustSign ? 'Save and sign' : 'Save settings')}</Button>
    : pending?.onchain && !registry.canSign
      ? <Button size="lg" className="w-full" onClick={registry.reconnect}>Reconnect wallet</Button>
      : pending?.onchain
        ? <Button size="lg" className="w-full" onClick={sign} disabled={busy !== null}>{busy ?? 'Sign on Monad'}</Button>
        : null; // nothing to save: the status says it is in force, and a change brings the button back

  return (
    <div className="grid gap-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-2xl">Bot settings</h1>
          <p className="mt-1 text-[13px] text-fg-2">The rules Monday trades by. They stay in force until you change them.</p>
        </div>
        {me.accountId != null && <Tag>Perpl account {me.accountId}</Tag>}
      </header>

      {pending && (
        <Notice tone="warn">
          Saved but not in force yet: it applies once your wallet publishes it on Monad.{!registry.canSign && ' The wallet connection was lost: reconnect the wallet you signed in with.'}
        </Notice>
      )}
      {!pending && authorized === false && (
        <Notice tone="warn" action={registry.canSign
          ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void authorize()}>Authorise agent</Button>
          : <Button size="sm" variant="ghost" onClick={registry.reconnect}>Reconnect wallet</Button>}>
          Your settings are published, but Monday&apos;s agent is not authorised to log its decisions in MondayRegistry yet. One signature completes it.
        </Notice>
      )}

      <PolicyForm value={draft} onChange={(d) => { setDraft(d); setNote(null); }} available={cfg ? (Object.keys(cfg.specs) as PolicyDraft['markets']) : ['BTC']} caps={caps} balance={balance} specs={specs}>
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-fg-3">Status</span>
          <Tag tone={unsaved || pending ? 'warn' : 'neutral'}>{unsaved ? 'Unsaved changes' : pending ? 'Waiting for signature' : 'In force'}</Tag>
        </div>
        {action}
        {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-[12px] text-fg-2' : 'text-[12px] text-ask-fg'}>{note.text}</p>}
        <p className="text-[12px] text-fg-3">Saving does not start or stop the bot. A running bot follows the new settings from its next tick.</p>
        {view.data.onchainTx && (
          <p className="text-[12px] text-fg-3">
            In force on Monad since {cfg ? <a className="num underline underline-offset-2" href={`${cfg.explorerUrl}/tx/${view.data.onchainTx}`} target="_blank" rel="noreferrer">{shortHash(view.data.onchainTx)}</a> : <span className="num">{shortHash(view.data.onchainTx)}</span>}.
          </p>
        )}
      </PolicyForm>

      <Panel title="Account access">
        <div className="grid gap-5 p-4 text-[12.5px] sm:grid-cols-3">
          <div>
            <p className="font-medium">Withdraw</p>
            <p className="mt-1 text-fg-2">Always on Perpl, from your own wallet. Stop Monday first so no order is resting while you move funds.</p>
            {cfg && <a href={cfg.perplAppUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 underline underline-offset-2">Open Perpl <ArrowSquareOutIcon size={12} /></a>}
          </div>
          <div>
            <p className="font-medium">Revoke the key</p>
            <p className="mt-1 text-fg-2">Delete the key on Perpl and Monday loses access at once. It notices, stops, and tells you.</p>
            {cfg && <a href={`${cfg.perplAppUrl}/apikeys`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 underline underline-offset-2">Perpl API keys <ArrowSquareOutIcon size={12} /></a>}
          </div>
          <div>
            <p className="font-medium">Disconnect</p>
            <p className="mt-1 text-fg-2">Cancels Monday&apos;s orders, stops the agent and deletes the stored key for account <span className="num">{me.accountId}</span>. Open positions stay.</p>
            <Button variant="danger" size="sm" className="mt-2" onClick={() => disconnect.current?.showModal()}>Disconnect</Button>
          </div>
        </div>
      </Panel>

      <dialog ref={disconnect} className="m-auto w-[min(92vw,26rem)] rounded-sm border border-line-2 bg-canvas p-6 text-fg">
        <h2 className="display text-2xl">Disconnect Monday?</h2>
        <p className="mt-3 text-sm text-fg-2">Orders are cancelled and the stored key is deleted. Any open position stays in your Perpl account for you to manage. To come back you paste a key again.</p>
        <form method="dialog" className="mt-6 flex justify-end gap-2">
          <Button type="submit" variant="ghost">Stay connected</Button>
          <Button type="submit" variant="danger" onClick={() => void remove()}>Disconnect</Button>
        </form>
      </dialog>
    </div>
  );
}

/** The draft says the same as a saved policy: same markets, same limits. The preset's name alone is no change. */
function sameLimits(p: Policy | null, d: PolicyDraft): boolean {
  return p != null && p.markets.join() === d.markets.join() && (Object.keys(d.limits) as (keyof PolicyLimits)[]).every((k) => p[k] === d.limits[k]);
}
