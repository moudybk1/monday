'use client';

import { CaretDownIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { usdCompact, type DashboardState, type MarketState, type MarketSym } from '@monday/core';
import { fmtPrice } from '@/lib/format';
import { CoinIcon, Tag, cx } from './ui';

// The market strip every trading page shares: the market picker, the ticker and the day's figures.

/** Market as agent state: a running plan's, traded by the policy, dropped but still holding a position, or only watched. */
const agentTag = (x: MarketState, state: DashboardState) =>
  state.plans.some((p) => p.status !== 'done' && p.input.sym === x.sym) ? 'plan' : x.inPolicy ? 'trading' : x.position.size !== 0 ? 'exit' : 'off';
const pct = (n: number | null) => (n == null ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const PICK_COLS = 'grid grid-cols-[minmax(0,1.3fr)_1fr_0.8fr] items-center gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_1fr_0.8fr_0.8fr_0.9fr_0.9fr]';

/** The selected market and a dropdown of every market, as on Hyperliquid: price, change, funding, volume, interest. */
export function MarketPicker({ state, sym, onPick, footer = 'Pick a market to watch it. Trade adds it to your policy; Monday then quotes it.' }: { state: DashboardState; sym: MarketSym; onPick: (s: MarketSym) => void; footer?: string }) {
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
  const tag = x && agentTag(x, state);
  // What Monday is doing in this market, only when it is out of the ordinary: a pulled side, a plan, a position left to
  // exit. Plain trading and watching carry no tag.
  const note = state.status === 'quoting' && x?.reflex
    ? <Tag tone="ask">{x.reflex.side} {x.reflex.action === 'pull' ? 'pulled' : 'widened'}</Tag>
    : tag === 'exit' || tag === 'plan' ? <Tag tone={tag === 'exit' ? 'warn' : 'neutral'}>{tag}</Tag> : null;
  return (
    <details ref={menu} className="relative order-1 flex-none border-r border-line" onKeyDown={(e) => e.key === 'Escape' && menu.current && (menu.current.open = false)}>
      <summary aria-label={`Market: ${sym}. Change market`} className="flex h-14 min-w-[8.25rem] cursor-pointer list-none flex-col justify-center gap-1.5 px-3 hover:bg-raised [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-[16px] font-semibold leading-none tracking-tight">
          <CoinIcon sym={sym} className="size-5" />{sym}<span className="text-[14px] font-normal text-fg-3">PERP</span>
          <CaretDownIcon size={12} weight="bold" className="ml-auto text-fg-3" />
        </span>
        {note && <span className="flex">{note}</span>}
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-[calc(100vw-1rem)] max-w-[40rem] rounded-sm border border-line-2 bg-raised py-1 shadow-lg">
        <div className={cx(PICK_COLS, 'label h-7 whitespace-nowrap px-3 [&>span:not(:first-child)]:text-right')}>
          <span>Market</span><span>Last Price</span><span>24h Change</span>
          <span className="hidden sm:block">Funding</span><span className="hidden sm:block">24h Volume</span><span className="hidden sm:block">Open Interest</span>
        </div>
        {(Object.keys(state.markets) as MarketSym[]).map((s) => {
          const r = state.markets[s];
          if (!r) return null;
          const t = agentTag(r, state);
          const c = r.day.changePct;
          return (
            <button
              key={s} aria-current={s === sym}
              onClick={() => { onPick(s); if (menu.current) menu.current.open = false; }}
              className={cx(PICK_COLS, 'num h-8 w-full px-3 text-left text-[13px] hover:bg-raised-2 [&>span:not(:first-child)]:text-right', s === sym && 'bg-raised-2')}
            >
              <span className="flex items-center gap-1.5 font-sans">
                <CoinIcon sym={s} /><span className="font-semibold">{s}</span><span className="text-fg-3">PERP</span>
                {(t === 'exit' || t === 'plan') && <Tag tone={t === 'exit' ? 'warn' : 'neutral'}>{t}</Tag>}
              </span>
              <span>{fmtPrice(r.mark, r.spec)}</span>
              <span className={c == null ? 'text-fg-3' : c >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{pct(c)}</span>
              <span className={cx('hidden sm:block', signTone(fundingPct(r.fundingRate)))}>{fundingPct(r.fundingRate)}</span>
              <span className="hidden sm:block">{r.day.volumeUsd == null ? '-' : usdCompact(r.day.volumeUsd)}</span>
              <span className="hidden sm:block">{r.openInterestUsd > 0 ? usdCompact(r.openInterestUsd) : '-'}</span>
            </button>
          );
        })}
        <p className="border-t border-line px-3 pb-1 pt-2 text-[12px] text-fg-3">{footer}</p>
      </div>
    </details>
  );
}

/** Green when a figure as shown is above zero, red below; one that shows as zero (0.0000%, -0.0) stays plain. */
const signTone = (shown: string) => (!/[1-9]/.test(shown) ? 'text-fg' : shown.startsWith('-') ? 'text-ask-fg' : 'text-bid-fg');
const fundingPct = (rate: number) => `${(rate * 100).toFixed(4)}%`;

/** The mark, coloured by its last move like every exchange ticker, with the 24-hour change under it. */
export function Ticker({ m }: { m: MarketState }) {
  // The previous print, kept across renders the way React documents for values derived from the last render.
  const [last, setLast] = useState({ sym: m.sym, p: m.mark, dir: 0 });
  if (last.sym !== m.sym || last.p !== m.mark) setLast({ sym: m.sym, p: m.mark, dir: last.sym !== m.sym ? 0 : m.mark > last.p ? 1 : -1 });
  const chg = m.day.changePct;
  const abs = chg == null ? null : (m.mark * chg) / (100 + chg);
  return (
    <div title={`Mark price: what Perpl values positions at, coloured by its last move. Oracle ${fmtPrice(m.oracle, m.spec)}.`} className="order-2 flex flex-none cursor-help flex-col justify-center gap-1.5 px-4">
      <span className={cx('num text-[19px] font-medium leading-none tracking-tight transition-colors duration-300', last.dir > 0 ? 'text-bid-fg' : last.dir < 0 ? 'text-ask-fg' : 'text-fg')}>
        {fmtPrice(m.mark, m.spec)}
      </span>
      <span className={cx('num whitespace-nowrap text-[13px] leading-none', chg == null ? 'text-fg-3' : chg >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>
        {chg == null || abs == null ? '24h n/a' : <>{abs >= 0 ? '+' : '-'}{fmtPrice(Math.abs(abs), m.spec)}<span className="ml-2">{pct(chg)}</span></>}
      </span>
    </div>
  );
}

/** One figure on the strip: a quiet label with its explanation on hover, the value under it, all on one baseline. */
function Cell({ k, hint, children, className }: { k: string; hint: string; children: React.ReactNode; className?: string }) {
  return (
    <div title={hint} className={cx('flex flex-none cursor-help flex-col justify-center gap-1.5', className)}>
      <dt className="whitespace-nowrap text-[12px] leading-none text-fg-3">{k}</dt>
      <dd className="num relative flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-none text-fg">{children}</dd>
    </div>
  );
}

/**
 * The figures a trader reads off the strip, for the selected market. The spread is in the order book's middle row, so
 * it is not here. Below 1280px they take a second row of their own, which scrolls sideways if it must.
 */
export function Stats({ m }: { m: MarketState }) {
  const { high, low } = m.day;
  const at = high != null && low != null && high > low ? Math.min(1, Math.max(0, (m.mark - low) / (high - low))) : null;
  return (
    <div className="scroll order-4 flex w-full min-w-0 items-stretch overflow-x-auto border-t border-line xl:order-3 xl:w-auto xl:flex-1 xl:border-t-0">
      <dl className="flex flex-none items-center gap-x-6 px-4 py-2 xl:py-0">
        <Cell k="Oracle" hint="The price from an outside source. Perpl rejects orders more than 1% from it.">{fmtPrice(m.oracle, m.spec)}</Cell>
        {/* Low to high as one figure, the mark's place between them on a hairline under it. */}
        <Cell k="24h Range" hint="The lowest (red) and highest (green) price in the last 24 hours, and where the mark sits between them.">
          {at == null ? '-' : (
            <>
              <span className="text-ask-fg">{fmtPrice(low!, m.spec)}</span><span className="text-fg-3">–</span><span className="text-bid-fg">{fmtPrice(high!, m.spec)}</span>
              <span aria-hidden className="absolute inset-x-0 -bottom-[7px] h-px bg-line-2">
                <span className="absolute -top-0.5 h-[5px] w-0.5 -translate-x-1/2 rounded-full bg-fg transition-[left] duration-500" style={{ left: `${at * 100}%` }} />
              </span>
            </>
          )}
        </Cell>
        <Cell k="24h Volume" hint="Notional traded on Perpl in the last 24 hours. The simulator reports none.">{m.day.volumeUsd == null ? '-' : usdCompact(m.day.volumeUsd)}</Cell>
        <Cell k="Open Interest" hint="Notional of all open positions in this market.">{m.openInterestUsd > 0 ? usdCompact(m.openInterestUsd) : '-'}</Cell>
        <Cell k="Funding" hint="A periodic payment between longs and shorts, per funding interval as Perpl shows it (the analytics pages show it per 8 hours). Positive means longs pay shorts.">
          <span className={signTone(fundingPct(m.fundingRate))}>{fundingPct(m.fundingRate)}</span>
        </Cell>
      </dl>
    </div>
  );
}

