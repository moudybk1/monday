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

const STATUS: Record<PlanView['status'], { label: string; tone: 'neutral' | 'accent' | 'bid' }> = {
  waiting: { label: 'Waiting', tone: 'neutral' }, entering: { label: 'Entering', tone: 'accent' }, open: { label: 'Open', tone: 'bid' }, done: { label: 'Done', tone: 'neutral' },
};

const KIND_SHORT = { trade: 'Scalp', twap: 'TWAP' } as const;
const what = (p: PlanView) => (p.input.kind === 'twap' ? `TWAP ${STYLE_LABEL[p.input.style].toLowerCase()}` : `Scalping ${p.input.frame}`);

/** Stop, cancel or close a plan. Closing at market is one click away from a mistake: the first click asks, the second within a few seconds does it. */
export function usePlanActions(onError: (message: string) => void) {
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  useEffect(() => {
    if (confirm == null) return;
    const t = setTimeout(() => setConfirm(null), 4_000);
    return () => clearTimeout(t);
  }, [confirm]);
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
  return { busy, confirm, act };
}

/** A running plan's one control: Close (with confirm) once it holds a position, else Cancel, or Stop for a scalping session. */
export function PlanButton({ p, actions }: { p: PlanView; actions: ReturnType<typeof usePlanActions> }) {
  const { busy, confirm, act } = actions;
  if (p.status === 'done') return null;
  return p.filledSize > 0
    ? <Button size="xs" variant={confirm === p.id ? 'danger' : 'ghost'} disabled={busy === p.id} onClick={() => void act(p, true)} title="Stop and close the position at market">{confirm === p.id ? 'Confirm Close' : 'Close'}</Button>
    : <Button size="xs" variant="ghost" disabled={busy === p.id} onClick={() => void act(p, false)} title={p.scalp ? 'End the session: no new scalps' : undefined}>{p.scalp ? 'Stop' : 'Cancel'}</Button>;
}

// Seven columns that fit the blotter without scrolling sideways: each cell is two short lines, the main fact on top
// and its context under it, so a row reads left to right as what, how far, at what price, risk, result, control.
const HEAD = 'label sticky top-0 z-[1] h-7 bg-canvas text-left [&>th]:font-normal [&>th]:px-2 [&>th:first-child]:pl-2.5';
const CELL = 'px-2 py-1.5 align-middle first:pl-2.5';
const SUB = 'block whitespace-nowrap text-[12px] leading-tight text-fg-3';

