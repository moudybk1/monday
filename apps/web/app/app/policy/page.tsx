'use client';

import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { policySummary } from '@monday/core';
import { PolicyForm, draftFits, draftFrom, toBody, type PolicyDraft } from '@/components/policy-form';
import { Button, Notice, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { shortHash } from '@/lib/format';
import { useAppConfig, useMe, useRegistry, type PolicyView } from '@/lib/wallet';

export default function PolicyPage() {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const qc = useQueryClient();
  const router = useRouter();
  const registry = useRegistry();
  const view = useQuery({ queryKey: ['policy'], queryFn: () => api<PolicyView>('/policy') });
  const balance = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<{ balanceUsd: number | null }>('/perpl/account') }).data?.balanceUsd ?? null;
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const disconnect = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (view.data && !draft) setDraft(draftFrom(view.data.pending?.policy ?? view.data.policy));
  }, [view.data, draft]);
  if (!draft || !view.data) return <div className="grid gap-4 py-10"><Skeleton className="h-10 w-64" /><Skeleton className="h-80" /></div>;

  const pending = view.data.pending;
  const save = async () => {
    setNote(null);
    setBusy('Saving');
    try {
      const res = await api<PolicyView>('/policy', { method: 'PUT', body: toBody(draft) });
      if (res.pending?.onchain) await registry.publish(res.pending.onchain, setBusy);
      await Promise.all([qc.invalidateQueries({ queryKey: ['policy'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
      setNote({ ok: true, text: res.pending ? 'Published on Monad. The new limits apply from the next tick.' : 'Saved. The new limits apply from the next tick.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Could not save.';
      await qc.invalidateQueries({ queryKey: ['policy'] });
      setNote({ ok: false, text: /rejected|denied/i.test(msg) ? 'You declined the transaction. The old limits stay in force until you sign.' : msg });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    await api('/credentials', { method: 'DELETE' });
    await qc.invalidateQueries({ queryKey: ['me'] });
    router.push('/app/onboarding');
  };

  return (
    <div className="grid gap-12 py-10 lg:grid-cols-[minmax(0,46rem)_minmax(0,1fr)] lg:gap-20">
      <div>
        <h1 className="display text-3xl md:text-4xl">Policy</h1>
        <p className="mt-3 max-w-[60ch] text-fg-2">Your limits bind every order. Tightening them makes Monday reduce inventory straight away; loosening them takes effect at the next tick.</p>
        {pending && (
          <div className="mt-6">
            <Notice tone="warn" action={pending.onchain && <Button size="sm" variant="ghost" disabled={busy !== null || !registry.canSign} onClick={save}>Sign on Monad</Button>}>
              A changed policy is saved but not in force. It applies once your wallet publishes it on Monad.
            </Notice>
          </div>
        )}
        <div className="mt-8"><PolicyForm value={draft} onChange={setDraft} available={cfg ? (Object.keys(cfg.specs) as PolicyDraft['markets']) : ['BTC']} caps={cfg?.caps ?? null} balance={balance} /></div>
        <p className="mt-8 border-l-2 border-fg pl-4 text-[15px]">{policySummary({ ...draft.limits, markets: draft.markets })}</p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={save} disabled={busy !== null || !draftFits(draft, balance)}>{busy ?? 'Save policy'}</Button>
          {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-[13px] text-fg-2' : 'text-[13px] text-ask-fg'}>{note.text}</p>}
        </div>
        {view.data.onchainTx && (
          <p className="mt-4 text-[13px] text-fg-3">
            In force on Monad since transaction <a className="num underline underline-offset-2" href={`${cfg?.explorerUrl}/tx/${view.data.onchainTx}`} target="_blank" rel="noreferrer">{shortHash(view.data.onchainTx)}</a>.
          </p>
        )}
      </div>

      <aside className="grid content-start gap-8 text-sm">
        <section>
          <h2 className="border-b border-line-2 pb-2 font-semibold">Your exits never depend on Monday</h2>
          <dl className="grid gap-4 pt-4">
            <div>
              <dt className="font-medium">Withdraw</dt>
              <dd className="mt-1 text-fg-2">Always on Perpl, from your own wallet. Pause Monday first so no order is resting while you move funds.</dd>
              <a href={cfg?.perplAppUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 underline underline-offset-2">Open Perpl <ArrowSquareOutIcon size={12} /></a>
            </div>
            <div>
              <dt className="font-medium">Revoke the key</dt>
              <dd className="mt-1 text-fg-2">Delete the key on Perpl and Monday loses access at once. It notices the dead key, stops, and tells you.</dd>
              <a href={`${cfg?.perplAppUrl}/apikeys`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 underline underline-offset-2">Perpl API keys <ArrowSquareOutIcon size={12} /></a>
            </div>
          </dl>
        </section>
        <section>
          <h2 className="border-b border-line-2 pb-2 font-semibold">Disconnect from Monday</h2>
          <p className="pt-4 text-fg-2">Cancels Monday&apos;s orders, stops the agent and deletes the stored key for account <span className="num">{me.accountId}</span>. Open positions are left as they are.</p>
          <Button variant="danger" className="mt-4" onClick={() => disconnect.current?.showModal()}>Disconnect</Button>
        </section>
      </aside>

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
