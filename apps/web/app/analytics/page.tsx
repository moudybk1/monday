'use client';

import { ArrowDownLeftIcon, ArrowUpRightIcon, LightningIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { PxActivity, PxCohorts, PxFlows, PxFunding, PxHistory, PxLiquidation, PxMarketRisk, PxOverview, PxPosition, PxSignal, PxTrader, PxTraderStats, PxWindow } from '@monday/core';
import { CATS, Donut, EASE, HeatGrid, LineChart, Share, SignedBars, Sparkline, StackedBars, type Series, type Tone } from '@/components/charts';
import { AccountLink, Delta, Kpi, Num, Segments, Skew, Tabs, ago, liqText, liqTone, money, pct, price, signedMoney, tone } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, Tag, cx } from '@/components/ui';
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
/** A loss bucket starts below zero; the bottom one is open-ended (lo null). The top one (hi null) is the biggest winners. */
const lost = (b: { lo: number | null }) => b.lo == null || b.lo < 0;
/** Funding as a percentage paid every 8 hours, the convention on most perp venues, from a rate per interval. */
const per8h = (rate: number, intervalMin: number) => rate * (480 / Math.max(1, intervalMin)) * 100;
const int = (n: number) => Math.round(n).toLocaleString('en-US');

/** The terms on this page, in plain words. Each tile carries its own line as a hint; the row under the tiles shows them all. */
const GLOSSARY: readonly (readonly [string, string])[] = [
  ['Volume', 'The dollar value of everything traded. A trade counts once, at its price.'],
  ['Open interest', 'The size of all positions open right now, counted on one side: every long has a short against it.'],
  ['TVL', 'Collateral the exchange holds for everyone: free balances plus what is locked in positions.'],
  ['Fees', 'What traders paid the exchange on their fills. Taking liquidity costs more than making it.'],
  ['Traders', 'Accounts that filled at least one order in the window.'],
  ['Net flow', 'Deposits minus withdrawals: whether money came into the exchange or left it, on balance.'],
  ['Liquidated', 'Positions the exchange closed because their collateral ran too low, valued at the mark price.'],
  ['Funding', 'A payment between longs and shorts every funding interval, shown per 8 hours. Positive means longs pay shorts.'],
  ['Long / short', 'Open accounts on each side. Notional is always equal on both sides of a perp, so the count is what skews.'],
  ['Mark price', 'The price the exchange values positions at and liquidates against, taken from several spot venues.'],
];
const hintOf = (k: string) => GLOSSARY.find(([g]) => g === k)?.[1];

const N = ({ children }: { children: React.ReactNode }) => <span className="num text-fg">{children}</span>;
/** "12% more than yesterday", "about the same as yesterday", "2.3x yesterday". Null without a comparison. */
function vs(cur: number | null | undefined, prev: number | null | undefined, what: string): string | null {
  if (!cur || !prev) return null;
  const r = cur / prev;
  if (Math.abs(r - 1) < 0.02) return `about the same as ${what}`;
  if (r >= 2) return `${r.toFixed(1)}x ${what}`;
  return `${Math.round(Math.abs(r - 1) * 100)}% ${r > 1 ? 'more' : 'less'} than ${what}`;
}

/**
 * The last day in three sentences, written by rules from the same figures as the tiles and refreshed with them, so a
 * reader who never scrolls still leaves knowing what happened.
 */
function Summary({ o, dayAgo }: { o: PxOverview; dayAgo: { oiUsd: number } | null }) {
  const h = o.headline;
  const today = Math.floor(o.at / DAY) * DAY;
  const yesterday = o.daily.find((d) => d.t === today - DAY);
  const todayRow = o.daily.find((d) => d.t === today);
  const marketsVol = o.markets.reduce((s, m) => s + m.volume24hUsd, 0);
  const top = [...o.markets].sort((a, b) => b.volume24hUsd - a.volume24hUsd)[0];
  const topShare = top && marketsVol ? top.volume24hUsd / marketsVol : 0;
  const volVs = vs(h.volume24hUsd, yesterday?.volumeUsd, 'yesterday');
  const liq = h.liquidations24hUsd;
  // Which side was hit: from today's indexed day, a hint beside the 24-hour figure.
  const longShare = liq && todayRow?.coverage === 'full' && todayRow.liquidationsUsd && todayRow.liqLongUsd != null ? todayRow.liqLongUsd / todayRow.liquidationsUsd : null;
  const oiVs = dayAgo ? vs(h.openInterestUsd, dayAgo.oiUsd, 'a day ago') : null;
  const flow = h.netFlow24hUsd;
  return (
    <div className="panel min-w-0 rise px-3 py-2.5" style={{ '--i': 0.5 } as React.CSSProperties}>
      <p className="label">The last 24 hours, in plain words</p>
      <p className="mt-1.5 max-w-[96ch] text-[14px] leading-relaxed text-fg-2">
        Perpl traded <N>{money(h.volume24hUsd)}</N>{volVs ? `, ${volVs}` : ''}{h.activeTraders24h != null ? <>, across <N>{int(h.activeTraders24h)}</N> accounts</> : null}{top && topShare ? <>; <N>{top.sym}</N> was <N>{Math.round(topShare * 100)}%</N> of it</> : null}.{' '}
        {liq == null ? 'Liquidations for the day are still being indexed.' : liq > 0 ? <>The exchange liquidated <N>{money(liq)}</N> of positions{longShare != null ? `, ${longShare >= 0.5 ? 'mostly longs' : 'mostly shorts'}` : ''}.</> : 'No position was liquidated.'}{' '}
        {flow != null ? <>On balance <N>{money(Math.abs(flow))}</N> of collateral {flow >= 0 ? 'came in' : 'left'}</> : <>Open interest is <N>{money(h.openInterestUsd)}</N></>}
        {flow != null ? <>, and open interest is <N>{money(h.openInterestUsd)}</N>{oiVs ? `, ${oiVs}` : ''}.</> : oiVs ? `, ${oiVs}.` : '.'}
      </p>
    </div>
  );
}

