'use client';

import { CaretDownIcon, QuestionIcon, SidebarSimpleIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MARKETS, groupSteps, usdCompact, type DashboardState, type KillReason, type MarketState, type MarketSym } from '@monday/core';
import { AgentConsole, HideAgentButton, terminalStatus } from '@/components/agent';
import { Fills, Model, OpenOrders, Positions } from '@/components/blotter';
import { OrderBook } from '@/components/book';
import { LineChart } from '@/components/charts';
import { Guide } from '@/components/guide';
import { draftFrom, toBody } from '@/components/policy-form';
import { MakerRow, PlanList, planLevels } from '@/components/plans';
import { PriceChart } from '@/components/price-chart';
import { FlowBars, SmartTape } from '@/components/smart-money';
import { Tape } from '@/components/tape';
import { DecisionLog } from '@/components/timeline';
import { Button, ButtonLink, CoinIcon, Notice, Panel, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtPrice, fmtTime, fmtUsd } from '@/lib/format';
import { useLive } from '@/lib/live';
import { useAppConfig, useMe, useRegistry, type PolicyView } from '@/lib/wallet';

// The layout every live terminal shares, measured on Hyperliquid: a market strip on top, the chart largest
// and left, the book and the tape beside it, the ticket column on the right (here the agent, since Monday trades for
// you), the blotter under the chart, a status bar at the foot. The page does not scroll on desktop; each panel does.

const KILL_WHY: Record<KillReason, string> = {
  manual: 'You pressed the kill switch.',
  loss_limit: 'The stop loss was reached for the day.',
  stale_data: 'Perpl market data stopped for more than 30 seconds.',
  order_failures: 'Three orders failed in a row.',
  key_error: 'Perpl rejected the API key.',
  session_loss: 'The session stop loss was reached.',
  margin: 'Equity fell below the margin this policy needs at its leverage.',
};

type Tab = 'orders' | 'positions' | 'plans' | 'fills' | 'decisions' | 'equity' | 'model';

