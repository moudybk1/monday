'use client';

import type { ReactNode, RefObject } from 'react';
import { Button } from './ui';

const Swatch = ({ tone }: { tone: 'bid' | 'ask' }) => <span aria-hidden className={`mx-0.5 inline-block h-0.5 w-3.5 align-middle ${tone === 'bid' ? 'bg-bid' : 'bg-ask'}`} />;

// One line per area, named as it appears on screen, in words a non-trader can act on.
const AREAS: [string, ReactNode][] = [
  ['Market strip', <>Pick a market. Beside it: price, 24-hour change and range, volume, open interest, funding, and the regime Monday reads.</>],
  ['Chart', <>Candles show the market price. The dashed <Swatch tone="bid" /> line is the market maker&apos;s offer to buy, <Swatch tone="ask" /> its offer to sell, and arrows mark its trades. A running trade or TWAP draws its entry, stop and target. Scroll to zoom, drag to move.</>],
  ['Order book', <>Every open offer on Perpl. The middle row is the spread, which the market maker aims to earn a few bps of. Its own offers are tagged MONDAY, with how much is queued ahead of them. The Trades tab shows what is printing.</>],
  ['Agent', <>Your money: equity, today&apos;s result, the market maker&apos;s session and the day&apos;s stop loss. At that stop loss the market maker stops and closes its positions. Once stopped, it starts again from Setup.</>],
  ['Plans', <>Everything that is trading: the market maker, Agentic Trades and TWAPs, each with its stop, target and controls. <b>Close</b> ends a trade or TWAP at market. <b>Stop</b> cancels the market maker&apos;s offers and leaves any position to you. <b>Kill and flatten</b> cancels every order and closes every position on the account.</>],
  ['Open orders', <>The market maker&apos;s offers: at the best price or behind it, and what has to trade before each fills. A plan&apos;s orders show under Plans.</>],
  ['History', <>The market maker&apos;s fills, with how the price moved after each, and the trades and TWAPs that have ended.</>],
  ['Smart Traders', <>Big trades by wallets with a record of consistent profit. When they rush one way, the market maker steps aside on that side.</>],
  ['Decisions', <>Every change the market maker makes, with the reason in plain words.</>],
];

/** How to read the terminal. Opens by itself on the first visit; the Guide button reopens it. */
export function Guide({ dialog, sim, paper }: { dialog: RefObject<HTMLDialogElement | null>; sim: boolean; paper: boolean }) {
  return (
    <dialog ref={dialog} aria-labelledby="guide-title" className="m-auto w-[min(94vw,34rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg backdrop:bg-black/60">
      <h2 id="guide-title" className="text-[17px] font-semibold tracking-tight">How to use Monday</h2>
      <p className="mt-2 text-[14px] text-fg-2">
        Monday trades for you from your own Perpl account, in up to three modes you start in Setup. The market maker keeps an offer to buy just below the price and one to sell just above it, and aims to earn the gap. Agentic Trade scalps your long or short bias on one market. TWAP builds a position in slices. Every mode can lose money, which is why each has a stop loss. While they run, there is nothing you need to do.
      </p>
      <dl className="mt-4 grid gap-2.5 border-t border-line pt-4 text-[14px]">
        {AREAS.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-line pt-4 text-[14px] text-fg-2">
        Start a mode or change its limits under <b>Setup</b>. Your funds stay in your own Perpl account, and you can withdraw there at any time.
      </p>
      {paper && (
        <p className="mt-3 rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-[14px]">
          <b>Paper trading:</b> prices, the order book and Smart Trader trades are real. Monday&apos;s orders are simulated and never reach Perpl. An offer fills when the real market trades through its price.
        </p>
      )}
      {sim && (
        <p className="mt-3 rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-[14px]">
          <b>Try it:</b> with the market maker running, press <b>Buy burst</b> in the Smart Traders panel. Within a few seconds it pulls its sell offer, and the reason appears under Decisions.
        </p>
      )}
      <form method="dialog" className="mt-5 flex justify-end">
        <Button type="submit">Got it</Button>
      </form>
    </dialog>
  );
}
