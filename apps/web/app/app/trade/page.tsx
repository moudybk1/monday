'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { MARKETS, groupSteps, type DashboardState, type ManualKind, type ManualOrderView, type MarketState, type MarketSym, type Side } from '@monday/core';
import { tone } from '@/components/agent';
import { OrderBook } from '@/components/book';
import { MarketPicker, Stats, Ticker } from '@/components/market-strip';
import { ConnectPrompt } from '@/components/perpl-connect';
import { PriceChart, type ChartLevel } from '@/components/price-chart';
import { Tape } from '@/components/tape';
import { Button, CoinIcon, INPUT, Notice, Skeleton, SymButton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtPrice, fmtSigned, fmtSize, fmtTime, fmtUsd } from '@/lib/format';
import { useLive } from '@/lib/live';
import { useMe } from '@/lib/wallet';

// Trading by hand, laid out like the Terminal (and Hyperliquid): the market strip on top, the chart left, the book and
// the tape beside it, the order ticket on the right, positions, orders and history under the chart. Markets the market
// maker or a running plan holds are theirs: the ticket shows them but will not trade them.

const HEAD = 'label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal';
type Tab = 'positions' | 'orders' | 'history';

const takenOf = (state: DashboardState): Partial<Record<MarketSym, 'maker' | 'plan'>> => {
  const out: Partial<Record<MarketSym, 'maker' | 'plan'>> = {};
  if (state.status === 'quoting') for (const s of state.policy.markets) out[s] = 'maker';
  for (const p of state.plans) if (p.status !== 'done') out[p.input.sym] = 'plan';
  return out;
};

/** Signed in without a Perpl key yet: Account Settings first. */
export default function Trade() {
  const me = useMe().data;
  if (me && !me.hasKey) return <ConnectPrompt next="/app/trade" what="trade by hand" />;
  return <TradeView />;
}

