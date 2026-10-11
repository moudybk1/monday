'use client';

import { CircleNotchIcon, MagnifyingGlassIcon, SparkleIcon } from '@phosphor-icons/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AskAnswer, AskIntent, PxOverview, PxTrader } from '@monday/core';
import { AppHeader } from '@/components/app-header';
import { Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { at } from '@/lib/hosts';

// Analytics, one place: Perpl's protocol and any wallet on it (public, no sign-in, so anyone can open a link),
// side-by-side wallets, and the signed-in user's own Monday fills. The header matches the app's.

const TABS = [
  { href: '/analytics', label: 'Perpl', on: (p: string) => p === '/analytics' || p.startsWith('/analytics/wallet') },
  { href: '/analytics/screener', label: 'Screener', on: (p: string) => p.startsWith('/analytics/screener') },
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
      <span className="hidden sm:inline" title="The network the public Perpl pages read. Your own results on My Monday name their own account and funds."><Tag tone="bid">Monad {ov.data?.network ?? 'mainnet'}</Tag></span>
    </AppHeader>
  );
}

function SubNav() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <div className="panel mt-1 flex-row flex-wrap items-stretch justify-between overflow-visible">
      <div role="tablist" aria-label="Analytics" className="flex h-9">
        {TABS.map((t) => (
          <Link key={t.href} href={at(t.href)} role="tab" aria-selected={t.on(pathname)} className={cx('relative flex items-center px-3 text-[12.5px] transition-colors duration-150', t.on(pathname) ? 'font-semibold text-fg' : 'text-fg-3 hover:text-fg')}>
            {t.label}
            {t.on(pathname) && <motion.span layoutId="analytics-tab" aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }} />}
          </Link>
        ))}
      </div>
      <AskBar />
    </div>
  );
}

const EXAMPLES = ['whales liquidated this month', 'consistent winners 30D', 'BTC funding', 'compare the top 3 winners this week', 'market makers with volume over $1M'];
const label = (i: AskIntent) => {
  const days = (d?: number) => (d === 1 ? 'today' : d ? `${d}D` : '');
  switch (i.kind) {
    case 'wallet': return `Opening wallet ${i.q.startsWith('0x') ? `${i.q.slice(0, 6)}…${i.q.slice(-4)}` : `#${i.q}`}`;
    case 'market': return `Focusing ${i.sym}`;
    case 'metric': return `Showing ${i.metric === 'oi' ? 'open interest' : i.metric === 'liqs' ? 'liquidations' : i.metric === 'skew' ? 'long / short' : i.metric}${i.sym ? ` on ${i.sym}` : ''}`;
    case 'screen': return `Screener: ${i.presets?.join(' + ') ?? 'everyone'}${i.days ? `, ${days(i.days)}` : ''}${i.minVolume ? `, volume $${i.minVolume.toLocaleString('en-US')}+` : ''}${i.minCloses ? `, ${i.minCloses}+ closes` : ''}`;
    case 'compare': return `Comparing ${i.wallets.length} wallets`;
    case 'top': return `Comparing the top ${i.n} by ${i.sort === 'net' ? 'PnL' : i.sort === 'loss' ? 'loss' : 'volume'}, ${days(i.days)}`;
    case 'tab': return `Opening ${i.tab === 'perpl' ? 'Perpl' : i.tab === 'monday' ? 'My Monday' : i.tab}`;
    default: return i.reason;
  }
};

/**
 * Ask Monday: an address, a market or a sentence. The server turns it into one action from a fixed menu (common shapes
 * without a model, sentences with one), and the page moves there with real data. Cmd/Ctrl+K focuses it.
 */
