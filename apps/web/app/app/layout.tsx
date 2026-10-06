'use client';

import { SignOutIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, Notice, Skeleton, Tag, Wordmark, cx } from '@/components/ui';
import { shortAddr } from '@/lib/format';
import { Providers, chain, useAppConfig, useMe, useSession } from '@/lib/wallet';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}

const NAV = [
  { href: '/app', label: 'Terminal' },
  { href: '/app/analytics', label: 'Analytics' },
  { href: '/app/policy', label: 'Policy' },
  { href: '/evidence', label: 'Evidence' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const cfg = useAppConfig();
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const onboarded = Boolean(me.data?.hasKey && me.data.policy);
  const mustOnboard = me.data && !onboarded && pathname !== '/app/onboarding';
  const terminal = pathname === '/app' && onboarded;

  useEffect(() => {
    if (mustOnboard) router.replace('/app/onboarding');
  }, [mustOnboard, router]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex h-11 flex-none items-stretch gap-2 border-b border-line bg-canvas px-3 sm:gap-4">
        <div className="flex items-center"><Wordmark size={18} compact={onboarded} /></div>
        {onboarded && (
          <nav className="flex items-stretch" aria-label="App">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={pathname === n.href ? 'page' : undefined} className={cx('flex items-center px-2.5 text-[12.5px] sm:px-3', pathname === n.href ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                {n.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* Always say what kind of money is on the line. Real funds is never hidden, even on a phone. */}
          {cfg.data?.realFunds ? <Tag tone="ask">Mainnet: real funds</Tag>
            : cfg.data && <span className="hidden sm:block"><Tag tone={cfg.data.sim || cfg.data.paper ? 'warn' : 'neutral'}>{cfg.data.sim ? 'Simulated market' : cfg.data.paper ? 'Paper trading' : cfg.data.networkName}</Tag></span>}
          {me.data && <span className={cx('hidden text-[12px] text-fg-2 sm:inline', !me.data.demo && 'num')}>{me.data.demo ? 'Demo account' : shortAddr(me.data.wallet)}</span>}
          <ThemeToggle />
          {me.data && (
            <button type="button" onClick={() => void session.signOut()} aria-label="Sign out" className="grid size-7 place-items-center rounded-sm text-fg-2 hover:bg-raised hover:text-fg">
              <SignOutIcon size={15} />
            </button>
          )}
        </div>
      </header>
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
  const [busy, setBusy] = useState<'wallet' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasWallet, setHasWallet] = useState(true);
  useEffect(() => setHasWallet(session.hasWallet), [session.hasWallet]);

  const run = (kind: 'wallet' | 'demo') => async () => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'wallet' ? session.signIn() : session.demo());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setError(/rejected|denied/i.test(msg) ? 'You declined the request in your wallet.' : msg.split('\n')[0]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-10 py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] md:py-24">
      <div>
        <h1 className="display text-4xl md:text-5xl">Connect your wallet</h1>
        <p className="mt-4 max-w-[52ch] text-[15px] text-fg-2">
          Monday signs you in with a message from your wallet on {chain.name}. It costs no gas and moves no funds. Your wallet key never leaves your browser.
          {realFunds && ' This server trades real funds.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Button size="lg" onClick={run('wallet')} disabled={busy !== null || !hasWallet}>{busy === 'wallet' ? 'Check your wallet' : 'Connect wallet'}</Button>
          {sim && <Button size="lg" variant="ghost" onClick={run('demo')} disabled={busy !== null}>{busy === 'demo' ? 'Opening' : 'Use a demo account'}</Button>}
        </div>
        {!hasWallet && <p className="mt-3 text-[12.5px] text-fg-3">No browser wallet detected. Install one that supports Monad{sim ? ', or use a demo account' : ''}.</p>}
        {error && <p role="alert" className="mt-3 text-[12.5px] text-ask-fg">{error}</p>}
      </div>
      <dl className="panel divide-y divide-line self-start text-[13px]">
        {[
          ['Funds stay put', 'Your collateral stays in your own Perpl account. Monday never holds it.'],
          ['Trade-only key', 'The key you give Monday can place and cancel orders. Perpl never lets an API key withdraw.'],
          ['One click to stop', 'Pause cancels every order. Kill also closes positions. Revoking the key on Perpl cuts access at once.'],
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
