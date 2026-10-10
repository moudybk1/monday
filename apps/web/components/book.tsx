'use client';

import { usdCompact, type BookLevel, type MarketState, type QuoteTarget, type Side } from '@monday/core';
import { fmtPrice, fmtSize } from '@/lib/format';
import { cx } from './ui';

interface Row {
  price: number;
  size: number;
  mine: boolean;
  cumUsd: number;
}

/** Mark Monday's resting quote in one side of the book, best price first. A level the feed already counts it in is not grown again. */
function ladder(levels: BookLevel[], mine: QuoteTarget | null, side: Side, n: number, onBook: boolean): Row[] {
  const rows = levels.map((l) => ({ price: l.price, size: l.size, mine: false, cumUsd: 0 }));
  if (mine) {
    const i = rows.findIndex((r) => (side === 'bid' ? r.price <= mine.price : r.price >= mine.price));
    if (i >= 0 && rows[i].price === mine.price) rows[i] = { ...rows[i], size: onBook ? rows[i].size : rows[i].size + mine.size, mine: true };
    else rows.splice(i < 0 ? rows.length : i, 0, { price: mine.price, size: mine.size, mine: true, cumUsd: 0 });
  }
  let acc = 0;
  for (const r of rows) r.cumUsd = acc += r.price * r.size;
  // Keep Monday's row visible even when it rests deeper than the rows we have room for.
  const at = rows.findIndex((r) => r.mine);
  return at >= n ? [...rows.slice(0, n - 1), rows[at]] : rows.slice(0, n);
}

// Three columns, nothing else: price, size, cumulative depth. The same rhythm on every row.
const COLS = 'grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-2 px-2.5';

function Level({ r, side, max, m, ahead }: { r: Row; side: Side; max: number; m: MarketState; ahead: number | null }) {
  return (
    <li className={cx(COLS, 'num relative h-[21px] text-[12px]', r.mine && 'flash bg-accent/14')}>
      {/* Depth: a tint anchored to the right edge, behind the figures. */}
      <span aria-hidden className="absolute inset-y-px right-0" style={{ width: `${(r.cumUsd / max) * 100}%`, background: side === 'bid' ? 'var(--bid)' : 'var(--ask)', opacity: r.mine ? 0 : 0.13 }} />
      {/* Amber on the leading edge: this level is Monday's order. */}
      {r.mine && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      <span className={cx('relative flex items-center gap-1.5', side === 'bid' ? 'text-bid-fg' : 'text-ask-fg')}>
        {fmtPrice(r.price, m.spec)}
        {r.mine && <span className="rounded-[2px] bg-accent px-1 text-[9.5px] font-semibold leading-[14px] tracking-wide text-accent-fg">MONDAY</span>}
      </span>
      <span className={cx('relative text-right', r.mine ? 'text-accent' : 'text-fg')}>{fmtSize(r.size, m.spec)}</span>
      {/* On Monday's row the useful number is not the depth but the queue: how much must trade before its order does. */}
      {r.mine && ahead != null
        ? <span className="relative whitespace-nowrap text-right text-[11px] text-accent" title="Resting ahead of Monday's order in line at this side">{ahead < 1 ? '1st in line' : `${usdCompact(ahead)} ahead`}</span>
        : <span className="relative text-right text-fg-3">{usdCompact(r.cumUsd)}</span>}
    </li>
  );
}

function Pulled({ side, m, now }: { side: Side; m: MarketState; now: number }) {
  const left = Math.max(0, Math.round((m.reflex!.until - now) / 1000));
  return (
    <li className="hatch num flex h-[21px] items-center justify-between border-y border-line-2 px-2.5 text-[11px]">
      <span className="font-medium uppercase tracking-wide text-accent">Monday&apos;s {side} pulled</span>
      <span className="text-fg-2">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </span>
    </li>
  );
}

/** `ownOnBook`: a live Perpl feed already shows Monday's order inside its level; a paper or simulated book does not. */
export function OrderBook({ m, rows = 10, now = Date.now(), ownOnBook = false }: { m: MarketState; rows?: number; now?: number; ownOnBook?: boolean }) {
  const asks = ladder(m.asks, m.quotes.ask, 'ask', rows, ownOnBook);
  const bids = ladder(m.bids, m.quotes.bid, 'bid', rows, ownOnBook);
  const max = Math.max(asks.at(-1)?.cumUsd ?? 1, bids.at(-1)?.cumUsd ?? 1);
  const pulled = m.reflex?.action === 'pull' ? m.reflex.side : null;
  const spreadBps = m.bestBid && m.bestAsk ? ((m.bestAsk - m.bestBid) / m.mark) * 1e4 : null;
  const spread = m.bestBid && m.bestAsk ? m.bestAsk - m.bestBid : null;

  return (
    <div className="select-none" role="table" aria-label={`${m.sym} order book with Monday's quotes highlighted`}>
      <div className={cx(COLS, 'label h-6')} role="row">
        <span>Price</span>
        <span className="text-right">Size {m.sym}</span>
        <span className="text-right">Total</span>
      </div>
      <ol aria-label="Asks">
        {/* Monday's row is keyed by price, so a requote remounts it and the flash plays. */}
        {[...asks].reverse().map((r) => <Level key={r.mine ? `mine-${r.price}` : r.price} r={r} side="ask" max={max} m={m} ahead={m.aheadUsd.ask} />)}
        {pulled === 'ask' && <Pulled side="ask" m={m} now={now} />}
      </ol>
      {/* The spread row every terminal has: the gap in ticks and bps, and the mark beside it. */}
      <div className="flex h-7 items-center justify-between border-y border-line bg-raised px-2.5">
        <span className="num text-[13px] font-semibold tracking-tight" title="Mark price, what Perpl values positions at. It can sit outside the best bid and ask.">
          {fmtPrice(m.mark, m.spec)} <span className="text-[10px] font-normal uppercase tracking-[0.04em] text-fg-3">mark</span>
        </span>
        <span className="num text-[11px] text-fg-3">
          {spread != null && spreadBps != null ? <>spread {fmtPrice(spread, m.spec)} <span className="text-fg-2">{spreadBps.toFixed(spreadBps < 1 ? 2 : 1)} bps</span></> : 'no book'}
        </span>
      </div>
      <ol aria-label="Bids">
        {pulled === 'bid' && <Pulled side="bid" m={m} now={now} />}
        {bids.map((r) => <Level key={r.mine ? `mine-${r.price}` : r.price} r={r} side="bid" max={max} m={m} ahead={m.aheadUsd.bid} />)}
      </ol>
    </div>
  );
}
