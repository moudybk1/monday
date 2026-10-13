'use client';

import { XIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { FLOW_GROUPS, type FlowGroup, type PxPositioning, type PxTape, type PxTapeRow } from '@monday/core';
import { EASE, Share } from '@/components/charts';
import { AccountLink, Segments, ago, money, price } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';

// Flow: what a group of Perpl's traders holds and how it moved over the last hour, six hours and day, and every order
// as it lands. Across every account a market's longs equal its shorts, so positioning follows a group; the tape can
// show everyone.

type Tape = FlowGroup | 'all';
type SortKey = 'change1hUsd' | 'change6hUsd' | 'change24hUsd' | 'longUsd' | 'shortUsd' | 'net';
type Market = PxPositioning['markets'][number];

const GROUPS = FLOW_GROUPS.map((g) => [g.id, g.label] as const);
const TAPE_GROUPS = [['all', 'Everyone'], ...GROUPS] as const;
const MINS = [[1_000, '$1k+'], [10_000, '$10k+'], [50_000, '$50k+']] as const;
const SHORT_LABEL: Record<FlowGroup, string> = { top: 'Top', winners: 'Winner', whales: 'Whale' };
const ACTION: Record<PxTapeRow['action'], string> = { open: 'Open', increase: 'Add', decrease: 'Reduce', close: 'Close', invert: 'Flip', liquidation: 'Liquidated', fill: 'Fill' };
const signed = (n: number) => (Math.abs(n) < 0.5 ? '$0' : `${n > 0 ? '+' : '-'}${money(Math.abs(n))}`);
const net = (m: Market) => m.longUsd - m.shortUsd;
/** Whether the order bought: opening or adding to a long, or closing a short. */
const bought = (r: PxTapeRow) => (r.action === 'close' || r.action === 'decrease' || r.action === 'liquidation' ? !r.long : r.long);

export default function FlowPage() {
  return <Suspense fallback={<Skeleton className="mt-1 h-64" />}><Flow /></Suspense>;
}

function Flow() {
  const params = useSearchParams();
  const router = useRouter();
  // The URL is the view, like the screener's: a shared link shows the same group, size and market.
  const pick = <T,>(k: string, options: readonly (readonly [T, string])[], d: T): T => options.find(([v]) => String(v) === params.get(k))?.[0] ?? d;
  const group = pick<FlowGroup>('group', GROUPS, 'top');
  const tapeGroup = pick<Tape>('tape', TAPE_GROUPS, 'all');
  const min = pick<number>('min', MINS, 1_000);
  const sym = params.get('sym')?.toUpperCase() || null;
  const set = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v == null) next.delete(k); else next.set(k, String(v));
    router.replace(`?${next}`, { scroll: false });
  };
  useEffect(() => {
    document.title = 'Flow - Monday';
  }, []);

  return (
    <div className="grid gap-1 pt-1">
      <Positioning group={group} sym={sym} onGroup={(g) => set({ group: g === 'top' ? null : g })} onSym={(s) => set({ sym: s === sym ? null : s })} />
      <LiveTape group={tapeGroup} min={min} sym={sym} onGroup={(g) => set({ tape: g === 'all' ? null : g })} onMin={(v) => set({ min: v === 1_000 ? null : v })} onClearSym={() => set({ sym: null })} />
    </div>
  );
}

