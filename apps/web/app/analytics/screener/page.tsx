'use client';

import { CaretDownIcon, CaretUpIcon, StarIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { PxScreen, PxScreenRow } from '@monday/core';
import { EASE, Share, Sparkline } from '@/components/charts';
import { AccountLink, Segments, money, signedMoney, tone, useStatsNetwork, useWatchlist } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, cx } from '@/components/ui';
import { api } from '@/lib/api';

// Find wallets. Every account active in the window, with one-click presets for the kinds of trader worth a look,
// filters for size and sample, and every column sortable. Each row opens the wallet; the star keeps it on the watchlist.

type Days = 1 | 7 | 30 | 90;
type Row = PxScreenRow & { winRate: number | null; profitFactor: number | null; makerShare: number; avgTradeUsd: number };
type SortKey = 'netUsd' | 'winRate' | 'profitFactor' | 'volumeUsd' | 'trades' | 'makerShare' | 'activeDays' | 'streak' | 'liquidatedUsd' | 'avgTradeUsd';
type Preset = { id: string; label: string; hint: string; keep: (r: Row) => boolean; sort: SortKey; dir: 'asc' | 'desc' };

const PRESETS: Preset[] = [
  { id: 'all', label: 'Everyone', hint: 'every account with a fill in the window, by net PnL', keep: () => true, sort: 'netUsd', dir: 'desc' },
  { id: 'winners', label: 'Consistent winners', hint: 'at least 30 closes, profit factor 1.5 or better, in the money', keep: (r) => r.closes >= 30 && (r.profitFactor ?? Infinity) >= 1.5 && r.netUsd > 0, sort: 'netUsd', dir: 'desc' },
  { id: 'streaks', label: 'On a streak', hint: 'three or more profitable days in a row', keep: (r) => r.streak >= 3, sort: 'streak', dir: 'desc' },
  { id: 'whales', label: 'Whales', hint: 'the most volume', keep: () => true, sort: 'volumeUsd', dir: 'desc' },
  { id: 'makers', label: 'Market makers', hint: 'at least 70% of volume made, not taken, and $100k traded', keep: (r) => r.makerShare >= 0.7 && r.volumeUsd >= 100_000, sort: 'volumeUsd', dir: 'desc' },
  { id: 'takers', label: 'Takers', hint: 'at most 20% made, at least 10 closes, by net PnL', keep: (r) => r.makerShare <= 0.2 && r.closes >= 10, sort: 'netUsd', dir: 'desc' },
  { id: 'liquidated', label: 'Liquidated', hint: 'closed by the Exchange at least once in the window', keep: (r) => r.liquidations > 0, sort: 'liquidatedUsd', dir: 'desc' },
  { id: 'losers', label: 'Biggest losers', hint: 'in the red, worst first', keep: (r) => r.netUsd < 0, sort: 'netUsd', dir: 'asc' },
];
const VOLUMES = [[0, 'Any volume'], [10_000, '$10k+'], [100_000, '$100k+'], [1_000_000, '$1M+']] as const;
const CLOSES = [[0, 'Any sample'], [10, '10+ closes'], [50, '50+ closes'], [200, '200+ closes']] as const;
const PAGE = 50;
const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: 'netUsd', label: 'Net PnL', title: 'Realised, after fees and funding' },
  { key: 'winRate', label: 'Win', title: 'Closes that made money' },
  { key: 'profitFactor', label: 'PF', title: 'Gross wins over gross losses' },
  { key: 'volumeUsd', label: 'Volume', title: 'Notional traded' },
  { key: 'avgTradeUsd', label: 'Avg fill', title: 'Volume per fill' },
  { key: 'makerShare', label: 'Maker', title: 'Share of volume made, not taken' },
  { key: 'activeDays', label: 'Days', title: 'Days with a fill' },
  { key: 'streak', label: 'Streak', title: 'Profitable or losing days in a row, ending on the last active day' },
  { key: 'liquidatedUsd', label: 'Liqs', title: 'Notional liquidated' },
];
const pct = (v: number | null, d = 0) => (v == null ? 'n/a' : `${(v * 100).toFixed(d)}%`);

export default function ScreenerPage() {
  return <Suspense fallback={<Skeleton className="mt-1 h-64" />}><Screener /></Suspense>;
}

