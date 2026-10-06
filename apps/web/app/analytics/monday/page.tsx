'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Analytics, Bucket } from '@monday/core';
import { SignedBars } from '@/components/charts';
import { Segments } from '@/components/stats-ui';
import { ButtonLink, Notice, Panel, Skeleton, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { fmtBps, fmtSigned, fmtUsd } from '@/lib/format';

// Tread-style performance view over Monday's own fills: is the spread paying for the adverse selection,
// and under which conditions (market, regime, quoted width, hour of day)?

const RANGES = [7, 30, 90] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HORIZON: Record<string, string> = { '1s': '1 s', '5s': '5 s', '10s': '10 s', '1m': '1 min', '5m': '5 min' };
const tone = (n: number | null) => (n == null ? 'text-fg-3' : n > 0.004 ? 'text-bid-fg' : n < -0.004 ? 'text-ask-fg' : 'text-fg');
const pct = (n: number | null) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);
const compact = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `$${(n / 1e3).toFixed(1)}k` : fmtUsd(n, 0));

export default function MyMondayPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useQuery({ queryKey: ['analytics', days], queryFn: () => api<Analytics>(`/analytics?days=${days}`), refetchInterval: 60_000, retry: false });
  useEffect(() => {
    document.title = 'My Monday - Analytics';
  }, []);
  const signedOut = q.error instanceof ApiError && q.error.status === 401;

  return (
    <div className="grid gap-1 pt-1">
      <div className="panel flex-row flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[12px] text-fg-2">
          <span className="font-semibold text-fg">Your agent&apos;s fills.</span> Net is realised PnL after fees, per dollar traded. Markout is how price moved after a fill: positive means the fill was good for you.
        </p>
        <Segments label="Range" value={days} onChange={setDays} options={RANGES.map((d) => [d, `${d}D`] as const)} />
      </div>
      {q.isLoading ? (
        <div className="grid gap-1"><Skeleton className="h-16" /><Skeleton className="h-64" /><Skeleton className="h-48" /></div>
      ) : signedOut ? (
        <Notice action={<ButtonLink href="/app" size="sm">Open Monday</ButtonLink>}>Sign in to Monday to see how your own agent has traded. Everything on the Perpl and Compare tabs is public.</Notice>
      ) : q.isError || !q.data ? (
        <Notice tone="warn">Could not load your analytics. {q.error instanceof Error ? q.error.message : ''}</Notice>
      ) : q.data.summary.fills === 0 ? (
        <Notice>No fills in the last {days} days. Numbers appear here as takers trade against Monday&apos;s quotes.</Notice>
      ) : (
        <Body a={q.data} />
      )}
    </div>
  );
}

