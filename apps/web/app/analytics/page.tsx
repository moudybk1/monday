'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { PxLiquidation, PxMarketRisk, PxOverview, PxPosition, PxTrader } from '@monday/core';
import { SignedBars } from '@/components/charts';
import { AccountLink, Kpi, Segments, Skew, ago, money, pct, price, signedMoney, tone } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, cx } from '@/components/ui';
import { api } from '@/lib/api';

// Protocol view. Headline numbers first, then one chart, the markets, and the risk that is building up right now.
// Every account on the page opens its wallet profile.

type Risk = { at: number; positions: number; markets: (PxMarketRisk & { map: { pct: number; longUsd: number; shortUsd: number }[] })[]; nearest: PxPosition[]; largest: PxPosition[] };
type Win = '24h' | '7d' | '30d' | 'all';
type Metric = 'volume' | 'fees' | 'traders' | 'flows' | 'liqs';

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

export default function StatsPage() {
  const ov = useQuery({ queryKey: ['stats-overview'], queryFn: () => api<PxOverview>('/stats/overview'), refetchInterval: 15_000 });
  const risk = useQuery({ queryKey: ['stats-risk'], queryFn: () => api<Risk>('/stats/risk'), refetchInterval: 30_000 });
  const liqs = useQuery({ queryKey: ['stats-liqs'], queryFn: () => api<PxLiquidation[]>('/stats/liquidations?limit=40'), refetchInterval: 10_000 });
  const [win, setWin] = useState<Win>('24h');
  const [sym, setSym] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Analytics - Monday';
  }, []);

  if (ov.isLoading) return <Loading />;
  if (ov.isError || !ov.data) return <div className="p-4"><Notice tone="warn">Could not load Perpl stats. {ov.error instanceof Error ? ov.error.message : ''}</Notice></div>;
  const o = ov.data;
  const h = o.headline;
  const pick = sym ?? risk.data?.markets[0]?.sym ?? o.markets[0]?.sym;
  // Indexed metrics only cover the days the indexer has seen; say so when the window reaches further back.
  const since = o.indexer.since;
  const partial = (days: number) => since == null || since > Date.now() - days * 86_400_000;
  const vol = { '24h': h.volume24hUsd, '7d': h.volume7dUsd, '30d': h.volume30dUsd, all: h.volumeAllUsd }[win];
  const fees = { '24h': h.fees24hUsd, '7d': h.fees7dUsd, '30d': h.fees30dUsd, all: h.feesAllUsd }[win];
  const traders = { '24h': h.activeTraders24h, '7d': h.activeTraders7d, '30d': h.activeTraders30d, all: null }[win];
  const winDays = { '24h': 1, '7d': 7, '30d': 30, all: 100_000 }[win];
  const sinceNote = since != null && partial(winDays) ? `since ${shortDay(since)}` : undefined;

  return (
    <div className="grid gap-1 pt-1">
      <div className="panel flex-row flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[12px] text-fg-2">
          <span className="font-semibold text-fg">Perpl</span>, the perp order book on Monad. Live from Perpl&apos;s API and the Exchange contract{o.indexer.source === 'off' ? '' : <>, fills and flows indexed {o.indexer.source === 'hypersync' ? 'from genesis with Envio HyperSync' : 'over Monad RPC'}</>}.
        </p>
        <Segments label="Window" value={win} onChange={setWin} options={[['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['all', 'All']] as const} />
      </div>

      <dl className="panel grid grid-cols-2 gap-px bg-line sm:grid-cols-4 xl:grid-cols-8">
        <Kpi k={`Volume ${win === 'all' ? 'all time' : win}`} v={money(vol)} sub={win === '24h' ? `${money(h.volume7dUsd)} in 7 days` : `${money(vol / Math.min(winDays, o.daily.length))} a day`} />
        <Kpi k="Open interest" v={money(h.openInterestUsd)} sub="one side, at mark" />
        <Kpi k="TVL" v={money(h.tvlUsd)} sub="collateral held by the Exchange" />
        <Kpi k={`Fees ${win === 'all' ? 'all time' : win}`} v={money(fees, true)} sub={sinceNote ?? (vol ? `${((fees ?? 0) / vol * 1e4).toFixed(2)} bps of volume` : undefined)} />
        <Kpi k={`Traders ${win === 'all' ? '30d' : win}`} v={(traders ?? h.activeTraders30d)?.toLocaleString('en-US') ?? 'n/a'} sub={sinceNote ?? 'accounts with a fill'} />
        <Kpi k="Net flow 24h" v={h.netFlow24hUsd == null ? 'n/a' : signedMoney(h.netFlow24hUsd)} t={h.netFlow24hUsd} sub="deposits minus withdrawals" />
        <Kpi k="Liquidated 24h" v={money(h.liquidations24hUsd)} sub={partial(1) ? sinceNote : 'notional at mark'} />
        <Kpi k="Accounts" v={h.accounts.toLocaleString('en-US')} sub="ever opened" />
      </dl>

      <div className="grid gap-1 xl:h-[440px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <History o={o} />
        <LiquidationMap risk={risk.data} sym={pick} onSym={setSym} />
      </div>

      <Markets o={o} pick={pick} onPick={setSym} />

      <div className="grid gap-1 lg:grid-cols-3">
        <Panel title="Closest to liquidation" aside={<span>{risk.data ? `${risk.data.positions} open positions` : ''}</span>} className="h-[420px]">
          {risk.data ? <PositionList rows={risk.data.nearest} /> : <Skeleton className="m-2 h-60" />}
        </Panel>
        <Panel title="Latest liquidations" aside={<span>live</span>} className="h-[420px]">
          <LiquidationFeed rows={liqs.data} since={since} />
        </Panel>
        <Traders />
      </div>
    </div>
  );
}

function History({ o }: { o: PxOverview }) {
  const [metric, setMetric] = useState<Metric>('volume');
  const [range, setRange] = useState<30 | 90 | 0>(90);
  const rows = o.daily.filter((d) => !range || d.t >= Date.now() - range * 86_400_000);
  const indexed = rows.filter((d) => d.feesUsd != null);
  const data =
    metric === 'volume' ? rows.map((d) => ({ key: day(d.t), v: d.volumeUsd, tip: `${shortDay(d.t)}: ${money(d.volumeUsd)} traded. Top: ${Object.entries(d.byMarket).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => `${s} ${money(v)}`).join(', ')}` }))
    : metric === 'fees' ? indexed.map((d) => ({ key: day(d.t), v: d.feesUsd ?? 0, tip: `${shortDay(d.t)}: ${money(d.feesUsd, true)} in fees` }))
    : metric === 'traders' ? indexed.map((d) => ({ key: day(d.t), v: d.traders ?? 0, tip: `${shortDay(d.t)}: ${d.traders} accounts traded` }))
    : metric === 'flows' ? rows.filter((d) => d.depositsUsd != null).map((d) => ({ key: day(d.t), v: (d.depositsUsd ?? 0) - (d.withdrawalsUsd ?? 0), tip: `${shortDay(d.t)}: ${money(d.depositsUsd)} in, ${money(d.withdrawalsUsd)} out` }))
    : rows.filter((d) => d.feesUsd != null).map((d) => ({ key: day(d.t), v: d.liquidationsUsd ?? 0, tip: `${shortDay(d.t)}: ${money(d.liquidationsUsd ?? 0)} liquidated` }));
  const fmt = metric === 'traders' ? (v: number) => String(Math.round(v)) : (v: number) => money(v);
  const toneOf = metric === 'flows' ? undefined : metric === 'liqs' ? 'ask' : 'muted';

  return (
    <Panel
      title={
        <span className="flex items-center gap-3">
          <span role="tablist" aria-label="Metric" className="flex min-w-0 gap-3 overflow-x-auto">
            {([['volume', 'Volume'], ['fees', 'Fees'], ['traders', 'Traders'], ['flows', 'Net flows'], ['liqs', 'Liquidations']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={metric === k} onClick={() => setMetric(k)} className={cx('h-8 flex-none text-[12px]', metric === k ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'font-normal text-fg-3 hover:text-fg')}>{l}</button>
            ))}
          </span>
        </span>
      }
      aside={<Segments label="Range" value={range} onChange={setRange} options={[[30, '30D'], [90, '90D'], [0, 'All']] as const} />}
      bodyClassName="p-2.5"
      className="min-h-[330px] xl:h-full"
    >
      {data.length ? (
        <SignedBars height={350} tone={toneOf} label={`Daily ${metric}`} format={fmt} data={data} lowLabel={data[0] ? shortDay(Date.parse(data[0].key)) : ''} highLabel={data.at(-1) ? shortDay(Date.parse(data.at(-1)!.key)) : ''} />
      ) : (
        <p className="flex h-[350px] items-center justify-center text-[12px] text-fg-3">The indexer has not covered a full day yet. This chart fills in as it catches up.</p>
      )}
      {metric !== 'volume' && o.indexer.since != null && <p className="text-[11px] text-fg-3">Indexed from {shortDay(o.indexer.since)}. Volume comes from Perpl&apos;s own candles and goes back to launch.</p>}
    </Panel>
  );
}

function LiquidationMap({ risk, sym, onSym }: { risk?: Risk; sym?: string; onSym: (s: string) => void }) {
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
            <span className="h-[7px] rounded-r-[1px]" style={{ width: `${(r.usd / max) * 100}%`, minWidth: r.usd ? 2 : 0, background: r.side === 'long' ? 'var(--bid)' : 'var(--ask)' }} />
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

function Markets({ o, pick, onPick }: { o: PxOverview; pick?: string; onPick: (s: string) => void }) {
  return (
    <Panel title="Markets" aside={<span>long/short is open accounts; share is of Hyperliquid&apos;s 24h volume</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[11.5px]">
          <thead>
            <tr className="label h-7 text-left [&>th]:font-normal">
              <th className="pl-2.5">Market</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="text-right">Volume 24h</th>
              <th className="text-right">Open interest</th><th className="text-right">Funding</th><th className="text-right">Long / short</th><th className="pr-2.5 text-right">vs Hyperliquid</th>
            </tr>
          </thead>
          <tbody className="num">
            {o.markets.map((m) => {
              const apr = m.fundingRate * ((365 * 24 * 60) / Math.max(1, m.fundingIntervalMin)) * 100;
              return (
                <tr key={m.id} onClick={() => onPick(m.sym)} className={cx('h-[28px] cursor-pointer border-t border-line', m.sym === pick ? 'bg-raised' : 'hover:bg-raised')}>
                  <td className="pl-2.5 font-sans font-semibold">{m.sym}</td>
                  <td className="text-right">{price(m.mark)}</td>
                  <td className={cx('text-right', tone(m.change24hPct))}>{pct(m.change24hPct, 2)}</td>
                  <td className="text-right">{money(m.volume24hUsd)}</td>
                  <td className="text-right">{money(m.openInterestUsd)}</td>
                  <td className="text-right" title={`${(m.fundingRate * 100).toFixed(4)}% every ${m.fundingIntervalMin} min`}><span className={tone(m.fundingRate)}>{pct(apr, 1)}</span><span className="text-fg-3"> /yr</span></td>
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
            <td className={cx('pr-2.5 text-right', p.liqDistancePct < 2 ? 'text-ask-fg' : p.liqDistancePct < 5 ? 'text-warn' : 'text-fg-2')}>{p.liqDistancePct.toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LiquidationFeed({ rows, since }: { rows?: PxLiquidation[]; since: number | null }) {
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
          <tr key={`${l.ts}${l.account}${l.sym}`} className="h-[24px] border-t border-line">
            <td className="pl-2.5 text-fg-3">{ago(l.ts)}</td>
            <td><AccountLink account={l.account} address={l.address} /></td>
            <td><span className="font-sans font-medium">{l.sym}</span> <span className={l.long ? 'text-bid-fg' : 'text-ask-fg'}>{l.long ? 'long' : 'short'}</span></td>
            <td className="text-right">{money(l.usd)}</td>
            <td className={cx('pr-2.5 text-right', tone(l.pnl))}>{signedMoney(l.pnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Traders() {
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [sort, setSort] = useState<'net' | 'volume'>('net');
  const q = useQuery({ queryKey: ['stats-traders', days, sort], queryFn: () => api<PxTrader[]>(`/stats/traders?days=${days}&sort=${sort}`), refetchInterval: 60_000 });
  return (
    <Panel
      title="Top traders"
      aside={
        <>
          <Segments label="Sort" value={sort} onChange={setSort} options={[['net', 'PnL'], ['volume', 'Volume']] as const} />
          <Segments label="Days" value={days} onChange={setDays} options={[[1, '1D'], [7, '7D'], [30, '30D']] as const} />
        </>
      }
      className="h-[420px]"
    >
      {!q.data ? <Skeleton className="m-2 h-60" /> : !q.data.length ? <p className="px-2.5 py-4 text-[12px] text-fg-3">No indexed fills in this window yet.</p> : (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
              <th className="pl-2.5">#</th><th>Account</th><th className="text-right">Net PnL</th><th className="text-right">Volume</th><th className="pr-2.5 text-right">Fills</th>
            </tr>
          </thead>
          <tbody className="num">
            {q.data.map((t, i) => (
              <tr key={t.account} className="h-[24px] border-t border-line">
                <td className="pl-2.5 text-fg-3">{i + 1}</td>
                <td><AccountLink account={t.account} address={t.address} /></td>
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