function Positioning({ group, sym, onGroup, onSym }: { group: FlowGroup; sym: string | null; onGroup: (g: FlowGroup) => void; onSym: (s: string) => void }) {
  const q = useQuery({ queryKey: ['stats-positioning', group], queryFn: () => api<PxPositioning>(`/stats/positioning?group=${group}`), refetchInterval: 15_000 });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'net', dir: 'desc' });
  const g = FLOW_GROUPS.find((x) => x.id === group)!;
  const value = (m: Market, k: SortKey) => (k === 'net' ? net(m) : m[k]);
  // Net position sorts by size either way: a big short belongs at the top as much as a big long.
  const rank = (m: Market) => (sort.key === 'net' ? Math.abs(net(m)) : value(m, sort.key));
  const rows = [...(q.data?.markets ?? [])].sort((a, b) => (sort.dir === 'desc' ? rank(b) - rank(a) : rank(a) - rank(b)));
  const scale = (k: SortKey) => Math.max(1, ...rows.map((m) => Math.abs(value(m, k))));
  const cols: [SortKey, string, string][] = [
    ['change1hUsd', '1h net bought', 'Buys minus sells by the group over the last hour, at fill prices'],
    ['change6hUsd', '6h net bought', 'Over the last 6 hours'],
    ['change24hUsd', '24h net bought', 'Over the last 24 hours'],
    ['longUsd', 'Long positions', 'Open longs held by the group now, at mark'],
    ['shortUsd', 'Short positions', 'Open shorts held by the group now, at mark'],
    ['net', 'Net position', 'Longs minus shorts held now'],
  ];
  const head = (k: SortKey) => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <Panel
      title={`What ${g.label.toLowerCase()} are trading on Perpl`}
      aside={q.data ? <span>{q.data.accounts} accounts</span> : undefined}
      className="min-w-0 rise"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2.5 py-1.5">
        <Segments label="Group" value={group} onChange={onGroup} options={GROUPS} />
        <span className="text-[12px] text-fg-3">{g.hint}</span>
      </div>
      {q.isError ? <div className="p-2"><Notice tone="warn">Could not load positioning. {q.error instanceof Error ? q.error.message : ''}</Notice></div> : !q.data ? <Skeleton className="m-2 h-72" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="label h-7 text-left [&>th]:font-normal">
                <th className="pl-2.5">Market</th>
                {cols.map(([k, label, title]) => (
                  <th key={k} className={cx('text-right last:pr-2.5', k.startsWith('change') && 'w-[17%]')} title={title} aria-sort={sort.key === k ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
                    <button type="button" onClick={() => head(k)} className={cx('hover:text-fg', sort.key === k && 'text-fg')}>{label}{sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((m) => {
                const n = net(m);
                return (
                  <tr key={m.sym} onClick={() => onSym(m.sym)} className={cx('h-[30px] cursor-pointer border-t border-line transition-colors hover:bg-raised', sym === m.sym && 'bg-raised')} title={`${m.holders} of the group hold ${m.sym}. Click to show its trades below.`}>
                    <td className="pl-2.5 font-sans font-semibold">{m.sym}</td>
                    {(['change1hUsd', 'change6hUsd', 'change24hUsd'] as const).map((k) => (
                      <td key={k} className="text-right">
                        <span className="flex items-center justify-end gap-2">
                          <span className={cx(m[k] > 0.5 ? 'text-bid-fg' : m[k] < -0.5 ? 'text-ask-fg' : 'text-fg-3')}>{signed(m[k])}</span>
                          <Share value={Math.abs(m[k]) / scale(k)} tone={m[k] >= 0 ? 'bid' : 'ask'} className="w-16" />
                        </span>
                      </td>
                    ))}
                    <td className="text-right">{money(m.longUsd)}</td>
                    <td className="text-right">{money(m.shortUsd)}</td>
                    <td className="pr-2.5 text-right">
                      {Math.abs(n) < 0.5 ? <span className="text-fg-3">flat</span> : <><span className={n > 0 ? 'text-bid-fg' : 'text-ask-fg'}>{n > 0 ? 'LONG' : 'SHORT'}</span> {money(Math.abs(n))}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-2.5 py-1.5 text-[12px] text-fg-3">
            Net bought is the group&apos;s buys minus sells at fill prices, from Perpl&apos;s indexed fills. Positions are live from the Exchange. Across every account a market&apos;s longs equal its shorts, so this follows a group, chosen from the last 30 days of realised results. Click a market to filter the trades below.
          </p>
        </div>
      )}
    </Panel>
  );
}

function LiveTape({ group, min, sym, onGroup, onMin, onClearSym }: { group: Tape; min: number; sym: string | null; onGroup: (g: Tape) => void; onMin: (v: number) => void; onClearSym: () => void }) {
  const q = useQuery({
    queryKey: ['stats-tape', group, min, sym],
    queryFn: () => api<PxTape>(`/stats/tape?group=${group}&min=${min}${sym ? `&sym=${sym}` : ''}`),
    refetchInterval: 3_000,
  });
  const reduce = useReducedMotion();
  // Orders that were not there on the last poll flash in; the first load and a filter change do not.
  const seen = useRef<{ filter: string; keys: Set<string> } | null>(null);
  const filter = `${group}:${min}:${sym}`;
  const key = (r: PxTapeRow) => `${r.block}:${r.account}:${r.sym}:${r.type}:${r.long}`;
  const fresh = new Set<string>();
  if (q.data) {
    if (seen.current?.filter === filter) for (const r of q.data.rows) if (!seen.current.keys.has(key(r))) fresh.add(key(r));
    seen.current = { filter, keys: new Set(q.data.rows.map(key)) };
  }
  const top = Math.max(1, ...(q.data?.rows ?? []).map((r) => r.usd));

  return (
    <Panel
      title="Live trades on Perpl"
      aside={<span>live, every 3 s</span>}
      className="min-w-0 rise"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2.5 py-1.5">
        <Segments label="Traders" value={group} onChange={onGroup} options={TAPE_GROUPS} />
        <Segments label="Size" value={min} onChange={onMin} options={MINS} />
        {sym && <button type="button" onClick={onClearSym} className="num flex items-center gap-1 rounded-sm border border-accent/40 px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/12" aria-label={`Show every market, not only ${sym}`}>{sym}<XIcon size={10} /></button>}
      </div>
      {q.isError ? <div className="p-2"><Notice tone="warn">Could not load trades. {q.error instanceof Error ? q.error.message : ''}</Notice></div> : !q.data ? <Skeleton className="m-2 h-72" /> : !q.data.rows.length ? (
        <p className="px-2.5 py-4 text-[13px] text-fg-3">No {min >= 10_000 ? `${money(min)}+ ` : ''}trades{sym ? ` on ${sym}` : ''}{group !== 'all' ? ` by ${FLOW_GROUPS.find((x) => x.id === group)!.label.toLowerCase()}` : ''} in the last 24 hours. New ones appear here within seconds.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="label h-7 text-left [&>th]:font-normal">
                <th className="pl-2.5">Trader</th><th>Market</th><th>Side</th><th>Action</th><th title="Market: took liquidity. Limit: a resting order filled.">Type</th>
                <th className="text-right">Amount</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="w-24" /><th className="pr-2.5 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="num">
              {q.data.rows.map((r) => (
                <motion.tr
                  key={key(r)} className={cx('h-[28px] border-t border-line', fresh.has(key(r)) && (bought(r) ? 'flash-up' : 'flash-down'))}
                  initial={fresh.has(key(r)) && !reduce ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}
                >
                  <td className="pl-2.5">
                    <span className="flex items-center gap-1.5">
                      <AccountLink account={r.account} address={r.address} />
                      {r.groups.map((g) => <Tag key={g} tone={g === 'whales' ? 'accent' : 'bid'}>{SHORT_LABEL[g]}</Tag>)}
                    </span>
                  </td>
                  <td className="font-sans font-semibold">{r.sym}</td>
                  <td className={r.long ? 'text-bid-fg' : 'text-ask-fg'}>{r.long ? 'LONG' : 'SHORT'}</td>
                  <td className={cx('font-sans', r.action === 'liquidation' ? 'text-ask-fg' : 'text-fg-2')}>{ACTION[r.action]}</td>
                  <td className="text-fg-3">{r.type === 'market' ? 'MARKET' : r.type === 'limit' ? 'LIMIT' : 'EXCHANGE'}</td>
                  <td className="text-right">{price(r.size)}</td>
                  <td className="text-right text-fg-2">{price(r.price)}</td>
                  <td className="text-right">{money(r.usd, r.usd < 10_000)}</td>
                  <td className="pl-3"><Share value={r.usd / top} tone="accent" /></td>
                  <td className="pr-2.5 text-right text-fg-3">{ago(r.ts)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-2.5 py-1.5 text-[12px] text-fg-3">
            One line per order: an account&apos;s fills on one market and side in one block. Side is the position&apos;s side; Flip closes one side and opens the other. Exchange means a liquidation. Indexed from Perpl&apos;s Exchange contract, seconds behind the chain; the newest 100 shown.
          </p>
        </div>
      )}
    </Panel>
  );
}
