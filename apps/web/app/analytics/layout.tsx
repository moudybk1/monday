'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PxOverview } from '@monday/core';
import { AppHeader } from '@/components/app-header';
import { AskChat } from '@/components/ask-chat';
import { INPUT, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { at } from '@/lib/hosts';

// Analytics, one place: Perpl's protocol, what groups of its traders are doing, and any wallet on it (public, no
// sign-in, so anyone can open a link), side-by-side wallets, and the signed-in user's own Monday fills. The header
// matches the app's.

const TABS = [
  { href: '/analytics', label: 'Perpl', on: (p: string) => p === '/analytics' || p.startsWith('/analytics/wallet') },
  { href: '/analytics/screener', label: 'Screener', on: (p: string) => p.startsWith('/analytics/screener') },
  { href: '/analytics/flow', label: 'Flow', on: (p: string) => p.startsWith('/analytics/flow') },
  { href: '/analytics/compare', label: 'Compare', on: (p: string) => p.startsWith('/analytics/compare') },
  { href: '/analytics/monday', label: 'My Monday', on: (p: string) => p.startsWith('/analytics/monday') },
];

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <div className="flex min-h-[100dvh] flex-col">
        <Header />
        <main className="page-in mx-auto w-full max-w-[1480px] flex-1 px-1.5 pb-8 sm:px-3">
          <SubNav />
          {children}
        </main>
        <AskChat />
      </div>
    </QueryClientProvider>
  );
}

function Header() {
  // The same cached query the Perpl tab polls: one request feeds both.
  const ov = useQuery({ queryKey: ['stats-overview'], queryFn: () => api<PxOverview>('/stats/overview'), refetchInterval: 15_000 });
  const ix = ov.data?.indexer;
  const off = ix?.source === 'off';
  const live = ix?.live;
  const ago = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86_400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86_400).toFixed(1)} d`);
  // Two freshnesses on one page: Perpl's API answers live; fills, flows and liquidations come from the indexer, which may be behind or off.
  const title = !ix ? undefined
    : off ? `The event indexer is not running (start it with npm run indexer). Fills, flows and liquidations stop${ix.block ? ` at block ${ix.block.toLocaleString('en-US')}` : ''}${ix.lagSec != null ? `, ${ago(ix.lagSec)} ago` : ''}. Prices, open interest and positions are live from Perpl's API.`
    : `Perpl events indexed to block ${Math.min(ix.block, ix.head).toLocaleString('en-US')} of ${ix.head.toLocaleString('en-US')} via ${ix.source === 'hypersync' ? 'Envio HyperSync' : 'Monad RPC'}${ix.lagSec != null ? `, last trade ${ago(ix.lagSec)} ago` : ''}.${ix.backfillDays ? ` ${ix.backfillDays} earlier days are still being indexed, newest first.` : ''}`;
  return (
    <AppHeader>
      <span className="hidden items-center gap-1.5 text-[11px] text-fg-3 md:flex" title={title}>
        <span aria-hidden className={cx('size-1.5 rounded-full', live ? 'live-dot bg-bid' : off ? 'bg-ask' : 'bg-warn')} />
        {!ix ? 'connecting' : off ? (ix.lagSec != null ? `history ${ago(ix.lagSec)} behind, indexer off` : 'indexer off') : !live ? 'catching up' : ix.backfillDays ? `live, ${ix.backfillDays} days backfilling` : 'live'}
      </span>
      <span className="hidden sm:inline" title="The network the public Perpl pages read. Your own results on My Monday name their own account and funds."><Tag tone="bid">Monad {ov.data?.network ?? 'mainnet'}</Tag></span>
    </AppHeader>
  );
}

function SubNav() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <div className="panel mt-1 flex-row flex-wrap items-stretch justify-between overflow-visible">
      <div role="tablist" aria-label="Analytics" className="no-bar flex h-10 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.href} href={at(t.href)} role="tab" aria-selected={t.on(pathname)} className={cx('relative flex flex-none items-center px-3.5 text-[13px] transition-colors duration-150', t.on(pathname) ? 'font-semibold text-fg' : 'text-fg-3 hover:text-fg')}>
            {t.label}
            {t.on(pathname) && <motion.span layoutId="analytics-tab" aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }} />}
          </Link>
        ))}
      </div>
      <WalletSearch />
    </div>
  );
}

const WALLET = /^(0x[0-9a-f]{40}|\d{1,8})$/;

/** Any address or account number, straight to its profile. Ask Monday takes sentences; this takes only a wallet. */
function WalletSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [bad, setBad] = useState(false);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim().toLowerCase().replace(/^#/, '');
    if (!WALLET.test(v)) return setBad(true);
    setQ('');
    router.push(at(`/analytics/wallet/${v}`));
  };
  return (
    <form role="search" onSubmit={go} className="relative flex items-center px-1.5 py-1 max-sm:w-full">
      <label htmlFor="wallet-search" className="sr-only">Find a wallet</label>
      <input
        id="wallet-search" value={q} onChange={(e) => { setQ(e.target.value); setBad(false); }} spellCheck={false} autoComplete="off"
        placeholder="Wallet address or account #" aria-invalid={bad} aria-describedby={bad ? 'wallet-search-error' : undefined}
        className={cx(INPUT, 'num h-7 text-[12px] sm:w-72', bad && 'border-ask focus:border-ask')}
      />
      {bad && (
        <p id="wallet-search-error" role="alert" className="absolute right-1.5 top-full z-20 rounded-sm border border-line-2 bg-raised px-2 py-1 text-[11.5px] text-ask-fg shadow-lg max-sm:left-1.5">
          Enter a full 0x address (42 characters) or a Perpl account number.
        </p>
      )}
    </form>
  );
}

