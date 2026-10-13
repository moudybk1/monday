'use client';

import { ShieldCheckIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ENTRY_LABEL, OUTCOME_LABEL, STYLE_LABEL, priceAway, type MarketSpec, type MarketSym, type PlanView } from '@monday/core';
import { tone } from './agent';
import type { ChartLevel } from './price-chart';
import { Button, Tag, cx } from './ui';
import { api } from '@/lib/api';
import { ago, fmtPrice, fmtSigned, fmtSize } from '@/lib/format';

const HEAD = 'label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal';
const STATUS: Record<PlanView['status'], { label: string; tone: 'neutral' | 'accent' | 'bid' }> = {
  waiting: { label: 'Waiting', tone: 'neutral' }, entering: { label: 'Entering', tone: 'accent' }, open: { label: 'Open', tone: 'bid' }, done: { label: 'Done', tone: 'neutral' },
};

const what = (p: PlanView) => (p.input.kind === 'twap' ? `TWAP, ${STYLE_LABEL[p.input.style].toLowerCase()}` : ENTRY_LABEL[p.input.entry]);
const pnlOf = (p: PlanView) => p.realizedUsd - p.feesUsd + p.unrealizedUsd;

/** Agentic Trade and TWAP plans: the running ones first, then the last few that ended. */
export function PlanList({ plans, specs, sim, now, onError }: { plans: PlanView[]; specs: Partial<Record<MarketSym, MarketSpec>>; sim: boolean; now: number; onError: (message: string) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  // Closing at market is one click away from a mistake: the first click asks, the second within a few seconds does it.
  const [confirm, setConfirm] = useState<number | null>(null);
  useEffect(() => {
    if (confirm == null) return;
    const t = setTimeout(() => setConfirm(null), 4_000);
    return () => clearTimeout(t);
  }, [confirm]);

  if (!plans.length) {
    return <p className="px-2.5 py-4 text-[12px] text-fg-3">No plans yet. Start an <Link href="/app/setup/trade" className="underline underline-offset-2 hover:text-fg">Agentic Trade</Link> or a <Link href="/app/setup/twap" className="underline underline-offset-2 hover:text-fg">TWAP</Link> in Setup.</p>;
  }
  const act = async (p: PlanView, close: boolean) => {
    if (close && confirm !== p.id) return setConfirm(p.id);
    setConfirm(null);
    setBusy(p.id);
    try {
      await api(`/plans/${p.id}/cancel`, { method: 'POST', body: { close } });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <table className="w-full min-w-[860px] text-[11.5px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Plan</th><th>Status</th><th className="text-right">Filled</th><th className="text-right">Entry</th>
          <th className="text-right" title={`Rest on ${sim ? 'the exchange' : 'Perpl'} while the position is open`}>Stop loss</th><th className="text-right">Take profit</th>
          <th className="text-right">PnL</th><th className="pl-4">Now</th><th className="pr-2.5" />
        </tr>
      </thead>
      <tbody className="num">
        {plans.map((p) => {
          const spec = specs[p.input.sym];
          const long = p.input.bias === 'long';
          const live = p.status !== 'done';
          const pnl = pnlOf(p);
          const s = STATUS[p.status];
          return (
            <tr key={p.id} className={cx('h-[26px] border-t border-line align-middle', !live && 'text-fg-3')}>
              <td className="pl-2.5 font-sans">
                <span className={cx('font-semibold', live && 'text-fg')}>{p.input.sym}</span>{' '}
                <span className={cx(live && (long ? 'text-bid-fg' : 'text-ask-fg'))}>{long ? 'Long' : 'Short'}</span>{' '}
                <span className="text-fg-3">{what(p)}, {p.input.leverage}x</span>
              </td>
              <td className="font-sans">{live ? <Tag tone={s.tone}>{s.label}</Tag> : <span title={p.endedAt ? `${ago(p.endedAt, now)} ago` : undefined}>{p.outcome ? OUTCOME_LABEL[p.outcome] : 'Done'}</span>}</td>
              <td className="text-right">{fmtSize(p.filledSize, spec)}<span className="text-fg-3">/{fmtSize(p.targetSize, spec)}</span></td>
              <td className="text-right">{p.avgEntry != null ? fmtPrice(p.avgEntry, spec) : p.input.kind === 'trade' && p.input.entryPrice ? <span className="text-fg-3">{fmtPrice(p.input.entryPrice, spec)}</span> : '-'}</td>
              <td className="text-right">
                {p.slPrice != null ? <span className="inline-flex items-center gap-1">{p.stopOnVenue && <ShieldCheckIcon size={12} className="text-accent" aria-label={`resting on ${sim ? 'the exchange' : 'Perpl'}`} />}{fmtPrice(p.slPrice, spec)}</span> : <span className="text-fg-3">{p.input.stopLossPct}%</span>}
              </td>
              <td className="text-right">
                {p.tpPrice != null ? <span className="inline-flex items-center gap-1">{p.takeOnVenue && <ShieldCheckIcon size={12} className="text-accent" aria-label="resting on the exchange" />}{fmtPrice(p.tpPrice, spec)}</span> : <span className="text-fg-3">{p.input.takeProfitPct ? `${p.input.takeProfitPct}%` : 'Off'}</span>}
              </td>
              <td className={cx('text-right', p.filledSize > 0 && tone(pnl))}>{p.filledSize > 0 ? fmtSigned(pnl) : '-'}</td>
              <td className="max-w-[22rem] truncate pl-4 font-sans text-fg-2" title={p.note}>
                {p.twap && live ? `${p.twap.slicesDone}/${p.twap.slices} slices. ` : ''}{p.note}
              </td>
              <td className="pr-2.5 text-right font-sans whitespace-nowrap">
                {live && (p.filledSize > 0
                  ? <Button size="xs" variant={confirm === p.id ? 'danger' : 'ghost'} disabled={busy === p.id} onClick={() => void act(p, true)} title="Cancel what is left to enter and close the position at market">{confirm === p.id ? 'Confirm close' : 'Close'}</Button>
                  : <Button size="xs" variant="ghost" disabled={busy === p.id} onClick={() => void act(p, false)}>Cancel</Button>)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A running plan's prices on the chart: where it waits to enter, its stop loss and its take profit. */
export function planLevels(p: PlanView | undefined): ChartLevel[] {
  if (!p || p.status === 'done') return [];
  const out: ChartLevel[] = [];
  const entry = p.input.kind === 'trade' && p.input.entry !== 'market' && p.status === 'waiting' ? p.input.entryPrice : null;
  if (entry) out.push({ price: entry, label: p.input.kind === 'trade' && p.input.entry === 'stop' ? 'Breakout' : 'Entry', tone: 'accent' });
  // Before the first fill the levels are where they will be if the entry fills at its price.
  const ref = p.avgEntry ?? entry;
  const sl = p.slPrice ?? (ref ? priceAway(p.input.bias, ref, p.input.stopLossPct, true) : null);
  const tp = p.tpPrice ?? (ref && p.input.takeProfitPct ? priceAway(p.input.bias, ref, p.input.takeProfitPct, false) : null);
  if (sl) out.push({ price: sl, label: 'Stop loss', tone: 'ask' });
  if (tp) out.push({ price: tp, label: 'Take profit', tone: 'bid' });
  return out;
}