function Screener() {
  const params = useSearchParams();
  const [days, setDays] = useState<Days>(7);
  const [preset, setPreset] = useState('all');
  const [minVolume, setMinVolume] = useState<number>(0);
  const [minCloses, setMinCloses] = useState<number>(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'netUsd', dir: 'desc' });
  const [shown, setShown] = useState(PAGE);
  const q = useQuery({ queryKey: ['stats-screen', days], queryFn: () => api<PxScreen>(`/stats/screen?days=${days}`), refetchInterval: 60_000 });
  useEffect(() => {
    document.title = 'Screener - Monday';
  }, []);
  // The ask bar arrives with its answer in the URL; apply it whenever it changes.
  useEffect(() => {
    const d = Number(params.get('days'));
    if ([1, 7, 30, 90].includes(d)) setDays(d as Days);
    const pr = PRESETS.find((x) => x.id === params.get('preset'));
    if (pr) { setPreset(pr.id); setSort({ key: pr.sort, dir: pr.dir }); }
    const mv = Number(params.get('minVolume'));
    if (mv > 0) setMinVolume([...VOLUMES].reverse().find(([v]) => v <= mv)?.[0] ?? 0);
    const mc = Number(params.get('minCloses'));
    if (mc > 0) setMinCloses([...CLOSES].reverse().find(([v]) => v <= mc)?.[0] ?? 0);
    const sk = params.get('sort') as SortKey | null;
    if (sk && COLS.some((c) => c.key === sk)) setSort({ key: sk, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' });
    setShown(PAGE);
  }, [params]);

  const rows = useMemo<Row[]>(() => (q.data?.rows ?? []).map((r) => ({
    ...r, winRate: r.closes ? r.wins / r.closes : null, profitFactor: r.grossLossUsd > 0 ? r.grossWinUsd / r.grossLossUsd : r.grossWinUsd > 0 ? Infinity : null,
    makerShare: r.volumeUsd ? r.makerVolumeUsd / r.volumeUsd : 0, avgTradeUsd: r.trades ? r.volumeUsd / r.trades : 0,
  })), [q.data]);
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
  const pick = (next: Preset) => {
    setPreset(next.id);
    setSort({ key: next.sort, dir: next.dir });
    setShown(PAGE);
  };
  const visible = useMemo(() => {
    const kept = rows.filter((r) => p.keep(r) && r.volumeUsd >= minVolume && r.closes >= minCloses);
    const v = (r: Row) => {
      const x = r[sort.key];
      return x == null ? (sort.dir === 'desc' ? -Infinity : Infinity) : x;
    };
    return kept.sort((a, b) => (sort.dir === 'desc' ? v(b) - v(a) : v(a) - v(b)));
  }, [rows, p, minVolume, minCloses, sort]);
  const maxAbs = Math.max(1, ...visible.slice(0, shown).map((r) => Math.abs(r.netUsd)));
  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'desc' ? 'asc' : 'desc') : key === 'netUsd' && preset === 'losers' ? 'asc' : 'desc' }));

  return (
    <div className="grid gap-1 pt-1">
      <div className="panel min-w-0 rise flex-row flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[12px] text-fg-2"><span className="font-semibold text-fg">Find a wallet.</span> Pick a kind of trader, narrow by size and sample, sort any column. Every row opens the wallet.</p>
        <Segments label="Window" value={days} onChange={(d) => { setDays(d); setShown(PAGE); }} options={[[1, 'Today'], [7, '7D'], [30, '30D'], [90, '90D']] as const} />
      </div>

      <div className="panel min-w-0 rise flex-row flex-wrap items-center gap-1.5 px-2.5 py-2" style={{ '--i': 1 } as React.CSSProperties} role="toolbar" aria-label="Presets and filters">
        {PRESETS.map((x) => (
          <button key={x.id} type="button" onClick={() => pick(x)} aria-pressed={x.id === preset} title={x.hint} className={cx('h-7 rounded-sm border px-2.5 text-[12px] transition-colors duration-150', x.id === preset ? 'border-accent/45 bg-accent/12 text-accent' : 'border-line-2 text-fg-2 hover:bg-raised hover:text-fg')}>
            {x.label}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line-2 sm:inline-block" aria-hidden />
        <select value={minVolume} onChange={(e) => { setMinVolume(Number(e.target.value)); setShown(PAGE); }} aria-label="Minimum volume" className="h-7 rounded-sm border border-line-2 bg-raised px-1.5 text-[12px] text-fg">
          {VOLUMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={minCloses} onChange={(e) => { setMinCloses(Number(e.target.value)); setShown(PAGE); }} aria-label="Minimum closes" className="h-7 rounded-sm border border-line-2 bg-raised px-1.5 text-[12px] text-fg">
          {CLOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="num ml-auto text-[11.5px] text-fg-3">{q.data ? `${visible.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} accounts` : ''}</span>
      </div>

      <Panel title={p.label} aside={<span className="hidden md:inline">{p.hint}</span>} className="min-w-0 rise" >
        {q.isLoading ? <Skeleton className="m-2 h-64" /> : q.isError ? <div className="p-2"><Notice tone="warn">Could not load the screener. {q.error instanceof Error ? q.error.message : ''}</Notice></div> : !visible.length ? (
          <p className="px-2.5 py-4 text-[12px] text-fg-3">No account matches. Widen the window or loosen the filters.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table rows={visible.slice(0, shown)} sort={sort} onSort={toggle} maxAbs={maxAbs} resetKey={`${preset}${days}${sort.key}${sort.dir}${minVolume}${minCloses}`} />
            </div>
            {visible.length > shown && (
              <div className="border-t border-line p-2 text-center">
                <button type="button" onClick={() => setShown(shown + PAGE)} className="h-7 rounded-sm border border-line-2 px-3 text-[12px] text-fg-2 hover:bg-raised hover:text-fg">Show {Math.min(PAGE, visible.length - shown)} more</button>
              </div>
            )}
          </>
        )}
      </Panel>
      <p className="px-1 text-[11px] text-fg-3">Results over whole UTC days with today included. A close is a fill that reduced a position; a win is a close that made money after fees. Realised PnL only: open positions do not count.</p>
    </div>
  );
}

function Table({ rows, sort, onSort, maxAbs, resetKey }: { rows: Row[]; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; maxAbs: number; resetKey: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const watch = useWatchlist(useStatsNetwork());
  const open = (r: Row) => router.push(`/analytics/wallet/${r.address || r.account}`);
  return (
    <table className="w-full min-w-[1040px] text-[11.5px]">
      <thead>
        <tr className="label h-7 text-left [&>th]:font-normal">
          <th className="w-8 pl-2.5">#</th>
          <th>Account</th>
          <th className="w-24" />
          {COLS.map((c) => (
            <th key={c.key} className="text-right" aria-sort={sort.key === c.key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
              <button type="button" onClick={() => onSort(c.key)} title={c.title} className={cx('label inline-flex h-7 items-center gap-0.5 hover:text-fg', sort.key === c.key && 'text-fg')}>
                {c.label}{sort.key === c.key && (sort.dir === 'desc' ? <CaretDownIcon size={9} weight="bold" /> : <CaretUpIcon size={9} weight="bold" />)}
              </button>
            </th>
          ))}
          <th className="pr-2.5 pl-3 text-left">14 days</th>
        </tr>
      </thead>
      <tbody key={resetKey} className="num">
        {rows.map((r, i) => {
          const on = watch.has({ account: r.account, address: r.address ?? '' });
          // Two weeks of net PnL, cumulative so the shape reads at a glance.
          let cum = 0;
          const curve = r.daily.map((v) => (cum += v ?? 0));
          return (
            <motion.tr
              key={r.account} onClick={() => open(r)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(r); }}
              className="h-[32px] cursor-pointer border-t border-line transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: Math.min(i * 0.015, 0.4) }}
            >
              <td className="pl-2.5 text-fg-3">{i + 1}</td>
              <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex items-center gap-1.5">
                  <button type="button" onClick={() => watch.toggle({ account: r.account, address: r.address ?? '' })} aria-pressed={on} aria-label={on ? 'Stop watching' : 'Watch'} className={cx('grid size-5 place-items-center rounded-sm hover:bg-raised-2', on ? 'text-accent' : 'text-fg-3 hover:text-fg')}>
                    <StarIcon size={12} weight={on ? 'fill' : 'regular'} />
                  </button>
                  <AccountLink account={r.account} address={r.address} />
                </span>
              </td>
              <td className="px-2"><Share value={Math.abs(r.netUsd) / maxAbs} tone={r.netUsd >= 0 ? 'bid' : 'ask'} /></td>
              <td className={cx('text-right', tone(r.netUsd))}>{signedMoney(r.netUsd)}</td>
              <td className="text-right text-fg-2">{pct(r.winRate)}</td>
              <td className={cx('text-right', r.profitFactor == null ? 'text-fg-3' : r.profitFactor >= 1 ? 'text-fg' : 'text-fg-2')}>{r.profitFactor == null ? 'n/a' : r.profitFactor === Infinity ? 'no losses' : r.profitFactor.toFixed(2)}</td>
              <td className="text-right">{money(r.volumeUsd)}</td>
              <td className="text-right text-fg-2">{money(r.avgTradeUsd)}</td>
              <td className="text-right text-fg-2">{pct(r.makerShare)}</td>
              <td className="text-right text-fg-2">{r.activeDays}</td>
              <td className="text-right"><Streak n={r.streak} /></td>
              <td className={cx('text-right', r.liquidations ? 'text-ask-fg' : 'text-fg-3')}>{r.liquidations ? `${r.liquidations}x ${money(r.liquidatedUsd)}` : ''}</td>
              <td className="pr-2.5 pl-3"><div className="h-5 w-24"><Sparkline values={curve} tone={cum >= 0 ? 'bid' : 'ask'} fill={false} /></div></td>
            </motion.tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Days in a row with the same sign, as a chip: teal for profitable days, vermilion for losing ones. */
function Streak({ n }: { n: number }) {
  if (!n) return <span className="text-fg-3">0</span>;
  return <span className={cx('inline-block rounded-[2px] px-1 text-[10.5px] font-medium', n > 0 ? 'bg-bid/15 text-bid-fg' : 'bg-ask/15 text-ask-fg')}>{n > 0 ? '+' : ''}{n}d</span>;
}
