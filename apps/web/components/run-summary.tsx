'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Analytics, DashboardState, KillReason } from '@monday/core';
import { tone } from '@/components/agent';
import { Button, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtSigned, fmtTime, fmtUsd } from '@/lib/format';

const SEEN = 'monday.run.seen';
/** A run that ended longer ago than this (a reload hours later) does not pop up. */
const FRESH_MS = 30 * 60_000;
/** Take profit ends the run before its flatten lands: count fills this long after the end too. */
const GRACE_MS = 60_000;

const KILL: Record<KillReason, string> = {
  manual: 'Killed by you',
  loss_limit: 'Daily loss limit reached',
  stale_data: 'Killed: market data stopped',
  order_failures: 'Killed: orders kept failing',
  key_error: 'Killed: Perpl rejected the API key',
  session_loss: 'Session stop loss reached',
  margin: 'Killed: margin too low',
};
const whyText = (why: string) =>
  why === 'pause' ? 'Stopped by you' : why === 'take_profit' ? 'Take profit reached' : why.startsWith('kill:') ? KILL[why.slice(5) as KillReason] ?? 'Killed' : why;

function duration(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 1 ? `${Math.round(ms / 1000)}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The result of a run, shown once when it ends: by Stop, Kill (any reason) or take profit. */
export function RunSummary({ state }: { state: DashboardState }) {
  const run = state.lastRun;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!run || Date.now() - run.endedAt > FRESH_MS) return;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(SEEN)) || 0;
    } catch {}
    if (run.endedAt <= seen) return;
    try {
      localStorage.setItem(SEEN, String(run.endedAt));
    } catch {}
    setOpen(true);
    dialog.current?.showModal();
  }, [run?.endedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetched once the kill's flatten has landed, so its closing fills count.
  const settled = state.closing === null;
  const q = useQuery({
    queryKey: ['run-summary', run?.endedAt, settled],
    queryFn: () => api<Analytics>(`/analytics?from=${run!.startedAt}&to=${Math.min(Date.now(), run!.endedAt + GRACE_MS)}`),
    enabled: open && !!run,
    retry: false,
  });

  const a = q.data?.summary;
  const rows: [string, string, string?][] = a
    ? [
        ['Fills', String(a.fills)],
        ['Volume', fmtUsd(a.volumeUsd)],
        ['Realized', fmtSigned(a.realizedUsd), tone(a.realizedUsd)],
        ['Fees', fmtSigned(-a.feesUsd), tone(-a.feesUsd)],
        ['Net (fills)', fmtSigned(a.netUsd), tone(a.netUsd)],
        ['Net per $ traded', a.fills ? `${a.netBps > 0 ? '+' : ''}${a.netBps.toFixed(1)} bps` : '–'],
        ['Maker share', a.fills ? `${Math.round(a.makerPct * 100)}%` : '–'],
        ['Win rate', a.winRate == null ? '–' : `${Math.round(a.winRate * 100)}% of ${a.closes} closes`],
      ]
    : [];

  return (
    <dialog ref={dialog} onClose={() => setOpen(false)} className="m-auto w-[min(92vw,28rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg">
      {run && (
        <>
          <h2 className="text-[17px] font-semibold tracking-tight">Run Summary</h2>
          <p className="mt-1 text-[13px] text-fg-2">
            {whyText(run.why)} · {fmtTime(run.startedAt, false)}–{fmtTime(run.endedAt, false)} ({duration(run.endedAt - run.startedAt)})
          </p>
          <div className="mt-4 flex items-baseline justify-between border-b border-line pb-3">
            <span className="text-[13px] text-fg-2">Session PnL</span>
            <span className={cx('num text-[22px] font-semibold', tone(run.pnlUsd))}>{fmtSigned(run.pnlUsd)}</span>
          </div>
          {q.isPending ? (
            <p className="mt-3 text-[13px] text-fg-3">Loading the fills…</p>
          ) : q.isError ? (
            <p className="mt-3 text-[13px] text-warn">Could not load the fills: {q.error.message}</p>
          ) : (
            <>
              <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                {rows.map(([k, v, c]) => (
                  <div key={k} className="contents">
                    <dt className="text-fg-2">{k}</dt>
                    <dd className={cx('text-right', c ?? 'text-fg')}>{v}</dd>
                  </div>
                ))}
              </dl>
              {q.data!.byMarket.length > 1 && (
                <table className="num mt-4 w-full text-[12px]">
                  <thead className="text-fg-3">
                    <tr><th className="text-left font-normal">Market</th><th className="text-right font-normal">Fills</th><th className="text-right font-normal">Volume</th><th className="text-right font-normal">Net</th></tr>
                  </thead>
                  <tbody>
                    {q.data!.byMarket.map((b) => (
                      <tr key={b.key}><td>{b.key}</td><td className="text-right">{b.fills}</td><td className="text-right">{fmtUsd(b.volumeUsd, 0)}</td><td className={cx('text-right', tone(b.netUsd))}>{fmtSigned(b.netUsd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!settled && <p className="mt-3 text-[12px] text-warn">Positions are still closing; the numbers update when they are closed.</p>}
            </>
          )}
          <p className="mt-3 text-[12px] text-fg-3">Session PnL is the change in equity, deposits taken out. The rows below it cover Monday's own fills in this run.</p>
          <form method="dialog" className="mt-4 flex justify-end">
            <Button type="submit">Close</Button>
          </form>
        </>
      )}
    </dialog>
  );
}
