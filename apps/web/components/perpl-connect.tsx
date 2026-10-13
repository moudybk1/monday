'use client';

// Connecting Monday to the user's Perpl account: find the account, then take a trade-only API key. Every setup path
// (the market maker, Agentic Trade, TWAP) starts here.

import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { usd } from '@monday/core';
import { Button, Field, INPUT, Notice, Skeleton, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { fmtUsd, shortAddr } from '@/lib/format';

export interface PerplAccount {
  exists: boolean; accountId: number | null; balanceUsd: number | null; minDepositUsd: number; depositUrl: string;
  /** Still free for a new plan: the balance less what the market maker and the running plans hold. */
  availableUsd: number | null;
  /** Still free for the market maker: the balance less what the running plans hold. */
  makerAvailableUsd: number | null;
}

export function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="display text-3xl md:text-4xl">{title}</h1>
      <p className="mt-3 max-w-[60ch] text-fg-2">{children}</p>
    </>
  );
}

export function AccountStep({ wallet, account, loading, error, retry, next }: { wallet: string | null; account?: PerplAccount; loading: boolean; error: Error | null; retry: () => void; next: () => void }) {
  if (!account && error) {
    return <Notice tone="warn" action={<Button size="sm" variant="ghost" onClick={retry}>Check now</Button>}>Could not look up your Perpl account: {error.message} It retries by itself every few seconds.</Notice>;
  }
  if (loading || !account) return <div className="grid gap-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-24" /></div>;
  if (!account.exists) {
    return (
      <div>
        <Heading title="You need a Perpl account first">
          Monday trades inside your own Perpl exchange account, and {wallet ? <span className="font-mono text-fg">{shortAddr(wallet)}</span> : 'this wallet'} does not have one yet. Open it on Perpl with the same wallet and a deposit of at least {usd(account.minDepositUsd)}. Already deposited? Then Perpl holds it under another wallet: sign out and connect that one.
        </Heading>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={account.depositUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm bg-fg px-4 text-sm font-medium text-canvas hover:bg-accent hover:text-accent-fg">Open Perpl <ArrowSquareOutIcon size={14} /></a>
          <Button variant="ghost" onClick={retry}>Check now</Button>
        </div>
        <p className="mt-4 text-[14px] text-fg-3" role="status">Leave this tab open. It checks every few seconds and moves on once the deposit lands.</p>
      </div>
    );
  }
  return (
    <div>
      <Heading title="Perpl account found">Monday will trade inside this account. Your collateral stays there the whole time, and you withdraw on Perpl whenever you like.</Heading>
      <dl className="mt-8 grid grid-cols-2 border-y border-line-2">
        <div className="py-4"><dt className="text-[13px] text-fg-3">Account</dt><dd className="num mt-1 text-xl font-semibold">{account.accountId}</dd></div>
        <div className="border-l border-line py-4 pl-5"><dt className="text-[13px] text-fg-3">Collateral balance</dt><dd className="num mt-1 text-xl font-semibold">{fmtUsd(account.balanceUsd ?? 0)}</dd></div>
      </dl>
      <Button size="lg" className="mt-8" onClick={next}>Continue</Button>
    </div>
  );
}

export function KeyStep({ sim, paper, perplUrl, hasKey, revoked, next }: { sim: boolean; paper: boolean; perplUrl: string; hasKey: boolean; revoked: boolean; next: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: 'token' | 'secret' | 'form'; message: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/credentials', { method: 'POST', body: { apiKeyToken: token, apiKeySecret: secret } });
      setSecret(''); // never keep the secret in the page after it is stored
      await next();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const message = e instanceof Error ? e.message : 'Could not validate the key.';
      setErr({ field: code === 'read_only_key' ? 'token' : code === 'bad_signature' ? 'secret' : 'form', message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Heading title="Give Monday a trade-only key">
        A Perpl API key lets Monday place and cancel orders in your account. No API key can withdraw or transfer funds, whatever its scope, and you can revoke it on Perpl at any moment.
      </Heading>
      <ol className="mt-8 grid gap-3 border-y border-line-2 py-5 text-sm">
        {[
          <>In Perpl settings, turn on <strong>One-Click Trading</strong>. Perpl only forwards API orders for accounts that enabled it.</>,
          <>Open the <a href={`${perplUrl}/apikeys`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">Perpl API keys page <ArrowSquareOutIcon size={12} className="inline" /></a> with this wallet.</>,
          <>Create a key with <strong>trade</strong> scope and label it Monday.</>,
          <>Copy the token and the secret, and paste them below.</>,
        ].map((t, i) => (
          <li key={i} className="grid grid-cols-[1.75rem_1fr] items-baseline"><span className="num text-fg-3">{i + 1}</span><span>{t}</span></li>
        ))}
      </ol>
      {revoked && <div className="mt-6"><Notice tone="warn">Key revoked, agent stopped. Perpl no longer accepts the stored key. Add a new one to continue.</Notice></div>}
      {hasKey && <div className="mt-6"><Notice>A key is already stored for this account. Submitting a new one replaces it.</Notice></div>}
      {sim && (
        <div className="mt-6">
          <Notice action={<Button size="sm" variant="ghost" onClick={() => { setToken('pk_demo_monday'); setSecret('sk_demo_monday'); }}>Fill a demo key</Button>}>
            {paper ? 'Paper trading: prices are Perpl\'s real ones, orders are simulated.' : 'Simulated market:'} Any token and secret are accepted. A token starting with <code className="num">read</code> or a secret starting with <code className="num">bad</code> shows the error states.
          </Notice>
        </div>
      )}
      <form onSubmit={submit} className="mt-6 grid gap-5" noValidate>
        <Field label="API key token" htmlFor="token" error={err?.field === 'token' ? err.message : null} hint="Identifies the key. Safe to share with Monday.">
          <input id="token" className={cx(INPUT, 'num')} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        <Field label="API key secret" htmlFor="secret" error={err?.field === 'secret' ? err.message : null} hint="Encrypted with AES-256-GCM on the server. Never sent back to the browser.">
          <input id="secret" type="password" className={cx(INPUT, 'num')} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        {err?.field === 'form' && <p role="alert" className="text-[14px] text-ask-fg">{err.message}</p>}
        <div><Button type="submit" size="lg" disabled={busy || !token || !secret}>{busy ? 'Signing in to Perpl' : 'Validate key'}</Button></div>
      </form>
    </div>
  );
}
