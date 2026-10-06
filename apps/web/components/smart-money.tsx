'use client';

import { DEFAULT_CONFIG, tradeSign, usdCompact, type MarketState } from '@monday/core';
import { ago, shortAddr } from '@/lib/format';
import { Diverging } from './charts';
import { cx } from './ui';

const Z_FULL = 4; // a z-score of 4 fills half the track

/** Net smart-money flow over three windows. The z-score is how unusual it is against the past week. */
export function FlowBars({ m }: { m: MarketState }) {
  const s = m.signal;
  if (!s) return <p className="px-2.5 py-4 text-[12px] text-fg-3">No smart-money source configured. Add a Nansen API key on the server to see flow here.</p>;
  const windows = [{ label: '5M', w: s.w5 }, { label: '15M', w: s.w15 }, { label: '60M', w: s.w60 }];
  const ticks = [DEFAULT_CONFIG.z1 / Z_FULL, DEFAULT_CONFIG.z2 / Z_FULL];
  return (
    <div className="px-2.5 pb-2 pt-2.5">
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5">
        {windows.map(({ label, w }) => (
          <div key={label} className="contents" title={`${w.n} trades, ${Math.round(Math.abs(w.imbalance) * 100)}% one-sided`}>
            <span className="label">{label}</span>
            <Diverging value={w.z / Z_FULL} ticks={ticks} />
            <span className="num w-[8.75rem] whitespace-nowrap text-right text-[11.5px]">
              <span className={w.netUsd >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{w.netUsd >= 0 ? '+' : '-'}{usdCompact(Math.abs(w.netUsd))}</span>
              <span className={cx('ml-2 inline-block w-[3.25rem]', Math.abs(w.z) >= DEFAULT_CONFIG.z2 ? 'font-semibold text-accent' : 'text-fg-3')}>z {w.z.toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="label mt-1.5 flex justify-between pl-[2.375rem] pr-[9.375rem]">
        <span>sell</span>
        <span>buy</span>
      </div>
      {s.stale && <p className="pt-2 text-[11.5px] text-warn">Smart-money data delayed. Quoting conservatively.</p>}
    </div>
  );
}

/** The tape: latest trades by wallets Nansen labels as smart money (FR-DSH-3). */
export function SmartTape({ m, now, limit = 40 }: { m: MarketState; now: number; limit?: number }) {
  if (!m.signal) return null;
  if (m.trades.length === 0) return <p className="px-2.5 py-4 text-[12px] text-fg-3">No labelled trades in the last six hours.</p>;
  return (
    <table className="w-full table-fixed text-[11.5px]">
      <thead>
        <tr className="label sticky top-0 z-[1] h-6 bg-canvas text-left [&>th]:font-normal">
          <th className="w-9 pl-2.5">Age</th>
          <th>Action</th>
          <th className="w-[5.5rem]">Trader</th>
          <th className="w-14 pr-2.5 text-right">Value</th>
        </tr>
      </thead>
      <tbody>
        {m.trades.slice(0, limit).map((t) => {
          const buy = tradeSign(t) > 0;
          const big = t.valueUsd >= DEFAULT_CONFIG.bigTradeUsd;
          return (
            <tr key={t.hash + t.action} className={cx('h-[21px] border-t border-line', big && 'bg-accent/10')} title={`${t.label || 'Smart Money'} ${t.trader}`}>
              <td className="num pl-2.5 text-fg-3">{ago(t.ts, now)}</td>
              <td className={cx('truncate', buy ? 'text-bid-fg' : 'text-ask-fg')}>{/Long|Short/.test(t.action) ? t.action.replace(' - ', ' ') : `${t.action} ${t.side}`}</td>
              <td className="num truncate text-fg-3">{shortAddr(t.trader)}</td>
              <td className={cx('num pr-2.5 text-right', big ? 'font-semibold text-accent' : 'text-fg')}>{usdCompact(t.valueUsd)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