function AskBar() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false); // the model is taking its time: say so instead of looking stuck
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn'; dropped?: string } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); ref.current?.select(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 6_000);
    return () => clearTimeout(t);
  }, [busy]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), note.tone === 'ok' && !note.dropped ? 3_000 : 8_000);
    return () => clearTimeout(t);
  }, [note]);

  const act = async (i: AskIntent) => {
    const go = (path: string) => router.push(at(path)); // from My Monday on the app's host, the public pages are on theirs
    const qs = (o: Record<string, string | number | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
    switch (i.kind) {
      case 'wallet': return go(`/analytics/wallet/${i.q}`);
      case 'market': return go(`/analytics${qs({ market: i.sym })}`);
      case 'metric': return go(`/analytics${qs({ metric: i.metric, market: i.sym, range: i.range })}`);
      case 'screen': return go(`/analytics/screener${qs({ preset: i.presets?.join(','), days: i.days, minVolume: i.minVolume, minCloses: i.minCloses, sort: i.sort, dir: i.dir })}`);
      case 'compare': return go(`/analytics/compare?w=${i.wallets.join(',')}`);
      case 'top': {
        const rows = await api<PxTrader[]>(`/stats/traders?days=${i.days}&sort=${i.sort}`);
        if (!rows.length) return setNote({ text: 'No traders in that window yet.', tone: 'warn' });
        return go(`/analytics/compare?w=${rows.slice(0, i.n).map((t) => t.address || t.account).join(',')}`);
      }
      case 'tab': return go(i.tab === 'perpl' ? '/analytics' : `/analytics/${i.tab}`);
      default: return setNote({ text: i.reason, tone: 'warn' });
    }
  };
  const submit = async (text: string) => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const r = await api<AskAnswer>('/stats/ask', { method: 'POST', body: { q: v } });
      if (r.intent.kind !== 'unknown') { setNote({ text: label(r.intent), tone: 'ok', dropped: r.dropped }); setQ(''); }
      await act(r.intent);
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'Could not ask right now.', tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(q); }} role="search" className="relative flex flex-1 items-center justify-end px-2 py-1 sm:flex-none">
      <label className={cx('flex h-7 w-full items-center gap-2 rounded-sm border bg-raised px-2 transition-colors sm:w-[26rem]', busy ? 'border-accent/60' : 'border-line-2 focus-within:border-accent')}>
        {busy ? <CircleNotchIcon size={13} className="flex-none animate-spin text-accent" /> : <MagnifyingGlassIcon size={13} className="flex-none text-fg-3" />}
        <span className="sr-only">Ask Monday: an address, a market, or a question about wallets</span>
        <input
          ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={busy ? (slow ? 'Still thinking, the model can take up to a minute…' : 'Thinking…') : 'Ask Monday: an address, a market, or "whales liquidated this month"'} spellCheck={false} disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-3 focus:outline-none disabled:opacity-70"
        />
        <kbd className="num hidden flex-none rounded-[3px] border border-line-2 px-1 text-[10px] text-fg-3 sm:inline">⌘K</kbd>
      </label>
      <AnimatePresence>
        {open && !q && !busy && (
          <motion.div key="ex" initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="absolute top-full right-2 left-2 z-20 mt-1 rounded-sm border border-line-2 bg-raised-2 p-2 shadow-[0_8px_24px_rgb(0_0_0/0.35)] sm:left-auto sm:w-[26rem]">
            <p className="mb-1.5 flex items-center gap-1 text-[10.5px] text-fg-3"><SparkleIcon size={11} weight="fill" className="text-accent" /> Try</p>
            <div className="flex flex-wrap gap-1">
              {EXAMPLES.map((x) => <button key={x} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(x); void submit(x); }} className="rounded-sm border border-line-2 px-2 py-0.5 text-[11.5px] text-fg-2 hover:border-accent/45 hover:text-fg">{x}</button>)}
            </div>
          </motion.div>
        )}
        {note && (
          <motion.p key={note.text} role="status" initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className={cx('absolute top-full right-2 left-2 z-20 mt-1 rounded-sm border px-2.5 py-1.5 text-[11.5px] shadow-[0_8px_24px_rgb(0_0_0/0.35)] sm:left-auto sm:w-[26rem]', note.tone === 'ok' ? 'border-accent/45 bg-raised-2 text-fg' : 'border-warn/45 bg-raised-2 text-warn')}>
            {note.text}
            {note.dropped && <span className="mt-0.5 block text-[11px] text-warn">Not applied: {note.dropped}</span>}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}
