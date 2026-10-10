'use client';

import { ArrowDownLeftIcon, ArrowUpRightIcon, LightningIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PxActivity, PxCohorts, PxFlows, PxFunding, PxHistory, PxLiquidation, PxMarketRisk, PxOverview, PxPosition, PxSignal, PxTrader, PxTraderStats, PxWindow } from '@monday/core';
import { CATS, EASE, HeatGrid, LineChart, Share, SignedBars, Sparkline, StackedBars, type Series, type Tone } from '@/components/charts';
import { AccountLink, Delta, Kpi, Segments, Skew, Tabs, ago, liqText, liqTone, money, pct, price, signedMoney, tone } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, cx } from '@/components/ui';
import { api } from '@/lib/api';

// Protocol view. Headline numbers with their trend first, then one chart that can show every metric, the markets,
// the risk building up right now, who is moving money, and who is winning. Every account on the page opens its wallet.

type Risk = { at: number; positions: number; markets: (PxMarketRisk & { map: { pct: number; longUsd: number; shortUsd: number }[] })[]; nearest: PxPosition[]; largest: PxPosition[] };
type Metric = 'volume' | 'fees' | 'traders' | 'fills' | 'accounts' | 'flows' | 'liqs' | 'oi' | 'tvl' | 'skew' | 'funding';
const METRICS: readonly (readonly [Metric, string])[] = [
  ['volume', 'Volume'], ['oi', 'Open interest'], ['tvl', 'TVL'], ['fees', 'Fees'], ['traders', 'Traders'], ['accounts', 'New accounts'],
  ['flows', 'Net flows'], ['liqs', 'Liquidations'], ['funding', 'Funding'], ['skew', 'Long / short'], ['fills', 'Fills'],
];
const SAMPLED: Metric[] = ['oi', 'tvl', 'skew'];
const DAY = 86_400_000;
const ALL = 'All markets';

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const shortTime = (t: number) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const apr = (rate: number, intervalMin: number) => rate * ((365 * 24 * 60) / Math.max(1, intervalMin)) * 100;
const int = (n: number) => Math.round(n).toLocaleString('en-US');

