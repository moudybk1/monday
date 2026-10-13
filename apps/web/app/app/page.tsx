'use client';

import { CaretDownIcon, QuestionIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, MARKETS, quotingFor, usdCompact, type DashboardState, type KillReason, type MarketState, type MarketSym } from '@monday/core';
import { AgentConsole, sessionUsd, terminalStatus, type SessionDraft } from '@/components/agent';
import { Fills, Model, OpenOrders, Positions } from '@/components/blotter';
import { OrderBook } from '@/components/book';
import { Diverging, LineChart } from '@/components/charts';
import { Guide } from '@/components/guide';
import { draftFrom, toBody } from '@/components/policy-form';
import { PlanList, planLevels } from '@/components/plans';
import { PriceChart } from '@/components/price-chart';
import { FlowBars, SmartTape } from '@/components/smart-money';
import { Tape } from '@/components/tape';
import { DecisionLog } from '@/components/timeline';
import { Button, ButtonLink, Mark, Notice, Panel, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtPrice, fmtTime, fmtUsd, towardHl } from '@/lib/format';
import { useLive } from '@/lib/live';
import { useAppConfig, useMe, useRegistry, type PolicyView } from '@/lib/wallet';

// The layout every live terminal shares, measured on Hyperliquid and Tread: a market strip on top, the chart largest
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
  const [side, setSide] = useState<'book' | 'trades'>('book');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDraft>({ sl: '', tp: '' });
  const killDialog = useRef<HTMLDialogElement>(null);
  const guide = useRef<HTMLDialogElement>(null);
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
  const start = () => {
    const stopLossUsd = sessionUsd(session.sl), takeProfitUsd = sessionUsd(session.tp);
    // A mistyped limit must not quietly become "no limit".
    if (Number.isNaN(stopLossUsd) || Number.isNaN(takeProfitUsd)) return setError('Session stop loss and take profit must be positive amounts, or empty for no limit.');
    return act('/agent/start', { stopLossUsd, takeProfitUsd });
  };
  const openPositions = shown.filter((s) => Math.abs(state.markets[s]?.position.notionalUsd ?? 0) >= 0.5).length;
  const running = state.plans.filter((p) => p.status !== 'done');
  const status = terminalStatus(state);
  const planMarkets = running.map((p) => p.input.sym);
  const openOrders = shown.reduce((n, s) => n + (state.markets[s]?.quotes.bid ? 1 : 0) + (state.markets[s]?.quotes.ask ? 1 : 0), 0);
  const stale = m && m.dataAgeMs > 5_000;
  const warning = state.alerts.find((a) => a.severity !== 'info' && now - a.at < 5 * 60_000);
  const TABS: [Tab, string, number | null][] = [
    ['orders', 'Open orders', openOrders], ['positions', 'Positions', openPositions], ['plans', 'Plans', running.length], ['fills', 'History', state.fills.length],
    ['decisions', 'Decisions', state.decisions.length], ['equity', 'Equity', null], ['model', 'Quote model', null],
  ];

  return (
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-3rem)]">
      {/* Market strip */}
      {/* Visible overflow so the market picker can drop below the strip. */}
      <div className="panel flex-none flex-row flex-wrap items-stretch overflow-visible">
        <MarketPicker state={state} sym={sym} onPick={setPicked} />
        {m && <Ticker m={m} />}
        {m && <Stats m={m} quoting={quoting} blend={quotingFor(state.policy).cfg.blend} />}
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
          <span className="flex items-center gap-1.5 text-[12px] font-medium">
            {/* The one status dot: it reflects real agent state. */}
            <span aria-hidden className={cx('size-1.5 rounded-full', status.live ? 'live-dot bg-bid' : state.status === 'killed' ? 'bg-ask' : 'bg-fg-3')} />
            {/* Phones show the status in the Agent panel right below; here it keeps only the dot. */}
            <span className="max-md:sr-only">{status.text}</span>
          </span>
        </div>
      </div>

      <div className="grid flex-none gap-1 empty:hidden">
        {error && <Notice tone="warn">{error}</Notice>}
        {/* Once a plan runs again after the kill, the kill is old news. */}
        {state.status === 'killed' && (state.closing || !running.length) && (
          // A kill ends everything: trading again starts from Setup, in any mode and any market.
          <Notice tone="ask" action={state.closing ? undefined : <ButtonLink href="/app/setup" size="xs" variant="ghost" className="border-white/70 text-white hover:bg-white/15">Set up again</ButtonLink>}>
            <strong>{state.closing ? 'Killed, still closing.' : 'Killed.'}</strong> {state.killReason ? KILL_WHY[state.killReason] : ''}{' '}
            {state.closing ? 'Perpl has not confirmed that every order is cancelled and every position closed. Monday retries every 10 seconds, also after a restart. You can close them on Perpl too.' : 'All orders were cancelled and positions closed. To trade again, pick a mode in Setup.'}
            {state.killReason === 'key_error' && <> <Link href="/app/connect" className="underline">Add a new key</Link>.</>}
          </Notice>
        )}
        {state.status === 'paused' && state.closing === 'cancel' && <Notice tone="warn">Stopped, but Perpl has not confirmed the cancels yet. Monday keeps retrying.</Notice>}
        {state.status === 'paused' && state.closing === 'flatten' && <Notice tone="warn">Take profit reached, but Perpl has not confirmed the position is closed. Monday retries every 10 seconds; you can close it on Perpl too.</Notice>}
        {/* Stop means stop: nothing watches a position left open, so say so while one is. */}
        {state.status === 'paused' && !state.closing && Object.values(state.markets).some((x) => x && x.position.size !== 0 && !planMarkets.includes(x.sym)) && (
          <Notice tone="warn">Stopped with an open position. Monday is not watching it: no stop loss, per position or for the day. Close it on Perpl, use Kill and flatten, or start Monday again.</Notice>
        )}
        {quoting && stale && <Notice tone="warn">Perpl data delayed, quotes pulled. Monday resumes on its own when data returns.</Notice>}
        {/* The newest warning from the agent itself: loss-limit approach, rate limits, blocked orders, disconnects. */}
        {warning && state.status !== 'killed' && <Notice tone="warn"><span className="num mr-2">{fmtTime(warning.at)}</span>{warning.message}</Notice>}
        {!connected && <Notice tone="warn">Live connection lost. Reconnecting.</Notice>}
      </div>

      {m ? (
        // Phone: agent, chart and blotter, book, smart money. Tablet: agent across the top, then book and smart money side
        // by side. Desktop: three columns, the agent and smart money stacked in the third.
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_300px_360px] xl:grid-rows-[auto_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-1 md:col-span-2 xl:col-span-1 xl:col-start-1 xl:row-span-2">
            <PriceChart sym={sym} m={m} fills={state.fills} now={now} levels={planLevels(running.find((p) => p.input.sym === sym))} className="h-[360px] flex-none xl:h-auto xl:flex-[3]" />

            <section className="panel h-[360px] flex-none xl:h-auto xl:flex-[2]">
              <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
                <div role="tablist" aria-label="Blotter" className="scroll flex h-full overflow-x-auto">
                  {TABS.map(([id, label, n]) => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('flex items-center gap-1.5 whitespace-nowrap px-3 text-[12px]', tab === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                      {label}{n != null && <span className="num text-[10.5px] font-normal text-fg-3">{n}</span>}
                    </button>
                  ))}
                </div>
                {/* One line, cut short when the tabs need the room: it never wraps into the tab row. */}
                <span className="hidden min-w-0 flex-1 truncate pl-4 text-right text-[11.5px] text-fg-3 lg:block">
                  {tab === 'orders' ? 'queue: what must trade before each order does'
                    : tab === 'positions' ? 'opened by fills; Kill and flatten closes all'
                    : tab === 'plans' ? `Agentic Trade and TWAP; stop losses rest on ${state.sim || state.paper ? 'the exchange' : 'Perpl'}`
                    : tab === 'decisions' ? (state.health.chain ? 'every decision is hashed and logged on Monad' : 'hashed; on-chain log is off')
                    : tab === 'fills' ? 'markout: price move after the fill, positive is good'
                    : tab === 'model' ? `${sym}, this tick` : `since ${state.equity[0] ? fmtTime(state.equity[0].t, false) : 'start'}`}
                </span>
              </header>
              <div className={cx('scroll min-h-0 flex-1', tab === 'equity' && 'p-1.5')}>
                {tab === 'orders' && <OpenOrders state={state} />}
                {tab === 'positions' && <Positions state={state} />}
                {tab === 'plans' && <PlanList plans={state.plans} specs={cfg?.specs ?? {}} sim={state.sim || state.paper} now={now} onError={setError} />}
                {tab === 'fills' && <Fills state={state} />}
                {tab === 'decisions' && <DecisionLog decisions={state.decisions} explorerUrl={cfg?.explorerUrl} chainOn={state.health.chain} />}
                {tab === 'model' && <Model m={m} quoting={quoting} policy={state.policy} />}
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

          {/* Book and tape share one panel, as on every exchange. */}
          <section className="panel h-[420px] flex-none md:h-[520px] xl:col-start-2 xl:row-span-2 xl:h-auto xl:min-h-0">
            <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
              <div role="tablist" aria-label="Book or trades" className="flex h-full">
                {(['book', 'trades'] as const).map((id) => (
                  <button key={id} role="tab" aria-selected={side === id} onClick={() => setSide(id)} className={cx('px-3 text-[12px] capitalize', side === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                    {id === 'book' ? 'Order book' : 'Trades'}
                  </button>
                ))}
              </div>
              <span className="text-[11.5px] text-fg-3">Perpl</span>
            </header>
            <div className="scroll min-h-0 flex-1">
              {side === 'book' ? <OrderBook m={m} rows={12} now={now} ownOnBook={!state.sim && !state.paper} /> : <Tape m={m} limit={40} />}
            </div>
          </section>

          <div className="order-first md:col-span-2 xl:order-none xl:col-span-1 xl:col-start-3 xl:row-start-1">
            {state.policy.markets.length ? (
              <AgentConsole
                state={state} sym={sym} onPick={setPicked} session={session} onSession={setSession} busy={busy !== null}
                onStart={start} onPause={() => act('/agent/pause')} onKill={() => killDialog.current?.showModal()}
              />
            ) : (
              <NoMaker running={running.length} onKill={() => killDialog.current?.showModal()} />
            )}
          </div>
          <div className="flex min-h-0 flex-col xl:col-start-3 xl:row-start-2">
            <Panel
              title={<>Smart Traders <span className="font-normal text-fg-3">on Hyperliquid</span></>}
              className="h-[360px] flex-none md:h-[520px] xl:h-auto xl:min-h-0 xl:flex-1"
              bodyClassName="flex flex-col !overflow-hidden"
              aside={cfg?.sim ? (
                <>
                  <Button size="xs" variant="ghost" title="Simulate a Smart Trader buying burst" onClick={() => act('/sim/burst', { market: sym, direction: 'buy' })}>Buy burst</Button>
                  <Button size="xs" variant="ghost" title="Simulate a Smart Trader selling burst" onClick={() => act('/sim/burst', { market: sym, direction: 'sell' })}>Sell burst</Button>
                </>
              ) : (m.signal ? undefined : <span>no feed</span>)}
            >
              <div className="flex-none border-b border-line"><FlowBars m={m} /></div>
              <div className="scroll min-h-0 flex-1"><SmartTape m={m} now={now} /></div>
            </Panel>
          </div>
        </div>
      ) : (
        <p className="panel flex-1 items-center justify-center py-16 text-fg-3">Waiting for market data.</p>
      )}

      <StatusBar state={state} sim={Boolean(cfg?.sim)} paper={Boolean(cfg?.paper)} connected={connected} />

      <Guide dialog={guide} sim={Boolean(cfg?.sim)} paper={Boolean(cfg?.paper)} />

      <dialog ref={killDialog} className="m-auto w-[min(92vw,26rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg">
        <h2 className="text-[17px] font-semibold tracking-tight">Kill and flatten?</h2>
        <p className="mt-2 text-[13px] text-fg-2">
          Monday cancels every open order on this Perpl account, in every market, then closes every open position on it with reduce-only market orders, including Agentic Trade and TWAP plans and anything you placed by hand. Closing at market can cost some slippage. The agent stays stopped until you restart it.
        </p>
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <Button type="submit" variant="ghost">Keep running</Button>
          <Button type="submit" variant="danger" onClick={() => void act('/agent/kill')}>Kill and flatten</Button>
        </form>
      </dialog>
    </div>
  );
}

