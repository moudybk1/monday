'use client';

import { KIND_LABEL, STYLE_LABEL, planPnl, usd, usdCompact, type DashboardState, type MarketSpec, type MarketState, type MarketSym, type PlanView, type Side } from '@monday/core';
import type { ReactNode } from 'react';
import { SidebarSimpleIcon } from '@phosphor-icons/react';
import { fmtBps, fmtPrice, fmtSigned, fmtUsd } from '@/lib/format';
import { Diverging } from './charts';
import { PlanButton, usePlanActions } from './plans';
import { Button, ButtonLink, SymButton, Tag, cx } from './ui';

export const STATUS = { quoting: 'Quoting', paused: 'Stopped', killed: 'Killed', idle: 'Not started' } as const;
/** The agent's state in one word, with cleanup Perpl has not confirmed yet taking precedence. */
export const statusText = (s: DashboardState) => (s.closing === 'flatten' ? 'Closing' : s.closing === 'cancel' ? 'Cancelling' : STATUS[s.status]);
/** The Terminal's status: what trades now. With the market maker stopped or killed, a running plan is what trades. */
export const terminalStatus = (s: DashboardState): { text: string; live: boolean } => {
  const n = s.plans.filter((p) => p.status !== 'done').length;
  if (!s.closing && s.status !== 'quoting' && n) return { text: `${n} plan${n > 1 ? 's' : ''} running`, live: true };
  return { text: statusText(s), live: s.status === 'quoting' };
};
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
/** Desktop only: folds the agent column away so the chart and blotter take its width. */
export function HideAgentButton({ onHide }: { onHide: () => void }) {
  return (
    <Button size="xs" variant="ghost" className="gap-1.5 max-xl:hidden" onClick={onHide} title="Hide the Agent column; the chart and blotter take its width">
      <SidebarSimpleIcon size={13} weight="bold" mirrored />Hide
    </Button>
  );
}

