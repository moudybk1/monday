'use client';

import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { PxWallet } from '@monday/core';
import { LineChart, type Tone } from '@/components/charts';
import { money, profitText, sameWallet, shortAddress, signedMoney, tone, useStatsNetwork, useWatchlist, walletKey } from '@/components/stats-ui';
import { INPUT, Notice, Panel, Skeleton, cx } from '@/components/ui';
import { api } from '@/lib/api';

// Up to four wallets side by side: the same numbers in one table and their realised PnL on one chart.

const MAX = 4;
const TONES: Tone[] = ['accent', 'bid', 'ask', 'fg'];
const label = (q: string) => (q.startsWith('0x') ? shortAddress(q) : `#${q}`);
const hold = (min: number | null) => (min == null ? 'n/a' : min < 60 ? `${min.toFixed(0)}m` : min < 1440 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`);

export default function ComparePage() {
  return <Suspense fallback={<Skeleton className="mt-1 h-64" />}><Compare /></Suspense>;
}

function Compare() {
  const params = useSearchParams();
  const router = useRouter();
  const watch = useWatchlist(useStatsNetwork());
  const ws = (params.get('w') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX);
  const [draft, setDraft] = useState('');
  const set = (next: string[]) => router.replace(`/analytics/compare${next.length ? `?w=${next.join(',')}` : ''}`);
  const qs = useQueries({ queries: ws.map((q) => ({ queryKey: ['stats-wallet', q], queryFn: () => api<PxWallet>(`/stats/wallet/${q}`), refetchInterval: 30_000 })) });
  useEffect(() => {
    document.title = 'Compare wallets - Monday';
  }, []);

  const loaded = ws.map((q, i) => ({ q, w: qs[i]?.data, err: qs[i]?.error, loading: qs[i]?.isLoading }));
  // One wallet is one column, whether it was added as an account number or an address in any letter case.
  const listed = (q: string) => ws.some((x) => x.toLowerCase() === q.toLowerCase()) || loaded.some(({ w }) => w && sameWallet(q, w));
  const add = (raw: string) => {
    const q = raw.trim();
    if (q && ws.length < MAX && !listed(q)) set([...ws, q]);
  };
  const resolved = loaded.map(({ q, w }) => (w ? walletKey(w) : q.toLowerCase()));
  useEffect(() => {
    const keep = ws.filter((_, i) => resolved.indexOf(resolved[i]) === i); // a duplicate shows up once it resolves
    if (keep.length < ws.length) set(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.join()]);
  const rows: [string, (w: PxWallet) => React.ReactNode, ((w: PxWallet) => number | null)?][] = [
    ['Equity', (w) => money(w.equityUsd)],
    ['Open PnL', (w) => signedMoney(w.positions.reduce((s, p) => s + p.upnl, 0)), (w) => w.positions.reduce((s, p) => s + p.upnl, 0)],
    ['Open positions', (w) => w.positions.length ? w.positions.map((p) => `${p.sym} ${p.long ? 'L' : 'S'}`).join(', ') : 'none'],
    ['Realised PnL', (w) => signedMoney(w.performance.netUsd), (w) => w.performance.netUsd],
    ['Fees paid', (w) => money(w.performance.feesUsd, true)],
    ['Volume', (w) => money(w.performance.volumeUsd)],
    ['Fills', (w) => w.performance.trades.toLocaleString('en-US')],
    // Busy wallets are measured over their newest fills only: each column says which period its numbers cover.
    ['Stats cover', (w) => (w.fills.total > w.fills.used ? `newest ${w.fills.used.toLocaleString('en-US')} of ${w.fills.total.toLocaleString('en-US')}` : 'all indexed fills') + (w.fills.since ? `, since ${new Date(w.fills.since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : '')],
    ['Win rate', (w) => (w.performance.winRate == null ? 'n/a' : `${(w.performance.winRate * 100).toFixed(1)}%`)],
    ['Profit factor', (w) => profitText(w.performance)],
    ['Max drawdown', (w) => money(w.performance.maxDrawdownUsd, true)],
    ['Longest streaks', (w) => `${w.performance.longestWin} W / ${w.performance.longestLoss} L`],
    ['Avg hold', (w) => hold(w.performance.avgHoldMin)],
    ['Best market', (w) => (w.performance.byMarket[0] ? `${w.performance.byMarket[0].sym} ${signedMoney(w.performance.byMarket[0].netUsd)}` : 'n/a')],
    ['Worst market', (w) => { const m = w.performance.byMarket.at(-1); return m ? `${m.sym} ${signedMoney(m.netUsd)}` : 'n/a'; }],
  ];

  return (
    <div className="grid gap-1 pt-1">
      <section className="panel flex-row flex-wrap items-center gap-2 px-2.5 py-2">
        {ws.map((q, i) => (
          <span key={q} className="num inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 pl-2 pr-1 text-[12px]">
            <span className="size-2 rounded-[1px]" style={{ background: `var(--${TONES[i]})` }} aria-hidden />
            <Link href={`/analytics/wallet/${q}`} className="hover:text-accent">{label(q)}</Link>
            <button type="button" onClick={() => set(ws.filter((x) => x !== q))} aria-label={`Remove ${label(q)}`} className="grid size-5 place-items-center rounded-sm text-fg-3 hover:bg-raised hover:text-fg"><XIcon size={11} /></button>
          </span>
        ))}
        {ws.length < MAX && (
          <form onSubmit={(e) => { e.preventDefault(); add(draft.trim()); setDraft(''); }} className="flex items-center gap-1">
            <label htmlFor="cmp-add" className="sr-only">Add a wallet to the comparison: address or account number</label>
            <input
              id="cmp-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add to comparison: address or account #" className={cx(INPUT, 'num h-7 w-64 text-[12px]')}
              required pattern="0x[0-9a-fA-F]{40}|[0-9]{1,12}" title="A 0x wallet address (40 hex characters) or a Perpl account number"
            />
            <button type="submit" className="grid size-7 place-items-center rounded-sm border border-line-2 text-fg-2 hover:bg-raised" aria-label="Add"><PlusIcon size={12} /></button>
          </form>
        )}
        {watch.list.filter((q) => !listed(q)).length > 0 && ws.length < MAX && (
          <span className="flex flex-wrap items-center gap-1 text-[11.5px] text-fg-3">
            Watching:
            {watch.list.filter((q) => !listed(q)).map((q) => (
              <button key={q} type="button" onClick={() => add(q)} className="num rounded-sm border border-accent/40 px-1.5 py-0.5 text-accent hover:bg-accent/12">{label(q)}</button>
            ))}
          </span>
        )}
      </section>

      {!ws.length ? (
        <Notice>Add up to four wallets to compare them: type an address or account number in the Add to comparison box above, use the Watch button on any wallet, or pick an account from the leaderboard.</Notice>
      ) : (
        <>
          <Panel title="Side by side">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead>
                  <tr className="h-8 border-b border-line text-left">
                    <th className="label pl-2.5 font-normal" />
                    {loaded.map(({ q }, i) => (
                      <th key={q} className="num px-2.5 text-right font-medium"><span className="mr-1.5 inline-block size-2 rounded-[1px]" style={{ background: `var(--${TONES[i]})` }} />{label(q)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="num">
                  {rows.map(([name, fmt, val]) => (
                    <tr key={name} className="h-[28px] border-t border-line first:border-t-0">
                      <th scope="row" className="pl-2.5 text-left font-sans font-normal text-fg-2">{name}</th>
                      {loaded.map(({ q, w, err, loading }) => (
                        <td key={q} className={cx('px-2.5 text-right', w && val ? tone(val(w)) : '')}>
                          {loading ? <Skeleton className="ml-auto h-3 w-16" /> : err ? <span className="font-sans text-ask-fg">not found</span> : w ? fmt(w) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Realised PnL" aside={<span>cumulative, after fees and funding</span>} bodyClassName="p-2.5" className="h-[320px]">
            <LineChart
              label="Cumulative realised PnL per wallet" format={(v) => money(v, true)} empty="No indexed fills yet"
              timeFormat={(t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}
              series={loaded.filter((x) => x.w).map(({ q, w }) => {
                return { name: label(q), tone: TONES[ws.indexOf(q)], points: w!.performance.curve }; // thinned by the server
              })}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