function TradeView() {
  const qc = useQueryClient();
  const me = useMe();
  const { state, connected } = useLive('auth', () => void qc.invalidateQueries({ queryKey: ['me'] }), me.data?.wallet);
  const [picked, setPicked] = useState<MarketSym>('BTC');
  const [tab, setTab] = useState<Tab>('positions');
  const [side, setSide] = useState<'book' | 'trades'>('book');
  const [group, setGroup] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const m = new URLSearchParams(location.search).get('m');
    if (m && (MARKETS as readonly string[]).includes(m)) setPicked(m as MarketSym);
  }, []);
  // Nothing else may have opened the trading connection yet (no market maker, no plan): open it for the balance.
  useEffect(() => {
    api('/manual/connect', { method: 'POST' }).catch((e) => setError(e instanceof Error ? e.message.split('\n')[0] : 'Could not reach the exchange.'));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!state) return <Loading />;
  const shown = Object.keys(state.markets) as MarketSym[];
  const sym = shown.includes(picked) ? picked : shown[0];
  const m = state.markets[sym];
  const taken = takenOf(state);
  const pick = (s: MarketSym) => {
    setPicked(s);
    const q = new URLSearchParams(location.search);
    q.set('m', s);
    history.replaceState(null, '', `?${q}`);
  };
  const run = async (id: string, path: string, body?: unknown, done?: string) => {
    setBusy(id);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Request failed.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const positions = shown.map((s) => state.markets[s]!).filter((x) => x && Math.abs(x.position.notionalUsd) >= 0.5);
  const orders = state.manual.orders;
  const TABS: [Tab, string, number | null][] = [['positions', 'Positions', positions.length], ['orders', 'Open Orders', orders.length], ['history', 'Trade History', state.manual.fills.length]];
  const levels: ChartLevel[] = orders.filter((o) => o.sym === sym).map((o) => ({
    price: (o.triggerPrice ?? o.price)!, tone: o.role === 'tp' ? 'bid' : o.role === 'sl' ? 'ask' : 'accent',
    label: o.role === 'tp' ? 'TP' : o.role === 'sl' ? 'SL' : `${o.side === 'bid' ? 'Buy' : 'Sell'} ${o.kind === 'stop' ? 'stop' : 'limit'}`,
  }));
  if (m && m.position.size !== 0) levels.push({ price: m.position.entryPrice, tone: 'accent', label: 'Entry' });

  return (
    <div className="flex flex-col gap-1 p-1 xl:h-[calc(100dvh-3.5rem)]">
      <div className="panel flex-none flex-row flex-wrap items-stretch overflow-visible">
        <MarketPicker state={state} sym={sym} onPick={pick} footer="Pick a market to trade it by hand. Markets the market maker or a plan holds stay theirs." />
        {m && <Ticker m={m} />}
        {m && <Stats m={m} />}
      </div>

      <div className="grid flex-none gap-1 empty:hidden">
        {error && <Notice tone="warn">{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        {!connected && <Notice tone="warn">Live connection lost. Reconnecting.</Notice>}
        {state.status === 'killed' && state.closing && <Notice tone="ask">A kill is still closing positions. Wait until it is done before trading by hand.</Notice>}
      </div>

      {m ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_300px_320px] xl:grid-rows-[minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-1 md:col-span-2 xl:col-span-1">
            <PriceChart sym={sym} m={m} fills={state.manual.fills} now={state.at} levels={levels} className="h-[360px] flex-none xl:h-auto xl:flex-[3]" />
            <section className="panel h-[320px] flex-none xl:h-auto xl:flex-[2]">
              <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
                <div role="tablist" aria-label="Blotter" className="scroll flex h-full overflow-x-auto">
                  {TABS.map(([id, label, n]) => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('flex items-center gap-1.5 whitespace-nowrap px-3 text-[13px]', tab === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                      {label}{n != null && <span className="num text-[12px] font-normal text-fg-3">{n}</span>}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {tab === 'positions' && positions.some((x) => !taken[x.sym]) && (
                    <Button size="xs" variant="danger" disabled={busy !== null} onClick={() => { if (confirm('Close every position you trade by hand at the market?')) void run('close-all', '/manual/close-all', undefined, 'Closing every hand-traded position.'); }}>
                      {busy === 'close-all' ? 'Closing' : 'Close All'}
                    </Button>
                  )}
                  {tab === 'orders' && orders.length > 0 && (
                    <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => void run('cancel-all', '/manual/orders/cancel-all', undefined, 'Orders cancelled.')}>
                      {busy === 'cancel-all' ? 'Cancelling' : 'Cancel All'}
                    </Button>
                  )}
                </div>
              </header>
              <div className="scroll min-h-0 flex-1">
                {tab === 'positions' && <PositionsTable state={state} rows={positions} taken={taken} busy={busy} onPick={pick} run={run} />}
                {tab === 'orders' && <OrdersTable state={state} orders={orders} busy={busy} onPick={pick} run={run} />}
                {tab === 'history' && <HistoryTable state={state} onPick={pick} />}
              </div>
            </section>
          </div>

          <section className="panel h-[420px] flex-none md:h-[520px] xl:h-auto xl:min-h-0">
            <header className="flex h-8 flex-none items-center justify-between border-b border-line pr-2.5">
              <div role="tablist" aria-label="Book or trades" className="flex h-full">
                {(['book', 'trades'] as const).map((id) => (
                  <button key={id} role="tab" aria-selected={side === id} onClick={() => setSide(id)} className={cx('px-3 text-[13px]', side === id ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                    {id === 'book' ? 'Order Book' : 'Trades'}
                  </button>
                ))}
              </div>
              {side === 'book' && (
                <select value={group} onChange={(e) => setGroup(Number(e.target.value))} aria-label="Group prices by" className="num h-6 cursor-pointer rounded-sm border border-line-2 bg-raised px-1 text-[12px] text-fg hover:border-fg-3">
                  {groupSteps(m.spec.priceTick).map((s, i) => <option key={s} value={i}>{s.toLocaleString('en-US', { maximumFractionDigits: 10 })}</option>)}
                </select>
              )}
            </header>
            <div className="scroll min-h-0 flex-1">
              {side === 'book' ? <OrderBook m={m} rows={12} now={state.at} step={groupSteps(m.spec.priceTick)[group]} /> : <Tape m={m} limit={40} />}
            </div>
          </section>

          <Ticket key={sym} state={state} m={m} taken={taken[sym]} onDone={setNotice} onError={setError} />
        </div>
      ) : (
        <Notice>Waiting for market data.</Notice>
      )}
    </div>
  );
}

// ---- the order ticket ----

const pctFrom = (from: number, to: number, long: boolean) => ((to / from - 1) * 100) * (long ? 1 : -1);
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const decimalsOf = (step: number) => Math.max(0, Math.min(10, Math.ceil(-Math.log10(step) - 1e-9)));

function Ticket({ state, m, taken, onDone, onError }: { state: DashboardState; m: MarketState; taken?: 'maker' | 'plan'; onDone: (s: string) => void; onError: (s: string | null) => void }) {
  const [kind, setKind] = useState<ManualKind>('market');
  const [side, setSide] = useState<Side>('bid');
  const [priceStr, setPrice] = useState('');
  const [triggerStr, setTrigger] = useState('');
  const [sizeStr, setSize] = useState('');
  const [unit, setUnit] = useState<'usd' | 'coin'>('usd');
  const [leverage, setLeverage] = useState(() => Math.min(5, m.spec.maxLeverage));
  const [tif, setTif] = useState<'post' | 'ioc'>('post');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [withTpSl, setWithTpSl] = useState(false);
  const [tpStr, setTp] = useState('');
  const [slStr, setSl] = useState('');
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const filled = useRef(false);

  const long = side === 'bid';
  const pd = decimalsOf(m.spec.priceTick);
  const touch = (long ? m.bestAsk : m.bestBid) ?? m.mark;
  // A fresh limit ticket starts at the best price on its own side of the book, where it rests at the front.
  useEffect(() => {
    if (kind === 'limit' && !filled.current) {
      filled.current = true;
      setPrice(((long ? m.bestBid : m.bestAsk) ?? m.mark).toFixed(pd));
    }
  }, [kind, long, m.bestAsk, m.bestBid, m.mark, pd]);

  const price = kind === 'limit' ? num(priceStr) : kind === 'stop' ? num(triggerStr) : touch;
  const sizeIn = num(sizeStr);
  const size = !(sizeIn > 0) || !(price > 0) ? 0 : unit === 'usd' ? sizeIn / price : sizeIn;
  const steps = Math.floor(size / m.spec.sizeStep + 1e-9);
  const sizeRounded = steps * m.spec.sizeStep;
  const notional = sizeRounded * (price || 0);
  const free = state.manual.freeUsd;
  const pos = m.position.size;
  const closing = pos !== 0 && (pos > 0) !== long ? Math.min(Math.abs(pos), sizeRounded) : 0;
  const margin = reduceOnly ? 0 : ((sizeRounded - closing) * (price || 0)) / leverage;
  const feeBps = kind === 'limit' && tif === 'post' ? m.spec.makerFeeBps : m.spec.takerFeeBps;
  const maxUsd = free * leverage + (pos !== 0 && (pos > 0) !== long ? Math.abs(pos) * (price || m.mark) : 0);
  const tp = num(tpStr), sl = num(slStr);

  const setPct = (p: number) => {
    const usd = reduceOnly ? Math.abs(pos) * (price || m.mark) * p : maxUsd * p;
    if (!(usd > 0)) return setSize('');
    setSize(unit === 'usd' ? (Math.floor(usd * 100) / 100).toFixed(2) : (Math.floor(usd / (price || m.mark) / m.spec.sizeStep) * m.spec.sizeStep).toFixed(decimalsOf(m.spec.sizeStep)));
  };
  const flipUnit = () => {
    if (sizeIn > 0 && price > 0) setSize(unit === 'usd' ? sizeRounded.toFixed(decimalsOf(m.spec.sizeStep)) : (sizeIn * price).toFixed(2));
    setUnit(unit === 'usd' ? 'coin' : 'usd');
  };

  const submit = async () => {
    onError(null);
    setFieldError(null);
    if (!(steps > 0)) return setFieldError(`Size is under one ${m.sym} step (${m.spec.sizeStep}).`);
    setSending(true);
    try {
      const placed = await api<ManualOrderView[]>('/manual/orders', {
        method: 'POST',
        body: {
          sym: m.sym, side, kind, size: sizeRounded, leverage, reduceOnly: reduceOnly || undefined,
          price: kind === 'limit' ? price : undefined, tif: kind === 'limit' ? tif : undefined, triggerPrice: kind === 'stop' ? price : undefined,
          tpPrice: kind === 'market' && withTpSl && tp > 0 ? tp : undefined, slPrice: kind === 'market' && withTpSl && sl > 0 ? sl : undefined,
        },
      });
      const what = `${long ? 'Buy' : 'Sell'} ${fmtSize(sizeRounded, m.spec)} ${m.sym}`;
      onDone(kind === 'market' ? `${what} sent at the market.${placed.length ? ` ${placed.length} protective order${placed.length > 1 ? 's' : ''} resting.` : ''}` : placed.length ? `${what} placed.` : `${what} sent; nothing left resting.`);
      setSize('');
    } catch (e) {
      setFieldError(e instanceof Error ? e.message.split('\n')[0] : 'Order failed.');
    } finally {
      setSending(false);
    }
  };

  const blocked = taken ? `${m.sym} is traded by ${taken === 'maker' ? 'the market maker' : 'a running plan'}. Stop it first, or pick another market.` : null;
  const label = 'flex items-center justify-between text-[12px] text-fg-3';

  return (
    <section className="panel flex-none md:col-span-2 xl:col-span-1 xl:min-h-0">
      <div className="scroll flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div role="tablist" aria-label="Order type" className="flex border-b border-line">
          {(['market', 'limit', 'stop'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setFieldError(null); }} className={cx('h-8 flex-1 text-[13px]', kind === k ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
              {k === 'stop' ? 'Stop Market' : k === 'limit' ? 'Limit' : 'Market'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-sm bg-raised p-0.5">
          {(['bid', 'ask'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => { setSide(s); filled.current = false; }} className={cx('h-8 rounded-sm text-[14px] font-semibold transition-colors', side === s ? (s === 'bid' ? 'bg-bid text-white' : 'bg-ask text-white') : 'text-fg-2 hover:text-fg')}>
              {s === 'bid' ? 'Buy / Long' : 'Sell / Short'}
            </button>
          ))}
        </div>

        <dl className="num grid gap-1 text-[12px]">
          <div className="flex justify-between"><dt className="font-sans text-fg-3">Available to Trade</dt><dd>{fmtUsd(free)}</dd></div>
          <div className="flex justify-between"><dt className="font-sans text-fg-3">Current Position</dt><dd className={pos > 0 ? 'text-bid-fg' : pos < 0 ? 'text-ask-fg' : undefined}>{pos === 0 ? '-' : `${fmtSize(pos, m.spec)} ${m.sym}`}</dd></div>
        </dl>

        {kind === 'limit' && (
          <label className="grid gap-1">
            <span className={label}>Price (USD)<button type="button" className="text-accent hover:underline" onClick={() => setPrice((m.mid ?? m.mark).toFixed(pd))}>Mid</button></span>
            <input className={cx(INPUT, 'num')} inputMode="decimal" value={priceStr} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
        {kind === 'stop' && (
          <label className="grid gap-1">
            <span className={label}>Trigger Price (USD)<span>mark {fmtPrice(m.mark, m.spec)}</span></span>
            <input className={cx(INPUT, 'num')} inputMode="decimal" placeholder={long ? 'above the mark' : 'below the mark'} value={triggerStr} onChange={(e) => setTrigger(e.target.value)} />
          </label>
        )}

        <label className="grid gap-1">
          <span className={label}>Size<button type="button" onClick={flipUnit} className="text-accent hover:underline">{unit === 'usd' ? 'USD' : m.sym} ⇄</button></span>
          <input className={cx(INPUT, 'num')} inputMode="decimal" placeholder={unit === 'usd' ? '0.00' : '0'} value={sizeStr} onChange={(e) => setSize(e.target.value)} />
          <span className="grid grid-cols-4 gap-1">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button key={p} type="button" onClick={() => setPct(p)} className="h-6 rounded-sm border border-line-2 text-[12px] text-fg-2 hover:bg-raised-2 hover:text-fg">{p * 100}%</button>
            ))}
          </span>
        </label>

        {!reduceOnly && (
          <label className="grid gap-1">
            <span className={label}>Leverage<span className="num text-fg">{leverage}x</span></span>
            <input type="range" min={1} max={m.spec.maxLeverage} step={1} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="accent-[var(--accent)]" />
          </label>
        )}

        {kind === 'limit' && (
          <div className="flex items-center gap-1 text-[12px]">
            <span className="mr-auto text-fg-3">Time in Force</span>
            {(['post', 'ioc'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tif === t} onClick={() => setTif(t)} title={t === 'post' ? 'Rests on the book as a maker order; rejected if it would take.' : 'Takes what it can at once; the rest is cancelled.'} className={cx('h-6 rounded-sm px-2', tif === t ? 'bg-raised-2 font-semibold text-fg' : 'text-fg-3 hover:text-fg')}>
                {t === 'post' ? 'Post Only' : 'IOC'}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-1.5 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={reduceOnly} onChange={(e) => { setReduceOnly(e.target.checked); if (e.target.checked) setWithTpSl(false); }} /> Reduce Only</label>
          {kind === 'market' && !reduceOnly && <label className="flex items-center gap-2"><input type="checkbox" checked={withTpSl} onChange={(e) => setWithTpSl(e.target.checked)} /> Take Profit / Stop Loss</label>}
        </div>
        {kind === 'market' && withTpSl && !reduceOnly && (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className={label}>TP Price{tp > 0 && <span className="num text-bid-fg">{pctFrom(touch, tp, long) >= 0 ? '+' : ''}{pctFrom(touch, tp, long).toFixed(2)}%</span>}</span>
              <input className={cx(INPUT, 'num')} inputMode="decimal" value={tpStr} onChange={(e) => setTp(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className={label}>SL Price{sl > 0 && <span className="num text-ask-fg">{pctFrom(touch, sl, long).toFixed(2)}%</span>}</span>
              <input className={cx(INPUT, 'num')} inputMode="decimal" value={slStr} onChange={(e) => setSl(e.target.value)} />
            </label>
          </div>
        )}

        {blocked ? <Notice tone="warn">{blocked}</Notice> : (
          <Button size="lg" onClick={() => void submit()} disabled={sending || !(steps > 0)} className={cx('w-full text-white', long ? '!bg-bid' : '!bg-ask')}>
            {sending ? 'Sending' : `${long ? 'Buy / Long' : 'Sell / Short'} ${m.sym}`}
          </Button>
        )}
        {fieldError && <p role="alert" className="text-[13px] text-ask-fg">{fieldError}</p>}

        <dl className="num grid gap-1 border-t border-line pt-2.5 text-[12px]">
          <div className="flex justify-between"><dt className="font-sans text-fg-3">Order Value</dt><dd>{notional > 0 ? fmtUsd(notional) : '-'}</dd></div>
          <div className="flex justify-between"><dt className="font-sans text-fg-3">Size</dt><dd>{steps > 0 ? `${fmtSize(sizeRounded, m.spec)} ${m.sym}` : '-'}</dd></div>
          <div className="flex justify-between"><dt className="font-sans text-fg-3">Margin Required</dt><dd className={margin > free ? 'text-ask-fg' : undefined}>{notional > 0 ? fmtUsd(margin) : '-'}</dd></div>
          <div className="flex justify-between"><dt className="font-sans text-fg-3">Fee</dt><dd>{notional > 0 ? `${fmtUsd((notional * feeBps) / 1e4, 4)} (${feeBps} bps ${kind === 'limit' && tif === 'post' ? 'maker' : 'taker'})` : `${feeBps} bps`}</dd></div>
          {kind === 'market' && <div className="flex justify-between"><dt className="font-sans text-fg-3">Max Slippage</dt><dd>0.5%</dd></div>}
        </dl>
        <p className="text-[12px] leading-relaxed text-fg-3">
          Hand-placed orders count toward your account&apos;s equity and daily loss limit, and a Kill closes them too. They stay out of the market maker&apos;s and plans&apos; results.
        </p>
      </div>
    </section>
  );
}

// ---- the blotter ----

type Run = (id: string, path: string, body?: unknown, done?: string) => Promise<boolean>;

function PositionsTable({ state, rows, taken, busy, onPick, run }: { state: DashboardState; rows: MarketState[]; taken: Partial<Record<MarketSym, 'maker' | 'plan'>>; busy: string | null; onPick: (s: MarketSym) => void; run: Run }) {
  const [editing, setEditing] = useState<MarketSym | null>(null);
  if (!rows.length) return <p className="px-2.5 py-4 text-[13px] text-fg-3">No open positions.</p>;
  const total = rows.reduce((a, x) => a + x.position.unrealizedUsd, 0);
  return (
    <table className="w-full min-w-[820px] text-[13px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Market</th><th>Side</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="text-right">Entry</th><th className="text-right">Mark</th>
          <th className="text-right">Open PnL</th><th className="pl-4">TP / SL</th><th className="pr-2.5 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map((x) => {
          const p = x.position;
          const long = p.size > 0;
          const pct = p.entryPrice ? (x.mark / p.entryPrice - 1) * (long ? 1 : -1) * 100 : 0;
          const own = state.manual.orders.filter((o) => o.sym === x.sym);
          const tp = own.find((o) => o.role === 'tp'), sl = own.find((o) => o.role === 'sl');
          const by = taken[x.sym];
          return [
            <tr key={x.sym} className="h-[28px] border-t border-line">
              <td className="pl-2.5 font-sans font-semibold"><span className="flex items-center gap-1.5"><CoinIcon sym={x.sym} /><SymButton sym={x.sym} onPick={onPick} />{by && <Tag>{by === 'maker' ? 'market maker' : 'plan'}</Tag>}</span></td>
              <td className={cx('font-sans', long ? 'text-bid-fg' : 'text-ask-fg')}>{long ? 'Long' : 'Short'}</td>
              <td className="text-right">{fmtSize(Math.abs(p.size), x.spec)} {x.sym}</td>
              <td className="text-right">{fmtUsd(Math.abs(p.notionalUsd))}</td>
              <td className="text-right">{fmtPrice(p.entryPrice, x.spec)}</td>
              <td className="text-right">{fmtPrice(x.mark, x.spec)}</td>
              <td className={cx('text-right', tone(p.unrealizedUsd))}>{fmtSigned(p.unrealizedUsd)} <span className="text-fg-3">({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</span></td>
              <td className="pl-4">
                <span className="text-bid-fg">{tp ? fmtPrice(tp.triggerPrice!, x.spec) : '-'}</span><span className="text-fg-3"> / </span><span className="text-ask-fg">{sl ? fmtPrice(sl.triggerPrice!, x.spec) : '-'}</span>
              </td>
              <td className="pr-2.5 text-right font-sans">
                {by ? <span className="text-[12px] text-fg-3">managed</span> : (
                  <span className="inline-flex gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(editing === x.sym ? null : x.sym)}>TP/SL</Button>
                    <Button size="xs" variant="danger" disabled={busy !== null} onClick={() => void run(`close:${x.sym}`, '/manual/close', { sym: x.sym }, `Closing ${x.sym} at the market.`)}>{busy === `close:${x.sym}` ? 'Closing' : 'Close'}</Button>
                  </span>
                )}
              </td>
            </tr>,
            editing === x.sym && !by ? <tr key={`${x.sym}:edit`} className="border-t border-line bg-raised"><td colSpan={9} className="px-2.5 py-2"><Protect m={x} tp={tp} sl={sl} busy={busy} run={run} onDone={() => setEditing(null)} /></td></tr> : null,
          ];
        })}
      </tbody>
      <tfoot className="num">
        <tr className="h-[24px] border-t border-line-2">
          <td colSpan={6} className="pl-2.5 font-sans text-fg-2">Total Open PnL</td>
          <td className={cx('text-right', tone(total))}>{fmtSigned(total)}</td>
          <td colSpan={2} />
        </tr>
      </tfoot>
    </table>
  );
}

function Protect({ m, tp, sl, busy, run, onDone }: { m: MarketState; tp?: ManualOrderView; sl?: ManualOrderView; busy: string | null; run: Run; onDone: () => void }) {
  const pd = decimalsOf(m.spec.priceTick);
  const [tpStr, setTp] = useState(tp?.triggerPrice?.toFixed(pd) ?? '');
  const [slStr, setSl] = useState(sl?.triggerPrice?.toFixed(pd) ?? '');
  const long = m.position.size > 0;
  const tpN = num(tpStr), slN = num(slStr);
  const pnlAt = (px: number) => m.position.size * (px - m.position.entryPrice);
  return (
    <div className="flex flex-wrap items-end gap-3 font-sans">
      <label className="grid gap-1 text-[12px] text-fg-3">
        Take Profit {tpN > 0 && <span className="num text-bid-fg">{fmtSigned(pnlAt(tpN))}</span>}
        <input className={cx(INPUT, 'num h-7 w-36')} inputMode="decimal" placeholder={long ? 'above mark' : 'below mark'} value={tpStr} onChange={(e) => setTp(e.target.value)} />
      </label>
      <label className="grid gap-1 text-[12px] text-fg-3">
        Stop Loss {slN > 0 && <span className="num text-ask-fg">{fmtSigned(pnlAt(slN))}</span>}
        <input className={cx(INPUT, 'num h-7 w-36')} inputMode="decimal" placeholder={long ? 'below mark' : 'above mark'} value={slStr} onChange={(e) => setSl(e.target.value)} />
      </label>
      <Button size="sm" disabled={busy !== null || !(tpN > 0 || slN > 0)} onClick={async () => {
        if (await run(`protect:${m.sym}`, '/manual/protect', { sym: m.sym, tpPrice: tpN > 0 ? tpN : undefined, slPrice: slN > 0 ? slN : undefined }, `${m.sym} take profit / stop loss set.`)) onDone();
      }}>{busy === `protect:${m.sym}` ? 'Setting' : 'Set'}</Button>
      <span className="text-[12px] text-fg-3">Reduce-only, for the whole position, triggered by the mark price.</span>
    </div>
  );
}

const ROLE: Record<ManualOrderView['role'], string> = { entry: '', close: 'reduce only', tp: 'take profit', sl: 'stop loss' };

function OrdersTable({ state, orders, busy, onPick, run }: { state: DashboardState; orders: ManualOrderView[]; busy: string | null; onPick: (s: MarketSym) => void; run: Run }) {
  if (!orders.length) return <p className="px-2.5 py-4 text-[13px] text-fg-3">No open orders. Limit and stop orders you place here, and the take profits and stop losses on your positions, show here until they fill or you cancel them.</p>;
  return (
    <table className="w-full min-w-[760px] text-[13px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Time</th><th>Market</th><th>Type</th><th>Side</th><th className="text-right">Size</th><th className="text-right">Price</th><th className="text-right">Trigger</th><th className="text-right">Value</th><th className="pr-2.5 text-right" />
        </tr>
      </thead>
      <tbody className="num">
        {orders.map((o) => {
          const spec = state.markets[o.sym]?.spec;
          const px = o.price ?? o.triggerPrice ?? state.markets[o.sym]?.mark ?? 0;
          return (
            <tr key={o.key} className="h-[26px] border-t border-line">
              <td className="pl-2.5 text-fg-3">{fmtTime(o.placedAt)}</td>
              <td className="font-sans font-semibold"><SymButton sym={o.sym} onPick={onPick} /></td>
              <td className="font-sans">{o.kind === 'stop' ? 'Stop Market' : 'Limit'}{ROLE[o.role] && <span className="text-fg-3"> · {ROLE[o.role]}</span>}</td>
              <td className={cx('font-sans', o.side === 'bid' ? 'text-bid-fg' : 'text-ask-fg')}>{o.side === 'bid' ? 'Buy' : 'Sell'}</td>
              <td className="text-right">{fmtSize(o.size, spec)}</td>
              <td className="text-right">{o.price == null ? 'Market' : fmtPrice(o.price, spec)}</td>
              <td className="text-right">{o.triggerPrice == null ? '-' : fmtPrice(o.triggerPrice, spec)}</td>
              <td className="text-right">{fmtUsd(o.size * px)}</td>
              <td className="pr-2.5 text-right font-sans">
                <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => void run(`cancel:${o.key}`, '/manual/orders/cancel', { key: o.key })}>{busy === `cancel:${o.key}` ? 'Cancelling' : 'Cancel'}</Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HistoryTable({ state, onPick }: { state: DashboardState; onPick: (s: MarketSym) => void }) {
  const fills = state.manual.fills;
  if (!fills.length) return <p className="px-2.5 py-4 text-[13px] text-fg-3">No trades placed by hand yet.</p>;
  return (
    <table className="w-full min-w-[680px] text-[13px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Time</th><th>Market</th><th>Side</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="text-right">Fee</th><th className="pr-2.5 text-right">Realised PnL</th>
        </tr>
      </thead>
      <tbody className="num">
        {fills.map((f) => {
          const spec = state.markets[f.sym]?.spec;
          return (
            <tr key={f.id} className="h-[22px] border-t border-line">
              <td className="pl-2.5 text-fg-3">{fmtTime(f.ts)}</td>
              <td className="font-sans font-medium"><SymButton sym={f.sym} onPick={onPick} /></td>
              <td className={cx('font-sans', f.side === 'bid' ? 'text-bid-fg' : 'text-ask-fg')}>{f.side === 'bid' ? 'Buy' : 'Sell'}<span className="text-fg-3"> {f.isMaker ? 'maker' : 'taker'}</span></td>
              <td className="text-right">{fmtPrice(f.price, spec)}</td>
              <td className="text-right">{fmtSize(f.size, spec)}</td>
              <td className="text-right">{fmtUsd(f.price * f.size)}</td>
              <td className="text-right text-fg-2">{fmtUsd(f.feeUsd, 4)}</td>
              <td className={cx('pr-2.5 text-right', f.realizedUsd != null && tone(f.realizedUsd))}>{f.realizedUsd == null ? <span className="text-fg-3">-</span> : fmtSigned(f.realizedUsd)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Loading() {
  return (
    <div className="grid gap-1 p-1">
      <Skeleton className="h-14" />
      <div className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_300px_320px]">
        <Skeleton className="h-[520px]" /><Skeleton className="h-[520px]" /><Skeleton className="h-[520px]" />
      </div>
    </div>
  );
}
