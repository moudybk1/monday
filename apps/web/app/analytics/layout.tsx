'use client';

import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PxOverview } from '@monday/core';
import { AppHeader } from '@/components/app-header';
import { Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';

// Analytics, one place: Perpl's protocol and any wallet on it (public, no sign-in, so anyone can open a link),
// side-by-side wallets, and the signed-in user's own Monday fills. The header matches the app's.

const TABS = [
  { href: '/analytics', label: 'Perpl', on: (p: string) => p === '/analytics' || p.startsWith('/analytics/wallet') },
  { href: '/analytics/compare', label: 'Compare', on: (p: string) => p.startsWith('/analytics/compare') },
  { href: '/analytics/monday', label: 'My Monday', on: (p: string) => p.startsWith('/analytics/monday') },
];

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <div className="flex min-h-[100dvh] flex-col">
        <Header />
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-1 pb-6 sm:px-2">
          <SubNav />
          {children}
        </main>
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
      <span className="hidden sm:inline" title="The network the public Perpl pages read. Your own results on My Monday name their own account and funds."><Tag tone="neutral">Public: Perpl {ov.data?.network ?? 'mainnet'}</Tag></span>
    </AppHeader>
  );
}

function SubNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v) router.push(`/analytics/wallet/${v}`);
  };
  return (
    <div className="panel mt-1 flex-row flex-wrap items-stretch justify-between">
      <div role="tablist" aria-label="Analytics" className="flex h-9">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} role="tab" aria-selected={t.on(pathname)} className={cx('flex items-center px-3 text-[12.5px]', t.on(pathname) ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
            {t.label}
          </Link>
        ))}
      </div>
      <form onSubmit={go} role="search" className="flex flex-1 items-center justify-end px-2 py-1 sm:flex-none">
        <label className="flex h-7 w-full items-center gap-2 rounded-sm border border-line-2 bg-raised px-2 focus-within:border-accent sm:w-[22rem]">
          <MagnifyingGlassIcon size={13} className="flex-none text-fg-3" />
          <span className="sr-only">Open a wallet: address or account number</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Open a wallet: address or account #" spellCheck={false} className="num min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:font-sans placeholder:text-fg-3 focus:outline-none" />
        </label>
      </form>
    </div>
  );
}