/** Market as agent state: traded by the policy, dropped but still holding a position, or only watched. */
const agentTag = (x: MarketState) => (x.inPolicy ? 'trading' : x.position.size !== 0 ? 'exit' : 'off');
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
  const tag = x && agentTag(x);
  return (
    <details ref={menu} className="relative order-1 flex-none border-r border-line" onKeyDown={(e) => e.key === 'Escape' && menu.current && (menu.current.open = false)}>
      <summary aria-label={`Market: ${sym}. Change market`} className="flex h-14 min-w-[8.25rem] cursor-pointer list-none flex-col justify-center gap-1.5 px-3 hover:bg-raised [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-none tracking-tight">
          {sym}<span className="text-[13px] font-normal text-fg-3">perp</span>
          <CaretDownIcon size={12} weight="bold" className="ml-auto text-fg-3" />
        </span>
        {/* What Monday is doing in this market: a pulled side outranks the policy state. */}
        <span className="flex">
          {state.status === 'quoting' && x?.reflex
            ? <Tag tone="ask">{x.reflex.side} {x.reflex.action === 'pull' ? 'pulled' : 'widened'}</Tag>
            : tag && <Tag tone={tag === 'trading' ? 'bid' : tag === 'exit' ? 'warn' : 'neutral'}>{tag === 'off' ? 'watching' : tag}</Tag>}
        </span>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-[calc(100vw-1rem)] max-w-[40rem] rounded-sm border border-line-2 bg-raised py-1 shadow-lg">
        <div className={cx(PICK_COLS, 'label h-7 whitespace-nowrap px-3 [&>span:not(:first-child)]:text-right')}>
          <span>Market</span><span>Last price</span><span>24h change</span>
          <span className="hidden sm:block">Funding</span><span className="hidden sm:block">24h volume</span><span className="hidden sm:block">Open interest</span>
        </div>
        {(Object.keys(state.markets) as MarketSym[]).map((s) => {
          const r = state.markets[s];
          if (!r) return null;
          const t = agentTag(r);
          const c = r.day.changePct;
          return (
            <button
              key={s} aria-current={s === sym}
              onClick={() => { onPick(s); if (menu.current) menu.current.open = false; }}
              className={cx(PICK_COLS, 'num h-8 w-full px-3 text-left text-[12px] hover:bg-raised-2 [&>span:not(:first-child)]:text-right', s === sym && 'bg-raised-2')}
            >
              <span className="flex items-center gap-1.5 font-sans">
                <span className="font-semibold">{s}</span><span className="text-fg-3">perp</span>
                <Tag tone={t === 'trading' ? 'bid' : t === 'exit' ? 'warn' : 'neutral'}>{t === 'off' ? 'watching' : t}</Tag>
              </span>
              <span>{fmtPrice(r.mark, r.spec)}</span>
              <span className={c == null ? 'text-fg-3' : c >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{pct(c)}</span>
              <span className="hidden sm:block">{(r.fundingRate * 100).toFixed(4)}%</span>
              <span className="hidden sm:block">{r.day.volumeUsd == null ? '-' : usdCompact(r.day.volumeUsd)}</span>
              <span className="hidden sm:block">{r.openInterestUsd > 0 ? usdCompact(r.openInterestUsd) : '-'}</span>
            </button>
          );
        })}
        <p className="border-t border-line px-3 pb-1 pt-2 text-[11px] text-fg-3">Pick a market to watch it. Trade adds it to your policy; Monday then quotes it.</p>
      </div>
    </details>
  );
}

