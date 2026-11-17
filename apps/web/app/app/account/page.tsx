'use client';

import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { safeReturnPath } from '@monday/core';
import { AccountStep, KeyStep, type PerplAccount } from '@/components/perpl-connect';
import { Button, ButtonLink, Notice, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtUsd } from '@/lib/format';
import { useAppConfig, useMe, useSession } from '@/lib/wallet';

/**
 * Account Settings: the wallet that signed in and its connection to Perpl (the account and the trade-only key).
 * Signing in only needs the wallet; the key is added here when the user wants to trade, and replaced or removed here too.
 */
export default function Account() {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const session = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const account = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<PerplAccount>('/perpl/account'), refetchInterval: (q) => (q.state.data?.exists ? 30_000 : 8_000) });
  // A page that sent the user here for the key (`?next=`): back to it once the key is in. Read after mount.
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => setNext(safeReturnPath(new URLSearchParams(location.search).get('next'))), []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'neutral' | 'warn'; text: string } | null>(null);

  const revoked = me.keyStatus === 'revoked';
  const connected = me.hasKey && !revoked;
  const showKeyForm = account.data?.exists && (!me.hasKey || revoked || editing);
  const sim = Boolean(cfg?.sim || cfg?.paper);

  const removeKey = async () => {
    if (!confirm('Remove the Perpl key from Monday? Monday stops trading for you until you add a key again. Your funds stay on Perpl.')) return;
    setBusy(true);
    setMsg(null);
    try {
      await api('/credentials', { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setMsg({ tone: 'neutral', text: 'Key removed. Monday can no longer place orders in your Perpl account.' });
    } catch (e) {
      setMsg({ tone: 'warn', text: e instanceof Error ? e.message.split('\n')[0] : 'Could not remove the key.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-in grid max-w-[46rem] gap-8 py-10 md:py-14">
      <header>
        <h1 className="display text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Account Settings</h1>
        <p className="mt-3 text-fg-2">Your wallet and Monday&apos;s connection to your Perpl account.</p>
      </header>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {next && !connected && <Notice>Add your Perpl key below to continue. You go straight back once it is in.</Notice>}

      <Section title="Wallet">
        <Row k="Signed in as">{me.demo ? 'Demo Account' : <span className="num break-all">{me.wallet}</span>}</Row>
        <Row k="Network">{cfg ? <>{cfg.networkName}{(cfg.sim || cfg.paper) && <Tag tone="warn" className="ml-2">{cfg.sim ? 'simulated market' : 'paper trading'}</Tag>}</> : '-'}</Row>
        <div className="flex justify-end px-5 py-3"><Button size="sm" variant="ghost" onClick={() => void session.signOut()}>Sign Out</Button></div>
      </Section>

      <Section title="Perpl Connection" aside={connected ? <Tag tone="bid">Connected</Tag> : revoked ? <Tag tone="ask">Key revoked</Tag> : <Tag>Not connected</Tag>}>
        {account.isLoading ? (
          <div className="grid gap-2 p-5"><Skeleton className="h-5 w-64" /><Skeleton className="h-5 w-48" /></div>
        ) : !account.data?.exists ? (
          <div className="p-5">
            <AccountStep compact wallet={me.demo ? null : me.wallet} account={account.data} loading={account.isLoading} error={account.error} retry={() => void account.refetch()} next={() => void account.refetch()} />
          </div>
        ) : (
          <>
            <Row k="Perpl account"><span className="num">{account.data.accountId}</span></Row>
            <Row k="Collateral">{fmtUsd(account.data.balanceUsd ?? 0)}</Row>
            <Row k="API key">{connected ? 'Trade-only key stored, encrypted' : revoked ? 'Perpl no longer accepts the stored key' : 'None yet'}</Row>
            {connected && !editing && (
              <div className="flex flex-wrap justify-end gap-2 px-5 py-3">
                {next && <ButtonLink href={next} size="sm">Continue</ButtonLink>}
                <ButtonLink href="/app" size="sm" variant={next ? 'ghost' : 'primary'}>Open Agentic</ButtonLink>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Replace Key</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void removeKey()}>{busy ? 'Removing' : 'Remove Key'}</Button>
              </div>
            )}
            {showKeyForm && (
              <div className={cx('border-t border-line p-5')}>
                <KeyStep
                  compact sim={sim} paper={Boolean(cfg?.paper)} perplUrl={cfg?.perplAppUrl ?? ''} hasKey={me.hasKey} revoked={revoked}
                  next={async () => {
                    await qc.invalidateQueries({ queryKey: ['me'] });
                    setEditing(false);
                    if (next) router.replace(next);
                    else setMsg({ tone: 'neutral', text: 'Key validated. Monday can now trade in your Perpl account.' });
                  }}
                />
                {editing && <div className="mt-3"><Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button></div>}
              </div>
            )}
          </>
        )}
      </Section>

      {account.data?.exists && (
        <Section title="Safety">
          <p className="px-5 py-4 text-[14px] text-fg-2">
            The key can place and cancel orders only; Perpl never lets an API key withdraw or transfer. Revoking it on Perpl cuts Monday off at once, whatever runs.{' '}
            {cfg?.perplAppUrl && <a href={`${cfg.perplAppUrl}/apikeys`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-fg underline underline-offset-2">Manage keys on Perpl <ArrowSquareOutIcon size={12} /></a>}
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3 text-[14px] sm:grid-cols-[10rem_1fr]">
      <span className="text-fg-3">{k}</span>
      <span>{children}</span>
    </div>
  );
}