export function AgentConsole({ state, sym, specs, busy, onPick, onStop, onError, onHide }: {
  state: DashboardState;
  sym: MarketSym;
  specs: Partial<Record<MarketSym, MarketSpec>>;
  busy: boolean;
  onPick: (s: MarketSym) => void;
  onStop: () => void;
  onError: (message: string) => void;
  onHide: () => void;
}) {
  const { pnl, policy } = state;
  const quoting = state.status === 'quoting';
  const hasMaker = policy.markets.length > 0;
  const live = quoting ? state.session : null;
  const plans = state.plans.filter((p) => p.status !== 'done');
  const used = Math.min(100, Math.max(0, pnl.lossLimitUsedPct));
  const actions = usePlanActions(onError);
  // The maker's markets: the policy's and any it is still working out, never a market a plan holds.
  const makerSyms = (Object.keys(state.markets) as MarketSym[]).filter((s) => {
    const x = state.markets[s];
    return x && !plans.some((p) => p.input.sym === s) && (x.inPolicy || x.position.size !== 0 || x.quotes.bid || x.quotes.ask);
  });
  // The maker's card shows while it quotes, and while its markets still hold quotes or a position to work out.
  const makerOn = quoting || (hasMaker && makerSyms.some((s) => state.markets[s]!.position.size !== 0 || state.markets[s]!.quotes.bid || state.markets[s]!.quotes.ask));
  const makerPnl = live?.makerPnlUsd ?? 0;
  // What is running, each with its own result: the maker's own fills, each plan's own position. They add up.
  const parts: { label: string; pnl: number }[] = [
    ...(live ? [{ label: 'Market Maker', pnl: makerPnl }] : []),
    ...plans.map((p) => ({ label: `${p.input.sym} ${KIND_LABEL[p.input.kind]}`, pnl: planPnl(p) })),
  ];
  const total = parts.reduce((a, x) => a + x.pnl, 0);
  const count = (makerOn ? 1 : 0) + plans.length;
  const headline = state.closing ? statusText(state) : count === 0 ? statusText(state) : quoting && plans.length ? `Maker + ${plans.length} plan${plans.length > 1 ? 's' : ''}` : quoting ? 'Quoting' : `${plans.length} plan${plans.length > 1 ? 's' : ''} running`;
  const mk = makerSyms.includes(sym) ? sym : makerSyms[0];
  const m = mk ? state.markets[mk] : undefined;
  const cell = 'min-w-0 bg-canvas px-2.5 py-2';

  return (
    <section className="panel flex-none" aria-label="Agent">
      <header className="flex h-8 flex-none items-center justify-between border-b border-line px-2.5">
        <h2 className="text-[13px] font-semibold">Agent</h2>
        <div className="flex items-center gap-2">
          <Tag tone={state.closing ? 'warn' : count ? 'bid' : state.status === 'killed' ? 'ask' : 'neutral'}>{headline}</Tag>
          <HideAgentButton onHide={onHide} />
        </div>
      </header>

      {/* The account as a whole. */}
      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line">
        <div className={cell}>
          <dt className="label">Equity</dt>
          <dd className="num mt-1.5 text-[20px] font-medium leading-none tracking-tight">{fmtUsd(state.account.equityUsd)}</dd>
          <dd className="num mt-1.5 text-[12px] text-fg-3">acct {state.account.id || 'none'}</dd>
        </div>
        <div className={cell}>
          <dt className="label" title="Trading result since 00:00 UTC: equity change minus deposits and withdrawals. Fees and funding are already inside it.">Today</dt>
          <dd className={cx('num mt-1.5 text-[20px] font-medium leading-none tracking-tight', tone(pnl.todayUsd))}>{fmtSigned(pnl.todayUsd)}</dd>
          <dd className="mt-1.5 text-[12px] text-fg-3">whole account, since 00:00 UTC</dd>
        </div>
      </dl>
      {hasMaker && (
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-[12px]" title="Reached, it kills everything: the market maker and every plan. Each plan also has its own stop.">
          <span className="text-fg-3">Daily loss limit</span>
          <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-[1px] bg-raised-2" aria-hidden>
            <span className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${used}%`, background: used >= 70 ? 'var(--ask)' : 'var(--fg-3)' }} />
          </span>
          <span className={cx('num whitespace-nowrap', used >= 70 ? 'text-ask-fg' : 'text-fg-2')}>{Math.round(used)}% of {usd(policy.maxDailyLossUsd)}</span>
        </div>
      )}

      {/* What is running: the total, then one card each that adds up to it. */}
      {count > 0 && (
        <div className="flex items-baseline justify-between gap-2 px-2.5 pb-1 pt-2">
          <span className="label">Running · {count}</span>
          {parts.length > 1 && <span className="num text-[13px]"><span className="text-fg-3">total </span><span className={tone(total)}>{fmtSigned(total)}</span></span>}
        </div>
      )}
      <div className="grid gap-1.5 px-1.5 pb-1.5 empty:hidden">
        {makerOn && (
          <article className="overflow-hidden rounded-sm border border-line-2">
            <CardHead
              kind="Market Maker" status={<Tag tone={quoting ? 'bid' : state.closing ? 'warn' : 'neutral'}>{quoting ? 'Quoting' : statusText(state)}</Tag>}
              pnl={live ? makerPnl : null}
              detail={<>{policy.markets.join(', ')} · {policy.maxLeverage}x{live && (live.stopLossUsd != null || live.takeProfitUsd != null) ? ` · stop ${live.stopLossUsd != null ? `-${usd(live.stopLossUsd, 2)}` : 'none'}, target ${live.takeProfitUsd != null ? `+${usd(live.takeProfitUsd, 2)}` : 'none'}` : ''}</>}
              action={quoting && <Button size="xs" variant="ghost" disabled={busy} onClick={onStop} title="Cancel the market maker's orders and stop it. Its open positions stay, and Monday stops watching them. Plans keep running.">Stop</Button>}
            />
      <div className="scroll">
      <table className="w-full min-w-[21rem] text-[13px]">
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
            // Only what Monday looks after: the policy's markets and any it is still exiting.
            // A plan's market shows on the plan's card, not here.
            if (!x || plans.some((p) => p.input.sym === s) || !(x.inPolicy || x.position.size !== 0 || x.quotes.bid || x.quotes.ask)) return null;
            const inv = x.position.notionalUsd;
            const q = (side: Side) => {
              const st = quoteStanding(x, side);
              if (!st) return <span className="text-fg-3">{x.reflex?.action === 'pull' && x.reflex.side === side ? 'pulled' : 'none'}</span>;
              return (
                <>
                  <span className={side === 'bid' ? 'text-bid-fg' : 'text-ask-fg'}>{fmtPrice(x.quotes[side]!.price, x.spec)}</span>
                  <span className={cx('block text-[12px] leading-tight', st.good ? 'text-fg-3' : 'text-warn')}>{st.label}</span>
                </>
              );
            };
            return (
              <tr
                key={s} onClick={() => onPick(s)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s); } }}
                className={cx('h-[34px] cursor-pointer border-t border-line align-middle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', s === sym ? 'bg-raised' : 'hover:bg-raised')}
              >
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
                  <span className={cx('block text-[12px]', x.markout1mBps == null ? 'text-fg-3' : x.markout1mBps >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>{x.markout1mBps == null ? '-' : `${fmtBps(x.markout1mBps)} bps`}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
            {m && mk && (
              <p className="border-t border-line px-2.5 py-1.5 text-[12px] leading-snug text-fg-2" role="status">
                <span className="font-semibold text-fg">{mk}</span> {m.why || (quoting ? 'Placing quotes.' : 'Not quoting.')}
              </p>
            )}
          </article>
        )}
        {plans.map((p) => <PlanCard key={p.id} p={p} spec={specs[p.input.sym]} sim={state.sim || state.paper} actions={actions} onPick={onPick} />)}
      </div>

      {count === 0 && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[13px] text-fg-3">
          <span>{state.closing ? 'Closing: waiting for Perpl to confirm.' : 'Nothing is trading. Pick a mode in Setup: the market maker, Agentic Trade or TWAP.'}</span>
          {!state.closing && <ButtonLink href="/app/setup" size="xs" variant="ghost">Setup</ButtonLink>}
        </div>
      )}
    </section>
  );
}

/** The top of a running card: what it is and its state, its own PnL, then its settings and its one control. */
function CardHead({ kind, status, pnl, detail, action }: { kind: ReactNode; status: ReactNode; pnl: number | null; detail: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-raised px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">{kind}{status}</span>
        <span className={cx('num text-[15px] font-semibold', pnl == null ? 'text-fg-3' : tone(pnl))}>{pnl == null ? '-' : fmtSigned(pnl)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-fg-2">{detail}</span>
        {action}
      </div>
    </div>
  );
}

/** One running Agentic Trade or TWAP: what it is, where it stands, and its control. */
function PlanCard({ p, spec, sim, actions, onPick }: { p: PlanView; spec?: MarketSpec; sim: boolean; actions: ReturnType<typeof usePlanActions>; onPick: (s: MarketSym) => void }) {
  const long = p.input.bias === 'long';
  const sc = p.scalp;
  const venue = sim ? 'the exchange' : 'Perpl';
  const price = (x: number | null) => (x == null ? 'none' : fmtPrice(x, spec));
  const pct = p.targetSize ? Math.round((p.filledSize / p.targetSize) * 100) : 0;
  const progress = sc
    ? `${sc.scalps} scalp${sc.scalps === 1 ? '' : 's'}${sc.scalps ? `, ${sc.wins} won` : ''}`
    : p.twap
      ? `${pct}% filled · slice ${p.twap.slicesDone}/${p.twap.slices}`
      : `${pct}% filled`;
  const cells: [string, ReactNode, string?][] = [
    ['Avg Entry', p.avgEntry == null ? 'none yet' : price(p.avgEntry)],
    ['Stop Loss', price(p.slPrice), p.stopOnVenue ? `Rests on ${venue}` : undefined],
    ['Take Profit', price(p.tpPrice), p.takeOnVenue ? `Rests on ${venue}` : undefined],
  ];
  const status = p.status === 'open' ? 'Open' : p.status === 'entering' ? 'Entering' : 'Waiting';
  return (
    <article className="overflow-hidden rounded-sm border border-line-2">
      <CardHead
        kind={KIND_LABEL[p.input.kind]}
        status={<Tag tone={p.status === 'open' ? 'bid' : p.status === 'entering' ? 'accent' : 'neutral'}>{status}</Tag>}
        pnl={sc || p.filledSize > 0 ? planPnl(p) : null}
        detail={<>
          <SymButton sym={p.input.sym} onPick={onPick} className="font-semibold text-fg" />{' '}
          <span className={long ? 'text-bid-fg' : 'text-ask-fg'}>{long ? 'Long' : 'Short'}</span> · {p.input.leverage}x{p.input.kind === 'twap' ? ` · ${STYLE_LABEL[p.input.style].toLowerCase()}` : sc ? ` · ${p.input.frame}` : ''}
        </>}
        action={<PlanButton p={p} actions={actions} />}
      />
      <div className="num px-2.5 pt-1.5 text-[12px]">
        <div className="flex items-baseline justify-between gap-2"><span className="text-fg-3">Progress</span><span className="text-fg">{progress}</span></div>
        {!sc && <span className="mt-1 block h-1 overflow-hidden rounded-[1px] bg-raised-2" aria-hidden><span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} /></span>}
      </div>
      <dl className="num grid grid-cols-3 gap-x-3 px-2.5 py-1.5 text-[12px]">
        {cells.map(([k, v, t]) => (
          <div key={k} className="min-w-0" title={t}>
            <dt className="text-fg-3">{k}</dt>
            <dd className="truncate text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      {p.note && <p className="border-t border-line px-2.5 py-1.5 text-[12px] leading-snug text-fg-2" role="status">{p.note}</p>}
    </article>
  );
}
