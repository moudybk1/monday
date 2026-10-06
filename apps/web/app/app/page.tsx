'use client';

import { PauseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { usd, type DashboardState, type KillReason, type MarketState, type MarketSym } from '@monday/core';
import { OrderBook } from '@/components/book';
import { Diverging, LineChart } from '@/components/charts';
import { FlowBars, SmartTape } from '@/components/smart-money';
import { DecisionLog } from '@/components/timeline';
import { Button, Notice, Panel, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtBps, fmtPrice, fmtSigned, fmtSize, fmtTime, fmtUsd } from '@/lib/format';
import { useLive } from '@/lib/live';
import { useAppConfig } from '@/lib/wallet';

// Layout follows the convention every live terminal shares: market strip on top, chart largest and
// left, book beside it, the ticket column on the right (here it is the agent, since Monday trades
// for you), a tabbed log under the chart, a status bar at the foot. The page does not scroll on
// desktop; each panel scrolls inside itself.

const KILL_WHY: Record<KillReason, string> = {
  manual: 'You pressed the kill switch.',
  loss_limit: 'The daily loss limit was reached.',
  stale_data: 'Perpl market data stopped for more than 30 seconds.',
  order_failures: 'Three orders failed in a row.',
  key_error: 'Perpl rejected the API key.',
};
const STATUS = { quoting: 'Quoting', paused: 'Paused', killed: 'Killed', idle: 'Not started' } as const;

export default function Terminal() {
  const qc = useQueryClient();
  // If the server drops this session's runner, re-check who we are; the shell then routes to onboarding.
  const { state, connected } = useLive('auth', () => void qc.invalidateQueries({ queryKey: ['me'] }));
  const cfg = useAppConfig().data;
  const [picked, setPicked] = useState<MarketSym>('BTC');
  const [tab, setTab] = useState<'decisions' | 'fills' | 'equity'>('decisions');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const killDialog = useRef<HTMLDialogElement>(null);

  if (!state) return <Loading />;
  const sym = state.policy.markets.includes(picked) ? picked : state.policy.markets[0];
  const m = state.markets[sym];
  const now = state.at;

  const act = async (path: string, body?: unknown) => {
    setBusy(path);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  };

  const quoting = state.status === 'quoting';
  const stale = m && m.dataAgeMs > 5_000;
  const warning = state.alerts.find((a) => a.severity !== 'info' && now - a.at < 5 * 60_000);

  return (
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-2.75rem)]">
      {/* Market strip */}
      <div className="panel flex-none flex-row flex-wrap items-stretch">
        <div role="tablist" aria-label="Market" className="flex">
          {state.policy.markets.map((s) => {
            const x = state.markets[s];
            return (
              <button key={s} role="tab" aria-selected={s === sym} onClick={() => setPicked(s)} className={cx('flex h-[50px] min-w-[7.25rem] flex-col justify-center gap-0.5 border-r border-line px-3 text-left', s === sym ? 'bg-raised shadow-[inset_0_-2px_0_var(--accent)]' : 'hover:bg-raised')}>
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  {s}<span className="font-normal text-fg-3">perp</span>
                  {quoting && x?.reflex && <span className="size-1.5 rounded-full bg-ask" title={`${x.reflex.side} ${x.reflex.action === 'pull' ? 'pulled' : 'widened'}`} />}
                </span>
                <span className="num text-[12px] text-fg-2">{x ? fmtPrice(x.mark, x.spec) : 'no data'}</span>
              </button>
            );
          })}
        </div>
        {m && (
          <dl className="hidden items-center md:flex">
            <Stat k="Mark" v={fmtPrice(m.mark, m.spec)} />
            <Stat k="Oracle" v={fmtPrice(m.oracle, m.spec)} />
            <Stat k="Funding" v={`${(m.fundingRate * 100).toFixed(4)}%`} />
            <Stat k="Vol 1m" v={`${m.sigma1mBps.toFixed(1)} bps`} />
            <Stat k="Signal" v={m.signal ? m.signal.S.toFixed(2) : 'none'} tone={m.signal && Math.abs(m.signal.S) >= 2.5 ? 'accent' : undefined} />
            <Stat k="Regime" v={quoting ? m.params.regime : 'off'} tone={quoting && m.params.regime === 'storm' ? 'accent' : undefined} />
          </dl>
        )}
        <div className="ml-auto flex items-center gap-2 px-2.5 py-2">
          <span className="mr-1 flex items-center gap-1.5 text-[12px] font-medium">
            {/* The one status dot: it reflects real agent state. */}
            <span aria-hidden className={cx('size-1.5 rounded-full', quoting ? 'live-dot bg-bid' : state.status === 'killed' ? 'bg-ask' : 'bg-fg-3')} />
            {STATUS[state.status]}
          </span>
          {quoting ? (
            <Button size="sm" variant="ghost" onClick={() => act('/agent/pause')} disabled={busy !== null}><PauseIcon size={12} weight="fill" /> Pause</Button>
          ) : (
            <Button size="sm" onClick={() => act('/agent/start')} disabled={busy !== null}><PlayIcon size={12} weight="fill" /> {state.status === 'idle' ? 'Start' : 'Resume'}</Button>
          )}
          <Button size="sm" variant="danger" onClick={() => killDialog.current?.showModal()} disabled={busy !== null || state.status === 'killed'}><StopIcon size={12} weight="fill" /> Kill and flatten</Button>
        </div>
      </div>

      <div className="grid flex-none gap-1 empty:hidden">
        {error && <Notice tone="warn">{error}</Notice>}
        {state.status === 'killed' && (
          <Notice tone="ask" action={<Button size="xs" variant="ghost" className="border-white/70 text-white hover:bg-white/15" onClick={() => act('/agent/start')}>Review done, restart</Button>}>
            <strong>Killed.</strong> {state.killReason ? KILL_WHY[state.killReason] : ''} All orders were cancelled and positions closed.
            {state.killReason === 'key_error' && <> <Link href="/app/onboarding" className="underline">Add a new key</Link>.</>}
          </Notice>
        )}
        {state.status === 'paused' && <Notice>Paused. Monday&apos;s orders are cancelled and any open position is kept.</Notice>}
        {state.status === 'idle' && <Notice>Monday is not running. Press Start to begin quoting under your policy.</Notice>}
        {quoting && stale && <Notice tone="warn">Perpl data delayed, quotes paused. Monday resumes on its own when data returns.</Notice>}
        {/* The newest warning from the agent itself: loss-limit approach, rate limits, blocked orders, disconnects. */}
        {warning && state.status !== 'killed' && <Notice tone="warn"><span className="num mr-2">{fmtTime(warning.at)}</span>{warning.message}</Notice>}
        {!connected && <Notice tone="warn">Live connection lost. Reconnecting.</Notice>}
      </div>

      {m ? (
        <div className="grid min-h-0 flex-1 gap-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_292px_344px]">
          <div className="flex min-h-0 flex-col gap-1 md:col-span-2 xl:col-span-1">
            <Panel title={<>{sym} perp <span className="font-normal text-fg-3">mark price and Monday&apos;s quotes</span></>} aside={<span>20 min</span>} className="h-[300px] flex-none xl:h-auto xl:flex-[3]" bodyClassName="p-1.5">
              <LineChart
                label={`${sym} mark price with Monday's bid and ask`} format={(v) => fmtPrice(v, m.spec)} empty="Collecting prices"
                series={[
                  { name: 'Mark', tone: 'fg', points: m.priceSeries.map((p) => ({ t: p.t, v: p.p })) },
                  { name: 'Ask', tone: 'ask', step: true, points: m.priceSeries.map((p) => ({ t: p.t, v: p.ask })) },
                  { name: 'Bid', tone: 'bid', step: true, points: m.priceSeries.map((p) => ({ t: p.t, v: p.bid })) },
                ]}
              />
            </Panel>

            <section className="panel h-[380px] flex-none xl:h-auto xl:flex-[2]">
              <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
                <div role="tablist" aria-label="Log" className="flex h-full">
                  {([['decisions', 'Decisions', state.decisions.length], ['fills', 'Fills', state.fills.length], ['equity', 'Equity', null]] as const).map(([id, label, n]) => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('flex items-center gap-1.5 px-3 text-[12px]', tab === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                      {label}{n != null && <span className="num text-[10.5px] font-normal text-fg-3">{n}</span>}
                    </button>
                  ))}
                </div>
                <span className="text-[11.5px] text-fg-3">
                  {tab === 'decisions' ? (state.health.chain ? 'every decision is hashed and logged on Monad' : 'hashed; on-chain log is off')
                    : tab === 'fills' ? 'markout: price move after the fill, positive is good' : `since ${state.equity[0] ? fmtTime(state.equity[0].t, false) : 'start'}`}
                </span>
              </header>
              <div className={cx('scroll min-h-0 flex-1', tab === 'equity' && 'p-1.5')}>
                {tab === 'decisions' && <DecisionLog decisions={state.decisions} explorerUrl={cfg?.explorerUrl} chainOn={state.health.chain} />}
                {tab === 'fills' && <Fills state={state} />}
                {tab === 'equity' && (
                  <LineChart
                    label="Account equity over time" format={(v) => fmtUsd(v)} empty="Equity appears after the first few seconds of running"
                    baseline={{ v: state.account.equityUsd - state.pnl.todayUsd, label: 'start of day' }}
                    series={[{ name: 'Equity', tone: 'fg', points: state.equity.map((p) => ({ t: p.t, v: p.v })) }]}
                  />
                )}
              </div>
            </section>
          </div>

          <div className="flex min-h-0 flex-col gap-1">
            <Panel title="Order book" aside={<span>Perpl</span>} className="flex-none" bodyClassName="!overflow-visible">
              <OrderBook m={m} rows={10} now={now} />
            </Panel>
            <Panel title="Why the quotes sit here" className="xl:min-h-0 xl:flex-1">
              <Model m={m} quoting={quoting} quoteSizeUsd={state.policy.quoteSizeUsd} />
            </Panel>
          </div>

          <div className="flex min-h-0 flex-col gap-1">
            <Agent state={state} sym={sym} onPick={setPicked} />
            <Panel
              title={<>Smart money <span className="font-normal text-fg-3">on Hyperliquid</span></>}
              className="h-[420px] flex-none xl:h-auto xl:min-h-0 xl:flex-1"
              bodyClassName="flex flex-col !overflow-hidden"
              aside={cfg?.sim ? (
                <>
                  <Button size="xs" variant="ghost" title="Simulate a smart-money buying burst" onClick={() => act('/sim/burst', { market: sym, direction: 'buy' })}>Buy burst</Button>
                  <Button size="xs" variant="ghost" title="Simulate a smart-money selling burst" onClick={() => act('/sim/burst', { market: sym, direction: 'sell' })}>Sell burst</Button>
                </>
              ) : <span>Nansen</span>}
            >
              <div className="flex-none border-b border-line"><FlowBars m={m} /></div>
              <div className="scroll min-h-0 flex-1"><SmartTape m={m} now={now} /></div>
            </Panel>
          </div>
        </div>
      ) : (
        <p className="panel flex-1 items-center justify-center py-16 text-fg-3">Waiting for market data.</p>
      )}

      <StatusBar state={state} sim={Boolean(cfg?.sim)} connected={connected} />

      <dialog ref={killDialog} className="m-auto w-[min(92vw,26rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg">
        <h2 className="text-[17px] font-semibold tracking-tight">Kill and flatten?</h2>
        <p className="mt-2 text-[13px] text-fg-2">
          Monday cancels every order, then closes all positions with reduce-only market orders. Closing at market can cost some slippage. The agent stays stopped until you restart it.
        </p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <Button type="submit" variant="ghost">Keep running</Button>
          <Button type="submit" variant="danger" onClick={() => void act('/agent/kill')}>Kill and flatten</Button>
        </form>
      </dialog>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'accent' }) {
  return (
    <div className="flex h-[50px] flex-col justify-center gap-1.5 border-r border-line px-3">
      <dt className="label">{k}</dt>
      <dd className={cx('num text-[12px] leading-none', tone === 'accent' ? 'text-accent' : 'text-fg')}>{v}</dd>
    </div>
  );
}

