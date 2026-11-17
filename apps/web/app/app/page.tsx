'use client';

import { PowerIcon, QuestionIcon, SidebarSimpleIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MARKETS, groupSteps, type DashboardState, type KillReason, type MarketState, type MarketSym } from '@monday/core';
import { AgentConsole, HideAgentButton, terminalStatus } from '@/components/agent';
import { Fills, Model, OpenOrders, Positions } from '@/components/blotter';
import { OrderBook } from '@/components/book';
import { LineChart } from '@/components/charts';
import { Guide } from '@/components/guide';
import { ConnectPrompt } from '@/components/perpl-connect';
import { draftFrom, toBody } from '@/components/policy-form';
import { MakerRow, PlanList, planLevels } from '@/components/plans';
import { PriceChart } from '@/components/price-chart';
import { RunSummary } from '@/components/run-summary';
import { FlowBars, SmartTape } from '@/components/smart-money';
import { MarketPicker, Stats, Ticker } from '@/components/market-strip';
import { Tape } from '@/components/tape';
import { DecisionLog } from '@/components/timeline';
import { Button, ButtonLink, Notice, Panel, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtTime, fmtUsd } from '@/lib/format';
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

/** Signed in without a Perpl key yet: Account Settings first. */
export default function Terminal() {
  const me = useMe().data;
  if (me && !me.hasKey) return <ConnectPrompt next="/app" />;
  return <TerminalView />;
}

function TerminalView() {
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
  const resting = shown.reduce((n, s) => n + (state.markets[s]?.quotes.bid ? 1 : 0) + (state.markets[s]?.quotes.ask ? 1 : 0), 0);
  const canKill = !state.closing && (quoting || running.length > 0 || openPositions > 0 || resting > 0);
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
          {/* The one Kill on the terminal: away from every per-run Stop, Cancel and Close, behind its own divider and a
              confirm. Shown while anything trades or anything is held, since it closes all of it. */}
          {canKill && (
            <span className="ml-1 flex items-center border-l border-line pl-3">
              <button
                type="button" onClick={() => killDialog.current?.showModal()} disabled={busy !== null}
                title="Kill Switch: cancel every order and close every position on the account. Asks first."
                className="flex h-7 items-center gap-1.5 rounded-sm border border-ask/60 px-2.5 text-[12px] font-semibold text-ask-fg transition-colors hover:bg-ask hover:text-white disabled:opacity-50"
              >
                <PowerIcon size={13} weight="bold" />Kill Switch
              </button>
            </span>
          )}
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
            {state.killReason === 'key_error' && <> <Link href="/app/account" className="underline">Add a new key</Link>.</>}
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
                    : tab === 'positions' ? 'opened by fills; the Kill Switch (top right) closes all'
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
                    maker={quoting ? <MakerRow state={state} busy={busy !== null} onStop={() => void act('/agent/pause')} onPick={pick} /> : undefined}
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
            <AgentConsole
              state={state} sym={sym} specs={cfg?.specs ?? {}} busy={busy !== null} onPick={pick} onError={setError} onHide={toggleAgent}
              onStop={() => void act('/agent/pause')}
            />
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

      <RunSummary state={state} specs={cfg?.specs ?? {}} />

      <dialog ref={killDialog} className="m-auto w-[min(92vw,26rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight"><PowerIcon size={18} weight="bold" className="text-ask-fg" />Kill and flatten everything?</h2>
        {/* What it ends, counted, so nobody kills more than they meant to. */}
        <ul className="num mt-3 grid gap-1 rounded-sm border border-line bg-raised px-3 py-2 text-[13px]">
          {quoting && <li>Market maker on {state.policy.markets.join(', ')} stops</li>}
          {running.length > 0 && <li>{running.length} plan{running.length > 1 ? 's' : ''} end{running.length > 1 ? '' : 's'}: {running.map((p) => `${p.input.sym} ${p.input.kind === 'twap' ? 'TWAP' : 'Agentic Trade'}`).join(', ')}</li>}
          <li>{openPositions} open position{openPositions === 1 ? '' : 's'} closed at market</li>
          <li>Every open order on the account cancelled</li>
        </ul>
        <p className="mt-3 text-[13px] text-fg-2">
          This covers the whole Perpl account, in every market, including anything you placed by hand. Closing at market can cost some slippage. To end just one run, use its own Stop or Close instead.
        </p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <Button type="submit" variant="ghost" autoFocus>Keep Running</Button>
          <Button type="submit" variant="danger" onClick={() => void act('/agent/kill')}>Kill and Flatten</Button>
        </form>
      </dialog>
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
