'use client';

import type { MarketState } from '@monday/core';
import { fmtPrice, fmtSize, fmtTime } from '@/lib/format';
import { cx } from './ui';

const COLS = 'grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-2 px-2.5';

/** The last prints on Perpl, newest first, in the taker's colour: a buy lifted an ask, a sell hit a bid. */
export function Tape({ m, limit = 30 }: { m: MarketState; limit?: number }) {
  return (
    <div role="table" aria-label={`${m.sym} recent trades`} className="select-none">
      <div className={cx(COLS, 'label h-6')} role="row">
        <span>Price</span>
        <span className="text-right">Size {m.sym}</span>
        <span className="text-right">Time</span>
      </div>
      {m.tape.length === 0 ? (
        <p className="px-2.5 py-4 text-[12px] text-fg-3">No prints yet. Trades appear here as they happen.</p>
      ) : (
        <ol>
          {/* Keyed by print, so a new print mounts a new row and flashes once in its own colour. */}
          {m.tape.slice(0, limit).map((t, i) => (
            <li key={`${t.ts}:${t.price}:${t.size}:${i}`} role="row" className={cx(COLS, 'num h-[21px] text-[12px]', i === 0 && (t.side === 'buy' ? 'flash-up' : 'flash-down'))}>
              <span className={t.side === 'buy' ? 'text-bid-fg' : 'text-ask-fg'}>{fmtPrice(t.price, m.spec)}</span>
              <span className="text-right text-fg">{fmtSize(t.size, m.spec)}</span>
              <span className="text-right text-fg-3">{fmtTime(t.ts)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