const REGIME_TONE = { calm: 'bid', active: 'warn', storm: 'ask', stale: 'warn' } as const;

/** The mark, coloured by its last move like every exchange ticker, with the 24-hour change under it. */
function Ticker({ m }: { m: MarketState }) {
  // The previous print, kept across renders the way React documents for values derived from the last render.
  const [last, setLast] = useState({ sym: m.sym, p: m.mark, dir: 0 });
  if (last.sym !== m.sym || last.p !== m.mark) setLast({ sym: m.sym, p: m.mark, dir: last.sym !== m.sym ? 0 : m.mark > last.p ? 1 : -1 });
  const chg = m.day.changePct;
  const abs = chg == null ? null : (m.mark * chg) / (100 + chg);
  return (
    <div title={`Mark price: what Perpl values positions at, coloured by its last move. Oracle ${fmtPrice(m.oracle, m.spec)}.`} className="order-2 flex flex-none cursor-help flex-col justify-center gap-1.5 px-3">
      <span className={cx('num text-[19px] font-medium leading-none tracking-tight transition-colors duration-300', last.dir > 0 ? 'text-bid-fg' : last.dir < 0 ? 'text-ask-fg' : 'text-fg')}>
        {fmtPrice(m.mark, m.spec)}
      </span>
      <span className={cx('num whitespace-nowrap text-[11.5px] leading-none', chg == null ? 'text-fg-3' : chg >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>
        {chg == null || abs == null ? '24h n/a' : <>{abs >= 0 ? '+' : '-'}{fmtPrice(Math.abs(abs), m.spec)}<span className="ml-2">{pct(chg)}</span></>}
      </span>
    </div>
  );
}

/** One figure on the strip: a quiet label with its explanation on hover, the value in mono under it. */
function Cell({ k, hint, children, className }: { k: string; hint: string; children: React.ReactNode; className?: string }) {
  return (
    <div title={hint} className={cx('flex flex-none cursor-help flex-col justify-center gap-1.5', className)}>
      <dt className="whitespace-nowrap text-[11px] leading-none text-fg-3 underline decoration-line-2 decoration-dotted underline-offset-[3px]">{k}</dt>
      <dd className="num flex items-center gap-2 whitespace-nowrap text-[12.5px] leading-none text-fg">{children}</dd>
    </div>
  );
}

/**
 * The figures a trader reads off the strip, for the selected market. Two groups: the market itself, then what Monday
 * reads from it (behind the mark, in Monday's amber). The spread is in the order book's middle row, so it is not here.
 * Below 1280px the groups take a second row of their own, which scrolls sideways if it must.
 */
function Stats({ m, quoting, blend }: { m: MarketState; quoting: boolean; blend: number }) {
  const { high, low } = m.day;
  const at = high != null && low != null && high > low ? Math.min(1, Math.max(0, (m.mark - low) / (high - low))) : null;
  const gapBps = m.hlMid ? ((m.mark - m.hlMid) / m.hlMid) * 1e4 : null;
  const S = m.signal?.S ?? null;
  const burst = S != null && Math.abs(S) >= DEFAULT_CONFIG.z2;
  const regime = quoting && m.inPolicy ? m.params.regime : null;
  return (
    <div className="scroll order-4 flex w-full min-w-0 items-stretch overflow-x-auto border-t border-line xl:order-3 xl:w-auto xl:flex-1 xl:border-t-0">
      <dl className="flex flex-none items-center gap-x-5 px-3 py-2 xl:py-0">
        {/* From 1280 to 1399px the oracle moves into the price's tooltip, so the strip still fits on one line. */}
        <Cell k="Oracle" hint="The price from an outside source. Perpl rejects orders more than 1% from it." className="xl:max-[1399px]:hidden">{fmtPrice(m.oracle, m.spec)}</Cell>
        <Cell k="24h range" hint="The lowest and highest price in the last 24 hours, and where the mark sits between them.">
          {at == null ? '-' : (
            <>
              <span className="text-[11.5px] text-fg-2">{fmtPrice(low!, m.spec)}</span>
              <span className="relative h-2.5 w-14" aria-hidden>
                <span className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
                <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-fg transition-[left] duration-500" style={{ left: `${at * 100}%` }} />
              </span>
              <span className="text-[11.5px] text-fg-2">{fmtPrice(high!, m.spec)}</span>
            </>
          )}
        </Cell>
        <Cell k="24h volume" hint="Notional traded on Perpl in the last 24 hours. The simulator reports none.">{m.day.volumeUsd == null ? '-' : usdCompact(m.day.volumeUsd)}</Cell>
        <Cell k="Open interest" hint="Notional of all open positions in this market.">{m.openInterestUsd > 0 ? usdCompact(m.openInterestUsd) : '-'}</Cell>
        <Cell k="Funding" hint="A periodic payment between longs and shorts. Positive means longs pay shorts.">{(m.fundingRate * 100).toFixed(4)}%</Cell>
      </dl>
      <div className="flex flex-none items-center gap-x-4 border-l border-line px-3 py-2 xl:py-0">
        <span title="Monday's readings for this market" className="flex-none"><Mark size={15} /></span>
        <dl aria-label="What Monday reads" className="flex items-center gap-x-4">
          <Cell k="Regime" hint="Monday's mode. Calm: at the best price. Active: cautious. Storm: very defensive. Stale: Smart Trader data is late. Off until Monday quotes this market.">
            {regime ? <Tag tone={REGIME_TONE[regime as keyof typeof REGIME_TONE] ?? 'neutral'}>{regime}</Tag> : <span className="text-fg-3">off</span>}
          </Cell>
          <Cell k="Signal" hint={`How unusual Smart Trader flow is right now. Beyond ${DEFAULT_CONFIG.z2} either way, Monday treats it as a burst and steps aside on the threatened side.`}>
            {S == null ? <span className="text-fg-3">none</span> : (
              <>
                <Diverging value={S / 4} ticks={[DEFAULT_CONFIG.z2 / 4]} className="w-12" />
                <span className={cx('w-9 text-right', burst ? 'font-semibold text-accent' : 'text-fg')}>{S >= 0 ? '+' : ''}{S.toFixed(2)}</span>
              </>
            )}
          </Cell>
          <Cell k="Vol 1m" hint="How much the price typically moves in a minute. 1 bp is 0.01%.">{m.sigma1mBps ? `${m.sigma1mBps.toFixed(1)} bps` : '-'}</Cell>
          <Cell k="vs Hyperliquid" hint={m.hlMid ? `Hyperliquid mid ${fmtPrice(m.hlMid, m.spec)}. How far Perpl's mark sits from it; ${blend > 0 ? `Monday centres its quotes ${towardHl(blend)} from Perpl to Hyperliquid` : 'in Mid mode Monday quotes off Perpl alone'}.` : 'Hyperliquid is off, stale or too far from Perpl to trust, so Monday uses Perpl alone.'}>
            {gapBps == null ? <span className="text-fg-3">off</span> : `${gapBps >= 0 ? '+' : ''}${gapBps.toFixed(1)} bps`}
          </Cell>
          </dl>
      </div>
    </div>
  );
}

/** Foot of every terminal: is the feed alive, and how old is what I am looking at. */
function StatusBar({ state, sim, paper, connected }: { state: DashboardState; sim: boolean; paper: boolean; connected: boolean }) {
  const h = state.health;
  const c = state.costs;
  const items: [string, string, boolean?][] = [
    ['Venue', sim ? 'simulated' : paper ? 'Perpl data, paper orders' : h.venueConnected ? 'Perpl' : 'Perpl down', !sim && !paper && !h.venueConnected],
    ['Data', `${(h.marketDataAgeMs / 1000).toFixed(1)}s`, h.marketDataAgeMs > 5_000],
    // Two separate sources with separate health: the Smart Trader poll, and Hyperliquid's live tape and mids.
    ['Smart Traders', h.signalAgeMs < 0 ? 'none' : `${Math.round(h.signalAgeMs / 1000)}s`, h.signalAgeMs > 15 * 60_000],
    ['Hyperliquid', h.hlAgeMs < 0 ? 'off' : `${(h.hlAgeMs / 1000).toFixed(1)}s`, h.hlAgeMs > 5_000],
    ['Order latency', h.latencyMs.venue == null ? 'n/a' : `${Math.round(h.latencyMs.venue)}ms`, (h.latencyMs.venue ?? 0) > 3_000],
    ['Budget', `${h.budgetRemaining}/${h.budgetPerMin}`, h.budgetRemaining < 8],
    ['Governor', h.llm ? (h.llmFailing ? 'rules, LLM failing' : 'LLM + rules') : 'rules', h.llmFailing],
    ['LLM 24h', !h.llm ? 'off' : !c.llmCalls24h ? 'no calls yet' : c.llmUsd24h == null ? `${c.llmCalls24h} calls, cost not recorded` : `${c.llmCalls24h} calls, $${c.llmUsd24h.toFixed(2)}`],
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
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-3rem)]">
      <Skeleton className="h-[52px] flex-none" />
      <div className="grid min-h-[60vh] flex-1 gap-1 xl:grid-cols-[minmax(0,1fr)_300px_360px]">
        <Skeleton />
        <Skeleton className="hidden xl:block" />
        <Skeleton className="hidden xl:block" />
      </div>
    </div>
  );
}

/** The agent column for an account with no market maker set up: its plans run on their own, and Kill still covers everything. */
function NoMaker({ running, onKill }: { running: number; onKill: () => void }) {
  return (
    <Panel title="Agent" aside={running ? <span>{running} plan{running > 1 ? 's' : ''} running</span> : undefined}>
      <div className="grid gap-3 p-3 text-[12.5px] text-fg-2">
        <p>The market maker is not set up on this account.{running ? ' Your plans run on their own; follow them under Plans.' : ' Start a trade, a TWAP, or set up the market maker.'}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/app/setup/trade" size="sm">New trade</ButtonLink>
          <ButtonLink href="/app/setup/twap" size="sm" variant="ghost">New TWAP</ButtonLink>
          <ButtonLink href="/app/onboarding" size="sm" variant="ghost">Market maker</ButtonLink>
          {running > 0 && <Button size="sm" variant="danger" onClick={onKill}>Kill and flatten</Button>}
        </div>
      </div>
    </Panel>
  );
}
