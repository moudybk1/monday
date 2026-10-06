'use client';

import { ArrowSquareOutIcon, CheckIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { policySummary, usd } from '@monday/core';
import { PolicyForm, draftFits, draftForBalance, draftFrom, toBody, type Caps, type PolicyDraft } from '@/components/policy-form';
import { Button, Field, INPUT, Notice, Skeleton, Tag, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { fmtUsd, shortAddr, shortHash } from '@/lib/format';
import { useAppConfig, useMe, useRegistry, type PolicyView } from '@/lib/wallet';

interface Account { exists: boolean; accountId: number | null; balanceUsd: number | null; minDepositUsd: number; depositUrl: string }

const STEPS = ['Wallet', 'Perpl account', 'Trade key', 'Limits', 'Review and start'];

export default function Onboarding() {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const qc = useQueryClient();
  // Poll while the user is off depositing on Perpl, so the step advances without a click.
  const account = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<Account>('/perpl/account'), refetchInterval: (q) => (q.state.data?.exists ? false : 8_000) });
  const policy = useQuery({ queryKey: ['policy'], queryFn: () => api<PolicyView>('/policy') });

  const hasPolicy = Boolean(me.policy || me.policyPending);
  const reachable = !account.data?.exists ? 1 : !me.hasKey ? 2 : !hasPolicy ? 3 : 4;
  const [step, setStep] = useState(1);
  const [linked, setLinked] = useState(false);
  // Resume where the user left off, but never past what is unlocked.
  useEffect(() => {
    if (account.data) setStep(me.hasKey ? reachable : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.data?.exists]);
  const current = Math.min(step, reachable);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['policy'] })]);

  return (
    <div className="grid gap-10 py-10 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-16 md:py-16">
      <nav aria-label="Setup steps">
        <ol className="flex gap-1 overflow-x-auto md:block md:space-y-1">
          {STEPS.map((label, i) => {
            const done = i < current || (i === 0);
            const active = i === current;
            return (
              <li key={label} className="shrink-0">
                <button
                  type="button" disabled={i === 0 || i > reachable} onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                  className={cx('flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm disabled:cursor-default', active ? 'bg-raised font-semibold' : 'text-fg-2', i <= reachable && i > 0 && !active && 'hover:bg-raised')}
                >
                  <span className={cx('num grid size-6 shrink-0 place-items-center rounded-sm border text-[12px]', done && !active ? 'border-fg bg-fg text-canvas' : active ? 'border-transparent bg-accent text-accent-fg' : 'border-line-2 text-fg-3')}>
                    {done && !active ? <CheckIcon size={12} weight="bold" /> : i + 1}
                  </span>
                  <span className={cx('whitespace-nowrap', !active && 'hidden md:inline')}>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 hidden text-[13px] text-fg-3 md:block">Signed in {me.demo ? 'with a demo account' : <>as <span className="num text-fg-2">{shortAddr(me.wallet)}</span></>}. Setup takes about five minutes.</p>
      </nav>

      <div className="max-w-[46rem]">
        {current === 1 && <AccountStep account={account.data} loading={account.isLoading} retry={() => void account.refetch()} next={() => setStep(2)} />}
        {current === 2 && <KeyStep sim={Boolean(cfg?.sim)} perplUrl={cfg?.perplAppUrl ?? ''} hasKey={me.hasKey} revoked={me.keyStatus === 'revoked'} next={async () => { await Promise.all([refresh(), account.refetch()]); setLinked(true); setStep(3); }} />}
        {current === 3 && (
          <LimitsStep
            initial={policy.data?.pending?.policy ?? policy.data?.policy ? draftFrom(policy.data?.pending?.policy ?? policy.data?.policy) : draftForBalance(account.data?.balanceUsd ?? 0, cfg?.caps ?? null)}
            balance={account.data?.balanceUsd ?? 0} linked={linked}
            available={cfg ? (Object.keys(cfg.specs) as PolicyDraft['markets']) : ['BTC']} caps={cfg?.caps ?? null}
            next={async () => { await refresh(); setStep(4); }}
          />
        )}
        {current === 4 && <ReviewStep view={policy.data} demo={me.demo} explorerUrl={cfg?.explorerUrl ?? ''} realFunds={Boolean(cfg?.realFunds)} networkName={cfg?.networkName ?? ''} refresh={refresh} />}
      </div>
    </div>
  );
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="display text-3xl md:text-4xl">{title}</h1>
      <p className="mt-3 max-w-[60ch] text-fg-2">{children}</p>
    </>
  );
}

function AccountStep({ account, loading, retry, next }: { account?: Account; loading: boolean; retry: () => void; next: () => void }) {
  if (loading || !account) return <div className="grid gap-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-24" /></div>;
  if (!account.exists) {
    return (
      <div>
        <Heading title="You need a Perpl account first">
          Monday trades inside your own Perpl exchange account, and this wallet does not have one yet. Open it on Perpl with the same wallet and a deposit of at least {usd(account.minDepositUsd)}.
        </Heading>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={account.depositUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm bg-fg px-4 text-sm font-medium text-canvas hover:bg-accent hover:text-accent-fg">Open Perpl <ArrowSquareOutIcon size={14} /></a>
          <Button variant="ghost" onClick={retry}>Check now</Button>
        </div>
        <p className="mt-4 text-[13px] text-fg-3" role="status">Leave this tab open. It checks every few seconds and moves on once the deposit lands.</p>
      </div>
    );
  }
  return (
    <div>
      <Heading title="Perpl account found">Monday will trade inside this account. Your collateral stays there the whole time, and you withdraw on Perpl whenever you like.</Heading>
      <dl className="mt-8 grid grid-cols-2 border-y border-line-2">
        <div className="py-4"><dt className="text-[12px] text-fg-3">Account</dt><dd className="num mt-1 text-xl font-semibold">{account.accountId}</dd></div>
        <div className="border-l border-line py-4 pl-5"><dt className="text-[12px] text-fg-3">Collateral balance</dt><dd className="num mt-1 text-xl font-semibold">{fmtUsd(account.balanceUsd ?? 0)}</dd></div>
      </dl>
      <Button size="lg" className="mt-8" onClick={next}>Continue</Button>
    </div>
  );
}

function KeyStep({ sim, perplUrl, hasKey, revoked, next }: { sim: boolean; perplUrl: string; hasKey: boolean; revoked: boolean; next: () => Promise<void> }) {
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
            Simulated market: any token and secret are accepted. A token starting with <code className="num">read</code> or a secret starting with <code className="num">bad</code> shows the error states.
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
        {err?.field === 'form' && <p role="alert" className="text-[13px] text-ask-fg">{err.message}</p>}
        <div><Button type="submit" size="lg" disabled={busy || !token || !secret}>{busy ? 'Signing in to Perpl' : 'Validate key'}</Button></div>
      </form>
    </div>
  );
}

function LimitsStep({ initial, balance, linked, available, caps, next }: { initial: PolicyDraft; balance: number; linked: boolean; available: PolicyDraft['markets']; caps: Caps | null; next: () => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/policy', { method: 'PUT', body: toBody(draft) });
      await next();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the policy.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {linked && <div className="mb-8"><Notice>Key accepted. Monday can place, change and cancel orders in your account. It cannot withdraw or transfer funds.</Notice></div>}
      <Heading title="Set your limits">These limits bind the agent and the LLM alike. Nothing Monday does can exceed them. Your Perpl balance is <span className="num">{fmtUsd(balance)}</span>.</Heading>
      <div className="mt-8"><PolicyForm value={draft} onChange={setDraft} available={available} caps={caps} balance={balance} /></div>
      <p className="mt-8 border-l-2 border-fg pl-4 text-[15px]">{policySummary({ ...draft.limits, markets: draft.markets })}</p>
      {err && <p role="alert" className="mt-4 text-[13px] text-ask-fg">{err}</p>}
      <Button size="lg" className="mt-8" onClick={save} disabled={busy || !draftFits(draft, balance)}>{busy ? 'Checking limits' : 'Continue'}</Button>
    </div>
  );
}

function ReviewStep({ view, demo, explorerUrl, realFunds, networkName, refresh }: { view?: PolicyView; demo: boolean; explorerUrl: string; realFunds: boolean; networkName: string; refresh: () => Promise<unknown> }) {
  const router = useRouter();
  const registry = useRegistry();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  if (!view) return <Skeleton className="h-64" />;
  const p = view.pending?.policy ?? view.policy;
  if (!p) return <Notice tone="warn">No policy saved yet. Go back one step.</Notice>;
  const mustSign = Boolean(view.pending);

  const sign = async () => {
    setErr(null);
    try {
      await registry.publish(view.pending!.onchain!, setBusy);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed.';
      setErr(/rejected|denied/i.test(msg) ? 'You declined the transaction in your wallet.' : msg);
    } finally {
      setBusy(null);
    }
  };
  const start = async () => {
    setBusy('Opening the trading session');
    setErr(null);
    try {
      await api('/agent/start', { method: 'POST' });
      await refresh();
      router.push('/app');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start.');
      setBusy(null);
    }
  };

  return (
    <div>
      <Heading title="Review and start">{policySummary(p)}</Heading>
      <dl className="mt-8 grid grid-cols-2 border-t border-line-2 text-sm sm:grid-cols-3">
        {[
          ['Markets', p.markets.join(', ')], ['Quote size per side', usd(p.quoteSizeUsd)], ['Max inventory', usd(p.maxInventoryUsd)],
          ['Min half-spread', `${p.minHalfSpreadBps} bps`], ['Daily loss limit', usd(p.maxDailyLossUsd)], ['Max leverage', `${p.maxLeverage}x`],
        ].map(([k, v]) => (
          <div key={k} className="border-b border-line py-3"><dt className="text-[12px] text-fg-3">{k}</dt><dd className="num mt-0.5 font-semibold">{v}</dd></div>
        ))}
      </dl>

      <div className="mt-8 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Publish the policy on Monad</p>
            <p className="mt-0.5 text-[13px] text-fg-3">
              {mustSign ? 'One transaction from your wallet records these limits in MondayRegistry and authorises the agent to log its decisions. The contract holds no funds.'
                : view.onchainTx ? <>Published. <a className="num underline underline-offset-2" href={`${explorerUrl}/tx/${view.onchainTx}`} target="_blank" rel="noreferrer">{shortHash(view.onchainTx)}</a></>
                : demo ? 'Skipped for demo accounts, which have no wallet to sign with. The policy is enforced off-chain.'
                : 'MondayRegistry is not configured on this server yet, so the policy is enforced off-chain only.'}
            </p>
          </div>
          {mustSign ? <Button variant="ghost" onClick={sign} disabled={busy !== null || !registry.canSign}>Sign on Monad</Button> : <Tag tone={view.onchainTx ? 'accent' : 'neutral'}>{view.onchainTx ? 'On-chain' : 'Off-chain'}</Tag>}
        </div>
        {mustSign && !registry.canSign && <p className="text-[13px] text-warn">Reconnect the wallet you signed in with to publish the policy.</p>}
      </div>

      {busy && <p className="mt-4 text-[13px] text-fg-2" role="status">{busy}</p>}
      {err && <p role="alert" className="mt-4 text-[13px] text-ask-fg">{err}</p>}
      {realFunds && (
        <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-sm border border-ask/60 bg-ask/8 p-3.5 text-[13px]">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 flex-none accent-[var(--ask)]" />
          <span>
            <strong>This trades real funds on {networkName}.</strong> Monday will place live orders in your Perpl account up to the limits above. Market making can lose money, the software is new, and past or simulated results promise nothing. I accept that risk.
          </span>
        </label>
      )}
      <Button size="lg" className="mt-8" onClick={start} disabled={busy !== null || mustSign || (realFunds && !accepted)}>Start Monday</Button>
      <p className="mt-3 text-[13px] text-fg-3">The first quotes reach the book within seconds. You can pause or kill from the dashboard at any time.</p>
    </div>
  );
}