export default function StatsPage() {
  const ov = useQuery({ queryKey: ['stats-overview'], queryFn: () => api<PxOverview>('/stats/overview'), refetchInterval: 15_000 });
  const risk = useQuery({ queryKey: ['stats-risk'], queryFn: () => api<Risk>('/stats/risk'), refetchInterval: 30_000 });
  const liqs = useQuery({ queryKey: ['stats-liqs'], queryFn: () => api<PxLiquidation[]>('/stats/liquidations?limit=40'), refetchInterval: 10_000 });
  const hist7 = useQuery({ queryKey: ['stats-history', 7], queryFn: () => api<PxHistory>('/stats/history?days=7'), refetchInterval: 60_000 });
  const [win, setWin] = useState<PxWindow>('24h');
  const [sym, setSym] = useState<string>(ALL);
  useEffect(() => {
    document.title = 'Analytics - Monday';
  }, []);

  if (ov.isLoading) return <Loading />;
  if (ov.isError || !ov.data) return <div className="p-4"><Notice tone="warn">Could not load Perpl stats. {ov.error instanceof Error ? ov.error.message : ''}</Notice></div>;
  const o = ov.data;
  const h = o.headline;
  const since = o.indexer.since;
  const now = o.at;
  const winDays = { '24h': 1, '7d': 7, '30d': 30, all: 100_000 }[win];
  const vol = { '24h': h.volume24hUsd, '7d': h.volume7dUsd, '30d': h.volume30dUsd, all: h.volumeAllUsd }[win];
  const fees = { '24h': h.fees24hUsd, '7d': h.fees7dUsd, '30d': h.fees30dUsd, all: h.feesAllUsd }[win];
  const traders = { '24h': h.activeTraders24h, '7d': h.activeTraders7d, '30d': h.activeTraders30d, all: h.activeTraders30d }[win];
  // Indexed numbers (fees, traders, flows, liquidations) say so whenever part of their window is not indexed yet.
  const PARTIAL = 'Partial history, still indexing';
  const feesDone = h.complete[win];
  const tradersDone = h.complete[win === 'all' ? '30d' : win];

  // The window before this one, for the deltas: whole UTC days, like the 7D and 30D figures themselves.
  const sum = (from: number, to: number, f: (d: PxOverview['daily'][number]) => number | null) => o.daily.filter((d) => d.t >= from && d.t < to).reduce((s, d) => s + (f(d) ?? 0), 0);
  const today = Math.floor(now / DAY) * DAY;
  const cur = (f: (d: PxOverview['daily'][number]) => number | null) => (win === '24h' || win === 'all' ? null : sum(today - (winDays - 1) * DAY, today + DAY, f));
  const prev = (f: (d: PxOverview['daily'][number]) => number | null) => (win === '24h' ? o.daily.find((d) => d.t === today - DAY)?.volumeUsd ?? null : win === 'all' ? null : sum(today - (2 * winDays - 1) * DAY, today - (winDays - 1) * DAY, f));
  const vsLabel = win === '24h' ? 'vs yesterday' : win === '7d' ? 'vs prior 7D' : win === '30d' ? 'vs prior 30D' : undefined;
  const spark = (f: (d: PxOverview['daily'][number]) => number | null) => o.daily.slice(-21).map(f);
  const total = hist7.data?.total ?? [];
  const dayAgo = total.length > 2 && now - total[0].t >= 20 * 3_600_000 ? total.reduce((b, p) => (Math.abs(p.t - (now - DAY)) < Math.abs(b.t - (now - DAY)) ? p : b)) : null;
  const sampled = (f: (p: PxHistory['total'][number]) => number) => (total.length > 2 ? total.map(f) : []);

  return (
    <div className="grid gap-1 pt-1">
      <div className="panel min-w-0 rise flex-row flex-wrap items-center justify-between gap-2 px-2.5 py-1.5" style={{ '--i': 0 } as React.CSSProperties}>
        <p className="text-[12px] text-fg-2">
          <span className="font-semibold text-fg">Perpl</span>, the perp order book on Monad. Live from Perpl&apos;s API and the Exchange contract{o.indexer.source === 'off' ? '' : <>, fills and flows indexed {o.indexer.source === 'hypersync' ? 'from genesis with Envio HyperSync' : 'over Monad RPC'}</>}.
        </p>
        <Segments label="Window" value={win} onChange={setWin} options={[['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['all', 'All']] as const} />
      </div>

      <dl className="panel min-w-0 rise grid grid-cols-2 gap-px bg-line md:grid-cols-4 2xl:grid-cols-8" style={{ '--i': 1 } as React.CSSProperties}>
        <Kpi k={`Volume ${win === 'all' ? 'all time' : win}`} n={vol} format={money} delta={<Delta now={win === '24h' ? h.volume24hUsd : cur((d) => d.volumeUsd)} prev={prev((d) => d.volumeUsd)} suffix={vsLabel} />} sub={win === '24h' ? `${money(h.volume7dUsd)} in 7 days` : `${money(vol / Math.min(winDays, o.daily.length))} a day`} spark={<Sparkline values={spark((d) => d.volumeUsd)} />} />
        <Kpi k="Open interest" n={h.openInterestUsd} format={money} delta={<Delta now={h.openInterestUsd} prev={dayAgo?.oiUsd} up="none" suffix="24h" />} sub="one side, at mark" spark={<Sparkline values={sampled((p) => p.oiUsd)} tone="accent" />} />
        <Kpi k="TVL" n={h.tvlUsd} format={money} delta={<Delta now={h.tvlUsd} prev={dayAgo?.tvlUsd} suffix="24h" />} sub="held by the Exchange" spark={<Sparkline values={sampled((p) => p.tvlUsd)} tone="accent" />} />
        {/* A fee rate is only meaningful when fees and volume cover the same days. */}
        <Kpi k={`Fees ${win === 'all' ? 'all time' : win}`} v={fees == null ? 'n/a' : undefined} n={fees} format={(v) => money(v, true)} delta={<Delta now={win === '24h' ? h.fees24hUsd : cur((d) => d.feesUsd)} prev={win === '24h' ? o.daily.find((d) => d.t === today - DAY)?.feesUsd : prev((d) => d.feesUsd)} suffix={vsLabel} />} sub={!feesDone ? PARTIAL : vol ? `${((fees ?? 0) / vol * 1e4).toFixed(2)} bps of volume` : undefined} spark={<Sparkline values={spark((d) => d.feesUsd)} />} />
        <Kpi k={`Traders ${win === 'all' ? '30d' : win}`} v={traders == null ? 'n/a' : undefined} n={traders} format={int} delta={win === '24h' ? <Delta now={h.activeTraders24h} prev={o.daily.find((d) => d.t === today - DAY)?.traders} suffix="vs yesterday" /> : undefined} sub={tradersDone ? 'accounts with a fill' : PARTIAL} spark={<Sparkline values={spark((d) => d.traders)} />} />
        <Kpi k="Net flow 24h" v={h.netFlow24hUsd == null ? 'n/a' : undefined} n={h.netFlow24hUsd} format={signedMoney} t={h.netFlow24hUsd} sub={h.complete['24h'] ? 'deposits minus withdrawals' : PARTIAL} spark={<Sparkline values={spark((d) => (d.depositsUsd == null ? null : d.depositsUsd - (d.withdrawalsUsd ?? 0)))} />} />
        <Kpi k="Liquidated 24h" v={h.liquidations24hUsd == null ? 'n/a' : undefined} n={h.liquidations24hUsd} format={money} sub={h.complete['24h'] ? 'notional at mark' : PARTIAL} spark={<Sparkline values={spark((d) => d.liquidationsUsd)} tone="ask" />} />
        <Kpi k="Accounts" n={h.accounts} format={int} delta={h.newAccounts24h != null ? <span className="num text-[11px] text-bid-fg">+{h.newAccounts24h} <span className="font-sans text-fg-3">24h</span></span> : undefined} sub="ever opened" spark={<Sparkline values={spark((d) => d.newAccounts)} />} />
      </dl>

      <div className="min-w-0 rise grid gap-1 xl:h-[460px] xl:grid-cols-[minmax(0,1fr)_400px]" style={{ '--i': 2 } as React.CSSProperties}>
        <History o={o} sym={sym} onSym={setSym} />
        <LiquidationMap risk={risk.data} sym={sym === ALL ? undefined : sym} onSym={setSym} />
      </div>

      <div className="min-w-0 rise" style={{ '--i': 3 } as React.CSSProperties}><Markets o={o} pick={sym} onPick={(s) => setSym(s === sym ? ALL : s)} /></div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={{ '--i': 4 } as React.CSSProperties}>
        <Activity />
        <FundingNow o={o} />
        <Signals />
      </div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={{ '--i': 5 } as React.CSSProperties}>
        <WhoWins win={win} />
        <Retention />
        <Flows win={win} />
      </div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={{ '--i': 6 } as React.CSSProperties}>
        <Panel title="Closest to liquidation" aside={<span>{risk.data ? `${risk.data.positions} open positions` : ''}</span>} className="h-[420px]">
          {risk.data ? <PositionList rows={risk.data.nearest} /> : <Skeleton className="m-2 h-60" />}
        </Panel>
        <Panel title="Latest liquidations" aside={<span>{o.indexer.source === 'off' ? 'indexer off' : o.indexer.live ? 'live' : 'catching up'}</span>} className="h-[420px]">
          <LiquidationFeed rows={liqs.data} since={since} />
        </Panel>
        <Panel title="Largest positions" aside={<span>open now, at mark</span>} className="h-[420px]">
          {risk.data ? <PositionList rows={risk.data.largest} /> : <Skeleton className="m-2 h-60" />}
        </Panel>
      </div>

      <div className="min-w-0 rise" style={{ '--i': 7 } as React.CSSProperties}>
        <Traders complete={(days) => (days === 1 ? o.daily.at(-1)?.coverage === 'full' : days === 7 ? h.complete['7d'] : h.complete['30d'])} />
      </div>
    </div>
  );
}

/** Every metric in one panel: daily bars for the flows, sampled lines for the levels, Perpl's own history for funding. */
function History({ o, sym, onSym }: { o: PxOverview; sym: string; onSym: (s: string) => void }) {
  const [metric, setMetric] = useState<Metric>('volume');
  const [range, setRange] = useState<7 | 30 | 90 | 0>(30);
  const [stack, setStack] = useState(false);
  const sampledDays = range === 7 ? 7 : 30;
  const hist = useQuery({ queryKey: ['stats-history', sampledDays], queryFn: () => api<PxHistory>(`/stats/history?days=${sampledDays}`), refetchInterval: 60_000, enabled: SAMPLED.includes(metric) });
  const fund = useQuery({ queryKey: ['stats-funding', sampledDays], queryFn: () => api<PxFunding>(`/stats/funding?days=${sampledDays}`), refetchInterval: 600_000, enabled: metric === 'funding' });
  const reduce = useReducedMotion();

  const all = o.daily;
  const rows = all.filter((d) => !range || d.t >= Date.now() - range * DAY);
  const first = all.length - rows.length;
  type Row = (typeof rows)[number];
  // Every calendar day keeps its slot: a day not indexed yet is drawn hatched, never dropped or shown as zero.
  const indexed = (d: Row, v: number | null, tip: string) => d.coverage === 'none'
    ? { key: day(d.t), v: null, tip: `${shortDay(d.t)}: not indexed yet` }
    : { key: day(d.t), v, tip: d.coverage === 'partial' ? `${tip}, partly indexed so far` : tip, faded: d.coverage === 'partial' };
  const marketVol = (d: Row) => (sym === ALL ? d.volumeUsd : d.byMarket[sym] ?? 0);
  // The seven-day average rides over the bars on the same scale.
  const avg7 = (f: (d: Row) => number | null) => rows.map((_, i) => {
    const w = all.slice(Math.max(0, first + i - 6), first + i + 1).map(f).filter((v): v is number => v != null);
    return w.length >= 4 ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  const topMarkets = useMemo(() => Object.entries(rows.reduce<Record<string, number>>((acc, d) => { for (const [k, v] of Object.entries(d.byMarket)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {})).sort((a, b) => b[1] - a[1]).map(([k]) => k), [rows]);
  const marketsBySize = useMemo(() => [...o.markets].sort((a, b) => b.openInterestUsd - a.openInterestUsd).map((m) => m.sym), [o.markets]);

  const title = METRICS.find(([k]) => k === metric)![1];
  const low = rows[0] ? shortDay(rows[0].t) : '', high = rows.at(-1) ? shortDay(rows.at(-1)!.t) : '';
  const marketLabel = sym === ALL ? '' : ` ${sym}`;
  let body: React.ReactNode;
  let note: React.ReactNode = null;
  const H = 360;
  if (metric === 'volume' && stack && sym === ALL) {
    body = <StackedBars height={H} label="Daily volume by market" format={money} series={topMarkets.slice(0, 5)} lowLabel={low} highLabel={high} data={rows.map((d) => ({ key: day(d.t), parts: d.byMarket, tip: `${shortDay(d.t)}: ${money(d.volumeUsd)} traded` }))} />;
  } else if (metric === 'volume') {
    body = <SignedBars height={H} tone="muted" label={`Daily volume${marketLabel}`} format={money} lowLabel={low} highLabel={high} line={{ values: avg7(marketVol), name: '7-day average' }} data={rows.map((d) => ({ key: day(d.t), v: marketVol(d), tip: `${shortDay(d.t)}: ${money(marketVol(d))} traded${sym === ALL ? `. Top: ${Object.entries(d.byMarket).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => `${s} ${money(v)}`).join(', ')}` : ` on ${sym}`}` }))} />;
    note = <>Volume comes from Perpl&apos;s own candles and goes back to launch.</>;
  } else if (metric === 'fees') {
    body = <SignedBars height={H} tone="muted" label="Daily fees" format={(v) => money(v, true)} lowLabel={low} highLabel={high} line={{ values: avg7((d) => d.feesUsd), name: '7-day average' }} data={rows.map((d) => indexed(d, d.feesUsd, `${shortDay(d.t)}: ${money(d.feesUsd, true)} in fees`))} />;
  } else if (metric === 'traders') {
    body = <SignedBars height={H} tone="muted" label="Daily active traders" format={int} lowLabel={low} highLabel={high} line={{ values: avg7((d) => d.traders), name: '7-day average' }} data={rows.map((d) => indexed(d, d.traders, `${shortDay(d.t)}: ${d.traders} accounts traded`))} />;
  } else if (metric === 'fills') {
    body = <SignedBars height={H} tone="muted" label="Daily fills" format={int} lowLabel={low} highLabel={high} line={{ values: avg7((d) => d.trades), name: '7-day average' }} data={rows.map((d) => indexed(d, d.trades, `${shortDay(d.t)}: ${int(d.trades ?? 0)} fills (maker and taker sides)`))} />;
    note = <>A fill counts once for its maker and once for its taker.</>;
  } else if (metric === 'accounts') {
    body = <SignedBars height={H} tone="muted" label="New accounts per day" format={int} lowLabel={low} highLabel={high} line={{ values: avg7((d) => d.newAccounts), name: '7-day average' }} data={rows.map((d) => indexed(d, d.newAccounts, `${shortDay(d.t)}: ${d.newAccounts} accounts opened`))} />;
  } else if (metric === 'flows') {
    body = <SignedBars height={H} label="Daily net flows" format={money} lowLabel={low} highLabel={high} data={rows.map((d) => indexed(d, d.depositsUsd == null ? null : d.depositsUsd - (d.withdrawalsUsd ?? 0), `${shortDay(d.t)}: ${money(d.depositsUsd)} in, ${money(d.withdrawalsUsd)} out`))} />;
    note = <>Teal days saw more deposited than withdrawn.</>;
  } else if (metric === 'liqs') {
    body = <StackedBars height={H} label="Daily liquidations, longs and shorts" format={money} series={['Longs', 'Shorts']} tones={{ Longs: 'bid', Shorts: 'ask' }} lowLabel={low} highLabel={high} data={rows.filter((d) => d.coverage !== 'none').map((d) => ({ key: day(d.t), parts: { Longs: d.liqLongUsd ?? 0, Shorts: d.liqShortUsd ?? 0 }, tip: `${shortDay(d.t)}: ${money(d.liquidationsUsd ?? 0)} liquidated` }))} />;
    note = <>Notional at the mark price when the position was closed by the Exchange.</>;
  } else if (metric === 'oi' || metric === 'tvl' || metric === 'skew') {
    const hd = hist.data;
    const pts = hd ? (metric === 'tvl' ? hd.total.map((p) => ({ t: p.t, v: p.tvlUsd })) : sym === ALL ? hd.total.map((p) => ({ t: p.t, v: p.oiUsd })) : (hd.markets[sym] ?? []).map((p) => ({ t: p.t, v: p.oiUsd }))) : [];
    const mk = hd && sym !== ALL ? hd.markets[sym] ?? [] : [];
    const series: Series[] = metric === 'skew'
      ? sym === ALL
        ? marketsBySize.slice(0, 4).map((s, i) => ({ name: s, tone: CATS[i], points: (hd?.markets[s] ?? []).map((p) => ({ t: p.t, v: p.longs + p.shorts ? (p.longs / (p.longs + p.shorts)) * 100 : null })) }))
        : [{ name: 'Long accounts', tone: 'bid', points: mk.map((p) => ({ t: p.t, v: p.longs })) }, { name: 'Short accounts', tone: 'ask', points: mk.map((p) => ({ t: p.t, v: p.shorts })) }]
      : [{ name: title, tone: 'accent', points: pts }];
    const n = series[0]?.points.length ?? 0;
    body = !hd ? <Skeleton className="h-[360px]" /> : n < 3
      ? <p className="flex h-[360px] items-center justify-center px-6 text-center text-[12px] text-fg-3">Sampling every five minutes{hd.since ? ` since ${shortTime(hd.since)}` : ''}. The line appears after a few samples.</p>
      : <div style={{ height: H }}><LineChart label={`${title}${marketLabel} over time`} format={metric === 'skew' ? (sym === ALL ? (v) => `${v.toFixed(0)}% long` : int) : money} timeFormat={sampledDays === 7 ? shortTime : shortDay} series={series} area={metric !== 'skew'} /></div>;
    note = <>{metric === 'skew' ? (sym === ALL ? 'Share of open accounts that are long, the four largest markets by open interest. ' : 'Accounts long and short. Notional is always equal on both sides of a perp, so the count is the skew. ') : ''}Read from the Exchange every five minutes{hd?.since ? `, since ${shortTime(hd.since)}` : ''}.</>;
  } else {
    // A rate per 43-minute interval flips sign all day: the day's average is what a position actually paid or earned.
    const fd = fund.data;
    const fsym = sym === ALL ? marketsBySize[0] : sym;
    const fm = fd?.markets[fsym];
    const byDay = new Map<number, number[]>();
    for (const p of fm?.points ?? []) {
      const k = Math.floor(p.t / DAY) * DAY;
      byDay.set(k, [...(byDay.get(k) ?? []), apr(p.rate, fm!.intervalMin)]);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, rs]) => ({ t, v: rs.reduce((a, b) => a + b, 0) / rs.length, n: rs.length }));
    body = !fd ? <Skeleton className="h-[360px]" /> : !days.length ? <p className="flex h-[360px] items-center justify-center text-[12px] text-fg-3">No funding history for {fsym}.</p>
      : <SignedBars height={H} label={`Average funding on ${fsym} per day, annualised`} format={(v) => `${v.toFixed(1)}%`} lowLabel={shortDay(days[0].t)} highLabel={shortDay(days.at(-1)!.t)} data={days.map((d) => ({ key: day(d.t), v: d.v, tip: `${shortDay(d.t)}: ${pct(d.v, 1)} a year on average over ${d.n} intervals, ${d.v >= 0 ? 'longs paid shorts' : 'shorts paid longs'}` }))} />;
    note = <>{fsym}: each day&apos;s average rate, annualised. Teal days longs paid shorts, vermilion days the reverse. From Perpl&apos;s funding history{sym === ALL ? '; pick a market above for another' : ''}.</>;
  }

  return (
    <Panel
      title={<Tabs size="sm" label="Metric" value={metric} onChange={setMetric} options={METRICS} />}
      aside={
        <>
          <select value={sym} onChange={(e) => onSym(e.target.value)} aria-label="Market" className="h-6 rounded-sm border border-line-2 bg-raised px-1 text-[11px] text-fg">
            <option>{ALL}</option>
            {o.markets.map((m) => <option key={m.id} value={m.sym}>{m.sym}</option>)}
          </select>
          {metric === 'volume' && sym === ALL && <button type="button" onClick={() => setStack(!stack)} aria-pressed={stack} className={cx('num h-6 rounded-sm border px-2 text-[11px]', stack ? 'border-accent/45 bg-accent/12 text-accent' : 'border-line-2 text-fg-2 hover:bg-raised')}>By market</button>}
          {SAMPLED.includes(metric) || metric === 'funding'
            ? <Segments label="Range" value={range === 7 ? 7 : 30} onChange={(v) => setRange(v)} options={[[7, '7D'], [30, '30D']] as const} />
            : <Segments label="Range" value={range} onChange={setRange} options={[[7, '7D'], [30, '30D'], [90, '90D'], [0, 'All']] as const} />}
        </>
      }
      bodyClassName="p-2.5"
      className="min-h-[330px] xl:h-full"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${metric}${stack}${sym}`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: EASE }}>
          {rows.length || SAMPLED.includes(metric) || metric === 'funding' ? body : <p className="flex h-[350px] items-center justify-center text-[12px] text-fg-3">The indexer has not covered a full day yet. This chart fills in as it catches up.</p>}
        </motion.div>
      </AnimatePresence>
      <p className="mt-1 text-[11px] text-fg-3">
        {metric !== 'volume' && !SAMPLED.includes(metric) && metric !== 'funding' && (o.indexer.backfillDays ? `${o.indexer.backfillDays} days are still being indexed, newest first: hatched days have no data yet, faded ones are partial. ` : 'Every day is indexed from the Exchange\'s events. ')}
        {note}
      </p>
    </Panel>
  );
}

function LiquidationMap({ risk, sym, onSym }: { risk?: Risk; sym?: string; onSym: (s: string) => void }) {
  const reduce = useReducedMotion();
  const m = risk?.markets.find((x) => x.sym === sym) ?? risk?.markets[0];
  if (!risk || !m) return <Panel title="Liquidation map" className="min-h-[330px] xl:h-full"><Skeleton className="m-2 h-64" /></Panel>;
  const map = m.map.slice(0, 12); // 12% either side keeps the ladder beside the chart; the rest is far from mark
  const max = Math.max(1, ...map.flatMap((b) => [b.longUsd, b.shortUsd]));
  type Row = { pct: number; side: 'long' | 'short'; usd: number; px: number };
  const rows: Row[] = [
    ...[...map].reverse().map((b): Row => ({ pct: b.pct, side: 'short', usd: b.shortUsd, px: m.mark * (1 + b.pct / 100) })),
    ...map.map((b): Row => ({ pct: b.pct, side: 'long', usd: b.longUsd, px: m.mark * (1 - b.pct / 100) })),
  ];
  return (
    <Panel
      title={`Liquidation map: ${m.sym}`}
      aside={
        <select value={m.sym} onChange={(e) => onSym(e.target.value)} aria-label="Market" className="num h-6 rounded-sm border border-line-2 bg-raised px-1 text-[11px] text-fg">
          {risk.markets.map((x) => <option key={x.sym} value={x.sym}>{x.sym}</option>)}
        </select>
      }
      bodyClassName="px-2.5 py-2"
      className="min-h-[330px] xl:h-full"
    >
      <div className="grid grid-cols-2 gap-px bg-line text-[11px]">
        <div className="bg-canvas px-2 py-1.5"><span className="label">Longs at risk</span><p className="num mt-1 text-[13px] text-bid-fg">{money(m.atRiskLongUsd)}</p></div>
        <div className="bg-canvas px-2 py-1.5"><span className="label">Shorts at risk</span><p className="num mt-1 text-[13px] text-ask-fg">{money(m.atRiskShortUsd)}</p></div>
      </div>
      <p className="mt-1.5 text-[11px] text-fg-3">Open notional by liquidation price. Shorts liquidate above mark, longs below. At risk means within 5%.</p>
      <div className="num mt-2 grid gap-px text-[10.5px]">
        {rows.map((r, i) => (
          <div key={`${r.side}${r.pct}`} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2" title={`${r.side === 'long' ? 'Longs' : 'Shorts'} liquidating ${r.pct - 1} to ${r.pct}% ${r.side === 'long' ? 'below' : 'above'} mark: ${money(r.usd)}`}>
            <span className="text-right text-fg-3">{price(r.px)}</span>
            <motion.span className="h-[7px] rounded-r-[1px]" style={{ minWidth: r.usd ? 2 : 0, background: r.side === 'long' ? 'var(--bid)' : 'var(--ask)' }} initial={reduce ? false : { width: 0 }} animate={{ width: `${(r.usd / max) * 100}%` }} transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.02, 0.4) }} />
            <span className={cx('text-right', r.usd ? 'text-fg-2' : 'text-fg-3/50')}>{r.usd ? money(r.usd) : ''}</span>
            {i === map.length - 1 && (
              <div className="col-span-3 my-0.5 flex items-center gap-2 text-[10.5px] text-accent"><span className="w-[4.5rem] text-right">{price(m.mark)}</span><span className="h-px flex-1 bg-accent/60" /><span>mark</span></div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Markets({ o, pick, onPick }: { o: PxOverview; pick: string; onPick: (s: string) => void }) {
  const oiTotal = Math.max(1, o.markets.reduce((s, m) => s + m.openInterestUsd, 0));
  const last14 = o.daily.slice(-14);
  return (
    <Panel title="Markets" aside={<span className="hidden lg:inline">click a market to focus the chart and the map. Long/short is open accounts; share is of Hyperliquid&apos;s 24h volume</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] text-[11.5px]">
          <thead>
            <tr className="label h-7 text-left [&>th]:font-normal">
              <th className="pl-2.5">Market</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="text-right">Volume 24h</th><th className="pl-3">14 days</th>
              <th className="text-right">Open interest</th><th className="pl-3">OI share</th><th className="text-right">Funding</th><th className="text-right">Long / short</th><th className="pr-2.5 text-right">vs Hyperliquid</th>
            </tr>
          </thead>
          <tbody className="num">
            {o.markets.map((m) => {
              const a = apr(m.fundingRate, m.fundingIntervalMin);
              const on = m.sym === pick;
              return (
                <tr
                  key={m.id} onClick={() => onPick(m.sym)} tabIndex={0} aria-selected={on}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(m.sym); } }}
                  className={cx('h-[30px] cursor-pointer border-t border-line transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', on ? 'bg-raised shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-raised')}
                >
                  <td className="pl-2.5 font-sans font-semibold">{m.sym}</td>
                  <td className="text-right">{price(m.mark)}</td>
                  <td className={cx('text-right', tone(m.change24hPct))}>{pct(m.change24hPct, 2)}</td>
                  <td className="text-right">{money(m.volume24hUsd)}</td>
                  <td className="pl-3"><div className="h-5 w-24"><Sparkline values={last14.map((d) => d.byMarket[m.sym] ?? 0)} fill={false} /></div></td>
                  <td className="text-right">{money(m.openInterestUsd)}</td>
                  <td className="pl-3"><span className="flex items-center gap-2"><Share value={m.openInterestUsd / oiTotal} className="w-16" /><span className="w-9 text-fg-3">{((m.openInterestUsd / oiTotal) * 100).toFixed(0)}%</span></span></td>
                  <td className="text-right" title={`${(m.fundingRate * 100).toFixed(4)}% every ${m.fundingIntervalMin} min`}><span className={tone(m.fundingRate)}>{pct(a, 1)}</span><span className="text-fg-3"> /yr</span></td>
                  <td className="text-right"><Skew longs={m.longs} shorts={m.shorts} /></td>
                  <td className="pr-2.5 text-right text-fg-2">{m.hlVolume24hUsd ? `${((m.volume24hUsd / m.hlVolume24hUsd) * 100).toFixed(m.volume24hUsd / m.hlVolume24hUsd < 0.01 ? 2 : 1)}%` : 'n/a'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Taker volume by UTC weekday and hour over the last week. */
function Activity() {
  const q = useQuery({ queryKey: ['stats-activity'], queryFn: () => api<PxActivity>('/stats/activity'), refetchInterval: 600_000 });
  const a = q.data;
  const peak = a ? a.cells.reduce((b, c) => (c.usd > b.usd ? c : b), a.cells[0]) : null;
  return (
    <Panel title="When Perpl trades" aside={<span className="hidden sm:inline">taker volume by hour, UTC, 7 days</span>} bodyClassName="p-2.5" className="min-h-[260px]">
      {!a ? <Skeleton className="h-44" /> : (
        <>
          <HeatGrid label="Volume by weekday and hour" rows={DAYS} cols={Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))} colLabelEvery={3} cell={18}
            cells={a.cells.map((c) => ({ r: c.dow, c: c.hour, v: c.usd, tip: `${DAYS[c.dow]} ${String(c.hour).padStart(2, '0')}:00 UTC: ${money(c.usd)} over ${int(c.trades)} trades` }))} />
          <p className="mt-2 text-[11.5px] text-fg-3">
            {money(a.usd)} over {int(a.trades)} trades, {money(a.trades ? a.usd / a.trades : 0)} each on average.{peak ? ` Busiest hour: ${DAYS[peak.dow]} ${String(peak.hour).padStart(2, '0')}:00 UTC, ${money(peak.usd)}.` : ''}
          </p>
        </>
      )}
    </Panel>
  );
}

/** Funding right now, every market on one scale: positive pays shorts. */
function FundingNow({ o }: { o: PxOverview }) {
  const reduce = useReducedMotion();
  const rows = [...o.markets].map((m) => ({ sym: m.sym, apr: apr(m.fundingRate, m.fundingIntervalMin), oi: m.openInterestUsd })).sort((a, b) => b.apr - a.apr);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.apr)));
  return (
    <Panel title="Funding now" aside={<span className="hidden sm:inline">annualised, positive: longs pay shorts</span>} bodyClassName="px-2.5 py-2" className="min-h-[260px]">
      <div className="num grid gap-1 text-[11px]">
        {rows.map((r, i) => (
          <div key={r.sym} className="grid grid-cols-[2.5rem_1fr_4rem] items-center gap-2">
            <span className="font-sans font-medium text-fg">{r.sym}</span>
            <span className="relative h-3" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
              <motion.span className="absolute top-[3px] bottom-[3px]" style={{ background: r.apr >= 0 ? 'var(--bid)' : 'var(--ask)', borderRadius: r.apr >= 0 ? '0 1px 1px 0' : '1px 0 0 1px', left: r.apr >= 0 ? '50%' : undefined, right: r.apr < 0 ? '50%' : undefined }} initial={reduce ? false : { width: 0 }} animate={{ width: `${(Math.abs(r.apr) / max) * 50}%` }} transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.03, 0.3) }} />
            </span>
            <span className={cx('text-right', tone(r.apr))}>{pct(r.apr, 1)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-fg-3">A crowded side pays the other every funding interval. The chart&apos;s Funding tab shows how each rate moved.</p>
    </Panel>
  );
}

/** Who moved collateral in the window: totals, then the largest depositors and withdrawers. */
function Flows({ win }: { win: PxWindow }) {
  const days = win === '24h' ? 1 : win === '7d' ? 7 : 30;
  const q = useQuery({ queryKey: ['stats-flows', days], queryFn: () => api<PxFlows>(`/stats/flows?days=${days}`), refetchInterval: 60_000 });
  const [side, setSide] = useState<'deposits' | 'withdrawals'>('deposits');
  const f = q.data;
  const rows = f?.[side] ?? [];
  const max = Math.max(1, ...rows.map((r) => r.usd));
  return (
    <Panel title={`Collateral flows ${days === 1 ? '24h' : `${days}D`}`} aside={<Segments label="Side" value={side} onChange={setSide} options={[['deposits', 'In'], ['withdrawals', 'Out']] as const} />} className="min-h-[260px] max-h-[360px]">
      {!f ? <Skeleton className="m-2 h-44" /> : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-[11px]">
            <div className="bg-canvas px-2.5 py-1.5"><span className="label">Deposited</span><p className="num mt-1 text-[13px] text-bid-fg">{money(f.depositsUsd)} <span className="text-fg-3">by {f.depositors}</span></p></div>
            <div className="bg-canvas px-2.5 py-1.5"><span className="label">Withdrawn</span><p className="num mt-1 text-[13px] text-ask-fg">{money(f.withdrawalsUsd)} <span className="text-fg-3">by {f.withdrawers}</span></p></div>
          </div>
          {!rows.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">None in this window.</p> : (
            <table className="w-full text-[11.5px]">
              <tbody className="num">
                {rows.map((r) => (
                  <tr key={r.account} className="h-[26px] border-t border-line first:border-t-0">
                    <td className="pl-2.5"><AccountLink account={r.account} address={r.address} /></td>
                    <td className="w-24 px-2"><Share value={r.usd / max} tone={side === 'deposits' ? 'bid' : 'ask'} /></td>
                    <td className="text-right text-fg-3">{r.n > 1 ? `${r.n}x` : ''}</td>
                    <td className={cx('pr-2.5 text-right', side === 'deposits' ? 'text-bid-fg' : 'text-ask-fg')}>{money(r.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}

/** Every account with a result in the window: how many came out ahead, how results spread, and who the volume belongs to. */
function WhoWins({ win }: { win: PxWindow }) {
  const days = win === '24h' ? 1 : win === '7d' ? 7 : win === '30d' ? 30 : 90;
  const q = useQuery({ queryKey: ['stats-trader-stats', days], queryFn: () => api<PxTraderStats>(`/stats/traders/stats?days=${days}`), refetchInterval: 60_000 });
  const s = q.data;
  const decided = s ? s.profitable + s.losing : 0;
  const share = (n: number) => `${((n / Math.max(1, decided)) * 100).toFixed(0)}%`;
  const label = days === 1 ? 'today' : `last ${days} days`;
  return (
    <Panel title="Who makes money" aside={<span className="hidden sm:inline">realised, after fees, {label}</span>} bodyClassName="p-2.5" className="min-h-[260px]">
      {!s ? <Skeleton className="h-48" /> : (
        <>
          <div className="grid grid-cols-2 gap-px bg-line text-[11px]">
            <div className="bg-canvas px-2 py-1.5"><span className="label">Profitable</span><p className="num mt-1 text-[13px] text-bid-fg">{share(s.profitable)}</p><p className="truncate text-fg-3">{int(s.profitable)} of {int(decided)} with a result</p></div>
            <div className="bg-canvas px-2 py-1.5"><span className="label">Median result</span><p className={cx('num mt-1 text-[13px]', tone(s.medianNetUsd))}>{s.medianNetUsd == null ? 'n/a' : signedMoney(s.medianNetUsd)}</p><p className="truncate text-fg-3">mean {s.meanNetUsd == null ? 'n/a' : signedMoney(s.meanNetUsd)}</p></div>
          </div>
          {decided ? (
            <SignedBars
              height={150} label={`Accounts by net PnL, ${label}`} format={(v) => int(Math.abs(v))} lowLabel={s.buckets[0].label} highLabel={s.buckets.at(-1)!.label}
              data={s.buckets.map((b) => ({ key: b.label, v: b.hi <= 0 ? -b.n : b.n, tip: `${int(b.n)} account${b.n === 1 ? '' : 's'} ${b.hi <= 0 ? 'lost' : 'made'} ${b.label.replace(/^-|-\$/g, (m) => (m === '-' ? '' : '$'))}` }))}
            />
          ) : <p className="flex h-[150px] items-center justify-center text-[12px] text-fg-3">No realised results in this window yet.</p>}
          <p className="text-[11px] text-fg-3">Losses to the left, gains to the right, one bar per band. {s.flat ? `${int(s.flat)} more traded without closing anything.` : ''}</p>
          <div className="num mt-2 grid gap-1 text-[11px]">
            {([['Top 10 accounts', s.top10Share], ['Top 50 accounts', s.top50Share]] as const).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2"><span className="font-sans text-fg-3">{k}</span><Share value={v} tone="muted" /><span className="text-right text-fg">{(v * 100).toFixed(0)}%</span></div>
            ))}
            <p className="font-sans text-fg-3">of {money(s.volumeUsd)} traded by {int(s.accounts)} accounts.</p>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Weekly cohorts: of the traders who first filled in a week, how many filled again one, two and four weeks later. */
function Retention() {
  const q = useQuery({ queryKey: ['stats-cohorts'], queryFn: () => api<PxCohorts>('/stats/cohorts'), refetchInterval: 600_000 });
  const c = q.data;
  const cell = (v: number | null) => (v == null ? undefined : { background: `color-mix(in oklab, var(--bid) ${Math.round(10 + v * 70)}%, var(--raised))` });
  return (
    <Panel title="Retention" aside={<span className="hidden xl:inline">share of a week&apos;s new traders active again later</span>} className="min-h-[260px]">
      {!c ? <Skeleton className="m-2 h-48" /> : (
        <>
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="label h-6 text-left [&>th]:font-normal"><th className="pl-2.5">Week of</th><th className="text-right">New</th>{c.offsets.map((k) => <th key={k} className="text-center">+{k} wk</th>)}</tr>
            </thead>
            <tbody className="num">
              {c.cohorts.map((r) => (
                <tr key={r.week} className={cx('h-[22px] border-t border-line', r.coverage !== 'full' && 'opacity-60')} title={r.coverage === 'full' ? undefined : r.coverage === 'none' ? 'This week is not indexed yet' : 'Part of this week is still being indexed'}>
                  <td className="pl-2.5 text-fg-2">{shortDay(r.week)}</td>
                  <td className="text-right">{r.size ? int(r.size) : <span className="text-fg-3">0</span>}</td>
                  {r.retained.map((v, i) => (
                    <td key={i} className="px-1 text-center"><span className="block rounded-[2px] py-0.5" style={cell(v)}>{v == null ? '' : r.size ? `${Math.round(v * 100)}%` : ''}</span></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2.5 py-1.5 text-[11px] text-fg-3">A trader joins the week of their first fill (weeks start Monday, UTC) and counts as back if they filled in that later week. Faded weeks are not fully indexed yet.</p>
        </>
      )}
    </Panel>
  );
}

const SIGNAL: Record<PxSignal['kind'], { Icon: typeof PlusIcon; cls: string; verb: string }> = {
  deposit: { Icon: ArrowDownLeftIcon, cls: 'text-bid-fg', verb: 'deposited' },
  withdraw: { Icon: ArrowUpRightIcon, cls: 'text-ask-fg', verb: 'withdrew' },
  liquidation: { Icon: LightningIcon, cls: 'text-ask-fg', verb: 'liquidated' },
  open: { Icon: PlusIcon, cls: 'text-accent', verb: 'opened' },
  close: { Icon: MinusIcon, cls: 'text-fg-2', verb: 'closed' },
};
/** The week's largest flows and liquidations and every large position seen opening or closing, newest first. */
function Signals() {
  const q = useQuery({ queryKey: ['stats-signals'], queryFn: () => api<PxSignal[]>('/stats/signals'), refetchInterval: 15_000 });
  const seen = useRef<Set<string> | null>(null);
  const reduce = useReducedMotion();
  const key = (x: PxSignal) => `${x.ts}${x.kind}${x.account}${x.sym ?? ''}`;
  const fresh = new Set<string>();
  if (q.data) {
    if (seen.current) for (const x of q.data) if (!seen.current.has(key(x))) fresh.add(key(x));
    seen.current = new Set(q.data.map(key));
  }
  return (
    <Panel title="Signals" aside={<span className="hidden sm:inline">largest flows and liquidations this week; positions over $50k as they open</span>} className="h-[360px]">
      {!q.data ? <Skeleton className="m-2 h-48" /> : !q.data.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">Nothing large this week.</p> : (
        <ul className="text-[11.5px]">
          {q.data.map((x) => {
            const { Icon, cls, verb } = SIGNAL[x.kind];
            return (
              <motion.li key={key(x)} className={cx('grid h-[30px] grid-cols-[2.2rem_1rem_1fr_auto] items-center gap-2 border-t border-line pr-2.5 first:border-t-0', fresh.has(key(x)) && 'flash')} initial={fresh.has(key(x)) && !reduce ? { opacity: 0, y: -10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
                <span className="num pl-2.5 text-fg-3">{ago(x.ts)}</span>
                <Icon size={13} weight="bold" className={cls} />
                <span className="truncate text-fg-2">
                  <AccountLink account={x.account} address={x.address} /> {verb} {x.sym && <span className="font-semibold text-fg">{x.sym} <span className={x.long ? 'text-bid-fg' : 'text-ask-fg'}>{x.long ? 'long' : 'short'}</span></span>}
                  {x.kind === 'liquidation' && x.pnl != null && <span className={cx('num', tone(x.pnl))}> {signedMoney(x.pnl)}</span>}
                </span>
                <span className="num text-fg">{money(x.usd)}</span>
              </motion.li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function PositionList({ rows }: { rows: PxPosition[] }) {
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
          <th className="pl-2.5">Account</th><th>Market</th><th className="text-right">Size</th><th className="text-right">Lev</th><th className="pr-2.5 text-right">To liq</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map((p) => (
          <tr key={`${p.sym}${p.account}`} className="h-[24px] border-t border-line">
            <td className="pl-2.5"><AccountLink account={p.account} address={p.address} /></td>
            <td><span className="font-sans font-medium">{p.sym}</span> <span className={p.long ? 'text-bid-fg' : 'text-ask-fg'}>{p.long ? 'long' : 'short'}</span></td>
            <td className="text-right">{money(p.usd)}</td>
            <td className="text-right text-fg-2">{p.leverage.toFixed(1)}x</td>
            <td className={cx('pr-2.5 text-right', liqTone(p.liqDistancePct))}>{liqText(p.liqDistancePct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** New liquidations slide in at the top with a tint in the side's colour. */
function LiquidationFeed({ rows, since }: { rows?: PxLiquidation[]; since: number | null }) {
  const seen = useRef<Set<string> | null>(null);
  const reduce = useReducedMotion();
  const key = (l: PxLiquidation) => `${l.ts}${l.account}${l.sym}`;
  const fresh = new Set<string>();
  if (rows) {
    if (seen.current) for (const l of rows) if (!seen.current.has(key(l))) fresh.add(key(l));
    seen.current = new Set(rows.map(key));
  }
  if (!rows) return <Skeleton className="m-2 h-60" />;
  if (!rows.length) return <p className="px-2.5 py-4 text-[12px] text-fg-3">No liquidations{since ? ` since ${shortDay(since)}` : ''}. New ones appear here within seconds.</p>;
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
          <th className="pl-2.5">Age</th><th>Account</th><th>Market</th><th className="text-right">Size</th><th className="pr-2.5 text-right">PnL</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map((l) => (
          <motion.tr key={key(l)} className={cx('h-[24px] border-t border-line', fresh.has(key(l)) && (l.long ? 'flash-down' : 'flash-up'))} initial={fresh.has(key(l)) && !reduce ? { opacity: 0, y: -10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <td className="pl-2.5 text-fg-3">{ago(l.ts)}</td>
            <td><AccountLink account={l.account} address={l.address} /></td>
            <td><span className="font-sans font-medium">{l.sym}</span> <span className={l.long ? 'text-bid-fg' : 'text-ask-fg'}>{l.long ? 'long' : 'short'}</span></td>
            <td className="text-right">{money(l.usd)}</td>
            <td className={cx('pr-2.5 text-right', tone(l.pnl))}>{signedMoney(l.pnl)}</td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}

/** Leaderboard by UTC day: Today, or the last 7, 30 or 90 days including today, the same days as the 7D and 30D numbers. */
function Traders({ complete }: { complete: (days: 1 | 7 | 30 | 90) => boolean }) {
  const [days, setDays] = useState<1 | 7 | 30 | 90>(7);
  const [sort, setSort] = useState<'net' | 'volume' | 'loss'>('net');
  const q = useQuery({ queryKey: ['stats-traders', days, sort], queryFn: () => api<PxTrader[]>(`/stats/traders?days=${days}&sort=${sort}`), refetchInterval: 60_000 });
  const rows = q.data ?? [];
  const max = Math.max(1, ...rows.map((t) => Math.abs(sort === 'volume' ? t.volumeUsd : t.netUsd)));
  const barTone = (t: PxTrader): Tone => (sort === 'volume' ? 'muted' : t.netUsd >= 0 ? 'bid' : 'ask');
  return (
    <Panel
      title={sort === 'loss' ? 'Biggest losers' : sort === 'volume' ? 'Most volume' : 'Top traders'}
      aside={
        <>
          <Segments label="Sort" value={sort} onChange={setSort} options={[['net', 'PnL'], ['loss', 'Losses'], ['volume', 'Volume']] as const} />
          <Segments label="Days" value={days} onChange={setDays} options={[[1, 'Today'], [7, '7D'], [30, '30D'], [90, '90D']] as const} />
        </>
      }
      className="h-[460px]"
    >
      {!complete(days) && <p className="border-b border-line px-2.5 py-1 text-[11px] text-warn">Partial history: some of these days are still being indexed.</p>}
      {!q.data ? <Skeleton className="m-2 h-60" /> : !rows.length ? <p className="px-2.5 py-4 text-[12px] text-fg-3">No indexed fills in this window.</p> : (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
              <th className="pl-2.5">#</th><th>Account</th><th className="w-[30%]" /><th className="text-right">Net PnL</th><th className="text-right">Volume</th><th className="pr-2.5 text-right">Fills</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((t, i) => (
              <tr key={t.account} className="h-[26px] border-t border-line transition-colors hover:bg-raised">
                <td className="pl-2.5 text-fg-3">{i + 1}</td>
                <td><AccountLink account={t.account} address={t.address} /></td>
                <td className="px-3"><Share value={Math.abs(sort === 'volume' ? t.volumeUsd : t.netUsd) / max} tone={barTone(t)} /></td>
                <td className={cx('text-right', tone(t.netUsd))}>{signedMoney(t.netUsd)}</td>
                <td className="text-right text-fg-2">{money(t.volumeUsd)}</td>
                <td className="pr-2.5 text-right text-fg-3">{t.trades.toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Loading() {
  return (
    <div className="grid gap-1 pt-1">
      <Skeleton className="h-9" />
      <Skeleton className="h-[74px]" />
      <div className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_400px]"><Skeleton className="h-[330px]" /><Skeleton className="h-[330px]" /></div>
      <Skeleton className="h-64" />
    </div>
  );
}
