'use client';

import { ArrowSquareOutIcon, CopyIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import type { PxWallet } from '@monday/core';
import { LineChart } from '@/components/charts';
import { Kpi, WatchButton, ago, money, price, shortAddress, signedMoney, tone } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

// One wallet on Perpl: what it holds now (read live from the Exchange), and how it has traded (indexed fills).

const EXPLORER = 'https://monadscan.com';
const shortDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const hold = (min: number | null) => (min == null ? 'n/a' : min < 60 ? `${min.toFixed(0)}m` : min < 1440 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`);

export default function WalletPage() {
  const { q } = useParams<{ q: string }>();
  const w = useQuery({ queryKey: ['stats-wallet', q], queryFn: () => api<PxWallet>(`/stats/wallet/${q}`), refetchInterval: 15_000 });
  useEffect(() => {
    document.title = `${q.startsWith('0x') ? shortAddress(q) : `#${q}`} on Perpl - Monday`;
  }, [q]);

  if (w.isLoading) return <div className="grid gap-1 pt-1"><Skeleton className="h-14" /><Skeleton className="h-[74px]" /><Skeleton className="h-64" /></div>;
  if (w.error instanceof ApiError && w.error.status === 404) return <div className="pt-2"><Notice>No Perpl account for <span className="num">{q}</span>. Search a wallet address (0x…) or an account number.</Notice></div>;
  if (w.isError || !w.data) return <div className="pt-2"><Notice tone="warn">Could not load this wallet. {w.error instanceof Error ? w.error.message : ''}</Notice></div>;
  const d = w.data;
  const p = d.performance;
  const upnl = d.positions.reduce((s, x) => s + x.upnl, 0);
  const id = d.address || String(d.account);

  return (
    <div className="grid gap-1 pt-1">
      <section className="panel flex-row flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <h1 className="num flex items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{d.address || `Account #${d.account}`}</span>
            {d.address && (
              <button type="button" onClick={() => void navigator.clipboard?.writeText(d.address)} aria-label="Copy address" className="grid size-6 place-items-center rounded-sm text-fg-3 hover:bg-raised hover:text-fg">
                <CopyIcon size={13} />
              </button>
            )}
          </h1>
          <p className="mt-0.5 text-[11.5px] text-fg-3">
            Perpl account <span className="num text-fg-2">#{d.account}</span>
            {d.frozen && <span className="ml-2 text-ask-fg">frozen</span>}
            {p.firstTs && <> · trading since <span className="num">{shortDay(p.firstTs)}</span>, last fill {ago(p.lastTs!)} ago</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WatchButton q={id} />
          <Link href={`/analytics/compare?w=${id}`} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2.5 text-[12px] text-fg-2 hover:bg-raised"><UsersThreeIcon size={12} /> Compare</Link>
          {d.address && <a href={`${EXPLORER}/address/${d.address}`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2.5 text-[12px] text-fg-2 hover:bg-raised">Explorer <ArrowSquareOutIcon size={11} /></a>}
        </div>
      </section>

      {!d.historyComplete && (
        <Notice>Trade history covers fills indexed so far{p.firstTs ? `, from ${shortDay(p.firstTs)}` : ''}. Balances and open positions are live from the Exchange.</Notice>
      )}

      <dl className="panel grid grid-cols-2 gap-px bg-line sm:grid-cols-4 xl:grid-cols-8">
        <Kpi k="Equity" v={money(d.equityUsd)} sub={`${money(d.balanceUsd)} free, ${money(d.lockedUsd)} in orders`} />
        <Kpi k="Open PnL" v={signedMoney(upnl)} t={upnl} sub={`${d.positions.length} open position${d.positions.length === 1 ? '' : 's'}`} />
        <Kpi k="Realised PnL" v={signedMoney(p.netUsd)} t={p.netUsd} sub={`${signedMoney(p.pnlUsd)} price, ${signedMoney(p.fundingUsd)} funding, -${money(p.feesUsd, true)} fees`} hint="Price PnL plus funding minus fees, over indexed fills" />
        <Kpi k="Volume" v={money(p.volumeUsd)} sub={`${p.trades.toLocaleString('en-US')} fills`} />
        <Kpi k="Win rate" v={p.winRate == null ? 'n/a' : `${(p.winRate * 100).toFixed(1)}%`} sub={`of ${p.closes.toLocaleString('en-US')} closing fills`} />
        <Kpi k="Profit factor" v={p.profitFactor == null ? 'n/a' : Number.isFinite(p.profitFactor) ? p.profitFactor.toFixed(2) : 'no losses'} sub="gross wins over gross losses" />
        <Kpi k="Max drawdown" v={money(p.maxDrawdownUsd, true)} sub={`streaks: ${p.longestWin} wins, ${p.longestLoss} losses`} />
        <Kpi k="Avg hold" v={hold(p.avgHoldMin)} sub="open to flat, per market" />
      </dl>

      <Panel title="Open positions" aside={<span>live from the Exchange</span>}>
        {!d.positions.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">No open positions.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[11.5px]">
              <thead>
                <tr className="label h-7 text-left [&>th]:font-normal">
                  <th className="pl-2.5">Market</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="text-right">Entry</th><th className="text-right">Mark</th>
                  <th className="text-right">Leverage</th><th className="text-right">Open PnL</th><th className="text-right">Liq. price</th><th className="pr-2.5 text-right">To liq.</th>
                </tr>
              </thead>
              <tbody className="num">
                {[...d.positions].sort((a, b) => b.usd - a.usd).map((x) => (
                  <tr key={x.sym} className="h-[28px] border-t border-line">
                    <td className="pl-2.5"><span className="font-sans font-semibold">{x.sym}</span> <span className={x.long ? 'text-bid-fg' : 'text-ask-fg'}>{x.long ? 'long' : 'short'}</span></td>
                    <td className="text-right">{price(x.size)}</td>
                    <td className="text-right">{money(x.usd)}</td>
                    <td className="text-right text-fg-2">{price(x.entry)}</td>
                    <td className="text-right">{price(x.mark)}</td>
                    <td className="text-right">{x.leverage.toFixed(1)}x</td>
                    <td className={cx('text-right', tone(x.upnl))}>{signedMoney(x.upnl)}</td>
                    <td className="text-right">{x.liqPrice > 0 ? price(x.liqPrice) : 'none'}</td>
                    <td className={cx('pr-2.5 text-right', x.liqDistancePct < 2 ? 'text-ask-fg' : x.liqDistancePct < 5 ? 'text-warn' : 'text-fg-2')}>{Number.isFinite(x.liqDistancePct) ? `${x.liqDistancePct.toFixed(1)}%` : 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Realised PnL over time" aside={<span>after fees and funding</span>} bodyClassName="p-2.5" className="h-[300px]">
          <LineChart label="Cumulative realised PnL" format={(v) => money(v, true)} empty="No indexed fills yet" timeFormat={shortDay} series={[{ name: 'PnL', tone: p.netUsd >= 0 ? 'bid' : 'ask', points: p.curve.length > 600 ? p.curve.filter((_, i) => i % Math.ceil(p.curve.length / 600) === 0 || i === p.curve.length - 1) : p.curve }]} />
        </Panel>
        <Panel title="By market" aside={<span>best first</span>} className="h-[300px]">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal"><th className="pl-2.5">Market</th><th className="text-right">Net PnL</th><th className="text-right">Volume</th><th className="pr-2.5 text-right">Fills</th></tr>
            </thead>
            <tbody className="num">
              {p.byMarket.map((m) => (
                <tr key={m.sym} className="h-[24px] border-t border-line">
                  <td className="pl-2.5 font-sans font-medium">{m.sym}</td>
                  <td className={cx('text-right', tone(m.netUsd))}>{signedMoney(m.netUsd)}</td>
                  <td className="text-right text-fg-2">{money(m.volumeUsd)}</td>
                  <td className="pr-2.5 text-right text-fg-3">{m.trades.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Trade history" aside={<span>newest {d.trades.length}</span>} className="h-[440px]">
          {!d.trades.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">No indexed fills yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[11.5px]">
                <thead>
                  <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
                    <th className="pl-2.5">Time UTC</th><th>Market</th><th>Action</th><th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="text-right">Fee</th><th className="pr-2.5 text-right">Realised</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {d.trades.map((t) => (
                    <tr key={`${t.block}-${t.idx}`} className="h-[22px] border-t border-line">
                      <td className="pl-2.5 text-fg-3">{new Date(t.ts).toISOString().slice(5, 19).replace('T', ' ')}</td>
                      <td className="font-sans font-medium">{t.sym}</td>
                      <td><span className={t.side === 'buy' ? 'text-bid-fg' : 'text-ask-fg'}>{t.side}</span> <span className="font-sans text-fg-3">{t.kind === 'fill' ? '' : t.kind}{t.role === 'maker' ? ', maker' : ''}</span></td>
                      <td className="text-right">{price(t.price)}</td>
                      <td className="text-right text-fg-2">{price(t.size)}</td>
                      <td className="text-right">{money(t.usd)}</td>
                      <td className="text-right text-fg-3">{money(t.fee, true)}</td>
                      <td className={cx('pr-2.5 text-right', tone(t.pnl + t.funding))}>{t.pnl || t.funding ? signedMoney(t.pnl + t.funding) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Deposits and withdrawals" className="h-[440px]">
          {!d.flows.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">None indexed yet.</p> : (
            <table className="w-full text-[11.5px]">
              <tbody className="num">
                {d.flows.map((f) => (
                  <tr key={`${f.ts}${f.kind}${f.usd}`} className="h-[24px] border-t border-line first:border-t-0">
                    <td className="pl-2.5 text-fg-3">{shortDay(f.ts)}</td>
                    <td className="font-sans text-fg-2">{f.kind === 'deposit' ? 'Deposit' : 'Withdrawal'}</td>
                    <td className={cx('pr-2.5 text-right', f.kind === 'deposit' ? 'text-bid-fg' : 'text-ask-fg')}>{f.kind === 'deposit' ? '+' : '-'}{money(f.usd, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      <p className="px-1 text-[11px] text-fg-3">Realised PnL counts price PnL and funding on reducing fills, minus every fill&apos;s fees, as the Exchange emits them.</p>
    </div>
  );
}
