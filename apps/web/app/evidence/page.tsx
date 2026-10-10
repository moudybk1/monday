'use client';

import { useEffect, useState } from 'react';
import { MARKETS, usd, type Evidence, type MarketSym, type ReplayArm } from '@monday/core';
import { LineChart, SignedBars } from '@/components/charts';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { Notice, Skeleton, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtBps, fmtSigned, fmtUsd } from '@/lib/format';

const WRAP = 'mx-auto max-w-[1120px] px-4 sm:px-8';

export default function EvidencePage() {
  const [ev, setEv] = useState<Evidence | null | 'none'>(null);
  const [sym, setSym] = useState<MarketSym>('BTC');
  useEffect(() => {
    document.title = 'Evidence - Monday';
    api<Evidence & { pending?: boolean }>('/evidence').then((e) => setEv(e.pending ? 'none' : e)).catch(() => setEv('none'));
  }, []);

  return (
    <>
      <SiteHeader />
      <main className={`${WRAP} pb-24 pt-12 md:pt-16`}>
        <h1 className="display max-w-[18ch] text-4xl md:text-6xl">Does Smart Trader flow lead price?</h1>
        <p className="mt-5 max-w-[62ch] text-lg text-fg-2">
          Monday&apos;s claim is testable, so here are the tests. An event study measures the signal. A replay compares a naive maker with Monday on the same minutes. Every assumption sits next to the numbers.
        </p>

        {ev === null ? (
          <div className="mt-12 grid gap-4"><Skeleton className="h-12" /><Skeleton className="h-80" /></div>
        ) : ev === 'none' || !Object.keys(ev.studies).length ? (
          <div className="mt-12">
            <Notice>Not enough data yet. The study needs at least two days of one-minute prices and Smart Trader trades. It recomputes every hour.</Notice>
          </div>
        ) : (
          <Body ev={ev} sym={ev.studies[sym] ? sym : (Object.keys(ev.studies)[0] as MarketSym)} setSym={setSym} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}

function Body({ ev, sym, setSym }: { ev: Evidence; sym: MarketSym; setSym: (s: MarketSym) => void }) {
  const s = ev.studies[sym]!;
  const r = ev.replays[sym];
  const head = s.grid.find((g) => g.window === 15 && g.horizon === 15)!;

  return (
    <>
      <div className="mt-10 grid gap-4">
        {ev.synthetic && (
          <Notice tone="warn">
            <strong>Simulated data.</strong> The simulator is built so that Smart Trader flow moves price, so a positive result here shows the pipeline working, not a proven edge. With the Smart Trader feed and the Perpl venue configured, the same code runs on real trades and real candles.
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div role="tablist" aria-label="Market" className="flex rounded-sm border border-line-2">
            {MARKETS.filter((m) => ev.studies[m]).map((m) => (
              <button key={m} role="tab" aria-selected={m === sym} onClick={() => setSym(m)} className={cx('h-9 px-4 text-sm font-medium', m === sym ? 'bg-fg text-canvas' : 'text-fg-2 hover:bg-raised')}>{m}</button>
            ))}
          </div>
          <p className="text-[13px] text-fg-3">
            {ev.smartMoneySource}. {ev.priceSource}. Computed {new Date(ev.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}.
          </p>
        </div>
      </div>

      <section className="mt-14 border-t border-line-2 pt-8">
        <h2 className="display text-3xl md:text-4xl">Event study</h2>
        <p className="mt-3 max-w-[66ch] text-fg-2">
          At the end of every five-minute bucket we score how unusual the net Smart Trader flow was (a z-score against the past week), then look at what {sym} did next.
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <p className="text-[13px] text-fg-3">Rank correlation, 15 min flow vs next 15 min return</p>
            <p className="num mt-1 text-6xl font-semibold tracking-tight">{head.rho.toFixed(2)}</p>
            <p className="num mt-2 text-[13px] text-fg-2">95% interval {head.lo.toFixed(2)} to {head.hi.toFixed(2)}, {head.n} independent samples</p>
            <div className="mt-6 border-l-2 border-fg pl-4">
              <p className="flex items-center gap-2 font-semibold">Decision <Tag tone={s.skewEnabled ? 'accent' : 'neutral'}>{s.skewEnabled ? 'lean on' : 'lean off'}</Tag></p>
              <p className="mt-1.5 text-[15px] text-fg-2">
                {s.skewEnabled
                  ? 'The interval sits above zero, so Monday shifts its quotes 1.5 bps per unit of signal in the direction of the flow.'
                  : 'The interval includes zero, so Monday does not lean with the flow. Smart Trader flow still widens, shrinks and pulls its quotes; it just does not move their centre.'}
              </p>
            </div>
            <p className="mt-6 text-[15px] text-fg-2">
              {s.hit.n > 0
                ? <>When the 5-minute score passed 2.5 either way, {sym} moved the same way over the next 15 minutes <span className="num font-semibold text-fg">{Math.round(s.hit.rate * 100)}%</span> of the time (<span className="num">{s.hit.n}</span> events).</>
                : 'No 5-minute score passed 2.5 in the sample.'}
            </p>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-semibold">Mean return over the next 15 minutes, by flow strength <span className="font-normal text-fg-3">(bps, ten equal groups)</span></p>
            <SignedBars
              height={250} format={(v) => v.toFixed(1)} label={`Mean forward 15-minute ${sym} return per decile of the 15-minute Smart Trader z-score`} lowLabel="strongest selling" highLabel="strongest buying"
              data={s.deciles.map((d) => ({ key: `Decile ${d.decile}`, v: d.meanRetBps, tip: `Group ${d.decile} of 10: mean z ${d.meanZ.toFixed(1)}, next 15 min ${fmtBps(d.meanRetBps, 2)} bps, ${d.n} samples` }))}
            />
          </div>
        </div>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="mb-2 text-left text-[13px] font-semibold">Every window against every horizon <span className="font-normal text-fg-3">(rank correlation, 95% interval, samples)</span></caption>
            <thead>
              <tr className="border-y border-line-2 text-[12.5px] text-fg-3">
                <th className="py-2 font-normal">Flow window</th>
                {[5, 15, 60].map((h) => <th key={h} className="px-3 py-2 font-normal">Next {h} min</th>)}
              </tr>
            </thead>
            <tbody className="num">
              {[5, 15, 60].map((w) => (
                <tr key={w} className="border-b border-line">
                  <th scope="row" className="py-2.5 font-sans font-normal text-fg-2">Last {w} min</th>
                  {[5, 15, 60].map((h) => {
                    const g = s.grid.find((x) => x.window === w && x.horizon === h)!;
                    return (
                      <td key={h} className={cx('px-3 py-2.5', w === 15 && h === 15 && 'bg-raised')}>
                        <span className="font-semibold">{g.rho.toFixed(2)}</span>
                        <span className="ml-2 text-[12.5px] text-fg-3">{g.lo.toFixed(2)} to {g.hi.toFixed(2)}, n {g.n}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r && (
        <section className="mt-16 border-t border-line-2 pt-8">
          <h2 className="display text-3xl md:text-4xl">Replay: naive maker against Monday</h2>
          <p className="mt-3 max-w-[66ch] text-fg-2">
            Both arms quote {sym} over the same {Math.round((r.to - r.from) / 86_400_000)} days with the same limits. The naive maker quotes symmetrically and skews only for inventory. Monday adds the Smart Trader reflex, the regimes{s.skewEnabled ? ' and the lean' : ''}.
          </p>
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
            <ArmsTable naive={r.naive} monday={r.monday} />
            <div>
              <p className="mb-2 text-[13px] font-semibold">Cumulative PnL net of fees <span className="font-normal text-fg-3">(USD)</span></p>
              <LineChart
                height={260} label="Cumulative PnL of the naive maker and Monday over the replay" format={(v) => fmtUsd(v, 0)}
                timeFormat={(t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                series={[
                  { name: 'Monday', tone: 'accent', points: r.monday.curve },
                  { name: 'Naive', tone: 'muted', dash: true, points: r.naive.curve },
                ]}
              />
              <p className="mt-3 text-[13px] text-fg-3">Monday pulled a quote <span className="num">{r.reflexPulls}</span> times in the replay.</p>
            </div>
          </div>
        </section>
      )}

      <section className="mt-16 grid gap-10 border-t border-line-2 pt-8 lg:grid-cols-2">
        <div>
          <h2 className="display text-2xl md:text-3xl">Assumptions</h2>
          <ul className="mt-4 grid gap-3 text-[15px] text-fg-2">
            <li>A trade counts only from the moment the collector could have seen it. Timestamps are shifted by the median ingestion lag, currently {Math.round(ev.lagMs / 1000)} s.</li>
            <li>Scores are scaled by the median and spread of the data before each day, so no sample sees its own future. The first day is warm-up.</li>
            <li>Samples do not overlap. Intervals are bootstrap 95% from 300 resamples.</li>
            <li>A replay quote fills in full when the minute&apos;s traded range passes through its price. Queue position is ignored in both arms, which keeps the comparison fair and makes absolute PnL optimistic.</li>
            <li>Replay quotes are set once a minute from the opening price. The live agent requotes within 1.5 seconds, so both arms take more stale fills here than they would live.</li>
            <li>Both arms: {usd(ev.policy.quoteSizeUsd)} per side, {usd(ev.policy.maxInventoryUsd)} max inventory, {ev.policy.minHalfSpreadBps} bps minimum half-spread, maker fee on every fill. Monday&apos;s regimes come from the rule-based governor, not the LLM.</li>
          </ul>
        </div>
        <div>
          <h2 className="display text-2xl md:text-3xl">What we claim</h2>
          <ul className="mt-4 grid gap-3 text-[15px] text-fg-2">
            <li>We claim measured results, with sample sizes and confidence intervals, whatever their sign.</li>
            <li>We do not claim profitability from one week of data. On testnet, flow is thin and partly generated by our own taker bot.</li>
            <li>Market making can lose money. These numbers describe the past on one dataset.</li>
          </ul>
        </div>
      </section>
    </>
  );
}

function ArmsTable({ naive, monday }: { naive: ReplayArm; monday: ReplayArm }) {
  type Row = [string, (a: ReplayArm) => number, (v: number) => string, 'higher' | 'lower' | null];
  const rows: Row[] = [
    ['PnL net of fees', (a) => a.pnlUsd, (v) => fmtSigned(v), 'higher'],
    ['Markout after 1 min', (a) => a.markout1mBps, (v) => `${fmtBps(v, 2)} bps`, 'higher'],
    ['Markout after 5 min', (a) => a.markout5mBps, (v) => `${fmtBps(v, 2)} bps`, 'higher'],
    ['Lost to adverse fills', (a) => a.adverseUsd, (v) => fmtUsd(v), 'lower'],
    ['Max drawdown', (a) => a.maxDrawdownUsd, (v) => fmtUsd(v), 'lower'],
    ['Inventory swing (std)', (a) => a.inventoryStdUsd, (v) => fmtUsd(v, 0), 'lower'],
    ['Fills', (a) => a.fills, (v) => v.toLocaleString('en-US'), null],
    ['Fees paid', (a) => a.feesUsd, (v) => fmtUsd(v), null],
    ['Time with both quotes up', (a) => a.quotedPct, (v) => `${v.toFixed(0)}%`, null],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] text-left text-sm">
        <thead>
          <tr className="border-y border-line-2 text-[12.5px] text-fg-3">
            <th className="py-2 font-normal">Same data, same limits</th>
            <th className="px-3 py-2 text-right font-normal">Naive</th>
            <th className="px-3 py-2 text-right font-semibold text-fg">Monday</th>
            <th className="py-2 pl-3 font-normal">Better</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get, fmt, good]) => {
            const a = get(naive), b = get(monday);
            const win = good == null || a === b ? null : (good === 'higher' ? b > a : b < a) ? 'Monday' : 'Naive';
            return (
              <tr key={label} className="border-b border-line">
                <th scope="row" className="py-2.5 font-normal text-fg-2">{label}</th>
                <td className="num px-3 text-right">{fmt(a)}</td>
                <td className="num px-3 text-right font-semibold">{fmt(b)}</td>
                <td className="pl-3 text-[12.5px] text-fg-3">{win ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
