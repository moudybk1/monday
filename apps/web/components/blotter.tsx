'use client';

import { usd, usdCompact, type DashboardState, type MarketState, type MarketSym, type Side } from '@monday/core';
import { ago, fmtBps, fmtPrice, fmtSigned, fmtSize, fmtTime, fmtUsd } from '@/lib/format';
import { quoteStanding, tone } from './agent';
import { cx } from './ui';

const HEAD = 'label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal';

/** Monday's resting orders, one row per side per market: where each sits against the book and how long it has stood. */
export function OpenOrders({ state }: { state: DashboardState }) {
  const rows: { m: MarketState; side: Side }[] = [];
  for (const m of Object.values(state.markets)) if (m) for (const side of ['bid', 'ask'] as const) if (m.quotes[side]) rows.push({ m, side });
  if (rows.length === 0) {
    return <p className="px-2.5 py-4 text-[12px] text-fg-3">{state.status === 'quoting' ? 'No order is resting right now. Monday places one as soon as the book, the signal and your limits allow it.' : 'Monday is not quoting, so nothing rests on the book.'}</p>;
  }
  return (
    <table className="w-full min-w-[720px] text-[11.5px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Market</th><th>Side</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Value</th>
          <th className="text-right" title="Distance from the book mid, in basis points">From mid</th>
          <th className="pl-4" title="What has to trade before this order does">Queue</th><th className="text-right">Standing</th><th className="pr-2.5 text-right">Age</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map(({ m, side }) => {
          const q = m.quotes[side]!;
          const mid = m.mid ?? m.mark;
          const dist = ((side === 'bid' ? mid - q.price : q.price - mid) / mid) * 1e4;
          const st = quoteStanding(m, side)!;
          const age = m.quoteAgeMs[side];
          return (
            <tr key={`${m.sym}:${side}`} className="h-[24px] border-t border-line">
              <td className="pl-2.5 font-sans font-semibold">{m.sym} <span className="font-normal text-fg-3">perp</span></td>
              <td className={cx('font-sans', side === 'bid' ? 'text-bid-fg' : 'text-ask-fg')}>{side === 'bid' ? 'Buy' : 'Sell'}</td>
              <td className="text-right">{fmtPrice(q.price, m.spec)}</td>
              <td className="text-right">{fmtSize(q.size, m.spec)}</td>
              <td className="text-right">{fmtUsd(q.price * q.size)}</td>
              <td className="text-right">{dist.toFixed(2)} bps</td>
              <td className="pl-4">{m.aheadUsd[side] == null ? '-' : m.aheadUsd[side]! < 1 ? 'nothing ahead' : `${usdCompact(m.aheadUsd[side]!)} ahead`}</td>
              <td className={cx('text-right font-sans', st.good ? 'text-bid-fg' : 'text-warn')}>{st.good ? 'at best price' : `behind, ${st.label}`}</td>
              <td className="pr-2.5 text-right text-fg-3">{age == null ? '-' : ago(state.at - age, state.at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One row per market in the policy: what Monday holds, at what entry, and how it is doing at the live mark. */
export function Positions({ state }: { state: DashboardState }) {
  const rows = Object.values(state.markets).filter((m): m is MarketState => Boolean(m) && (m!.inPolicy || m!.position.size !== 0));
  const open = rows.filter((m) => Math.abs(m.position.notionalUsd) >= 0.5);
  const total = open.reduce((a, m) => a + m.position.unrealizedUsd, 0);
  return (
    <table className="w-full min-w-[640px] text-[11.5px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Market</th><th>Side</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="text-right">Entry</th><th className="text-right">Mark</th><th className="text-right">Open PnL</th><th className="pr-2.5 text-right" title="Share of your inventory limit this position uses">Of limit</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map((m) => {
          const p = m.position;
          const flat = Math.abs(p.notionalUsd) < 0.5;
          const long = p.size > 0;
          const pct = flat || !p.entryPrice ? 0 : (m.mark / p.entryPrice - 1) * (long ? 1 : -1) * 100;
          return (
            <tr key={m.sym} className={cx('h-[24px] border-t border-line', flat && 'text-fg-3')}>
              <td className="pl-2.5 font-sans font-semibold text-fg">{m.sym} <span className="font-normal text-fg-3">perp</span></td>
              <td className={cx('font-sans', !flat && (long ? 'text-bid-fg' : 'text-ask-fg'))}>{flat ? 'Flat' : long ? 'Long' : 'Short'}</td>
              <td className="text-right">{flat ? '-' : `${fmtSize(Math.abs(p.size), m.spec)} ${m.sym}`}</td>
              <td className="text-right">{flat ? '-' : fmtUsd(Math.abs(p.notionalUsd))}</td>
              <td className="text-right">{flat ? '-' : fmtPrice(p.entryPrice, m.spec)}</td>
              <td className="text-right">{fmtPrice(m.mark, m.spec)}</td>
              <td className={cx('text-right', !flat && tone(p.unrealizedUsd))}>{flat ? '-' : <>{fmtSigned(p.unrealizedUsd)} <span className="text-fg-3">({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</span></>}</td>
              <td className="pr-2.5 text-right">{flat ? '-' : `${Math.round(Math.min(100, (Math.abs(p.notionalUsd) / state.policy.maxInventoryUsd) * 100))}%`}</td>
            </tr>
          );
        })}
      </tbody>
      {open.length > 0 && (
        <tfoot className="num">
          <tr className="h-[24px] border-t border-line-2">
            <td colSpan={6} className="pl-2.5 font-sans text-fg-2">Total open PnL</td>
            <td className={cx('text-right', tone(total))}>{fmtSigned(total)}</td>
            <td />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export function Fills({ state }: { state: DashboardState }) {
  if (state.fills.length === 0) return <p className="px-2.5 py-4 text-[12px] text-fg-3">No trades yet. A trade appears here when a taker trades against one of Monday&apos;s resting orders.</p>;
  const mk = (v: number | null) => (v == null ? <span className="text-fg-3">wait</span> : <span className={v >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{fmtBps(v)}</span>);
  return (
    <table className="w-full min-w-[640px] text-[11.5px]">
      <thead>
        <tr className={HEAD}>
          <th className="pl-2.5">Time</th><th>Market</th><th>Side</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="text-right">Fee</th><th className="pl-4">Regime</th>
          <th className="text-right" title="Price move after the fill, in basis points. Positive means the market moved Monday's way.">10s</th><th className="text-right">1m</th><th className="pr-2.5 text-right">5m</th>
        </tr>
      </thead>
      <tbody className="num">
        {state.fills.map((f) => {
          const spec = state.markets[f.sym]?.spec;
          return (
            <tr key={f.id} className="h-[22px] border-t border-line">
              <td className="pl-2.5 text-fg-3">{fmtTime(f.ts)}</td>
              <td className="font-sans font-medium">{f.sym}</td>
              <td className={cx('font-sans', f.side === 'bid' ? 'text-bid-fg' : 'text-ask-fg')}>{f.side === 'bid' ? 'Buy' : 'Sell'}{!f.isMaker && <span className="text-fg-3"> taker</span>}</td>
              <td className="text-right">{fmtPrice(f.price, spec)}</td>
              <td className="text-right">{fmtSize(f.size, spec)}</td>
              <td className="text-right">{fmtUsd(f.price * f.size)}</td>
              <td className="text-right text-fg-2">{fmtUsd(f.feeUsd, 4)}</td>
              <td className="pl-4 font-sans text-fg-2">{f.regime}</td>
              <td className="text-right">{f.isMaker ? mk(f.markout10sBps) : ''}</td>
              <td className="text-right">{f.isMaker ? mk(f.markout1mBps) : ''}</td>
              <td className="pr-2.5 text-right">{f.isMaker ? mk(f.markout5mBps) : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Why the quotes sit where they do: the model's terms for the selected market, each with a one-line reading. */
export function Model({ m, quoting, quoteSizeUsd }: { m: MarketState; quoting: boolean; quoteSizeUsd: number }) {
  if (!quoting || !m.model) return <p className="px-2.5 py-4 text-[12px] text-fg-3">Monday is not quoting, so there is nothing to explain yet.</p>;
  const g = m.params;
  const rows: [string, string, string][] = [
    ['Fair price', fmtPrice(m.model.ref, m.spec), m.hlMid != null ? `Perpl, pulled ${fmtBps(m.model.blendBps, 1)} bps halfway to Hyperliquid` : 'Perpl mark, or the book mid when it agrees'],
    ['Half-spread', `${m.model.halfBps.toFixed(2)} bps`, `volatility ${m.sigma1mBps.toFixed(1)} bps a minute, widened ${g.spread_mult}x by the ${g.regime} regime. In a calm market the quote moves up to the best price instead.`],
    ['Inventory skew', `${fmtBps(m.model.skewInvBps, 2)} bps`, m.model.q === 0 ? 'flat, no skew' : `leans to shed the ${m.model.q > 0 ? 'long' : 'short'}`],
    ['Smart Trader skew', `${fmtBps(m.model.skewNanBps + g.skew_bias_bps, 2)} bps`, m.model.skewNanBps === 0 && g.skew_bias_bps === 0 ? 'off or neutral' : 'leans with the flow'],
    ['Order-book skew', `${fmtBps(m.model.skewBookBps, 2)} bps`, `top 5 levels are ${Math.round(50 + Math.abs(m.book) * 50)}% ${m.book >= 0 ? 'bids' : 'asks'}`],
    ['Trend skew', `${fmtBps(m.model.skewTrendBps, 2)} bps`, Math.abs(m.trend5mBps) <= 4 ? `price moved ${fmtBps(m.trend5mBps, 1)} bps in 5 min: no trend` : `price moved ${fmtBps(m.trend5mBps, 1)} bps in 5 min: the ${m.trend5mBps < 0 ? 'bid' : 'ask'} waits off the touch`],
    ['Quote size', `${Math.round(g.size_mult * 100)}%`, m.model.sizeCapUsd != null && m.model.sizeCapUsd < quoteSizeUsd * g.size_mult
      ? `capped at ${usd(m.model.sizeCapUsd)}, 5% of an average hour's volume`
      : `of your ${usd(quoteSizeUsd)} per side`],
  ];
  return (
    <div className="grid text-[12px] md:grid-cols-2 md:gap-x-4">
      {rows.map(([k, v, note]) => (
        <div key={k} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-2.5 py-1.5">
          <dt className="text-fg-2">{k}</dt>
          <dd className="num text-right text-fg">{v}</dd>
          <dd className="col-span-2 text-[11px] leading-tight text-fg-3">{note}</dd>
        </div>
      ))}
      <p className="px-2.5 py-1.5 text-[11px] text-fg-3 md:col-span-2">Set by the {m.paramsSource === 'governor' ? 'LLM governor' : 'rule-based governor'}, clamped to your policy. {g.reason}</p>
    </div>
  );
}
