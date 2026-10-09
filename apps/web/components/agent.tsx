'use client';

import { PauseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react';
import { usd, usdCompact, type DashboardState, type MarketState, type MarketSym, type Side } from '@monday/core';
import { fmtBps, fmtPrice, fmtSigned, fmtTime, fmtUsd } from '@/lib/format';
import { Diverging } from './charts';
import { Button, Tag, cx } from './ui';

/** Session stop loss and take profit as typed: empty or not a positive number means none. */
export type SessionDraft = { sl: string; tp: string };
export const STATUS = { quoting: 'Quoting', paused: 'Paused', killed: 'Killed', idle: 'Not started' } as const;
/** What fmtSigned shows as non-zero gets a colour. */
export const tone = (n: number) => (n >= 0.00005 ? 'text-bid-fg' : n <= -0.00005 ? 'text-ask-fg' : 'text-fg');

/** How a resting quote stands against the book, for the console and the blotter. */
export function quoteStanding(m: MarketState, side: Side): { label: string; good: boolean } | null {
  const q = m.quotes[side];
  if (!q) return null;
  const best = side === 'bid' ? m.bestBid : m.bestAsk;
  const ahead = m.aheadUsd[side];
  if (best != null && (side === 'bid' ? q.price >= best : q.price <= best)) return ahead != null && ahead >= 1 ? { label: `${usdCompact(ahead)} ahead`, good: true } : { label: '1st in line', good: true };
  const mid = m.mid ?? m.mark;
  return { label: `${(Math.abs(q.price - mid) / mid * 1e4).toFixed(1)} bps out`, good: false };
}

/**
 * The column where a manual terminal keeps its order ticket. Monday trades for you, so this is the agent: the money,
 * the controls, and one row per market showing where its quotes stand in line and what they have earned.
 */
export function AgentConsole({ state, sym, onPick, session, onSession, busy, onStart, onPause, onKill }: {
  state: DashboardState;
  sym: MarketSym;
  onPick: (s: MarketSym) => void;
  session: SessionDraft;
  onSession: (s: SessionDraft) => void;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onKill: () => void;
}) {
  const { pnl, policy } = state;
  const quoting = state.status === 'quoting';
  const live = quoting ? state.session : null;
  const used = Math.min(100, Math.max(0, pnl.lossLimitUsedPct));
  const m = state.markets[sym];
  const cell = 'min-w-0 bg-canvas px-2.5 py-2';

  return (
    <section className="panel flex-none" aria-label="Agent">
      <header className="flex h-8 flex-none items-center justify-between border-b border-line px-2.5">
        <h2 className="text-[12px] font-semibold">Agent</h2>
        <Tag tone={state.closing ? 'warn' : quoting ? 'bid' : state.status === 'killed' ? 'ask' : 'neutral'}>{state.closing ? 'Closing' : STATUS[state.status]}</Tag>
      </header>

      <dl className="grid grid-cols-2 gap-px bg-line">
        <div className={cell}>
          <dt className="label">Equity</dt>
          <dd className="num mt-1.5 text-[20px] font-medium leading-none tracking-tight">{fmtUsd(state.account.equityUsd)}</dd>
          <dd className="num mt-1.5 text-[11px] text-fg-3">acct {state.account.id || 'none'}</dd>
        </div>
        <div className={cell}>
          <dt className="label" title="Trading result since 00:00 UTC: equity change minus deposits and withdrawals. Fees and funding are already inside it.">Today</dt>
          <dd className={cx('num mt-1.5 text-[20px] font-medium leading-none tracking-tight', tone(pnl.todayUsd))}>{fmtSigned(pnl.todayUsd)}</dd>
          <dd className="num mt-1.5 truncate text-[11px] text-fg-3">
            <span className={tone(pnl.realizedUsd)}>{fmtSigned(pnl.realizedUsd)}</span> real <span className={tone(pnl.unrealizedUsd)}>{fmtSigned(pnl.unrealizedUsd)}</span> open, fees {fmtUsd(pnl.feesUsd, 3)}
          </dd>
        </div>
        <div className={cell}>
          <dt className="label">Session</dt>
          <dd className="num mt-1.5 text-[12px]">
            {live ? <><span className={tone(live.pnlUsd)}>{fmtSigned(live.pnlUsd)}</span> <span className="text-fg-3">since {fmtTime(live.startedAt, false)}</span></> : <span className="text-fg-3">not running</span>}
          </dd>
          {live && (live.stopLossUsd != null || live.takeProfitUsd != null) && (
            <dd className="num mt-1 text-[11px] text-fg-3">
              stop {live.stopLossUsd != null ? <span className="text-ask-fg">-{usd(live.stopLossUsd)}</span> : 'none'} / target {live.takeProfitUsd != null ? <span className="text-bid-fg">+{usd(live.takeProfitUsd)}</span> : 'none'}
            </dd>
          )}
        </div>
        <div className={cell}>
          <dt className="label">Daily loss limit</dt>
          <dd className="num mt-1.5 flex items-center gap-2 text-[12px]">
            <span className={used >= 70 ? 'text-ask-fg' : 'text-fg'}>{Math.round(used)}%</span>
            <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-[1px] bg-raised-2" aria-hidden>
              <span className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${used}%`, background: used >= 70 ? 'var(--ask)' : 'var(--fg-3)' }} />
            </span>
            <span className="whitespace-nowrap text-fg-3">of {usd(policy.maxDailyLossUsd)}</span>
          </dd>
        </div>
      </dl>

      <div className="border-t border-line px-2.5 py-2">
        {quoting ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="flex-1" onClick={onPause} disabled={busy}><PauseIcon size={12} weight="fill" /> Pause</Button>
            <Button size="sm" variant="danger" className="flex-1" onClick={onKill} disabled={busy}><StopIcon size={12} weight="fill" /> Kill and flatten</Button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              {([['sl', 'Session stop loss', 'Kill and flatten once this session loses this much. Empty: only the daily limit.'], ['tp', 'Take profit', 'Stop and close the position once this session makes this much. Empty: no target.']] as const).map(([k, label, help]) => (
                <label key={k} htmlFor={`session-${k}`} className="grid gap-1" title={help}>
                  <span className="label">{label}</span>
                  <span className="flex items-center gap-1 text-[12px] text-fg-3">
                    $<input
                      id={`session-${k}`} type="number" inputMode="decimal" min={0} step={1} placeholder="none" value={session[k]}
                      onChange={(e) => onSession({ ...session, [k]: e.target.value })}
                      className="num h-7 w-full min-w-0 rounded-sm border border-line-2 bg-raised px-1.5 text-[12px] text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
                    />
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" className="flex-1" onClick={onStart} disabled={busy}><PlayIcon size={12} weight="fill" /> {state.status === 'idle' ? 'Start quoting' : 'Resume'}</Button>
              {state.status === 'paused' && <Button size="sm" variant="danger" onClick={onKill} disabled={busy}><StopIcon size={12} weight="fill" /> Kill</Button>}
            </div>
          </div>
        )}
      </div>

      <div className="scroll border-t border-line">
      <table className="w-full min-w-[21rem] text-[11.5px]">
        <thead>
          <tr className="label h-6 text-left [&>th]:font-normal">
            <th className="pl-2.5">Mkt</th>
            <th>Inventory</th>
            <th className="text-right">Bid</th>
            <th className="text-right">Ask</th>
            <th className="pr-2.5 text-right" title="Monday's maker fills in the last hour, and their average price move one minute later (positive is good)">Fills/h</th>
          </tr>
        </thead>
        <tbody className="num">
          {(Object.keys(state.markets) as MarketSym[]).map((s) => {
            const x = state.markets[s];
            if (!x) return null;
            const inv = x.position.notionalUsd;
            const q = (side: Side) => {
              const st = quoteStanding(x, side);
              if (!st) return <span className="text-fg-3">{x.reflex?.action === 'pull' && x.reflex.side === side ? 'pulled' : 'none'}</span>;
              return (
                <>
                  <span className={side === 'bid' ? 'text-bid-fg' : 'text-ask-fg'}>{fmtPrice(x.quotes[side]!.price, x.spec)}</span>
                  <span className={cx('block text-[10.5px] leading-tight', st.good ? 'text-fg-3' : 'text-warn')}>{st.label}</span>
                </>
              );
            };
            return (
              <tr key={s} onClick={() => onPick(s)} className={cx('h-[34px] cursor-pointer border-t border-line align-middle', s === sym ? 'bg-raised' : 'hover:bg-raised')}>
                <td className="pl-2.5 font-sans font-semibold" title={!x.inPolicy ? 'Not in your policy any more: Monday only closes the position here.' : x.stage !== 'normal' ? `Inventory stage: ${x.stage}. Monday has stopped adding and is working the exit.` : undefined}>
                  {s}{(!x.inPolicy || x.stage !== 'normal') && <span className={cx('ml-1 font-normal', x.stage === 'urgent' ? 'text-ask-fg' : 'text-warn')}>{x.inPolicy ? x.stage : 'exit'}</span>}
                </td>
                <td>
                  <span className={cx('inline-block w-[3.6rem]', tone(inv))}>{Math.abs(inv) < 0.5 ? 'flat' : `${inv > 0 ? '+' : '-'}${fmtUsd(Math.abs(inv), 0)}`}</span>
                  <Diverging value={inv / policy.maxInventoryUsd} className="inline-block w-9 align-middle" />
                </td>
                <td className="text-right leading-tight">{q('bid')}</td>
                <td className="text-right leading-tight">{q('ask')}</td>
                <td className="pr-2.5 text-right leading-tight">
                  {x.fills1h}
                  <span className={cx('block text-[10.5px]', x.markout1mBps == null ? 'text-fg-3' : x.markout1mBps >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>{x.markout1mBps == null ? '-' : `${fmtBps(x.markout1mBps)} bps`}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {/* One plain sentence from the engine on what the selected market is doing or waiting for. */}
      {m && (
        <p className="border-t border-line px-2.5 py-1.5 text-[11.5px] leading-snug text-fg-2" role="status">
          <span className="font-semibold text-fg">{sym}</span> {m.why || (quoting ? 'Placing quotes.' : 'Not quoting.')}
        </p>
      )}
    </section>
  );
}