export default function Terminal() {
  const qc = useQueryClient();
  // If the server drops this session's runner, re-check who we are; the shell then routes to onboarding.
  const me = useMe();
  const { state, connected } = useLive('auth', () => void qc.invalidateQueries({ queryKey: ['me'] }), me.data?.wallet);
  const cfg = useAppConfig().data;
  const registry = useRegistry();
  const [picked, setPicked] = useState<MarketSym>('BTC');
  const [tab, setTab] = useState<Tab>('orders');
  // History holds what is over: fills, and the Agentic Trade and TWAP plans that ended.
  const [past, setPast] = useState<'fills' | 'plans'>('fills');
  const [side, setSide] = useState<'book' | 'trades'>('book');
  const [group, setGroup] = useState(0); // index into groupSteps: 0 is the tick
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const killDialog = useRef<HTMLDialogElement>(null);
  const blotter = useRef<HTMLElement>(null);
  const guide = useRef<HTMLDialogElement>(null);
  const chartArea = useRef<HTMLDivElement>(null);
  const ready = Boolean(state);
  // Arriving from a plan's setup: its market, on the Plans tab.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const m = q.get('m');
    if (m && (MARKETS as readonly string[]).includes(m)) setPicked(m as MarketSym);
    if (q.get('tab') === 'plans') setTab('plans');
  }, []);
  // First visit: open the guide once. Storage can be blocked; then it simply does not auto-open.
  useEffect(() => {
    if (!ready) return;
    try {
      if (localStorage.getItem('monday.guide.seen')) return;
      localStorage.setItem('monday.guide.seen', '1');
    } catch {
      return;
    }
    guide.current?.showModal();
  }, [ready]);
  // Desktop only: the agent column can fold away so the chart and blotter take its width. Remembered per browser.
  const [agentHidden, setAgentHidden] = useState(false);
  useEffect(() => {
    try {
      setAgentHidden(localStorage.getItem('monday.agent.hidden') === '1');
    } catch {}
  }, []);
  const toggleAgent = () => {
    setAgentHidden(!agentHidden);
    try {
      localStorage.setItem('monday.agent.hidden', agentHidden ? '' : '1');
    } catch {}
  };

  if (!state) return <Loading />;
  // Every market Perpl lists; the policy's are the ones Monday trades.
  const shown = Object.keys(state.markets) as MarketSym[];
  const sym = shown.includes(picked) ? picked : state.policy.markets[0] ?? shown[0];
  const m = state.markets[sym];
  const now = state.at;
  const trading = state.policy.markets.includes(sym);

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
  // Same save as the policy page: presets refit to the new market count, and a registry asks the wallet to sign.
  const toggleMarket = async () => {
    const markets = trading ? state.policy.markets.filter((s) => s !== sym) : [...state.policy.markets, sym];
    setBusy('policy');
    setError(null);
    try {
      const res = await api<PolicyView>('/policy', { method: 'PUT', body: toBody({ ...draftFrom(state.policy), markets }) });
      if (res.pending?.onchain) await registry.publish(res.pending.onchain, () => {});
      await qc.invalidateQueries({ queryKey: ['policy'] });
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Could not change markets.');
    } finally {
      setBusy(null);
    }
  };

  const quoting = state.status === 'quoting';
  const showPlans = () => {
    setTab('plans');
    blotter.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // on a phone the blotter sits below
  };
  const openPositions = shown.filter((s) => Math.abs(state.markets[s]?.position.notionalUsd ?? 0) >= 0.5).length;
  const running = state.plans.filter((p) => p.status !== 'done');
  const ended = state.plans.filter((p) => p.status === 'done');
  const status = terminalStatus(state);
  // A market picked from a table: its chart and book, its URL (?m=) so a reload keeps it, and the chart in view on a phone.
  const pick = (s: MarketSym) => {
    setPicked(s);
    const q = new URLSearchParams(location.search);
    q.set('m', s);
    history.replaceState(null, '', `?${q}`);
    const top = chartArea.current?.getBoundingClientRect().top;
    if (top != null && (top < 0 || top > innerHeight / 2)) chartArea.current!.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const planMarkets = running.map((p) => p.input.sym);
  const openOrders = shown.reduce((n, s) => n + (state.markets[s]?.quotes.bid ? 1 : 0) + (state.markets[s]?.quotes.ask ? 1 : 0), 0);
  const stale = m && m.dataAgeMs > 5_000;
  const warning = state.alerts.find((a) => a.severity !== 'info' && now - a.at < 5 * 60_000);
  const TABS: [Tab, string, number | null][] = [
    ['orders', 'Open Orders', openOrders], ['positions', 'Positions', openPositions], ['plans', 'Plans', running.length + (quoting ? 1 : 0)], ['fills', 'History', state.fills.length + ended.length],
    ['decisions', 'Decisions', state.decisions.length], ['equity', 'Equity', null], ['model', 'Quote Model', null],
  ];

  return (
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-3.5rem)]">
      {/* Market strip */}
      {/* Visible overflow so the market picker can drop below the strip. */}
      <div className="panel flex-none flex-row flex-wrap items-stretch overflow-visible">
        <MarketPicker state={state} sym={sym} onPick={pick} />
        {m && <Ticker m={m} />}
        {m && <Stats m={m} />}
        <div className="order-3 ml-auto flex items-center gap-2 px-2.5 py-2 xl:order-4">
          {/* The last market cannot be dropped: a policy always trades one. Stop ends trading altogether. */}
          {state.policy.markets.length > 0 && !(trading && state.policy.markets.length === 1) && (
            <Button
              size="sm" variant={trading ? 'ghost' : 'primary'} onClick={() => void toggleMarket()} disabled={busy !== null}
              title={trading ? `Stop quoting ${sym}. Monday cancels its ${sym} orders and works any open position out.` : `Add ${sym} to your policy. ${quoting ? 'Monday starts quoting it on the next tick.' : 'Monday quotes it once you start.'}`}
            >
              {busy === 'policy' ? 'Saving' : trading ? `Stop ${sym}` : `Trade ${sym}`}
            </Button>
          )}
          <Button size="sm" variant="quiet" onClick={() => guide.current?.showModal()}><QuestionIcon size={12} weight="bold" /> <span className="max-[1399px]:sr-only">Guide</span></Button>
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            {/* The one status dot: it reflects real agent state. */}
            <span aria-hidden className={cx('size-1.5 rounded-full', status.live ? 'live-dot bg-bid' : state.status === 'killed' ? 'bg-ask' : 'bg-fg-3')} />
            {/* Phones show the status in the Agent panel right below; here it keeps only the dot. */}
            <span className="max-md:sr-only">{status.text}</span>
          </span>
        </div>
      </div>

      <div className="grid flex-none gap-1 empty:hidden">
        {error && <Notice tone="warn">{error}</Notice>}
        {/* A kill the user pressed needs no notice, nor one a plan has moved on from; one Monday made, or one still closing, does. */}
        {state.status === 'killed' && (state.closing || (state.killReason !== 'manual' && !running.length)) && (
          // A kill ends everything: trading again starts from Setup, in any mode and any market.
          <Notice tone="ask" action={state.closing ? undefined : <ButtonLink href="/app/setup" size="xs" variant="ghost" className="border-white/70 text-white hover:bg-white/15">Setup</ButtonLink>}>
            <strong>{state.closing ? 'Killed, still closing.' : 'Killed.'}</strong> {state.killReason ? KILL_WHY[state.killReason] : ''}{' '}
            {state.closing ? 'Perpl has not confirmed that every order is cancelled and every position closed. Monday retries every 10 seconds, also after a restart. You can close them on Perpl too.' : 'All orders were cancelled and positions closed. To trade again, pick a mode in Setup.'}
            {state.killReason === 'key_error' && <> <Link href="/app/connect" className="underline">Add a new key</Link>.</>}
          </Notice>
        )}
        {state.status === 'paused' && state.closing === 'cancel' && <Notice tone="warn">Stopped, but Perpl has not confirmed the cancels yet. Monday keeps retrying.</Notice>}
        {state.status === 'paused' && state.closing === 'flatten' && <Notice tone="warn">Take profit reached, but Perpl has not confirmed the position is closed. Monday retries every 10 seconds; you can close it on Perpl too.</Notice>}
        {/* Stop means stop: nothing watches a position left open, so say so while one is. */}
        {state.status === 'paused' && !state.closing && Object.values(state.markets).some((x) => x && x.position.size !== 0 && !planMarkets.includes(x.sym)) && (
          <Notice tone="warn" action={<Button size="xs" variant="danger" onClick={() => killDialog.current?.showModal()}>Kill and Flatten</Button>}>Stopped with an open position. Monday is not watching it: no stop loss, per position or for the day. Close it on Perpl or with Kill and Flatten.</Notice>
        )}
        {quoting && stale && <Notice tone="warn">Perpl data delayed, quotes pulled. Monday resumes on its own when data returns.</Notice>}
        {/* The newest warning from the agent itself: loss-limit approach, rate limits, blocked orders, disconnects. */}
        {warning && state.status !== 'killed' && <Notice tone="warn"><span className="num mr-2">{fmtTime(warning.at)}</span>{warning.message}</Notice>}
        {!connected && <Notice tone="warn">Live connection lost. Reconnecting.</Notice>}
      </div>

      {m ? (
        // Phone: agent, chart and blotter, book, Smart Traders (while on). Tablet: agent across the top, then book and Smart
        // Traders side by side. Desktop: three columns, the agent (and Smart Traders under it) in the third.
        // Folding the agent column animates its width and the chart's height together.
        <div className={cx('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-2 xl:grid-rows-[minmax(0,1fr)] xl:transition-[grid-template-columns] xl:duration-300 xl:ease-out-expo', agentHidden ? 'xl:grid-cols-[minmax(0,1fr)_300px_40px]' : 'xl:grid-cols-[minmax(0,1fr)_300px_360px]')}>
          <div ref={chartArea} className="flex min-h-0 flex-col gap-1 md:col-span-2 xl:col-span-1 xl:col-start-1">
            <PriceChart sym={sym} m={m} fills={state.fills} now={now} levels={planLevels(running.find((p) => p.input.sym === sym))} className={cx('h-[360px] flex-none xl:h-auto xl:transition-[flex-grow] xl:duration-300 xl:ease-out-expo', agentHidden ? 'xl:flex-[4]' : 'xl:flex-[3]')} />

            <section ref={blotter} className="panel h-[360px] flex-none xl:h-auto xl:flex-[2]">
              <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
                <div role="tablist" aria-label="Blotter" className="scroll flex h-full overflow-x-auto">
                  {TABS.map(([id, label, n]) => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('flex items-center gap-1.5 whitespace-nowrap px-3 text-[13px]', tab === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                      {label}{n != null && <span className="num text-[12px] font-normal text-fg-3">{n}</span>}
                    </button>
                  ))}
                </div>
                {/* One line, cut short when the tabs need the room: it never wraps into the tab row. */}
                <span className="hidden min-w-0 flex-1 truncate pl-4 text-right text-[13px] text-fg-3 lg:block">
                  {tab === 'orders' ? "the market maker's quotes; a plan's orders show under Plans"
                    : tab === 'positions' ? 'opened by fills; Kill and Flatten closes all'
                    : tab === 'plans' ? `everything that trades; plan stop losses rest on ${state.sim || state.paper ? 'the exchange' : 'Perpl'}`
                    : tab === 'decisions' ? (state.health.chain ? 'every decision is hashed and logged on Monad' : 'hashed; on-chain log is off')
                    : tab === 'fills' ? (past === 'fills' ? "the market maker's fills; markout is the move after, positive is good" : 'Agentic Trade and TWAP that have ended')
                    : tab === 'model' ? `${sym}, this tick` : `since ${state.equity[0] ? fmtTime(state.equity[0].t, false) : 'start'}`}
                </span>
              </header>
              <div className={cx('scroll min-h-0 flex-1', tab === 'equity' && 'p-1.5')}>
                {tab === 'orders' && <OpenOrders state={state} onPick={pick} />}
                {tab === 'positions' && <Positions state={state} onPick={pick} />}
                {tab === 'plans' && (
                  <PlanList
                    plans={running} specs={cfg?.specs ?? {}} sim={state.sim || state.paper} now={now} onError={setError} onPick={pick}
                    maker={quoting ? <MakerRow state={state} busy={busy !== null} onStop={() => void act('/agent/pause')} onKill={() => killDialog.current?.showModal()} onPick={pick} /> : undefined}
                  />
                )}
                {tab === 'fills' && (
                  <>
                    <div role="group" aria-label="History" className="flex gap-1 border-b border-line px-2.5 py-1.5">
                      {(['fills', 'plans'] as const).map((v) => (
                        <button
                          key={v} type="button" aria-pressed={past === v} onClick={() => setPast(v)}
                          className={cx('flex h-6 items-center gap-1.5 rounded-sm px-2 text-[13px]', past === v ? 'bg-raised-2 font-semibold text-fg' : 'text-fg-3 hover:text-fg')}
                        >
                          {v === 'fills' ? 'Maker Fills' : 'Plans'}<span className="num text-[12px] font-normal text-fg-3">{v === 'fills' ? state.fills.length : ended.length}</span>
                        </button>
                      ))}
                    </div>
                    {past === 'fills'
                      ? <Fills state={state} onPick={pick} />
                      : <PlanList plans={ended} specs={cfg?.specs ?? {}} sim={state.sim || state.paper} now={now} onError={setError} onPick={pick} empty="No Agentic Trade or TWAP has ended yet." />}
                  </>
                )}
                {tab === 'decisions' && <DecisionLog decisions={state.decisions} explorerUrl={cfg?.explorerUrl} chainOn={state.health.chain} onPick={pick} />}
                {tab === 'model' && <Model m={m} quoting={quoting} policy={state.policy} />}
                {tab === 'equity' && (
                  <LineChart
                    drawKey="equity" // a new point lands every 10 s: without a fixed key the line would redraw itself each time
                    label="Account equity over time" format={(v) => fmtUsd(v)} empty="Equity appears after the first few seconds of running"
                    baseline={{ v: state.account.equityUsd - state.pnl.todayUsd, label: 'Start of Day' }}
                    series={[{ name: 'Equity', tone: 'fg', points: state.equity.map((p) => ({ t: p.t, v: p.v })) }]}
                  />
                )}
              </div>
            </section>
          </div>

          {/* Book and tape share one panel, as on every exchange. */}
          <section className="panel h-[420px] flex-none md:h-[520px] xl:col-start-2 xl:h-auto xl:min-h-0">
            <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
              <div role="tablist" aria-label="Book or trades" className="flex h-full">
                {(['book', 'trades'] as const).map((id) => (
                  <button key={id} role="tab" aria-selected={side === id} onClick={() => setSide(id)} className={cx('px-3 text-[13px] capitalize', side === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                    {id === 'book' ? 'Order Book' : 'Trades'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {/* Price grouping: the market's tick and 10x, 100x, 1000x it. The step's position carries over between markets. */}
                {side === 'book' && (
                  <select
                    value={group} onChange={(e) => setGroup(Number(e.target.value))} aria-label="Group prices by" title="Group the book's prices into wider steps"
                    className="num h-6 cursor-pointer rounded-sm border border-line-2 bg-raised px-1 text-[12px] text-fg hover:border-fg-3"
                  >
                    {groupSteps(m.spec.priceTick).map((s, i) => <option key={s} value={i}>{s.toLocaleString('en-US', { maximumFractionDigits: 10 })}</option>)}
                  </select>
                )}
                <span className="text-[13px] text-fg-3">Perpl</span>
              </div>
            </header>
            <div className="scroll min-h-0 flex-1">
              {side === 'book' ? <OrderBook m={m} rows={12} now={now} ownOnBook={!state.sim && !state.paper} step={groupSteps(m.spec.priceTick)[group]} /> : <Tape m={m} limit={40} />}
            </div>
          </section>

          {/* Below xl this wrapper steps aside (display: contents) and its panels sit in the grid as before. At xl it is the
              third column, its panels a fixed 360px wide, so folding clips them while they fade instead of squeezing them. */}
          <div className={cx('contents xl:col-start-3 xl:row-start-1 xl:flex xl:min-h-0 xl:flex-col xl:gap-1 xl:overflow-hidden xl:transition-[opacity,visibility] xl:duration-300 xl:ease-out-expo', agentHidden && 'xl:invisible xl:opacity-0')}>
          <div className={cx('order-first md:col-span-2 xl:order-none xl:w-[360px]', m.signal ? 'xl:flex-none' : 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col [&>*]:xl:flex-1')}>
            {state.policy.markets.length ? (
              <AgentConsole
                state={state} sym={sym} onPick={pick} onShowPlans={showPlans} onHide={toggleAgent}
              />
            ) : (
              <NoMaker running={running.length} onKill={() => killDialog.current?.showModal()} onHide={toggleAgent} />
            )}
          </div>
          {/* Only while a Smart Trader source is on (SMART_TRADERS=on, or the simulator): off since 2026-11-16. */}
          {m.signal && <div className="flex min-h-0 flex-col xl:w-[360px] xl:flex-1">
            <Panel
              title="Smart Traders"
              className="h-[360px] flex-none md:h-[520px] xl:h-auto xl:min-h-0 xl:flex-1"
              bodyClassName="flex flex-col !overflow-hidden"
              aside={cfg?.sim ? (
                <>
                  <Button size="xs" variant="ghost" title="Simulate a Smart Trader buying burst" onClick={() => act('/sim/burst', { market: sym, direction: 'buy' })}>Buy Burst</Button>
                  <Button size="xs" variant="ghost" title="Simulate a Smart Trader selling burst" onClick={() => act('/sim/burst', { market: sym, direction: 'sell' })}>Sell Burst</Button>
                </>
              ) : undefined}
            >
              <div className="flex-none border-b border-line"><FlowBars m={m} /></div>
              <div className="scroll min-h-0 flex-1"><SmartTape m={m} now={now} /></div>
            </Panel>
          </div>}
          </div>
          {/* The folded agent column: a rail on the right edge that names it, keeps its status in view and opens it again.
              It shares the column with the panels above and cross-fades with them. */}
          <button
            type="button" onClick={toggleAgent} title="Show the Agent column"
            className={cx('panel hidden cursor-pointer items-center gap-3 py-2.5 text-fg-2 hover:border-accent/60 hover:bg-raised hover:text-fg xl:col-start-3 xl:row-start-1 xl:flex xl:transition-[opacity,visibility,color,background-color,border-color] xl:duration-300 xl:ease-out-expo', !agentHidden && 'xl:invisible xl:opacity-0')}
          >
            <SidebarSimpleIcon size={16} weight="bold" mirrored className="flex-none text-accent" />
            <span className="text-[13px] font-semibold text-fg [writing-mode:vertical-rl]">Show Agent</span>
            <span aria-hidden className={cx('size-1.5 flex-none rounded-full', status.live ? 'live-dot bg-bid' : state.status === 'killed' ? 'bg-ask' : 'bg-fg-3')} />
            <span className="text-[13px] [writing-mode:vertical-rl]">{status.text}</span>
          </button>
        </div>
      ) : (
        <p className="panel flex-1 items-center justify-center py-16 text-fg-3">Waiting for market data.</p>
      )}

      <StatusBar state={state} sim={Boolean(cfg?.sim)} paper={Boolean(cfg?.paper)} connected={connected} />

      <Guide dialog={guide} sim={Boolean(cfg?.sim)} paper={Boolean(cfg?.paper)} />

      <dialog ref={killDialog} className="m-auto w-[min(92vw,26rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg">
        <h2 className="text-[17px] font-semibold tracking-tight">Kill and Flatten?</h2>
        <p className="mt-2 text-[14px] text-fg-2">
          Monday cancels every open order on this Perpl account, in every market, then closes every open position on it with reduce-only market orders, including Agentic Trade and TWAP plans and anything you placed by hand. Closing at market can cost some slippage. The agent stays stopped until you restart it.
        </p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <Button type="submit" variant="ghost">Keep Running</Button>
          <Button type="submit" variant="danger" onClick={() => void act('/agent/kill')}>Kill and Flatten</Button>
        </form>
      </dialog>
    </div>
  );
}

/** Market as agent state: a running plan's, traded by the policy, dropped but still holding a position, or only watched. */
const agentTag = (x: MarketState, state: DashboardState) =>
  state.plans.some((p) => p.status !== 'done' && p.input.sym === x.sym) ? 'plan' : x.inPolicy ? 'trading' : x.position.size !== 0 ? 'exit' : 'off';
const pct = (n: number | null) => (n == null ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const PICK_COLS = 'grid grid-cols-[minmax(0,1.3fr)_1fr_0.8fr] items-center gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_1fr_0.8fr_0.8fr_0.9fr_0.9fr]';

/** The selected market and a dropdown of every market, as on Hyperliquid: price, change, funding, volume, interest. */
function MarketPicker({ state, sym, onPick }: { state: DashboardState; sym: MarketSym; onPick: (s: MarketSym) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  // Closes on a click elsewhere or Escape, like the chart's indicator menu.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const x = state.markets[sym];
  const tag = x && agentTag(x, state);
  // What Monday is doing in this market, only when it is out of the ordinary: a pulled side, a plan, a position left to
  // exit. Plain trading and watching carry no tag.
  const note = state.status === 'quoting' && x?.reflex
    ? <Tag tone="ask">{x.reflex.side} {x.reflex.action === 'pull' ? 'pulled' : 'widened'}</Tag>
    : tag === 'exit' || tag === 'plan' ? <Tag tone={tag === 'exit' ? 'warn' : 'neutral'}>{tag}</Tag> : null;
  return (
    <details ref={menu} className="relative order-1 flex-none border-r border-line" onKeyDown={(e) => e.key === 'Escape' && menu.current && (menu.current.open = false)}>
      <summary aria-label={`Market: ${sym}. Change market`} className="flex h-14 min-w-[8.25rem] cursor-pointer list-none flex-col justify-center gap-1.5 px-3 hover:bg-raised [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-[16px] font-semibold leading-none tracking-tight">
          <CoinIcon sym={sym} className="size-5" />{sym}<span className="text-[14px] font-normal text-fg-3">PERP</span>
          <CaretDownIcon size={12} weight="bold" className="ml-auto text-fg-3" />
        </span>
        {note && <span className="flex">{note}</span>}
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-[calc(100vw-1rem)] max-w-[40rem] rounded-sm border border-line-2 bg-raised py-1 shadow-lg">
        <div className={cx(PICK_COLS, 'label h-7 whitespace-nowrap px-3 [&>span:not(:first-child)]:text-right')}>
          <span>Market</span><span>Last Price</span><span>24h Change</span>
          <span className="hidden sm:block">Funding</span><span className="hidden sm:block">24h Volume</span><span className="hidden sm:block">Open Interest</span>
        </div>
        {(Object.keys(state.markets) as MarketSym[]).map((s) => {
          const r = state.markets[s];
          if (!r) return null;
          const t = agentTag(r, state);
          const c = r.day.changePct;
          return (
            <button
              key={s} aria-current={s === sym}
              onClick={() => { onPick(s); if (menu.current) menu.current.open = false; }}
              className={cx(PICK_COLS, 'num h-8 w-full px-3 text-left text-[13px] hover:bg-raised-2 [&>span:not(:first-child)]:text-right', s === sym && 'bg-raised-2')}
            >
              <span className="flex items-center gap-1.5 font-sans">
                <CoinIcon sym={s} /><span className="font-semibold">{s}</span><span className="text-fg-3">PERP</span>
                {(t === 'exit' || t === 'plan') && <Tag tone={t === 'exit' ? 'warn' : 'neutral'}>{t}</Tag>}
              </span>
              <span>{fmtPrice(r.mark, r.spec)}</span>
              <span className={c == null ? 'text-fg-3' : c >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{pct(c)}</span>
              <span className={cx('hidden sm:block', signTone(fundingPct(r.fundingRate)))}>{fundingPct(r.fundingRate)}</span>
              <span className="hidden sm:block">{r.day.volumeUsd == null ? '-' : usdCompact(r.day.volumeUsd)}</span>
              <span className="hidden sm:block">{r.openInterestUsd > 0 ? usdCompact(r.openInterestUsd) : '-'}</span>
            </button>
          );
        })}
        <p className="border-t border-line px-3 pb-1 pt-2 text-[12px] text-fg-3">Pick a market to watch it. Trade adds it to your policy; Monday then quotes it.</p>
      </div>
    </details>
  );
}

/** Green when a figure as shown is above zero, red below; one that shows as zero (0.0000%, -0.0) stays plain. */
const signTone = (shown: string) => (!/[1-9]/.test(shown) ? 'text-fg' : shown.startsWith('-') ? 'text-ask-fg' : 'text-bid-fg');
const fundingPct = (rate: number) => `${(rate * 100).toFixed(4)}%`;

/** The mark, coloured by its last move like every exchange ticker, with the 24-hour change under it. */
function Ticker({ m }: { m: MarketState }) {
  // The previous print, kept across renders the way React documents for values derived from the last render.
  const [last, setLast] = useState({ sym: m.sym, p: m.mark, dir: 0 });
  if (last.sym !== m.sym || last.p !== m.mark) setLast({ sym: m.sym, p: m.mark, dir: last.sym !== m.sym ? 0 : m.mark > last.p ? 1 : -1 });
  const chg = m.day.changePct;
  const abs = chg == null ? null : (m.mark * chg) / (100 + chg);
  return (
    <div title={`Mark price: what Perpl values positions at, coloured by its last move. Oracle ${fmtPrice(m.oracle, m.spec)}.`} className="order-2 flex flex-none cursor-help flex-col justify-center gap-1.5 px-4">
      <span className={cx('num text-[19px] font-medium leading-none tracking-tight transition-colors duration-300', last.dir > 0 ? 'text-bid-fg' : last.dir < 0 ? 'text-ask-fg' : 'text-fg')}>
        {fmtPrice(m.mark, m.spec)}
      </span>
      <span className={cx('num whitespace-nowrap text-[13px] leading-none', chg == null ? 'text-fg-3' : chg >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>
        {chg == null || abs == null ? '24h n/a' : <>{abs >= 0 ? '+' : '-'}{fmtPrice(Math.abs(abs), m.spec)}<span className="ml-2">{pct(chg)}</span></>}
      </span>
    </div>
  );
}

/** One figure on the strip: a quiet label with its explanation on hover, the value under it, all on one baseline. */
function Cell({ k, hint, children, className }: { k: string; hint: string; children: React.ReactNode; className?: string }) {
  return (
    <div title={hint} className={cx('flex flex-none cursor-help flex-col justify-center gap-1.5', className)}>
      <dt className="whitespace-nowrap text-[12px] leading-none text-fg-3">{k}</dt>
      <dd className="num relative flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-none text-fg">{children}</dd>
    </div>
  );
}

/**
 * The figures a trader reads off the strip, for the selected market. The spread is in the order book's middle row, so
 * it is not here. Below 1280px they take a second row of their own, which scrolls sideways if it must.
 */
function Stats({ m }: { m: MarketState }) {
  const { high, low } = m.day;
  const at = high != null && low != null && high > low ? Math.min(1, Math.max(0, (m.mark - low) / (high - low))) : null;
  return (
    <div className="scroll order-4 flex w-full min-w-0 items-stretch overflow-x-auto border-t border-line xl:order-3 xl:w-auto xl:flex-1 xl:border-t-0">
      <dl className="flex flex-none items-center gap-x-6 px-4 py-2 xl:py-0">
        <Cell k="Oracle" hint="The price from an outside source. Perpl rejects orders more than 1% from it.">{fmtPrice(m.oracle, m.spec)}</Cell>
        {/* Low to high as one figure, the mark's place between them on a hairline under it. */}
        <Cell k="24h Range" hint="The lowest (red) and highest (green) price in the last 24 hours, and where the mark sits between them.">
          {at == null ? '-' : (
            <>
              <span className="text-ask-fg">{fmtPrice(low!, m.spec)}</span><span className="text-fg-3">–</span><span className="text-bid-fg">{fmtPrice(high!, m.spec)}</span>
              <span aria-hidden className="absolute inset-x-0 -bottom-[7px] h-px bg-line-2">
                <span className="absolute -top-0.5 h-[5px] w-0.5 -translate-x-1/2 rounded-full bg-fg transition-[left] duration-500" style={{ left: `${at * 100}%` }} />
              </span>
            </>
          )}
        </Cell>
        <Cell k="24h Volume" hint="Notional traded on Perpl in the last 24 hours. The simulator reports none.">{m.day.volumeUsd == null ? '-' : usdCompact(m.day.volumeUsd)}</Cell>
        <Cell k="Open Interest" hint="Notional of all open positions in this market.">{m.openInterestUsd > 0 ? usdCompact(m.openInterestUsd) : '-'}</Cell>
        <Cell k="Funding" hint="A periodic payment between longs and shorts, per funding interval as Perpl shows it (the analytics pages show it per 8 hours). Positive means longs pay shorts.">
          <span className={signTone(fundingPct(m.fundingRate))}>{fundingPct(m.fundingRate)}</span>
        </Cell>
      </dl>
    </div>
  );
}

/** Foot of every terminal: is the feed alive, and how old is what I am looking at. */
function StatusBar({ state, sim, paper, connected }: { state: DashboardState; sim: boolean; paper: boolean; connected: boolean }) {
  const h = state.health;
  const c = state.costs;
  const items = ([
    ['Venue', sim ? 'simulated' : paper ? 'Perpl data, paper orders' : h.venueConnected ? 'Perpl' : 'Perpl down', !sim && !paper && !h.venueConnected],
    ['Data', `${(h.marketDataAgeMs / 1000).toFixed(1)}s`, h.marketDataAgeMs > 5_000],
    // Two separate sources with separate health: the Smart Trader poll (shown only while it is on), and Hyperliquid's live tape and mids.
    h.signalAgeMs >= 0 && ['Smart Traders', `${Math.round(h.signalAgeMs / 1000)}s`, h.signalAgeMs > 15 * 60_000],
    ['Reference Market', h.hlAgeMs < 0 ? 'off' : `${(h.hlAgeMs / 1000).toFixed(1)}s`, h.hlAgeMs > 5_000],
    ['Order Latency', h.latencyMs.venue == null ? 'n/a' : `${Math.round(h.latencyMs.venue)}ms`, (h.latencyMs.venue ?? 0) > 3_000],
    ['Budget', `${h.budgetRemaining}/${h.budgetPerMin}`, h.budgetRemaining < 8],
    ['Governor', h.llm ? (h.llmFailing ? 'rules, LLM failing' : 'LLM + rules') : 'rules', h.llmFailing],
    ['LLM 24h', !h.llm ? 'off' : !c.llmCalls24h ? 'no calls yet' : c.llmUsd24h == null ? `${c.llmCalls24h} calls, cost not recorded` : `${c.llmCalls24h} calls, $${c.llmUsd24h.toFixed(2)}`],
    ['Chain Log', h.chain ? 'on' : 'off'],
  ] as ([string, string, boolean?] | false)[]).filter((x) => x !== false);
  return (
    <footer className="panel num h-[28px] flex-none flex-row items-center gap-x-4 overflow-x-auto px-2.5 text-[12px] text-fg-3">
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
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-3.5rem)]">
      <Skeleton className="h-[52px] flex-none" />
      <div className="grid min-h-[60vh] flex-1 gap-1 xl:grid-cols-[minmax(0,1fr)_300px_360px]">
        <Skeleton />
        <Skeleton className="hidden xl:block" />
        <Skeleton className="hidden xl:block" />
      </div>
    </div>
  );
}

/** The agent column for an account with no market maker set up: one way to Setup, and Kill still covers any running plan. */
function NoMaker({ running, onKill, onHide }: { running: number; onKill: () => void; onHide: () => void }) {
  return (
    <Panel title="Agent" aside={<>{running > 0 && <span>{running} plan{running > 1 ? 's' : ''} running</span>}<HideAgentButton onHide={onHide} /></>}>
      <div className="grid gap-3 p-3 text-[13px] text-fg-2">
        <p>{running ? 'Your plans are trading; follow them under Plans. Start the market maker or another plan in Setup.' : 'Nothing is trading yet. Pick a mode in Setup: the market maker, Agentic Trade or TWAP.'}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/app/setup" size="sm">Setup</ButtonLink>
          {running > 0 && <Button size="sm" variant="danger" onClick={onKill}>Kill and Flatten</Button>}
        </div>
      </div>
    </Panel>
  );
}