/** Where the window's volume sits, and where today's open interest sits, market by market. */
function Shares({ o, win, winDays, today }: { o: PxOverview; win: PxWindow; winDays: number; today: number }) {
  const label = win === '24h' ? 'last 24h' : win === 'all' ? 'all time' : `last ${winDays} days`;
  const vol = win === '24h'
    ? o.markets.map((m) => ({ name: m.sym, value: m.volume24hUsd }))
    : Object.entries(o.daily.filter((d) => win === 'all' || d.t >= today - (winDays - 1) * DAY).reduce<Record<string, number>>((acc, d) => {
      for (const [k, v] of Object.entries(d.byMarket)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {})).map(([name, value]) => ({ name, value }));
  const oi = o.markets.map((m) => ({ name: m.sym, value: m.openInterestUsd }));
  const total = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);
  const centre = (v: number, k: string) => <><span className="num text-[15px] font-medium text-fg">{money(v)}</span><span className="label mt-0.5">{k}</span></>;
  return (
    <div className="grid gap-1 lg:grid-cols-2">
      <Panel title={`Volume by market, ${label}`} aside={<span className="hidden sm:inline">share of what was traded</span>} bodyClassName="p-3">
        <Donut parts={vol} format={money} label={`Volume by market, ${label}`} centre={centre(total(vol), 'traded')} />
      </Panel>
      <Panel title="Open interest by market" aside={<span className="hidden sm:inline">share of positions open now</span>} bodyClassName="p-3">
        <Donut parts={oi} format={money} label="Open interest by market" centre={centre(total(oi), 'open now')} />
      </Panel>
    </div>
  );
}

export default function StatsPage() {
  return <Suspense fallback={<Loading />}><Stats /></Suspense>;
}

function Stats() {
  const params = useSearchParams();
  const ov = useQuery({ queryKey: ['stats-overview'], queryFn: () => api<PxOverview>('/stats/overview'), refetchInterval: 15_000 });
  const risk = useQuery({ queryKey: ['stats-risk'], queryFn: () => api<Risk>('/stats/risk'), refetchInterval: 30_000 });
  const liqs = useQuery({ queryKey: ['stats-liqs'], queryFn: () => api<PxLiquidation[]>('/stats/liquidations?limit=200'), refetchInterval: 10_000 });
  const hist7 = useQuery({ queryKey: ['stats-history', 7], queryFn: () => api<PxHistory>('/stats/history?days=7'), refetchInterval: 60_000 });
  const [win, setWin] = useState<PxWindow>('24h');
  const [sym, setSym] = useState<string>(ALL);
  useEffect(() => {
    document.title = 'Analytics - Monday';
  }, []);
  // The ask bar names a market in the URL; the chart panel reads its own metric and range from the same place.
  useEffect(() => {
    const m = params.get('market');
    if (m) setSym(m);
    // The ask bar's "range" is the page's window: one control for every number and the chart.
    const r = params.get('range');
    if (r != null && ['0', '7', '30', '90'].includes(r)) setWin(r === '7' ? '7d' : r === '0' ? 'all' : '30d');
  }, [params]);

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

  // The deltas compare whole UTC days: the last 7 (or 30) finished days against the 7 (or 30) before them. Today is
  // still running, so counting it would make every window look a little worse than the last.
  const sum = (from: number, to: number, f: (d: PxOverview['daily'][number]) => number | null) => o.daily.filter((d) => d.t >= from && d.t < to).reduce((s, d) => s + (f(d) ?? 0), 0);
  const today = Math.floor(now / DAY) * DAY;
  const yesterday = o.daily.find((d) => d.t === today - DAY);
  const cur = (f: (d: PxOverview['daily'][number]) => number | null) => (win === '24h' || win === 'all' ? null : sum(today - winDays * DAY, today, f));
  const prev = (f: (d: PxOverview['daily'][number]) => number | null) => (win === '24h' ? (yesterday ? f(yesterday) : null) : win === 'all' ? null : sum(today - 2 * winDays * DAY, today - winDays * DAY, f));
  const vsLabel = win === '24h' ? 'vs yesterday' : win === '7d' ? 'vs prior 7D' : win === '30d' ? 'vs prior 30D' : undefined;
  const spark = (f: (d: PxOverview['daily'][number]) => number | null) => o.daily.slice(-21).map(f);
  const total = hist7.data?.total ?? [];
  const dayAgo = total.length > 2 && now - total[0].t >= 20 * 3_600_000 ? total.reduce((b, p) => (Math.abs(p.t - (now - DAY)) < Math.abs(b.t - (now - DAY)) ? p : b)) : null;
  const sampled = (f: (p: PxHistory['total'][number]) => number) => (total.length > 2 ? total.map(f) : []);
  // The window's own flows, liquidations and new accounts: the last 24 hours from the headline, longer windows summed
  // over their UTC days, today included, the same days as the volume and fee figures.
  const winLabel = win === 'all' ? 'all time' : win;
  const inWindow = (f: (d: PxOverview['daily'][number]) => number | null) => (win === '24h' ? null : o.daily.filter((d) => win === 'all' || d.t >= today - (winDays - 1) * DAY).reduce<number | null>((s, d) => (s == null || f(d) == null ? null : s + f(d)!), 0));
  const netFlow = win === '24h' ? h.netFlow24hUsd : inWindow((d) => (d.depositsUsd == null ? null : d.depositsUsd - (d.withdrawalsUsd ?? 0)));
  const liquidated = win === '24h' ? h.liquidations24hUsd : inWindow((d) => d.liquidationsUsd);
  const newAccounts = win === '24h' ? h.newAccounts24h : win === 'all' ? null : inWindow((d) => d.newAccounts);

  return (
    <div className="grid gap-1 pt-1">
      <div className="panel min-w-0 rise flex-row flex-wrap items-center justify-between gap-2 px-2.5 py-1.5" style={{ '--i': 0 } as React.CSSProperties}>
        <p className="text-[13px] text-fg-2">
          <span className="font-semibold text-fg">Perpl</span>, the perp order book on Monad. Live from Perpl&apos;s API and the Exchange contract{o.indexer.source === 'off' ? '' : <>, fills and flows indexed {o.indexer.source === 'hypersync' ? 'from genesis with Envio HyperSync' : 'over Monad RPC'}</>}.
        </p>
        <Segments label="Window" value={win} onChange={setWin} options={[['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['all', 'All']] as const} />
      </div>

      <Summary o={o} dayAgo={dayAgo} />

      <dl className="panel min-w-0 rise grid grid-cols-2 gap-px bg-line md:grid-cols-4 2xl:grid-cols-8" style={{ '--i': 1 } as React.CSSProperties}>
        <Kpi k={`Volume ${win === 'all' ? 'all time' : win}`} hint={hintOf('Volume')} n={vol} format={money} delta={<Delta now={win === '24h' ? h.volume24hUsd : cur((d) => d.volumeUsd)} prev={prev((d) => d.volumeUsd)} suffix={vsLabel} />} sub={win === '24h' ? `${money(h.volume7dUsd)} in 7 days` : `${money(vol / Math.min(winDays, o.daily.length))} a day`} spark={<Sparkline values={spark((d) => d.volumeUsd)} />} />
        <Kpi k="Open interest" hint={hintOf('Open interest')} n={h.openInterestUsd} format={money} delta={<Delta now={h.openInterestUsd} prev={dayAgo?.oiUsd} up="none" suffix="24h" />} sub="all open positions, one side" spark={<Sparkline values={sampled((p) => p.oiUsd)} tone="accent" />} />
        <Kpi k="TVL" hint={hintOf('TVL')} n={h.tvlUsd} format={money} delta={<Delta now={h.tvlUsd} prev={dayAgo?.tvlUsd} suffix="24h" />} sub="collateral the exchange holds" spark={<Sparkline values={sampled((p) => p.tvlUsd)} tone="accent" />} />
        {/* A fee rate is only meaningful when fees and volume cover the same days. */}
        <Kpi k={`Fees ${win === 'all' ? 'all time' : win}`} hint={hintOf('Fees')} v={fees == null ? 'n/a' : undefined} n={fees} format={(v) => money(v, true)} delta={<Delta now={win === '24h' ? h.fees24hUsd : cur((d) => d.feesUsd)} prev={win === '24h' ? o.daily.find((d) => d.t === today - DAY)?.feesUsd : prev((d) => d.feesUsd)} suffix={vsLabel} />} sub={!feesDone ? PARTIAL : vol ? `${((fees ?? 0) / vol * 100).toFixed(3)}% of volume` : undefined} spark={<Sparkline values={spark((d) => d.feesUsd)} />} />
        <Kpi k={`Traders ${win === 'all' ? '30d' : win}`} hint={hintOf('Traders')} v={traders == null ? 'n/a' : undefined} n={traders} format={int} delta={win === '24h' ? <Delta now={h.activeTraders24h} prev={o.daily.find((d) => d.t === today - DAY)?.traders} suffix="vs yesterday" /> : undefined} sub={tradersDone ? 'accounts that traded' : PARTIAL} spark={<Sparkline values={spark((d) => d.traders)} />} />
        <Kpi k={`Net flow ${winLabel}`} hint={hintOf('Net flow')} v={netFlow == null ? 'n/a' : undefined} n={netFlow} format={signedMoney} t={netFlow} sub={h.complete[win] ? 'deposits minus withdrawals' : PARTIAL} spark={<Sparkline values={spark((d) => (d.depositsUsd == null ? null : d.depositsUsd - (d.withdrawalsUsd ?? 0)))} />} />
        <Kpi k={`Liquidated ${winLabel}`} hint={hintOf('Liquidated')} v={liquidated == null ? 'n/a' : undefined} n={liquidated} format={money} sub={h.complete[win] ? 'closed by the exchange' : PARTIAL} spark={<Sparkline values={spark((d) => d.liquidationsUsd)} tone="ask" />} />
        <Kpi k="Accounts" n={h.accounts} format={int} delta={newAccounts != null ? <span className="num text-[12px] text-bid-fg">+{int(newAccounts)} <span className="font-sans text-fg-3">{winLabel}</span></span> : undefined} sub="ever opened" spark={<Sparkline values={spark((d) => d.newAccounts)} />} />
      </dl>

      <details className="panel min-w-0 rise px-3 py-2 text-[13px] text-fg-2" style={{ '--i': 1.5 } as React.CSSProperties}>
        <summary className="cursor-pointer select-none text-fg-3 hover:text-fg">What these numbers mean</summary>
        <dl className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {GLOSSARY.map(([k, v]) => <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2"><dt className="font-semibold text-fg">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </details>

      <div className="min-w-0 rise" style={{ '--i': 1.7 } as React.CSSProperties}><Shares o={o} win={win} winDays={winDays} today={today} /></div>

      <div className="min-w-0 rise grid gap-1 xl:h-[460px] xl:grid-cols-[minmax(0,1fr)_400px]" style={{ '--i': 2 } as React.CSSProperties}>
        <History o={o} sym={sym} onSym={setSym} win={win} />
        <LiquidationMap risk={risk.data} error={risk.isError} sym={sym === ALL ? undefined : sym} onSym={setSym} />
      </div>

      <div className="min-w-0 rise" style={{ '--i': 3 } as React.CSSProperties}><Spotlight liqs={liqs.data} now={now} /></div>

      <div className="min-w-0 rise" style={{ '--i': 3 } as React.CSSProperties}><Markets o={o} risk={risk.data} hist={hist7.data} pick={sym} onPick={(s) => setSym(s === sym ? ALL : s)} /></div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={{ '--i': 4 } as React.CSSProperties}>
        <Panel title="Closest to liquidation" aside={<span>{risk.data ? `${risk.data.positions} open positions` : ''}</span>} className="h-[420px]">
          {risk.data ? <PositionList rows={risk.data.nearest} /> : <Pending error={risk.isError} className="m-2 h-60" />}
        </Panel>
        <Panel title="Latest liquidations" aside={<span>{o.indexer.source === 'off' ? 'indexer off' : o.indexer.live ? 'live' : 'catching up'}</span>} className="h-[420px]">
          <LiquidationFeed rows={liqs.data} error={liqs.isError} since={since} />
        </Panel>
        <Panel title="Largest positions" aside={<span>open now, at mark</span>} className="h-[420px]">
          {risk.data ? <PositionList rows={risk.data.largest} /> : <Pending error={risk.isError} className="m-2 h-60" />}
        </Panel>
      </div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={{ '--i': 5 } as React.CSSProperties}>
        <Activity />
        <FundingNow o={o} />
        <Signals />
      </div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={{ '--i': 6 } as React.CSSProperties}>
        <WhoWins win={win} />
        <Retention />
        <Flows win={win} />
      </div>

      <div className="min-w-0 rise" style={{ '--i': 7 } as React.CSSProperties}>
        <Traders complete={(days) => (days === 1 ? o.daily.at(-1)?.coverage === 'full' : days === 7 ? h.complete['7d'] : days === 30 ? h.complete['30d'] : h.complete.all)} />
      </div>
    </div>
  );
}

/** Every metric in one panel: daily bars for the flows, sampled lines for the levels, Perpl's own history for funding. */
function History({ o, sym, onSym, win }: { o: PxOverview; sym: string; onSym: (s: string) => void; win: PxWindow }) {
  const params = useSearchParams();
  const [metric, setMetric] = useState<Metric>('volume');
  const [stack, setStack] = useState(false);
  useEffect(() => {
    const m = params.get('metric');
    if (METRICS.some(([k]) => k === m)) setMetric(m as Metric);
  }, [params]);
  // One window for the whole page: the chart follows it. A day is one bar, so 24H shows the last 7 days, today at the right.
  const range: 7 | 30 | 0 = win === '30d' ? 30 : win === 'all' ? 0 : 7;
  const sampledDays = range === 7 ? 7 : 30;
  const hist = useQuery({ queryKey: ['stats-history', sampledDays], queryFn: () => api<PxHistory>(`/stats/history?days=${sampledDays}`), refetchInterval: 60_000, enabled: SAMPLED.includes(metric) });
  const fund = useQuery({ queryKey: ['stats-funding', sampledDays], queryFn: () => api<PxFunding>(`/stats/funding?days=${sampledDays}`), refetchInterval: 600_000, enabled: metric === 'funding' });
  const reduce = useReducedMotion();

  const all = o.daily;
  const rows = all.filter((d) => !range || d.t >= Date.now() - range * DAY);
  type Row = (typeof rows)[number];
  // Every calendar day keeps its slot: a day not indexed yet is drawn hatched, never dropped or shown as zero.
  const indexed = (d: Row, v: number | null, tip: string) => d.coverage === 'none'
    ? { key: day(d.t), v: null, tip: `${shortDay(d.t)}: not indexed yet` }
    : { key: day(d.t), v, tip: d.coverage === 'partial' ? `${tip}, partly indexed so far` : tip, faded: d.coverage === 'partial' };
  const marketVol = (d: Row) => (sym === ALL ? d.volumeUsd : d.byMarket[sym] ?? 0);
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
    body = <SignedBars height={H} tone="bid" label={`Daily volume${marketLabel}`} format={money} lowLabel={low} highLabel={high} data={rows.map((d) => ({ key: day(d.t), v: marketVol(d), tip: `${shortDay(d.t)}: ${money(marketVol(d))} traded${sym === ALL ? `. Top: ${Object.entries(d.byMarket).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => `${s} ${money(v)}`).join(', ')}` : ` on ${sym}`}` }))} />;
    note = <>Volume comes from Perpl&apos;s own candles and goes back to launch.</>;
  } else if (metric === 'fees') {
    body = <SignedBars height={H} tone="bid" label="Daily fees" format={(v) => money(v, true)} lowLabel={low} highLabel={high} data={rows.map((d) => indexed(d, d.feesUsd, `${shortDay(d.t)}: ${money(d.feesUsd, true)} in fees`))} />;
  } else if (metric === 'traders') {
    body = <SignedBars height={H} tone="bid" label="Daily active traders" format={int} lowLabel={low} highLabel={high} data={rows.map((d) => indexed(d, d.traders, `${shortDay(d.t)}: ${d.traders} accounts traded`))} />;
  } else if (metric === 'fills') {
    body = <SignedBars height={H} tone="bid" label="Daily fills" format={int} lowLabel={low} highLabel={high} data={rows.map((d) => indexed(d, d.trades, `${shortDay(d.t)}: ${int(d.trades ?? 0)} fills (maker and taker sides)`))} />;
    note = <>A fill counts once for its maker and once for its taker.</>;
  } else if (metric === 'accounts') {
    body = <SignedBars height={H} tone="bid" label="New accounts per day" format={int} lowLabel={low} highLabel={high} data={rows.map((d) => indexed(d, d.newAccounts, `${shortDay(d.t)}: ${d.newAccounts} accounts opened`))} />;
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
    body = !hd ? <Pending error={hist.isError} className="h-[360px]" /> : n < 3
      ? <p className="flex h-[360px] items-center justify-center px-6 text-center text-[13px] text-fg-3">Sampling every five minutes{hd.since ? ` since ${shortTime(hd.since)}` : ''}. The line appears after a few samples.</p>
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
      byDay.set(k, [...(byDay.get(k) ?? []), per8h(p.rate, fm!.intervalMin)]);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, rs]) => ({ t, v: rs.reduce((a, b) => a + b, 0) / rs.length, n: rs.length }));
    body = !fd ? <Pending error={fund.isError} className="h-[360px]" /> : !days.length ? <p className="flex h-[360px] items-center justify-center text-[13px] text-fg-3">No funding history for {fsym}.</p>
      : <SignedBars height={H} label={`Average funding on ${fsym} per 8 hours, by day`} format={(v) => `${v.toFixed(4)}%`} lowLabel={shortDay(days[0].t)} highLabel={shortDay(days.at(-1)!.t)} data={days.map((d) => ({ key: day(d.t), v: d.v, tip: `${shortDay(d.t)}: ${pct(d.v, 4)} per 8 hours on average over ${d.n} intervals, ${d.v >= 0 ? 'longs paid shorts' : 'shorts paid longs'}` }))} />;
    note = <>{fsym}: each day&apos;s average rate per 8 hours. Teal days longs paid shorts, vermilion days the reverse. From Perpl&apos;s funding history{sym === ALL ? '; pick a market above for another' : ''}.</>;
  }

  return (
    <Panel
      // The metrics take the whole header; on a phone they still scroll, faded at the edge to say so.
      title={<Tabs size="sm" label="Metric" value={metric} onChange={setMetric} options={METRICS} className="max-md:pr-8 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)]" />}
      bodyClassName="p-2.5"
      className="min-h-[330px] xl:h-full"
    >
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 text-[13px] text-fg-3">
        <select value={sym} onChange={(e) => onSym(e.target.value)} aria-label="Market" className="h-6 rounded-sm border border-line-2 bg-raised px-1 text-[12px] text-fg">
          <option>{ALL}</option>
          {o.markets.map((m) => <option key={m.id} value={m.sym}>{m.sym}</option>)}
        </select>
        {metric === 'volume' && sym === ALL && <button type="button" onClick={() => setStack(!stack)} aria-pressed={stack} className={cx('num h-6 rounded-sm border px-2 text-[12px]', stack ? 'border-accent/45 bg-accent/12 text-accent' : 'border-line-2 text-fg-2 hover:bg-raised')}>By market</button>}
        <span className="num">{SAMPLED.includes(metric) || metric === 'funding' ? `last ${sampledDays} days` : range === 0 ? 'every day since launch' : `last ${range} days${win === '24h' ? ', today at the right' : ''}`}</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${metric}${stack}${sym}`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: EASE }}>
          {rows.length || SAMPLED.includes(metric) || metric === 'funding' ? body : <p className="flex h-[350px] items-center justify-center text-[13px] text-fg-3">The indexer has not covered a full day yet. This chart fills in as it catches up.</p>}
        </motion.div>
      </AnimatePresence>
      <p className="mt-1 text-[12px] text-fg-3">
        {metric !== 'volume' && !SAMPLED.includes(metric) && metric !== 'funding' && (o.indexer.backfillDays ? `${o.indexer.backfillDays} days are still being indexed, newest first: hatched days have no data yet, faded ones are partial. ` : 'Every day is indexed from the Exchange\'s events. ')}
        {note}
      </p>
    </Panel>
  );
}

function LiquidationMap({ risk, error, sym, onSym }: { risk?: Risk; error: boolean; sym?: string; onSym: (s: string) => void }) {
  const reduce = useReducedMotion();
  const [move, setMove] = useState(-3); // what if the price moves this many percent
  const m = risk?.markets.find((x) => x.sym === sym) ?? risk?.markets[0];
  if (!risk || !m) return <Panel title="Liquidation map" className="min-h-[330px] xl:h-full"><Pending error={error} className="m-2 h-64" /></Panel>;
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
        <select value={m.sym} onChange={(e) => onSym(e.target.value)} aria-label="Market" className="num h-6 rounded-sm border border-line-2 bg-raised px-1 text-[12px] text-fg">
          {risk.markets.map((x) => <option key={x.sym} value={x.sym}>{x.sym}</option>)}
        </select>
      }
      bodyClassName="px-2.5 py-2"
      className="min-h-[330px] xl:h-full"
    >
      <div className="grid grid-cols-2 gap-px bg-line text-[12px]">
        <div className="bg-canvas px-2 py-1.5"><span className="label">Longs at risk</span><p className="num mt-1 text-[14px] text-bid-fg">{money(m.atRiskLongUsd)}</p></div>
        <div className="bg-canvas px-2 py-1.5"><span className="label">Shorts at risk</span><p className="num mt-1 text-[14px] text-ask-fg">{money(m.atRiskShortUsd)}</p></div>
      </div>
      <p className="mt-1.5 text-[12px] text-fg-3">Open notional by liquidation price. Shorts liquidate above mark, longs below. At risk means within 5%.</p>
      <WhatIf m={m} move={move} onMove={setMove} />
      <div className="num mt-2 grid gap-px text-[12px]">
        {rows.map((r, i) => (
          <div key={`${r.side}${r.pct}`} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2" title={`${r.side === 'long' ? 'Longs' : 'Shorts'} liquidating ${r.pct - 1} to ${r.pct}% ${r.side === 'long' ? 'below' : 'above'} mark: ${money(r.usd)}`}>
            <span className="text-right text-fg-3">{price(r.px)}</span>
            <motion.span className="h-[7px] rounded-r-[1px]" style={{ minWidth: r.usd ? 2 : 0, background: r.side === 'long' ? 'var(--bid)' : 'var(--ask)' }} initial={reduce ? false : { width: 0 }} animate={{ width: `${(r.usd / max) * 100}%` }} transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.02, 0.4) }} />
            <span className={cx('text-right', r.usd ? 'text-fg-2' : 'text-fg-3/50')}>{r.usd ? money(r.usd) : ''}</span>
            {i === map.length - 1 && (
              <div className="col-span-3 my-0.5 flex items-center gap-2 text-[12px] text-accent"><span className="w-[4.5rem] text-right">{price(m.mark)}</span><span className="h-px flex-1 bg-accent/60" /><span>mark</span></div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Slide a price move and read what the Exchange would close: the map's buckets summed up to that distance. */
function WhatIf({ m, move, onMove }: { m: Risk['markets'][number]; move: number; onMove: (v: number) => void }) {
  const dist = Math.abs(move);
  const usd = m.map.filter((b) => b.pct <= Math.ceil(dist)).reduce((s, b) => s + (move < 0 ? b.longUsd : b.shortUsd), 0);
  const px = m.mark * (1 + move / 100);
  return (
    <div className="mt-2 rounded-sm border border-line bg-raised px-2 py-1.5 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-2">If {m.sym} {move < 0 ? 'falls' : 'rises'} <span className="num text-fg">{dist.toFixed(1)}%</span> to <span className="num text-fg">{price(px)}</span></span>
        <span className={cx('num text-[13px] font-medium', usd ? (move < 0 ? 'text-bid-fg' : 'text-ask-fg') : 'text-fg-3')}><Num value={usd} format={money} /> <span className="font-sans text-[12px] text-fg-3">of {move < 0 ? 'longs' : 'shorts'}</span></span>
      </div>
      <input type="range" min={-10} max={10} step={0.5} value={move} onChange={(e) => onMove(Number(e.target.value))} aria-label="Price move, percent" className="range mt-1 w-full" style={{ '--p': (move + 10) / 20 } as React.CSSProperties} />
      <div className="flex justify-between text-[12px] text-fg-3"><span>-10%</span><span>mark</span><span>+10%</span></div>
    </div>
  );
}

/** What is going on in a market right now, as short flags. Each one is a threshold a reader can check in the row. */
function setups(m: PxOverview['markets'][number], o: PxOverview, risk?: Risk): { text: string; tone: 'warn' | 'ask' | 'accent' | 'neutral'; title: string }[] {
  const out: { text: string; tone: 'warn' | 'ask' | 'accent' | 'neutral'; title: string }[] = [];
  const n = m.longs + m.shorts;
  const skew = n ? m.longs / n : 0.5;
  const a = per8h(m.fundingRate, m.fundingIntervalMin);
  if (n >= 10 && skew >= 0.7) out.push({ text: 'Crowded long', tone: 'warn', title: `${(skew * 100).toFixed(0)}% of ${n} open accounts are long` });
  if (n >= 10 && skew <= 0.3) out.push({ text: 'Crowded short', tone: 'warn', title: `${((1 - skew) * 100).toFixed(0)}% of ${n} open accounts are short` });
  // 0.03% every 8 hours is about 33% a year: a side that is paying to stay crowded.
  if (Math.abs(a) >= 0.03) out.push({ text: `Funding ${pct(a, 3)}`, tone: a > 0 ? 'ask' : 'accent', title: `${a > 0 ? 'Longs pay shorts' : 'Shorts pay longs'} ${Math.abs(a).toFixed(4)}% every 8 hours at the last 8 hours' average rate` });
  const prev = o.daily.slice(-8, -1).map((d) => d.byMarket[m.sym] ?? 0);
  const avg = prev.length ? prev.reduce((x, y) => x + y, 0) / prev.length : 0;
  if (avg > 0 && m.volume24hUsd >= 2 * avg) out.push({ text: `Volume ${(m.volume24hUsd / avg).toFixed(1)}x`, tone: 'accent', title: `${money(m.volume24hUsd)} in 24h against ${money(avg)} a day over the previous week` });
  const r = risk?.markets.find((x) => x.sym === m.sym);
  if (r && m.openInterestUsd > 0 && (r.atRiskLongUsd + r.atRiskShortUsd) / (2 * m.openInterestUsd) >= 0.1) out.push({ text: 'Liq. risk', tone: 'ask', title: `${money(r.atRiskLongUsd + r.atRiskShortUsd)} within 5% of liquidation` });
  return out;
}

function Markets({ o, risk, hist, pick, onPick }: { o: PxOverview; risk?: Risk; hist?: PxHistory; pick: string; onPick: (s: string) => void }) {
  const oiTotal = Math.max(1, o.markets.reduce((s, m) => s + m.openInterestUsd, 0));
  const last14 = o.daily.slice(-14);
  // Open interest a day ago, from the samples, once a day of them exists.
  const oiAgo = (sym: string) => {
    const pts = hist?.markets[sym];
    if (!pts || pts.length < 3 || o.at - pts[0].t < 20 * 3_600_000) return null;
    return pts.reduce((b, p) => (Math.abs(p.t - (o.at - DAY)) < Math.abs(b.t - (o.at - DAY)) ? p : b)).oiUsd;
  };
  return (
    <Panel title="Markets" aside={<span className="hidden lg:inline">click a market to focus the chart and the map. Long/short is open accounts; vs ref. market compares 24h volume with the market where these perps are priced first</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-[13px]">
          <thead>
            <tr className="label h-7 text-left [&>th]:font-normal">
              <th className="pl-2.5">Market</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="text-right">Volume 24h</th><th className="pl-3">14 days</th>
              <th className="text-right">Open interest</th><th className="pl-3">OI share</th><th className="text-right" title="Paid every 8 hours, at the mean of the last 8 hours' funding intervals">Funding 8h</th><th className="text-right">Long / short</th><th className="text-right" title="Perpl's 24h volume as a share of the reference market's">vs ref. market</th><th className="pr-2.5 pl-3">Setups</th>
            </tr>
          </thead>
          <tbody className="num">
            {o.markets.map((m) => {
              const a = per8h(m.fundingRate, m.fundingIntervalMin);
              const on = m.sym === pick;
              const flags = setups(m, o, risk);
              const ago = oiAgo(m.sym);
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
                  <td className="text-right">{money(m.openInterestUsd)}{ago != null && <> <Delta now={m.openInterestUsd} prev={ago} up="none" /></>}</td>
                  <td className="pl-3"><span className="flex items-center gap-2"><Share value={m.openInterestUsd / oiTotal} className="w-16" /><span className="w-9 text-fg-3">{((m.openInterestUsd / oiTotal) * 100).toFixed(0)}%</span></span></td>
                  {m.fundingUnknown
                    ? <td className="text-right text-fg-3" title="Perpl did not return this market's funding just now">-</td>
                    : <td className="text-right" title={`8-hour average: ${(m.fundingRate * 100).toFixed(4)}% every ${m.fundingIntervalMin} min`}><span className={tone(m.fundingRate)}>{pct(a, 4)}</span></td>}
                  <td className="text-right"><Skew longs={m.longs} shorts={m.shorts} /></td>
                  <td className="text-right text-fg-2">{m.hlVolume24hUsd ? `${((m.volume24hUsd / m.hlVolume24hUsd) * 100).toFixed(m.volume24hUsd / m.hlVolume24hUsd < 0.01 ? 2 : 1)}%` : 'n/a'}</td>
                  <td className="pr-2.5 pl-3"><span className="flex flex-wrap gap-1">{flags.map((f) => <span key={f.text} title={f.title}><Tag tone={f.tone}>{f.text}</Tag></span>)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Today's names: the biggest winner and loser, the most active account and the largest liquidation of the last day. */
function Spotlight({ liqs, now }: { liqs?: PxLiquidation[]; now: number }) {
  const board = (sort: 'net' | 'loss' | 'volume') => ({ queryKey: ['stats-traders', 1, sort], queryFn: () => api<PxTrader[]>(`/stats/traders?days=1&sort=${sort}`), refetchInterval: 60_000 });
  const win = useQuery(board('net'));
  const loss = useQuery(board('loss'));
  const vol = useQuery(board('volume'));
  const w = win.data?.[0], l = loss.data?.[0], v = vol.data?.[0];
  const liq = liqs?.filter((x) => now - x.ts < DAY).sort((a, b) => b.usd - a.usd)[0];
  const cards: { k: string; who?: { account: number; address: string | null }; n?: number; format: (v: number) => string; t?: number; sub: string }[] = [
    { k: 'Biggest winner today', who: w, n: w && w.netUsd > 0 ? w.netUsd : undefined, format: signedMoney, t: 1, sub: w && w.netUsd > 0 ? `${money(w.volumeUsd)} traded, ${w.trades.toLocaleString('en-US')} fills` : 'nobody in the money yet' },
    { k: 'Biggest loser today', who: l, n: l && l.netUsd < 0 ? l.netUsd : undefined, format: signedMoney, t: -1, sub: l && l.netUsd < 0 ? `${money(l.volumeUsd)} traded, ${l.trades.toLocaleString('en-US')} fills` : 'nobody in the red yet' },
    { k: 'Most active today', who: v, n: v?.volumeUsd, format: money, sub: v ? `${v.trades.toLocaleString('en-US')} fills, ${signedMoney(v.netUsd)} net` : 'no fills yet' },
    { k: 'Largest liquidation 24h', who: liq, n: liq?.usd, format: money, t: -1, sub: liq ? `${liq.sym} ${liq.long ? 'long' : 'short'}, ${signedMoney(liq.pnl)}` : 'none in 24 hours' },
  ];
  return (
    <dl className="panel grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.k} className="min-w-0 bg-canvas px-3 py-2.5">
          <dt className="label truncate">{c.k}</dt>
          <dd className={cx('num mt-1.5 text-[17px] font-medium leading-none tracking-tight', c.n == null ? 'text-fg-3' : c.t === undefined ? 'text-fg' : tone(c.t))}>{c.n == null ? (win.isLoading ? '…' : 'n/a') : <Num value={c.n} format={c.format} />}</dd>
          <dd className="mt-1.5 flex items-center gap-2 truncate text-[12px] text-fg-3">{c.who && c.n != null && <AccountLink account={c.who.account} address={c.who.address} className="text-fg-2" />}<span className="truncate">{c.sub}</span></dd>
        </div>
      ))}
    </dl>
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
      {!a ? <Pending error={q.isError} className="h-44" /> : (
        <>
          <HeatGrid label="Volume by weekday and hour" rows={DAYS} cols={Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))} colLabelEvery={3} cell={18}
            cells={a.cells.map((c) => ({ r: c.dow, c: c.hour, v: c.usd, tip: `${DAYS[c.dow]} ${String(c.hour).padStart(2, '0')}:00 UTC: ${money(c.usd)} over ${int(c.trades)} trades` }))} />
          <p className="mt-2 text-[13px] text-fg-3">
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
  // A market whose funding Perpl did not return is left out rather than drawn at 0.
  const rows = o.markets.filter((m) => !m.fundingUnknown).map((m) => ({ sym: m.sym, v: per8h(m.fundingRate, m.fundingIntervalMin), oi: m.openInterestUsd })).sort((a, b) => b.v - a.v);
  const max = Math.max(0.001, ...rows.map((r) => Math.abs(r.v))); // a floor, so near-zero rates do not fill the bar
  return (
    <Panel title="Funding" aside={<span className="hidden sm:inline">per 8 hours, positive: longs pay shorts</span>} bodyClassName="px-2.5 py-2" className="min-h-[260px]">
      <div className="num grid gap-1 text-[12px]">
        {rows.map((r, i) => (
          <div key={r.sym} className="grid grid-cols-[2.5rem_1fr_4.5rem] items-center gap-2">
            <span className="font-sans font-medium text-fg">{r.sym}</span>
            <span className="relative h-3" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
              <motion.span className="absolute top-[3px] bottom-[3px]" style={{ background: r.v >= 0 ? 'var(--bid)' : 'var(--ask)', borderRadius: r.v >= 0 ? '0 1px 1px 0' : '1px 0 0 1px', left: r.v >= 0 ? '50%' : undefined, right: r.v < 0 ? '50%' : undefined }} initial={reduce ? false : { width: 0 }} animate={{ width: `${(Math.abs(r.v) / max) * 50}%` }} transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.03, 0.3) }} />
            </span>
            <span className={cx('text-right', tone(r.v))}>{pct(r.v, 4)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-fg-3">A crowded side pays the other every funding interval. Perpl sets each interval&apos;s rate in steps of 0.001%, so the last 8 hours are averaged. The chart&apos;s Funding tab shows how each rate moved.</p>
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
      {!f ? <Pending error={q.isError} className="m-2 h-44" /> : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-[12px]">
            <div className="bg-canvas px-2.5 py-1.5"><span className="label">Deposited</span><p className="num mt-1 text-[14px] text-bid-fg">{money(f.depositsUsd)} <span className="text-fg-3">by {f.depositors}</span></p></div>
            <div className="bg-canvas px-2.5 py-1.5"><span className="label">Withdrawn</span><p className="num mt-1 text-[14px] text-ask-fg">{money(f.withdrawalsUsd)} <span className="text-fg-3">by {f.withdrawers}</span></p></div>
          </div>
          {!rows.length ? <p className="px-2.5 py-3 text-[13px] text-fg-3">None in this window.</p> : (
            <table className="w-full text-[13px]">
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
      {!s ? <Pending error={q.isError} className="h-48" /> : (
        <>
          <div className="grid grid-cols-2 gap-px bg-line text-[12px]">
            <div className="bg-canvas px-2 py-1.5"><span className="label">Profitable</span><p className="num mt-1 text-[14px] text-bid-fg">{share(s.profitable)}</p><p className="truncate text-fg-3">{int(s.profitable)} of {int(decided)} with a result</p></div>
            <div className="bg-canvas px-2 py-1.5"><span className="label">Median result</span><p className={cx('num mt-1 text-[14px]', tone(s.medianNetUsd))}>{s.medianNetUsd == null ? 'n/a' : signedMoney(s.medianNetUsd)}</p><p className="truncate text-fg-3">mean {s.meanNetUsd == null ? 'n/a' : signedMoney(s.meanNetUsd)}</p></div>
          </div>
          {decided ? (
            <SignedBars
              height={150} label={`Accounts by net PnL, ${label}`} format={(v) => int(Math.abs(v))} lowLabel={s.buckets[0].label} highLabel={s.buckets.at(-1)!.label}
              data={s.buckets.map((b) => ({ key: b.label, v: lost(b) ? -b.n : b.n, tip: `${int(b.n)} account${b.n === 1 ? '' : 's'} ${lost(b) ? 'lost' : 'made'} ${b.label.replace(/^-|-\$/g, (m) => (m === '-' ? '' : '$'))}` }))}
            />
          ) : <p className="flex h-[150px] items-center justify-center text-[13px] text-fg-3">No realised results in this window yet.</p>}
          <p className="text-[12px] text-fg-3">Losses to the left, gains to the right, one bar per band. {s.flat ? `${int(s.flat)} more traded without closing anything.` : ''}</p>
          <div className="num mt-2 grid gap-1 text-[12px]">
            {([['Top 10 accounts', s.top10Share], ['Top 50 accounts', s.top50Share]] as const).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2"><span className="font-sans text-fg-3">{k}</span><Share value={v} tone="muted" /><span className="text-right text-fg">{(v * 100).toFixed(0)}%</span></div>
            ))}
            <p className="font-sans text-fg-3">of {money(s.volumeUsd)} account volume, {int(s.accounts)} accounts. Every trade counts for its buyer and its seller, so this is about twice the market volume.</p>
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
      {!c ? <Pending error={q.isError} className="m-2 h-48" /> : (
        <>
          <table className="w-full text-[13px]">
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
          <p className="px-2.5 py-1.5 text-[12px] text-fg-3">A trader joins the week of their first fill (weeks start Monday, UTC) and counts as back if they filled in that later week. A blank cell is a week that has not ended yet; faded weeks are not fully indexed yet.</p>
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
      {!q.data ? <Pending error={q.isError} className="m-2 h-48" /> : !q.data.length ? <p className="px-2.5 py-3 text-[13px] text-fg-3">Nothing large this week.</p> : (
        <ul className="text-[13px]">
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
    <table className="w-full text-[13px]">
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
function LiquidationFeed({ rows, error, since }: { rows?: PxLiquidation[]; error: boolean; since: number | null }) {
  const seen = useRef<Set<string> | null>(null);
  const reduce = useReducedMotion();
  const key = (l: PxLiquidation) => `${l.ts}${l.account}${l.sym}`;
  const fresh = new Set<string>();
  if (rows) {
    if (seen.current) for (const l of rows) if (!seen.current.has(key(l))) fresh.add(key(l));
    seen.current = new Set(rows.map(key));
  }
  if (!rows) return <Pending error={error} className="m-2 h-60" />;
  if (!rows.length) return <p className="px-2.5 py-4 text-[13px] text-fg-3">No liquidations{since ? ` since ${shortDay(since)}` : ''}. New ones appear here within seconds.</p>;
  return (
    <table className="w-full text-[13px]">
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
      {!complete(days) && <p className="border-b border-line px-2.5 py-1 text-[12px] text-warn">Partial history: some of these days are still being indexed.</p>}
      {!q.data ? <Pending error={q.isError} className="m-2 h-60" /> : !rows.length ? <p className="px-2.5 py-4 text-[13px] text-fg-3">No indexed fills in this window.</p> : (
        <table className="w-full text-[13px]">
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

/** A panel still waiting for its first answer. A failed request says so instead of pulsing forever; polling retries it. */
function Pending({ error, className }: { error: boolean; className?: string }) {
  return error ? <p className="px-2.5 py-3 text-[13px] text-warn">Could not load this. It tries again on its own.</p> : <Skeleton className={className} />;
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