function Body({ a }: { a: Analytics }) {
  const s = a.summary;
  const m1 = a.markouts.find((m) => m.horizon === '1m');
  const cells: [string, string, string, number | null][] = [
    ['Volume', compact(s.volumeUsd), `${s.fills} fills, ${pct(s.makerPct)} maker`, null],
    ['Net PnL', fmtSigned(s.netUsd), `${fmtBps(s.netBps, 2)} bps per dollar traded`, s.netUsd],
    ['Realised', fmtSigned(s.realizedUsd), 'before fees', s.realizedUsd],
    ['Fees', fmtUsd(s.feesUsd), `${s.feeBps.toFixed(2)} bps of volume`, null],
    ['Win rate', pct(s.winRate), `of ${s.closes} position-reducing fills`, null],
    ['Markout 1 min', m1?.bps == null ? 'n/a' : `${fmtBps(m1.bps)} bps`, `over ${m1?.n ?? 0} maker fills`, m1?.bps ?? null],
  ];

  return (
    <div className="grid gap-1">
      <dl className="panel grid grid-cols-2 gap-px bg-line md:grid-cols-3 xl:grid-cols-6">
        {cells.map(([k, v, hint, t]) => (
          <div key={k} className="bg-canvas px-3 py-2.5">
            <dt className="label">{k}</dt>
            <dd className={cx('num mt-1.5 text-[19px] font-medium leading-none tracking-tight', t == null ? 'text-fg' : tone(t))}>{v}</dd>
            <dd className="mt-1.5 text-[11px] text-fg-3">{hint}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-1 lg:grid-cols-2">
        <Panel title="Markout after a maker fill" aside={<span>average, bps</span>} bodyClassName="p-2.5">
          {a.markouts.every((m) => m.bps == null) ? (
            <p className="flex h-[200px] items-center justify-center text-[12px] text-fg-3">Markouts are saved five minutes after each maker fill.</p>
          ) : <SignedBars
            height={200} label="Average markout after a maker fill, by horizon" format={(v) => fmtBps(v)} lowLabel="1 s after" highLabel="5 min after"
            data={a.markouts.filter((m) => m.bps != null).map((m) => ({ key: m.horizon, v: m.bps!, tip: `${HORIZON[m.horizon]} after the fill: ${fmtBps(m.bps!, 2)} bps over ${m.n} fills` }))}
          />}
          <p className="mt-2 text-[11.5px] text-fg-3">Falling below zero means takers knew where price was going. Wider quotes or a faster reflex are the fix.</p>
        </Panel>
        <Panel title="Net PnL per day" aside={<span>UTC</span>} bodyClassName="p-2.5">
          <SignedBars
            height={200} label="Net PnL per day" format={(v) => fmtUsd(v, a.daily.some((d) => Math.abs(d.netUsd) >= 10) ? 0 : 2)} lowLabel={a.daily[0]?.day.slice(5) ?? ''} highLabel={a.daily.at(-1)?.day.slice(5) ?? ''}
            data={a.daily.map((d) => ({ key: d.day, v: d.netUsd, tip: `${d.day}: ${fmtSigned(d.netUsd)} net on ${compact(d.volumeUsd)} traded` }))}
          />
        </Panel>
      </div>

      <div className="grid gap-1 lg:grid-cols-3">
        <Buckets title="By market" rows={a.byMarket} />
        <Buckets title="By regime" rows={a.byRegime} />
        <Buckets title="By quoted half-spread" unit=" bps" rows={a.bySpread} />
      </div>

      <Heatmap cells={a.hourly} />
    </div>
  );
}

function Buckets({ title, rows, unit = '' }: { title: string; rows: Bucket[]; unit?: string }) {
  return (
    <Panel title={title} className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[340px] text-[11.5px]">
          <thead>
            <tr className="label h-6 text-left [&>th]:font-normal">
              <th className="pl-2.5" />
              <th className="text-right">Volume</th><th className="text-right">Net bps</th><th className="text-right">1m mark</th><th className="pr-2.5 text-right">Win</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((r) => (
              <tr key={r.key} className="h-[24px] border-t border-line">
                <td className="pl-2.5 font-sans font-medium">{r.key}{r.key !== 'unknown' && unit}</td>
                <td className="text-right text-fg-2">{compact(r.volumeUsd)}</td>
                <td className={cx('text-right', tone(r.netBps))}>{fmtBps(r.netBps, 2)}</td>
                <td className={cx('text-right', tone(r.markout1mBps))}>{r.markout1mBps == null ? 'n/a' : fmtBps(r.markout1mBps)}</td>
                <td className="pr-2.5 text-right text-fg-2">{pct(r.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Net bps by UTC hour and weekday. Colour is the sign, strength is the size; empty cells had no fills. */
function Heatmap({ cells }: { cells: Analytics['hourly'] }) {
  const max = Math.max(1, ...cells.filter((c) => c.fills).map((c) => Math.abs(c.netBps)));
  return (
    <Panel title="When Monday makes or loses money" aside={<span>net bps by hour, UTC</span>}>
      <div className="overflow-x-auto p-2.5">
        <div className="grid min-w-[640px] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-px text-[10.5px]">
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="num text-center text-fg-3">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
          {DAYS.map((d, dow) => (
            <Row key={d} day={d} cells={cells.filter((c) => c.dow === dow)} max={max} />
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-fg-3">Teal hours made money after fees, vermilion hours lost it, blank hours had no fills. Hover a cell for the numbers.</p>
      </div>
    </Panel>
  );
}

function Row({ day, cells, max }: { day: string; cells: Analytics['hourly']; max: number }) {
  return (
    <>
      <span className="flex items-center text-fg-3">{day}</span>
      {cells.map((c) => {
        const k = Math.round(15 + (Math.min(1, Math.abs(c.netBps) / max)) * 70);
        return (
          <span
            key={c.hour}
            title={c.fills ? `${day} ${String(c.hour).padStart(2, '0')}:00 UTC: ${c.fills} fills, ${fmtBps(c.netBps, 2)} bps net` : `${day} ${String(c.hour).padStart(2, '0')}:00 UTC: no fills`}
            className="h-5 rounded-[2px] bg-raised"
            style={c.fills ? { background: `color-mix(in oklab, var(${c.netBps >= 0 ? '--bid' : '--ask'}) ${k}%, var(--raised))` } : undefined}
          />
        );
      })}
    </>
  );
}
