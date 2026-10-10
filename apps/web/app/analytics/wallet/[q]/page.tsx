'use client';

import { ArrowSquareOutIcon, CopyIcon, InfoIcon, TrendDownIcon, TrendUpIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PxWallet } from '@monday/core';
import { EASE, HeatGrid, LineChart, Share, Sparkline, type Tone } from '@/components/charts';
import { Kpi, Segments, WatchButton, ago, liqText, liqTone, money, price, profitText, shortAddress, signedMoney, tone } from '@/components/stats-ui';
import { Notice, Panel, Skeleton, cx } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { walletInsights, type Insight } from '@/lib/insights';

// One wallet on Perpl: what it holds now (read live from the Exchange), how it has traded (indexed fills), and what
// stands out about the way it trades.

const EXPLORER = 'https://monadscan.com';
const DAY = 86_400_000;
const shortDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const hold = (min: number | null) => (min == null ? 'n/a' : min < 60 ? `${min.toFixed(0)}m` : min < 1440 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`);
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');

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
  const id = d.account != null ? String(d.account) : d.address; // the account number is the wallet's one identity
  const deposits = d.flows.reduce((s, f) => s + (f.kind === 'deposit' ? f.usd : -f.usd), 0);
  const style = (i: number) => ({ '--i': i } as React.CSSProperties);

  return (
    <div className="grid gap-1 pt-1">
      <section className="panel min-w-0 rise flex-row flex-wrap items-center justify-between gap-3 px-3 py-2.5" style={style(0)}>
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
          {d.rank.volumePct != null && d.rank.pnlPct != null && (
            <p className="mt-1 text-[11.5px] text-fg-2" title={`Among the ${d.rank.accounts.toLocaleString('en-US')} accounts with a fill in the last ${d.rank.days} days`}>
              Last {d.rank.days} days: more volume than <span className="num text-fg">{Math.round((1 - d.rank.volumePct) * 100)}%</span> of traders, a better result than <span className={cx('num', d.rank.pnlPct <= 0.5 ? 'text-bid-fg' : 'text-ask-fg')}>{Math.round((1 - d.rank.pnlPct) * 100)}%</span>.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WatchButton wallet={d} network={d.network} />
          <Link href={`/analytics/compare?w=${id}`} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2.5 text-[12px] text-fg-2 hover:bg-raised"><UsersThreeIcon size={12} /> Compare</Link>
          {d.address && <a href={`${EXPLORER}/address/${d.address}`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2.5 text-[12px] text-fg-2 hover:bg-raised">Explorer <ArrowSquareOutIcon size={11} /></a>}
        </div>
      </section>

      {d.fills.total > d.fills.used ? (
        <Notice>Statistics cover this wallet&apos;s newest {d.fills.used.toLocaleString('en-US')} of {d.fills.total.toLocaleString('en-US')} fills{d.fills.since ? `, since ${shortDay(d.fills.since)}` : ''}. Balances and open positions are live from the Exchange.</Notice>
      ) : !d.historyComplete && (
        <Notice>Trade history covers fills indexed so far{p.firstTs ? `, from ${shortDay(p.firstTs)}` : ''}; part of Perpl&apos;s history is still being indexed. Balances and open positions are live from the Exchange.</Notice>
      )}

      <dl className="panel min-w-0 rise grid grid-cols-2 gap-px bg-line md:grid-cols-4 2xl:grid-cols-8" style={style(1)}>
        <Kpi k="Equity" n={d.equityUsd} format={money} sub={`${money(d.balanceUsd)} free, ${money(d.lockedUsd)} in orders`} />
        <Kpi k="Open PnL" n={upnl} format={signedMoney} t={upnl} sub={`${d.positions.length} open position${d.positions.length === 1 ? '' : 's'}`} />
        <Kpi k="Realised PnL" n={p.netUsd} format={signedMoney} t={p.netUsd} sub={`${signedMoney(p.pnlUsd)} price, ${signedMoney(p.fundingUsd)} funding, -${money(p.feesUsd, true)} fees`} hint="Price PnL plus funding minus fees, over indexed fills" spark={<Sparkline values={p.curve.map((c) => c.v)} tone={p.netUsd >= 0 ? 'bid' : 'ask'} />} />
        <Kpi k="Volume" n={p.volumeUsd} format={money} sub={`${p.trades.toLocaleString('en-US')} fills, ${pctOf(p.makerVolumeUsd, p.volumeUsd)} as maker`} spark={<Sparkline values={p.daily.slice(-21).map((x) => x.volumeUsd)} />} />
        <Kpi k="Win rate" v={p.winRate == null ? 'n/a' : `${(p.winRate * 100).toFixed(1)}%`} sub={`of ${p.closes.toLocaleString('en-US')} closing fills`} />
        <Kpi k="Profit factor" v={profitText(p)} sub={p.avgWinUsd != null && p.avgLossUsd != null ? `avg win ${money(p.avgWinUsd, true)}, avg loss ${money(p.avgLossUsd, true)}` : 'gross wins over gross losses'} />
        <Kpi k="Max drawdown" n={p.maxDrawdownUsd} format={(v) => money(v, true)} sub={`streaks: ${p.longestWin} wins, ${p.longestLoss} losses`} />
        <Kpi k="Avg hold" v={hold(p.avgHoldMin)} sub="open to flat, per market" />
      </dl>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" style={style(2)}>
        <Curve p={p} />
        <Insights w={d} />
      </div>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-3" style={style(3)}>
        <Calendar p={p} />
        <Edge p={p} deposits={deposits} equity={d.equityUsd} partial={d.flows.length >= 200} />
        <Panel title="When this wallet trades" aside={<span>fills by UTC hour</span>} bodyClassName="p-2.5">
          <HeatGrid label="Fills by hour of day" rows={['']} cols={Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))} colLabelEvery={3} cell={26} cells={p.hours.map((n, h) => ({ r: 0, c: h, v: n, tip: `${String(h).padStart(2, '0')}:00 UTC: ${int(n)} fills` }))} />
          <Sides p={p} />
        </Panel>
      </div>

      <Panel title="Open positions" aside={<span>live from the Exchange</span>} className="min-w-0 rise" >
        {!d.positions.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">No open positions.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-[11.5px]">
              <thead>
                <tr className="label h-7 text-left [&>th]:font-normal">
                  <th className="pl-2.5">Market</th><th className="text-right">Size</th><th className="text-right">Value</th><th className="pl-3" /><th className="text-right">Entry</th><th className="text-right">Mark</th>
                  <th className="text-right">Leverage</th><th className="text-right">Open PnL</th><th className="text-right">Liq. price</th><th className="pr-2.5 text-right">To liq.</th>
                </tr>
              </thead>
              <tbody className="num">
                {[...d.positions].sort((a, b) => b.usd - a.usd).map((x, _, arr) => (
                  <tr key={x.sym} className="h-[28px] border-t border-line">
                    <td className="pl-2.5"><span className="font-sans font-semibold">{x.sym}</span> <span className={x.long ? 'text-bid-fg' : 'text-ask-fg'}>{x.long ? 'long' : 'short'}</span></td>
                    <td className="text-right">{price(x.size)}</td>
                    <td className="text-right">{money(x.usd)}</td>
                    <td className="w-28 pl-3"><Share value={x.usd / Math.max(1, arr[0].usd)} tone={x.long ? 'bid' : 'ask'} /></td>
                    <td className="text-right text-fg-2">{price(x.entry)}</td>
                    <td className="text-right">{price(x.mark)}</td>
                    <td className="text-right">{x.leverage.toFixed(1)}x</td>
                    <td className={cx('text-right', tone(x.upnl))}>{signedMoney(x.upnl)}</td>
                    <td className="text-right">{x.liqPrice > 0 ? price(x.liqPrice) : 'none'}</td>
                    <td className={cx('pr-2.5 text-right', liqTone(x.liqDistancePct))}>{liqText(x.liqDistancePct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="min-w-0 rise grid gap-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]" style={style(4)}>
        <Panel title="By market" aside={<span>best first</span>} className="h-[440px]">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal"><th className="pl-2.5">Market</th><th className="text-right">Net PnL</th><th className="text-right">Win</th><th className="pr-2.5 text-right">Volume</th></tr>
            </thead>
            <tbody className="num">
              {p.byMarket.map((m) => (
                <tr key={m.sym} className="h-[26px] border-t border-line">
                  <td className="pl-2.5 font-sans font-medium">{m.sym}</td>
                  <td className={cx('text-right', tone(m.netUsd))}>{signedMoney(m.netUsd)}</td>
                  <td className="text-right text-fg-2">{m.closes ? `${Math.round((m.wins / m.closes) * 100)}%` : 'n/a'}</td>
                  <td className="pr-2.5 text-right text-fg-2">{money(m.volumeUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Trade history" aside={<span>newest {d.trades.length}</span>} className="h-[440px]">
          {!d.trades.length ? <p className="px-2.5 py-3 text-[12px] text-fg-3">No indexed fills yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-[11.5px]">
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
        <Panel title="Deposits and withdrawals" aside={<span>{deposits ? `${signedMoney(deposits)} net` : ''}</span>} className="h-[440px]">
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
      <p className="px-1 text-[11px] text-fg-3">Realised PnL counts price PnL and funding on reducing fills, minus every fill&apos;s fees, as the Exchange emits them. A win is a reducing fill that made money after fees.</p>
    </div>
  );
}

/** Cumulative realised PnL with the drawdown from its running peak shaded underneath. */
function Curve({ p }: { p: PxWallet['performance'] }) {
  const [range, setRange] = useState<7 | 30 | 0>(0);
  const now = Date.now();
  const pts = p.curve.filter((c) => !range || c.t >= now - range * DAY);
  let peak = -Infinity;
  const peaks = pts.map((c) => ({ t: c.t, v: (peak = Math.max(peak, c.v)) }));
  const dd = pts.length ? Math.max(0, ...pts.map((c, i) => peaks[i].v - c.v)) : 0;
  return (
    <Panel
      title="Realised PnL over time" aside={<><span className="hidden md:inline">after fees and funding{dd ? `, deepest drawdown in range ${money(dd, true)}` : ''}</span><Segments label="Range" value={range} onChange={setRange} options={[[7, '7D'], [30, '30D'], [0, 'All']] as const} /></>}
      bodyClassName="p-2.5" className="h-[340px]"
    >
      <LineChart label="Cumulative realised PnL" format={(v) => money(v, true)} empty={range ? 'No fills in this range' : 'No indexed fills yet'} timeFormat={range === 7 ? (t) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : shortDay} series={[{ name: 'PnL', tone: (pts.at(-1)?.v ?? 0) >= (pts[0]?.v ?? 0) ? 'bid' : 'ask', points: pts }]} under={peaks} />
    </Panel>
  );
}

const ICON: Record<Insight['tone'], { Icon: typeof InfoIcon; cls: string }> = {
  good: { Icon: TrendUpIcon, cls: 'text-bid-fg' }, bad: { Icon: TrendDownIcon, cls: 'text-ask-fg' }, warn: { Icon: WarningIcon, cls: 'text-warn' }, neutral: { Icon: InfoIcon, cls: 'text-fg-3' },
};
function Insights({ w }: { w: PxWallet }) {
  const reduce = useReducedMotion();
  const lines = walletInsights(w);
  return (
    <Panel title="What stands out" aside={<span>from this wallet&apos;s own numbers</span>} bodyClassName="p-2.5" className="h-[340px]">
      <ul className="grid gap-2 text-[12px] leading-snug text-fg-2">
        {lines.map((l, i) => {
          const { Icon, cls } = ICON[l.tone];
          return (
            <motion.li key={l.text} className="flex gap-2" initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.15 + i * 0.08 }}>
              <Icon size={14} weight="bold" className={cx('mt-0.5 flex-none', cls)} />
              <span>{l.text}</span>
            </motion.li>
          );
        })}
      </ul>
    </Panel>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Net PnL by UTC day over the last half year: one column per week, teal days made money, vermilion days lost it. */
function Calendar({ p }: { p: PxWallet['performance'] }) {
  const WEEKS = 26;
  const today = Math.floor(Date.now() / DAY) * DAY;
  const dow = (t: number) => (Math.floor(t / DAY) + 3) % 7; // 0 is Monday
  const lastMonday = today - dow(today) * DAY;
  const start = lastMonday - (WEEKS - 1) * 7 * DAY;
  const byDay = new Map(p.daily.map((d) => [d.day, d]));
  const cells = [];
  const cols: string[] = [];
  for (let wk = 0; wk < WEEKS; wk++) {
    const monday = start + wk * 7 * DAY;
    const m = new Date(monday);
    cols.push(m.getUTCDate() <= 7 ? m.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : '');
    for (let r = 0; r < 7; r++) {
      const t = monday + r * DAY;
      if (t > today) continue;
      const d = byDay.get(t);
      cells.push({ r, c: wk, v: d ? d.netUsd : null, tip: d ? `${shortDay(t)}: ${signedMoney(d.netUsd)} on ${int(d.trades)} fills, ${d.closes ? `${Math.round((d.wins / d.closes) * 100)}% of closes won` : 'no closes'}` : `${shortDay(t)}: no fills` });
    }
  }
  const active = p.daily.filter((d) => d.day >= start);
  const green = active.filter((d) => d.netUsd > 0).length;
  const best = active.reduce<typeof active[number] | null>((b, d) => (!b || d.netUsd > b.netUsd ? d : b), null);
  const worst = active.reduce<typeof active[number] | null>((b, d) => (!b || d.netUsd < b.netUsd ? d : b), null);
  return (
    <Panel title="Daily PnL" aside={<span>last {WEEKS} weeks, UTC days</span>} bodyClassName="p-2.5">
      <HeatGrid label="Net PnL per day" rows={WEEKDAYS} cols={cols} cells={cells} mode="sign" cell={14} />
      <p className="mt-2 text-[11.5px] text-fg-3">
        {active.length ? <>{green} of {active.length} trading days made money.{best && best.netUsd > 0 ? ` Best ${shortDay(best.day)} ${signedMoney(best.netUsd)}` : ''}{worst && worst.netUsd < 0 ? `, worst ${shortDay(worst.day)} ${signedMoney(worst.netUsd)}` : ''}.</> : 'No fills in this period.'}
      </p>
    </Panel>
  );
}

/** Two numbers that belong together, with the split between them drawn as one bar. */
function Pair({ label, a, b, fa, fb, tones = ['bid', 'ask'], i }: { label: string; a: number; b: number; fa: string; fb: string; tones?: [Tone, Tone]; i: number }) {
  const reduce = useReducedMotion();
  const total = Math.abs(a) + Math.abs(b);
  const share = total ? Math.abs(a) / total : 0.5;
  const color = (t: Tone) => (t === 'bid' ? 'var(--bid)' : t === 'ask' ? 'var(--ask)' : t === 'accent' ? 'var(--accent)' : 'var(--fg-3)');
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-[11px]"><span className="text-fg-3">{label}</span></div>
      <div className="num flex items-center gap-2 text-[11.5px]">
        <span className="w-20 text-fg">{fa}</span>
        <span className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-[1px] bg-raised-2" aria-hidden>
          <motion.span className="h-full" style={{ background: color(tones[0]) }} initial={reduce ? false : { width: 0 }} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.8, ease: EASE, delay: i * 0.05 }} />
          <motion.span className="h-full" style={{ background: color(tones[1]) }} initial={reduce ? false : { width: 0 }} animate={{ width: `${(1 - share) * 100}%` }} transition={{ duration: 0.8, ease: EASE, delay: i * 0.05 }} />
        </span>
        <span className="w-20 text-right text-fg">{fb}</span>
      </div>
    </div>
  );
}

function Edge({ p, deposits, equity, partial }: { p: PxWallet['performance']; deposits: number; equity: number; partial: boolean }) {
  const roi = deposits > 0 && !partial ? (equity - deposits) / deposits : null;
  return (
    <Panel title="The edge, in pairs" aside={<span>left against right</span>} bodyClassName="grid gap-3 p-2.5">
      <Pair i={0} label="Average win against average loss" a={p.avgWinUsd ?? 0} b={p.avgLossUsd ?? 0} fa={p.avgWinUsd == null ? 'n/a' : money(p.avgWinUsd, true)} fb={p.avgLossUsd == null ? 'n/a' : money(p.avgLossUsd, true)} />
      <Pair i={1} label="Largest win against largest loss" a={p.largestWinUsd} b={p.largestLossUsd} fa={money(p.largestWinUsd, true)} fb={money(p.largestLossUsd, true)} />
      <Pair i={2} label="Gross won against gross lost" a={p.grossWinUsd} b={p.grossLossUsd} fa={money(p.grossWinUsd)} fb={money(p.grossLossUsd)} />
      <Pair i={3} label="Net long against net short" a={p.sides.long.netUsd} b={p.sides.short.netUsd} fa={signedMoney(p.sides.long.netUsd)} fb={signedMoney(p.sides.short.netUsd)} tones={[p.sides.long.netUsd >= 0 ? 'bid' : 'ask', p.sides.short.netUsd >= 0 ? 'bid' : 'ask']} />
      <Pair i={4} label="Volume made against volume taken" a={p.makerVolumeUsd} b={p.volumeUsd - p.makerVolumeUsd} fa={money(p.makerVolumeUsd)} fb={money(p.volumeUsd - p.makerVolumeUsd)} tones={['accent', 'muted']} />
      <Pair i={5} label="Funding against fees" a={Math.max(0, p.fundingUsd)} b={p.feesUsd + Math.max(0, -p.fundingUsd)} fa={signedMoney(p.fundingUsd)} fb={`-${money(p.feesUsd, true)}`} />
      <div className="flex items-baseline justify-between border-t border-line pt-2 text-[11.5px]">
        <span className="text-fg-3">Return on net deposits</span>
        <span className={cx('num', roi == null ? 'text-fg-3' : tone(roi))}>{roi == null ? (partial ? 'more than 200 flows, n/a' : 'n/a') : `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}% on ${money(deposits)}`}</span>
      </div>
    </Panel>
  );
}

/** Closes won, long and short. */
function Sides({ p }: { p: PxWallet['performance'] }) {
  const { long, short } = p.sides;
  const row = (name: string, s: typeof long, t: Tone) => (
    <div key={name} className="grid grid-cols-[3rem_1fr_5rem] items-center gap-2 text-[11.5px]">
      <span className="text-fg-2">{name}</span>
      <span className="flex items-center gap-2"><Share value={s.closes ? s.wins / s.closes : 0} tone={t} className="flex-1" /><span className="num w-9 text-fg-3">{s.closes ? `${Math.round((s.wins / s.closes) * 100)}%` : 'n/a'}</span></span>
      <span className={cx('num text-right', tone(s.netUsd))}>{signedMoney(s.netUsd)}</span>
    </div>
  );
  return (
    <div className="mt-3 grid gap-1.5">
      <p className="label">Closes won, and net, by side</p>
      {row('Long', long, 'bid')}
      {row('Short', short, 'ask')}
    </div>
  );
}
