'use client';

import { ShieldCheckIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { MODE_LABEL, OUTCOME_LABEL, STYLE_LABEL, TREND_LABEL, planPnl, priceAway, usd, type DashboardState, type MarketSpec, type MarketSym, type PlanView } from '@monday/core';
import { tone } from './agent';
import type { ChartLevel } from './price-chart';
import { Button, SymButton, Tag, cx } from './ui';
import { api } from '@/lib/api';
import { ago, fmtPrice, fmtSigned, fmtSize, fmtTime } from '@/lib/format';

const HEAD = 'label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal';
const STATUS: Record<PlanView['status'], { label: string; tone: 'neutral' | 'accent' | 'bid' }> = {
  waiting: { label: 'Waiting', tone: 'neutral' }, entering: { label: 'Entering', tone: 'accent' }, open: { label: 'Open', tone: 'bid' }, done: { label: 'Done', tone: 'neutral' },
};

const what = (p: PlanView) => (p.input.kind === 'twap' ? `TWAP, ${STYLE_LABEL[p.input.style].toLowerCase()}` : `Scalping ${p.input.frame}`);

/**
 * Agentic Trade and TWAP plans as given: the Plans tab passes the running ones, History the ones that ended. The Plans
 * tab also passes the running market maker's row (MakerRow), so everything that trades is stopped from one place.
 */
export function PlanList({ plans, specs, sim, now, onError, onPick, empty, maker }: { plans: PlanView[]; specs: Partial<Record<MarketSym, MarketSpec>>; sim: boolean; now: number; onError: (message: string) => void; onPick?: (s: MarketSym) => void; empty?: ReactNode; maker?: ReactNode }) {
  const [busy, setBusy] = useState<number | null>(null);
  // Closing at market is one click away from a mistake: the first click asks, the second within a few seconds does it.
  const [confirm, setConfirm] = useState<number | null>(null);
  useEffect(() => {
    if (confirm == null) return;
    const t = setTimeout(() => setConfirm(null), 4_000);
    return () => clearTimeout(t);
  }, [confirm]);

  if (!plans.length && !maker) {
    return <p className="px-2.5 py-4 text-[13px] text-fg-3">{empty ?? <>No plan running. Start an <Link href="/app/setup/trade" className="underline underline-offset-2 hover:text-fg">Agentic Trade</Link> or a <Link href="/app/setup/twap" className="underline underline-offset-2 hover:text-fg">TWAP</Link> in Setup.</>}</p>;
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
  const venue = sim ? 'the exchange' : 'Perpl';

  return (
    <table className="w-full min-w-[900px] text-[13px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Plan</th><th>Status</th><th>Progress</th><th className="text-right">Entry</th>
          <th className="text-right" title={`Rest on ${venue} while a position is open`}>Stop loss</th><th className="text-right">Take profit</th>
          <th className="text-right">PnL</th><th className="pl-4">Now</th><th className="pr-2.5" />
        </tr>
      </thead>
      <tbody className="num">
        {maker}
        {plans.map((p) => {
          const spec = specs[p.input.sym];
          const long = p.input.bias === 'long';
          const live = p.status !== 'done';
          const pnl = planPnl(p);
          const s = STATUS[p.status];
          const sc = p.scalp;
          const level = (price: number | null, onVenue: boolean, fallback: string) => price != null
            ? <span className="inline-flex items-center gap-1">{onVenue && <ShieldCheckIcon size={12} className="text-accent" aria-label={`resting on ${venue}`} />}{fmtPrice(price, spec)}</span>
            : <span className="text-fg-3">{fallback}</span>;
          return (
            <tr key={p.id} className={cx('h-[26px] border-t border-line align-middle', !live && 'text-fg-3')}>
              <td className="pl-2.5 font-sans">
                <SymButton sym={p.input.sym} onPick={onPick} className={cx('font-semibold', live && 'text-fg')} />{' '}
                <span className={cx(live && (long ? 'text-bid-fg' : 'text-ask-fg'))}>{long ? 'Long' : 'Short'}</span>{' '}
                <span className="text-fg-3">{what(p)}, {p.input.leverage}x</span>
              </td>
              <td className="font-sans">{live ? <Tag tone={s.tone}>{s.label}</Tag> : <span title={p.endedAt ? `${ago(p.endedAt, now)} ago` : undefined}>{p.outcome ? OUTCOME_LABEL[p.outcome] : 'Done'}</span>}</td>
              <td className="font-sans">
                {sc ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span>{sc.scalps} scalp{sc.scalps === 1 ? '' : 's'}{sc.scalps ? `, ${sc.wins} won` : ''}</span>
                    {live && <span className="text-fg-3" title="D1 and H4 as Monday last read them">D1 {TREND_LABEL[sc.d1].slice(0, 4).toLowerCase()}, H4 {TREND_LABEL[sc.h4].slice(0, 4).toLowerCase()}{sc.mode ? `, ${MODE_LABEL[sc.mode].toLowerCase()}` : ''}</span>}
                  </span>
                ) : (
                  <span>{fmtSize(p.filledSize, spec)}<span className="text-fg-3">/{fmtSize(p.targetSize, spec)}</span>{p.twap && live ? <span className="text-fg-3"> {p.twap.slicesDone}/{p.twap.slices} slices</span> : null}</span>
                )}
              </td>
              <td className="text-right">{p.avgEntry != null ? fmtPrice(p.avgEntry, spec) : '-'}</td>
              <td className="text-right">{level(p.slPrice, p.stopOnVenue, sc ? '-' : p.input.kind === 'twap' ? `${p.input.stopLossPct}%` : '-')}</td>
              <td className="text-right">{level(p.tpPrice, p.takeOnVenue, sc ? '-' : p.input.kind === 'twap' && p.input.takeProfitPct ? `${p.input.takeProfitPct}%` : 'Off')}</td>
              <td className="text-right" title={sc ? `Session stop loss -${usd(sc.lossLimitUsd, 2)}${sc.targetUsd != null ? `, take profit +${usd(sc.targetUsd, 2)}` : ''}` : undefined}>
                {sc || p.filledSize > 0 ? <span className={tone(pnl)}>{fmtSigned(pnl)}</span> : '-'}
                {sc && live && <span className="text-fg-3"> of -{usd(sc.lossLimitUsd, 2)}{sc.targetUsd != null ? `/+${usd(sc.targetUsd, 2)}` : ''}</span>}
              </td>
              <td className="max-w-[22rem] truncate pl-4 font-sans text-fg-2" title={p.note}>{p.note}</td>
              <td className="pr-2.5 text-right font-sans whitespace-nowrap">
                {live && (p.filledSize > 0
                  ? <Button size="xs" variant={confirm === p.id ? 'danger' : 'ghost'} disabled={busy === p.id} onClick={() => void act(p, true)} title="Stop and close the position at market">{confirm === p.id ? 'Confirm close' : 'Close'}</Button>
                  : <Button size="xs" variant="ghost" disabled={busy === p.id} onClick={() => void act(p, false)} title={sc ? 'End the session: no new scalps' : undefined}>{sc ? 'Stop' : 'Cancel'}</Button>)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The running market maker as a row of the Plans table: its markets, its session, and its Stop and Kill. */
export function MakerRow({ state, busy, onStop, onKill, onPick }: { state: DashboardState; busy: boolean; onStop: () => void; onKill: () => void; onPick?: (s: MarketSym) => void }) {
  const { policy, session: s } = state;
  const quotes = policy.markets.reduce((n, m) => n + (state.markets[m]?.quotes.bid ? 1 : 0) + (state.markets[m]?.quotes.ask ? 1 : 0), 0);
  return (
    <tr className="h-[26px] border-t border-line align-middle">
      <td className="pl-2.5 font-sans">
        {policy.markets.map((m, i) => <Fragment key={m}>{i > 0 && ', '}<SymButton sym={m} onPick={onPick} className="font-semibold text-fg" /></Fragment>)}{' '}
        <span className="text-fg-3">Market maker, {policy.maxLeverage}x</span>
      </td>
      <td className="font-sans"><Tag tone="bid">Quoting</Tag></td>
      <td className="font-sans">{quotes} order{quotes === 1 ? '' : 's'} resting</td>
      <td className="text-right text-fg-3">-</td>
      <td className="text-right" title="Session stop loss when one is set, else the daily loss limit">{s?.stopLossUsd != null ? `-${usd(s.stopLossUsd, 2)}` : <span className="text-fg-3">-{usd(policy.maxDailyLossUsd, 2)} a day</span>}</td>
      <td className="text-right">{s?.takeProfitUsd != null ? `+${usd(s.takeProfitUsd, 2)}` : <span className="text-fg-3">Off</span>}</td>
      <td className="text-right">{s ? <span className={tone(s.pnlUsd)}>{fmtSigned(s.pnlUsd)}</span> : '-'}</td>
      <td className="pl-4 font-sans text-fg-2">{s ? `quoting since ${fmtTime(s.startedAt, false)}` : 'quoting'}</td>
      <td className="pr-2.5 text-right font-sans whitespace-nowrap">
        <Button size="xs" variant="ghost" disabled={busy} onClick={onStop} title="Cancel Monday's orders and stop the bot. Open positions and orders you placed yourself stay as they are, and Monday stops watching them.">Stop</Button>{' '}
        <Button size="xs" variant="danger" disabled={busy} onClick={onKill} title="Cancel every order and close every position on the account, the plans' too">Kill and flatten</Button>
      </td>
    </tr>
  );
}

/** A running plan's prices on the chart: where a scalp waits to enter, and the stop loss and take profit resting now. */
export function planLevels(p: PlanView | undefined): ChartLevel[] {
  if (!p || p.status === 'done') return [];
  const out: ChartLevel[] = [];
  if (p.input.kind === 'trade') {
    if (p.status === 'entering' && p.avgEntry != null) out.push({ price: p.avgEntry, label: 'Scalp entry', tone: 'accent' });
    if (p.slPrice != null) out.push({ price: p.slPrice, label: 'Stop loss', tone: 'ask' });
    if (p.tpPrice != null) out.push({ price: p.tpPrice, label: 'Take profit', tone: 'bid' });
    return out;
  }
  // A TWAP's levels are priced from where it started, so they show before the first fill too.
  const ref = p.twap?.arrival || p.avgEntry;
  const sl = p.slPrice ?? (ref ? priceAway(p.input.bias, ref, p.input.stopLossPct, true) : null);
  const tp = p.tpPrice ?? (ref && p.input.takeProfitPct ? priceAway(p.input.bias, ref, p.input.takeProfitPct, false) : null);
  if (sl) out.push({ price: sl, label: 'Stop loss', tone: 'ask' });
  if (tp) out.push({ price: tp, label: 'Take profit', tone: 'bid' });
  return out;
}
