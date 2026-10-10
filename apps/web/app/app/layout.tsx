'use client';

import { SignOutIcon } from '@phosphor-icons/react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button, Notice, Skeleton, Tag, cx } from '@/components/ui';
import { shortAddr } from '@/lib/format';
import { safeReturnPath } from '@monday/core';
import { showAccount } from '@/lib/api';
import { Providers, chain, useAppConfig, useMe, useSession } from '@/lib/wallet';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const cfg = useAppConfig();
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const onboarded = Boolean(me.data?.hasKey && me.data.policy);
  // A page that sent the user here to sign in (`?next=`). Reading your own history needs a session, not a running agent,
  // so an analytics page is returned to at once; anything else once setup is done. Read after mount: during a client
  // navigation the new page renders before the address bar changes. Undefined until read, and nothing redirects before.
  const [next, setNext] = useState<string | null | undefined>(undefined);
  useEffect(() => setNext(safeReturnPath(new URLSearchParams(location.search).get('next'))), []);
  const readOnly = next?.startsWith('/analytics') ?? false;
  const mustOnboard = me.data && next !== undefined && !onboarded && !readOnly && pathname !== '/app/onboarding';
  const terminal = pathname === '/app' && onboarded;

  // Every change this tab asks for names the account it shows (see lib/api).
  const wallet = me.data?.wallet ?? null;
  useEffect(() => showAccount(wallet), [wallet]);

  useEffect(() => {
    if (mustOnboard) router.replace(`/app/onboarding${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  }, [mustOnboard, next, router]);
  useEffect(() => {
    if (me.data && next && (readOnly || (onboarded && pathname === '/app'))) router.replace(next);
  }, [me.data, next, readOnly, onboarded, pathname, router]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader nav={onboarded}>
        {/* Always say what kind of money is on the line. Real funds is never hidden, even on a phone. */}
        {cfg.data?.realFunds ? <Tag tone="ask">Mainnet: real funds</Tag>
          : cfg.data && <span><Tag tone={cfg.data.sim || cfg.data.paper ? 'warn' : 'neutral'}>{cfg.data.sim ? 'Simulated market' : cfg.data.paper ? 'Paper trading' : cfg.data.networkName}</Tag></span>}
        {me.data && (
          <span className="flex h-7 items-center rounded-sm border border-line-2">
            <span className={cx('hidden whitespace-nowrap pl-2.5 pr-1 text-[12px] text-fg-2 sm:inline', !me.data.demo && 'num')}>{me.data.demo ? 'Demo account' : shortAddr(me.data.wallet)}</span>
            <button type="button" onClick={() => void session.signOut()} aria-label="Sign out" title="Sign out" className="grid h-full w-7 place-items-center text-fg-2 hover:bg-raised hover:text-fg">
              <SignOutIcon size={14} />
            </button>
          </span>
        )}
      </AppHeader>
      <main className={cx('w-full flex-1', !terminal && 'mx-auto max-w-[1180px] px-4 sm:px-6')}>
        {me.isLoading ? (
          <div className="grid gap-3 p-6">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-64" />
          </div>
        ) : me.isError ? (
          <div className="grid max-w-[46rem] gap-3 py-16" role="status">
            <h1 className="display text-2xl">Connecting to Monday</h1>
            <p className="text-fg-2">The server takes up to a minute to start. This page connects by itself as soon as it is ready.</p>
            <Skeleton className="mt-2 h-1.5 w-56" />
            <p className="mt-4 text-[12.5px] text-fg-3">Still here after a minute? Check that the server is running (<code className="num">npm run dev</code>).</p>
          </div>
        ) : cfg.data && !cfg.data.sim && cfg.data.chainId !== chain.id ? (
          <div className="py-16">
            <Notice tone="warn">
              The web app is built for {chain.name} (chain {chain.id}) but the server runs on {cfg.data.networkName} (chain {cfg.data.chainId}). Set the same NETWORK for both and restart.
            </Notice>
          </div>
        ) : !me.data ? (
          <Connect sim={Boolean(cfg.data?.sim || cfg.data?.paper)} realFunds={Boolean(cfg.data?.realFunds)} />
        ) : mustOnboard ? null : (
          children
        )}
      </main>
    </div>
  );
}

function Connect({ sim, realFunds }: { sim: boolean; realFunds: boolean }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demo = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.demo();
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    // Centred both ways in the space under the 45px header: one compact block, not two columns pushed to the edges.
    <div className="mx-auto grid min-h-[calc(100dvh-2.75rem-1px)] max-w-[60rem] content-center items-center gap-10 py-12 md:grid-cols-2 md:gap-14">
      <div>
        <h1 className="display text-4xl md:text-5xl">Connect your wallet</h1>
        <p className="mt-4 max-w-[52ch] text-[15px] text-fg-2">
          Monday signs you in with a message from your wallet on {chain.name}. It costs no gas and moves no funds. Your wallet key never leaves your browser.
          {realFunds && ' This server trades real funds.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Button size="lg" onClick={session.signIn} disabled={busy}>Connect wallet</Button>
          {sim && <Button size="lg" variant="ghost" onClick={demo} disabled={busy}>{busy ? 'Opening' : 'Use a demo account'}</Button>}
        </div>
        {error && <p role="alert" className="mt-3 text-[12.5px] text-ask-fg">{error}</p>}
      </div>
      <dl className="panel divide-y divide-line text-[13px]">
        {[
          ['Funds stay put', 'Your collateral stays in your own Perpl account. Monday never holds it.'],
          ['Trade-only key', 'The key you give Monday can place and cancel orders. Perpl never lets an API key withdraw.'],
          ['One click to stop', 'Stop cancels Monday\'s orders. Kill cancels every order and closes positions. Revoking the key on Perpl cuts access at once.'],
        ].map(([t, d]) => (
          <div key={t} className="px-4 py-3.5">
            <dt className="font-semibold">{t}</dt>
            <dd className="mt-1 text-fg-2">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
