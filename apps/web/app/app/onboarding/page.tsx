'use client';

import { CheckIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ComponentProps } from 'react';
import { policySummary, safeReturnPath, usd } from '@monday/core';
import { PolicyForm, draftForBalance, draftFrom, draftOk, toBody, type Caps, type PolicyDraft } from '@/components/policy-form';
import { Button, Notice, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtUsd, shortAddr, shortHash } from '@/lib/format';
import { useAgentAuthorized, useAppConfig, useMe, useRegistry, type PolicyView } from '@/lib/wallet';
import { AccountStep, KeyStep, type PerplAccount as Account } from '@/components/perpl-connect';


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
  const reduce = useReducedMotion();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['policy'] })]);

  return (
    <div className="page-in mx-auto grid max-w-[66rem] gap-10 py-10 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-16 md:py-16">
      <nav aria-label="Setup steps">
        {/* How far through setup: fills as each step is done. */}
        <div className="mb-5 hidden md:block">
          <div className="flex items-baseline justify-between text-[12px] text-fg-3"><span>Setup</span><span className="num">{current + 1} of {STEPS.length}</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised-2">
            <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${((current + 1) / STEPS.length) * 100}%` }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }} />
          </div>
        </div>
        <ol className="flex gap-1 overflow-x-auto md:block md:space-y-1">
          {STEPS.map((label, i) => {
            const done = i < current || (i === 0);
            const active = i === current;
            return (
              <li key={label} className="shrink-0">
                <button
                  type="button" disabled={i === 0 || i > reachable} onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                  className={cx('flex w-full items-center gap-3 rounded-sm px-2.5 py-2.5 text-left text-[14px] transition-colors disabled:cursor-default', active ? 'bg-raised font-semibold' : 'text-fg-2', i <= reachable && i > 0 && !active && 'hover:bg-raised')}
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

      {/* Each step slides in when it opens: keyed by step, so moving between steps reads as moving forward. */}
      <motion.div key={current} className="max-w-[46rem]" initial={reduce ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
        {current === 1 && <AccountStep wallet={me.demo ? null : me.wallet} account={account.data} loading={account.isLoading} error={account.error} retry={() => void account.refetch()} next={() => setStep(2)} />}
        {current === 2 && <KeyStep sim={Boolean(cfg?.sim || cfg?.paper)} paper={Boolean(cfg?.paper)} perplUrl={cfg?.perplAppUrl ?? ''} hasKey={me.hasKey} revoked={me.keyStatus === 'revoked'} next={async () => { await Promise.all([refresh(), account.refetch()]); setLinked(true); setStep(3); }} />}
        {current === 3 && (
          <LimitsStep
            initial={policy.data?.pending?.policy ?? policy.data?.policy ? draftFrom(policy.data?.pending?.policy ?? policy.data?.policy) : draftForBalance(account.data?.makerAvailableUsd ?? account.data?.balanceUsd ?? 0, cfg?.caps ?? null)}
            balance={account.data?.makerAvailableUsd ?? account.data?.balanceUsd ?? 0} linked={linked}
            available={cfg ? (Object.keys(cfg.specs) as PolicyDraft['markets']) : ['BTC']} caps={cfg?.caps ?? null} specs={cfg?.specs ?? {}}
            next={async () => { await refresh(); setStep(4); }}
          />
        )}
        {current === 4 && <ReviewStep view={policy.data} demo={me.demo} explorerUrl={cfg?.explorerUrl ?? ''} registryAt={cfg?.registry ?? null} agent={cfg?.agentAddress ?? null} refresh={refresh} />}
      </motion.div>
    </div>
  );
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="display text-3xl font-medium md:text-[2.5rem]">{title}</h1>
      <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-fg-2">{children}</p>
    </>
  );
}

function LimitsStep({ initial, balance, linked, available, caps, specs, next }: { initial: PolicyDraft; balance: number; linked: boolean; available: PolicyDraft['markets']; caps: Caps | null; specs: ComponentProps<typeof PolicyForm>['specs']; next: () => Promise<void> }) {
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
      <Heading title="Set your limits">Pick a margin and a leverage, and Monday sizes the rest. The agent and the LLM are both held to these limits. Your Perpl balance is <span className="num">{fmtUsd(balance)}</span>.</Heading>
      <div className="mt-8">
        <PolicyForm value={draft} onChange={setDraft} available={available} caps={caps} balance={balance} specs={specs}>
          {err && <p role="alert" className="text-[12px] text-ask-fg">{err}</p>}
          <Button size="lg" className="w-full" onClick={save} disabled={busy || !draftOk(draft, balance, caps, specs ?? {})}>{busy ? 'Checking limits' : 'Continue'}</Button>
        </PolicyForm>
      </div>
    </div>
  );
}

function ReviewStep({ view, demo, explorerUrl, registryAt, agent, refresh }: { view?: PolicyView; demo: boolean; explorerUrl: string; registryAt: string | null; agent: string | null; refresh: () => Promise<unknown> }) {
  const router = useRouter();
  const registry = useRegistry();
  // Step two on Monad, checked on its own: a declined authorisation must be retryable without publishing again.
  const authorized = useAgentAuthorized(demo ? null : (registryAt as `0x${string}` | null), agent as `0x${string}` | null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!view) return <Skeleton className="h-64" />;
  const p = view.pending?.policy ?? view.policy;
  if (!p) return <Notice tone="warn">No policy saved yet. Go back one step.</Notice>;
  const mustSign = Boolean(view.pending);

  const authorize = async () => {
    setErr(null);
    try {
      await registry.authorize(registryAt as `0x${string}`, agent as `0x${string}`, setBusy);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed.';
      setErr(/rejected|denied/i.test(msg) ? 'You declined the authorisation. The policy stays in force; decisions are not logged on Monad until you authorise.' : msg);
    } finally {
      setBusy(null);
    }
  };
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
      router.push(safeReturnPath(new URLSearchParams(location.search).get('next')) ?? '/app'); // back where sign-in began
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
          ['Markets', p.markets.join(', ')], ['Quote per side', usd(p.quoteSizeUsd)], ['Position limit per market', usd(p.maxInventoryUsd)],
          ['Base spread', `${p.minHalfSpreadBps} bps`], ['Stop loss', usd(p.maxDailyLossUsd)], ['Leverage', `${p.maxLeverage}x`],
        ].map(([k, v]) => (
          <div key={k} className="border-b border-line py-3"><dt className="text-[12px] text-fg-3">{k}</dt><dd className="num mt-0.5 font-semibold">{v}</dd></div>
        ))}
      </dl>

      <div className="mt-8 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Publish the policy on Monad</p>
            <p className="mt-0.5 text-[13px] text-fg-3">
              {mustSign ? 'Two steps in your wallet: publish these limits to MondayRegistry, then, the first time only, authorise Monday\'s agent to log its decisions. The contract holds no funds.'
                : view.onchainTx ? <>Published. <a className="num underline underline-offset-2" href={`${explorerUrl}/tx/${view.onchainTx}`} target="_blank" rel="noreferrer">{shortHash(view.onchainTx)}</a></>
                : demo ? 'Skipped for demo accounts, which have no wallet to sign with. The policy is enforced off-chain.'
                : 'MondayRegistry is not configured on this server yet, so the policy is enforced off-chain only.'}
            </p>
          </div>
          {mustSign && !registry.canSign ? <Button variant="ghost" onClick={registry.reconnect}>Reconnect wallet</Button>
            : mustSign ? <Button variant="ghost" onClick={sign} disabled={busy !== null}>Sign on Monad</Button>
            : <Tag tone={view.onchainTx ? 'accent' : 'neutral'}>{view.onchainTx ? 'On-chain' : 'Off-chain'}</Tag>}
        </div>
        {mustSign && !registry.canSign && <p className="text-[13px] text-warn">The wallet connection was lost. Reconnect the wallet you signed in with to publish the policy.</p>}
        {!mustSign && authorized === false && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Authorise the agent</p>
              <p className="mt-0.5 text-[13px] text-fg-3">The policy is published. One more signature lets Monday&apos;s agent log its decisions in MondayRegistry; until then they are kept off-chain.</p>
            </div>
            {registry.canSign ? <Button variant="ghost" onClick={authorize} disabled={busy !== null}>Authorise agent</Button> : <Button variant="ghost" onClick={registry.reconnect}>Reconnect wallet</Button>}
          </div>
        )}
      </div>

      {busy && <p className="mt-4 text-[13px] text-fg-2" role="status">{busy}</p>}
      {err && <p role="alert" className="mt-4 text-[13px] text-ask-fg">{err}</p>}
      <Button size="lg" className="mt-8" onClick={start} disabled={busy !== null || mustSign}>Start Monday</Button>
      <p className="mt-3 text-[13px] text-fg-3">The first quotes reach the book within seconds. You can stop or kill from the dashboard at any time.</p>
    </div>
  );
}