/** The column where a manual terminal has its order ticket. Monday trades for you, so this is the agent. */
function Agent({ state, sym, onPick }: { state: DashboardState; sym: MarketSym; onPick: (s: MarketSym) => void }) {
  const { pnl, policy } = state;
  const tone = (n: number) => (n > 0.004 ? 'text-bid-fg' : n < -0.004 ? 'text-ask-fg' : 'text-fg');
  const cell = 'bg-canvas px-2.5 py-2';
  return (
    <Panel
      title="Agent" className="flex-none" bodyClassName="!overflow-visible"
      aside={<Tag tone={state.status === 'quoting' ? 'bid' : state.status === 'killed' ? 'ask' : 'neutral'}>{STATUS[state.status]}</Tag>}
    >
      <dl className="grid grid-cols-2 gap-px bg-line">
        <div className={cell}>
          <dt className="label">Equity</dt>
          <dd className="num mt-1.5 text-[19px] font-medium leading-none tracking-tight">{fmtUsd(state.account.equityUsd)}</dd>
          <dd className="num mt-1.5 text-[11px] text-fg-3">acct {state.account.id || 'none'}</dd>
        </div>
        <div className={cell}>
          <dt className="label">Today</dt>
          <dd className={cx('num mt-1.5 text-[19px] font-medium leading-none tracking-tight', tone(pnl.todayUsd))}>{fmtSigned(pnl.todayUsd)}</dd>
          <dd className="num mt-1.5 text-[11px] text-fg-3">fees {fmtUsd(pnl.feesUsd, 3)}</dd>
        </div>
        <div className={cell}>
          <dt className="label">Realised / open</dt>
          <dd className="num mt-1.5 text-[12px]"><span className={tone(pnl.realizedUsd)}>{fmtSigned(pnl.realizedUsd)}</span> <span className="text-fg-3">/</span> <span className={tone(pnl.unrealizedUsd)}>{fmtSigned(pnl.unrealizedUsd)}</span></dd>
        </div>
        <div className={cell}>
          <dt className="label">Daily loss limit</dt>
          <dd className={cx('num mt-1.5 text-[12px]', pnl.lossLimitUsedPct >= 70 ? 'text-ask-fg' : 'text-fg')}>{Math.round(pnl.lossLimitUsedPct)}% <span className="text-fg-3">of {usd(policy.maxDailyLossUsd)}</span></dd>
        </div>
      </dl>
      <table className="w-full border-t border-line text-[11.5px]">
        <thead>
          <tr className="label h-6 text-left [&>th]:font-normal">
            <th className="pl-2.5">Mkt</th><th>Inventory</th><th className="text-right">Open PnL</th><th className="text-right">Bid</th><th className="pr-2.5 text-right">Ask</th>
          </tr>
        </thead>
        <tbody className="num">
          {policy.markets.map((s) => {
            const x = state.markets[s];
            if (!x) return null;
            const inv = x.position.notionalUsd;
            const q = (side: 'bid' | 'ask') => (x.quotes[side] ? fmtPrice(x.quotes[side]!.price, x.spec) : x.reflex?.action === 'pull' && x.reflex.side === side ? 'pulled' : 'none');
            return (
              <tr key={s} onClick={() => onPick(s)} className={cx('h-[26px] cursor-pointer border-t border-line', s === sym ? 'bg-raised' : 'hover:bg-raised')}>
                <td className="pl-2.5 font-sans font-semibold">{s}</td>
                <td>
                  <span className={cx('inline-block w-[4.5rem]', tone(inv))}>{Math.abs(inv) < 0.5 ? 'flat' : `${inv > 0 ? '+' : '-'}${fmtUsd(Math.abs(inv), 0)}`}</span>
                  <Diverging value={inv / policy.maxInventoryUsd} className="inline-block w-10 align-middle" />
                </td>
                <td className={cx('text-right', tone(x.position.unrealizedUsd))}>{fmtSigned(x.position.unrealizedUsd)}</td>
                <td className={cx('text-right', x.quotes.bid ? 'text-bid-fg' : 'text-fg-3')}>{q('bid')}</td>
                <td className={cx('pr-2.5 text-right', x.quotes.ask ? 'text-ask-fg' : 'text-fg-3')}>{q('ask')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-2.5 py-1.5 text-[11px] text-fg-3">Inventory limit {usd(policy.maxInventoryUsd)} each way per market. {usd(policy.quoteSizeUsd)} quoted per side.</p>
    </Panel>
  );
}

function Model({ m, quoting, quoteSizeUsd }: { m: MarketState; quoting: boolean; quoteSizeUsd: number }) {
  if (!quoting || !m.model) return <p className="px-2.5 py-3 text-[12px] text-fg-3">Monday is not quoting, so there is nothing to explain yet.</p>;
  const g = m.params;
  const rows: [string, string, string][] = [
    ['Fair price', fmtPrice(m.model.ref, m.spec), 'Perpl mark, or the book mid when it agrees'],
    ['Half-spread', `${m.model.halfBps.toFixed(2)} bps`, `volatility ${m.sigma1mBps.toFixed(1)} bps/min, widened ${g.spread_mult}x`],
    ['Inventory skew', `${fmtBps(m.model.skewInvBps, 2)} bps`, m.model.q === 0 ? 'flat, no skew' : `leans to shed the ${m.model.q > 0 ? 'long' : 'short'}`],
    ['Smart-money skew', `${fmtBps(m.model.skewNanBps + g.skew_bias_bps, 2)} bps`, m.model.skewNanBps === 0 && g.skew_bias_bps === 0 ? 'off or neutral' : 'leans with the flow'],
    ['Quote size', `${Math.round(g.size_mult * 100)}%`, `of your ${usd(quoteSizeUsd)} per side`],
  ];
  return (
    <dl className="text-[12px]">
      {rows.map(([k, v, note]) => (
        <div key={k} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-2.5 py-1.5">
          <dt className="text-fg-2">{k}</dt>
          <dd className="num text-right text-fg">{v}</dd>
          <dd className="col-span-2 text-[11px] leading-tight text-fg-3">{note}</dd>
        </div>
      ))}
      <p className="px-2.5 py-1.5 text-[11px] text-fg-3">Set by the {m.paramsSource === 'governor' ? 'LLM governor' : 'rule-based governor'}, clamped to your policy.</p>
    </dl>
  );
}

function Fills({ state }: { state: DashboardState }) {
  if (state.fills.length === 0) return <p className="px-2.5 py-4 text-[12px] text-fg-3">No fills yet. A fill appears when a taker trades against one of Monday&apos;s quotes.</p>;
  const mk = (v: number | null) => (v == null ? <span className="text-fg-3">wait</span> : <span className={v >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{fmtBps(v)}</span>);
  return (
    <table className="w-full min-w-[560px] text-[11.5px]">
      <thead>
        <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
          <th className="pl-2.5">Time</th><th>Mkt</th><th>Side</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Fee</th><th className="pl-4">Regime</th><th className="text-right">1m bps</th><th className="pr-2.5 text-right">5m bps</th>
        </tr>
      </thead>
      <tbody className="num">
        {state.fills.map((f) => {
          const spec = state.markets[f.sym]?.spec;
          return (
            <tr key={f.id} className="h-[21px] border-t border-line">
              <td className="pl-2.5 text-fg-3">{fmtTime(f.ts)}</td>
              <td className="font-sans font-medium">{f.sym}</td>
              <td className={f.side === 'bid' ? 'text-bid-fg' : 'text-ask-fg'}>{f.side === 'bid' ? 'buy' : 'sell'}{!f.isMaker && ' (exit)'}</td>
              <td className="text-right">{fmtPrice(f.price, spec)}</td>
              <td className="text-right">{fmtSize(f.size, spec)}</td>
              <td className="text-right text-fg-2">{fmtUsd(f.feeUsd, 4)}</td>
              <td className="pl-4 text-fg-2">{f.regime}</td>
              <td className="text-right">{f.isMaker ? mk(f.markout1mBps) : ''}</td>
              <td className="pr-2.5 text-right">{f.isMaker ? mk(f.markout5mBps) : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Foot of every terminal: is the feed alive, and how old is what I am looking at. */
function StatusBar({ state, sim, connected }: { state: DashboardState; sim: boolean; connected: boolean }) {
  const h = state.health;
  const items: [string, string, boolean?][] = [
    ['Venue', sim ? 'simulated' : h.venueConnected ? 'Perpl' : 'Perpl down', !sim && !h.venueConnected],
    ['Data', `${(h.marketDataAgeMs / 1000).toFixed(1)}s`, h.marketDataAgeMs > 5_000],
    ['Signal', h.signalAgeMs < 0 ? 'none' : `${Math.round(h.signalAgeMs / 1000)}s`, h.signalAgeMs < 0 || h.signalAgeMs > 15 * 60_000],
    ['Budget', `${h.budgetRemaining}/${h.budgetPerMin}`, h.budgetRemaining < 8],
    ['Governor', h.llm ? (h.llmFailing ? 'rules, LLM failing' : 'LLM + rules') : 'rules', h.llmFailing],
    ['Chain log', h.chain ? 'on' : 'off'],
  ];
  return (
    <footer className="panel num h-[26px] flex-none flex-row items-center gap-x-4 overflow-x-auto px-2.5 text-[10.5px] uppercase tracking-[0.05em] text-fg-3">
      <span className={cx('flex flex-none items-center gap-1.5', connected ? 'text-bid-fg' : 'text-warn')}>
        <span aria-hidden className={cx('size-1.5 rounded-full', connected ? 'bg-bid' : 'bg-warn')} />
        {connected ? 'Live' : 'Reconnecting'}
      </span>
      {items.map(([k, v, bad]) => (
        <span key={k} className="flex-none whitespace-nowrap">{k} <span className={bad ? 'text-warn' : 'text-fg-2'}>{v}</span></span>
      ))}
      <span className="ml-auto flex-none whitespace-nowrap">{new Date(state.at).toISOString().slice(11, 19)} UTC</span>
    </footer>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-2.75rem)]">
      <Skeleton className="h-[52px] flex-none" />
      <div className="grid min-h-[60vh] flex-1 gap-1 xl:grid-cols-[minmax(0,1fr)_292px_344px]">
        <Skeleton />
        <Skeleton className="hidden xl:block" />
        <Skeleton className="hidden xl:block" />
      </div>
    </div>
  );
}