function Bar({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'fg' }) {
  return (
    <span className="mt-1 block h-1 w-full max-w-[9rem] overflow-hidden rounded-[1px] bg-raised-2" aria-hidden>
      <span className={cx('block h-full transition-[width] duration-500', tone === 'accent' ? 'bg-accent' : 'bg-fg-3')} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

function PlanHead() {
  return (
    <thead>
      <tr className={HEAD}>
        <th>Plan</th><th>Status</th><th>Progress</th><th className="!text-right">Entry</th>
        <th className="!text-right">Stop / Target</th><th className="!text-right">PnL</th><th />
      </tr>
    </thead>
  );
}

/**
 * Agentic Trade and TWAP plans as given: the Plans tab passes the running ones, History the ones that ended. The Plans
 * tab also passes the running market maker's row (MakerRow), so everything that trades is stopped from one place.
 */
export function PlanList({ plans, specs, sim, now, onError, onPick, empty, maker }: { plans: PlanView[]; specs: Partial<Record<MarketSym, MarketSpec>>; sim: boolean; now: number; onError: (message: string) => void; onPick?: (s: MarketSym) => void; empty?: ReactNode; maker?: ReactNode }) {
  const actions = usePlanActions(onError);

  if (!plans.length && !maker) {
    return <p className="px-2.5 py-4 text-[13px] text-fg-3">{empty ?? <>No plan running. Start an <Link href="/app/setup/trade" className="underline underline-offset-2 hover:text-fg">Agentic Trade</Link> or a <Link href="/app/setup/twap" className="underline underline-offset-2 hover:text-fg">TWAP</Link> in Setup.</>}</p>;
  }
  const venue = sim ? 'the exchange' : 'Perpl';

  return (
    <table className="w-full min-w-[560px] text-[13px]">
      <PlanHead />
      <tbody className="num">
        {maker}
        {plans.map((p) => {
          const spec = specs[p.input.sym];
          const long = p.input.bias === 'long';
          const live = p.status !== 'done';
          const pnl = planPnl(p);
          const roi = p.input.marginUsd ? (pnl / p.input.marginUsd) * 100 : 0;
          const s = STATUS[p.status];
          const sc = p.scalp;
          const pct = p.targetSize ? (p.filledSize / p.targetSize) * 100 : 0;
          const [sl, tp] = (() => {
            const lv = planLevels(p);
            return [lv.find((l) => l.label === 'Stop Loss')?.price ?? p.slPrice, lv.find((l) => l.label === 'Take Profit')?.price ?? p.tpPrice];
          })();
          const shield = (on: boolean) => on && <ShieldCheckIcon size={11} className="mr-0.5 inline align-[-1px] text-accent" aria-label={`resting on ${venue}`} />;
          const hasResult = sc || p.filledSize > 0;
          return (
            <tr key={p.id} className={cx('border-t border-line', !live && 'text-fg-3')}>
              <td className={cx(CELL, 'font-sans')}>
                <span className="whitespace-nowrap">
                  <SymButton sym={p.input.sym} onPick={onPick} className={cx('font-semibold', live && 'text-fg')} />{' '}
                  <span className={cx('font-medium', live && (long ? 'text-bid-fg' : 'text-ask-fg'))}>{long ? 'Long' : 'Short'}</span>
                </span>
                <span className={SUB} title={what(p)}>{KIND_SHORT[p.input.kind]} · {p.input.leverage}x · {usd(p.input.marginUsd, 0)}</span>
              </td>
              <td className={cx(CELL, 'max-w-[9rem] font-sans')}>
                {live ? <Tag tone={s.tone}>{s.label}</Tag> : <span className="text-fg-2">{p.outcome ? OUTCOME_LABEL[p.outcome] : 'Done'}</span>}
                <span className={cx(SUB, 'mt-0.5 truncate')} title={p.note}>{live ? p.note : p.endedAt ? `${ago(p.endedAt, now)} ago` : p.note}</span>
              </td>
              <td className={cx(CELL, 'font-sans')}>
                {sc ? (
                  <>
                    <span className="whitespace-nowrap">{sc.scalps} scalp{sc.scalps === 1 ? '' : 's'}{sc.scalps ? `, ${sc.wins} won` : ''}</span>
                    <span className={SUB} title="D1 and H4 as Monday last read them">D1 {TREND_LABEL[sc.d1].toLowerCase()} · H4 {TREND_LABEL[sc.h4].toLowerCase()}{live && sc.mode ? ` · ${MODE_LABEL[sc.mode].toLowerCase()}` : ''}</span>
                  </>
                ) : (
                  <>
                    <span className="whitespace-nowrap">{Math.round(pct)}% filled</span>
                    {live ? <Bar pct={pct} /> : <span className={SUB}>{fmtSize(p.filledSize, spec)} of {fmtSize(p.targetSize, spec)}</span>}
                  </>
                )}
              </td>
              <td className={cx(CELL, 'text-right')}>
                {p.avgEntry != null ? fmtPrice(p.avgEntry, spec) : <span className="text-fg-3">-</span>}
                <span className={SUB}>{p.filledSize > 0 ? fmtSize(p.filledSize, spec) : 'no fill'}</span>
              </td>
              <td className={cx(CELL, 'text-right whitespace-nowrap')}>
                {sc ? (
                  <span title={`Session stop loss -${usd(sc.lossLimitUsd, 2)}${sc.targetUsd != null ? `, take profit +${usd(sc.targetUsd, 2)}` : ''}`}>
                    <span className={live ? 'text-ask-fg' : undefined}>-{usd(sc.lossLimitUsd, 2)}</span>
                    <span className={SUB}>{sc.targetUsd != null ? `+${usd(sc.targetUsd, 2)}` : 'no target'}</span>
                  </span>
                ) : (
                  <>
                    <span className={live ? 'text-ask-fg' : undefined}>{sl != null ? <>{shield(p.stopOnVenue)}{fmtPrice(sl, spec)}</> : '-'}</span>
                    <span className={SUB}>{tp != null ? <>{shield(p.takeOnVenue)}<span className={live ? 'text-bid-fg' : undefined}>{fmtPrice(tp, spec)}</span></> : 'no target'}</span>
                  </>
                )}
              </td>
              <td className={cx(CELL, 'text-right whitespace-nowrap')}>
                {hasResult ? <span className={cx('font-medium', tone(pnl))}>{fmtSigned(pnl)}</span> : <span className="text-fg-3">-</span>}
                <span className={SUB}>{hasResult ? `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%` : ' '}</span>
              </td>
              <td className={cx(CELL, 'pl-0 text-right font-sans whitespace-nowrap')}>
                {live && <PlanButton p={p} actions={actions} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The running market maker as a row of the Plans table: its markets, its session, and its Stop. Kill lives apart, in the top bar. */
export function MakerRow({ state, busy, onStop, onPick }: { state: DashboardState; busy: boolean; onStop: () => void; onPick?: (s: MarketSym) => void }) {
  const { policy, session: s } = state;
  const quotes = policy.markets.reduce((n, m) => n + (state.markets[m]?.quotes.bid ? 1 : 0) + (state.markets[m]?.quotes.ask ? 1 : 0), 0);
  return (
    <tr className="border-t border-line">
      <td className={cx(CELL, 'font-sans')}>
        <span className="whitespace-nowrap">
          {policy.markets.map((m, i) => <Fragment key={m}>{i > 0 && ', '}<SymButton sym={m} onPick={onPick} className="font-semibold text-fg" /></Fragment>)}
        </span>
        <span className={SUB}>Market Maker · {policy.maxLeverage}x</span>
      </td>
      <td className={cx(CELL, 'font-sans')}>
        <Tag tone="bid">Quoting</Tag>
        <span className={cx(SUB, 'mt-0.5')}>{quotes} order{quotes === 1 ? '' : 's'} resting</span>
      </td>
      <td className={cx(CELL, 'font-sans')}>
        <span className="whitespace-nowrap">{s ? `since ${fmtTime(s.startedAt, false)}` : 'quoting'}</span>
        <span className={SUB}>until you stop it</span>
      </td>
      <td className={cx(CELL, 'text-right text-fg-3')}>-</td>
      <td className={cx(CELL, 'text-right whitespace-nowrap')} title="Session stop loss and take profit when set, else the daily loss limit">
        <span className="text-ask-fg">{s?.stopLossUsd != null ? `-${usd(s.stopLossUsd, 2)}` : `-${usd(policy.maxDailyLossUsd, 2)}/day`}</span>
        <span className={SUB}>{s?.takeProfitUsd != null ? <span className="text-bid-fg">+{usd(s.takeProfitUsd, 2)}</span> : 'no target'}</span>
      </td>
      <td className={cx(CELL, 'text-right whitespace-nowrap')}>
        {s ? <span className={cx('font-medium', tone(s.makerPnlUsd))}>{fmtSigned(s.makerPnlUsd)}</span> : '-'}
        <span className={SUB}>own fills</span>
      </td>
      <td className={cx(CELL, 'pl-0 text-right font-sans whitespace-nowrap')}>
        <Button size="xs" variant="ghost" disabled={busy} onClick={onStop} title="Cancel the market maker's orders and stop it. Its open positions stay, and Monday stops watching them. Plans keep running.">Stop</Button>
      </td>
    </tr>
  );
}

/** A running plan's prices on the chart: where a scalp waits to enter, and the stop loss and take profit resting now. */
export function planLevels(p: PlanView | undefined): ChartLevel[] {
  if (!p || p.status === 'done') return [];
  const out: ChartLevel[] = [];
  if (p.input.kind === 'trade') {
    if (p.status === 'entering' && p.avgEntry != null) out.push({ price: p.avgEntry, label: 'Scalp Entry', tone: 'accent' });
    if (p.slPrice != null) out.push({ price: p.slPrice, label: 'Stop Loss', tone: 'ask' });
    if (p.tpPrice != null) out.push({ price: p.tpPrice, label: 'Take Profit', tone: 'bid' });
    return out;
  }
  // A TWAP's levels are priced from where it started, so they show before the first fill too.
  const ref = p.twap?.arrival || p.avgEntry;
  const sl = p.slPrice ?? (ref ? priceAway(p.input.bias, ref, p.input.stopLossPct, true) : null);
  const tp = p.tpPrice ?? (ref && p.input.takeProfitPct ? priceAway(p.input.bias, ref, p.input.takeProfitPct, false) : null);
  if (sl) out.push({ price: sl, label: 'Stop Loss', tone: 'ask' });
  if (tp) out.push({ price: tp, label: 'Take Profit', tone: 'bid' });
  return out;
}
