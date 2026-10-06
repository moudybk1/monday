'use client';

import type { ReactNode, RefObject } from 'react';
import { Button } from './ui';

const Swatch = ({ tone }: { tone: 'bid' | 'ask' }) => <span aria-hidden className={`mx-0.5 inline-block h-0.5 w-3.5 align-middle ${tone === 'bid' ? 'bg-bid' : 'bg-ask'}`} />;

// One line per area, named as it appears on screen, in words a non-trader can act on.
const AREAS: [string, ReactNode][] = [
  ['Top bar', <>Whether Monday is running. <b>Pause</b> cancels its offers and keeps any open position. <b>Kill and flatten</b> cancels everything and closes positions.</>],
  ['Chart', <>Candles show the market price. The dashed <Swatch tone="bid" /> line is Monday&apos;s offer to buy, <Swatch tone="ask" /> its offer to sell. Arrows mark its trades. Scroll to zoom, drag to move.</>],
  ['Order book', <>Every open offer on Perpl. Monday&apos;s own are tagged MONDAY.</>],
  ['Agent', <>Your money: account value, today&apos;s result after fees, and how much of your daily loss limit is used. At 100% Monday stops for the day.</>],
  ['Smart money', <>Big trades by wallets Nansen labels as consistently profitable. When they rush one way, Monday steps aside on that side.</>],
  ['Positions', <>What Monday holds in each market, its entry price, and the open profit or loss at today&apos;s price.</>],
  ['Decisions', <>Every change Monday makes, with the reason in plain words.</>],
];

/** How to read the terminal. Opens by itself on the first visit; the Guide button reopens it. */
export function Guide({ dialog, sim, paper }: { dialog: RefObject<HTMLDialogElement | null>; sim: boolean; paper: boolean }) {
  return (
    <dialog ref={dialog} aria-labelledby="guide-title" className="m-auto w-[min(94vw,34rem)] rounded-md border border-line-2 bg-canvas p-5 text-fg backdrop:bg-black/60">
      <h2 id="guide-title" className="text-[17px] font-semibold tracking-tight">How to use Monday</h2>
      <p className="mt-2 text-[13px] text-fg-2">
        Monday trades for you. It keeps one offer to buy a little below the market price and one to sell a little above it. When other traders take those offers, it aims to earn the gap. It can also lose money if the price moves against what it holds, which is why your limits exist. While it runs, there is nothing you need to do.
      </p>
      <dl className="mt-4 grid gap-2.5 border-t border-line pt-4 text-[13px]">
        {AREAS.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-line pt-4 text-[13px] text-fg-2">
        Change your limits on the <b>Policy</b> tab. Your funds stay in your own Perpl account, and you can withdraw there at any time.
      </p>
      {paper && (
        <p className="mt-3 rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-[13px]">
          <b>Paper trading:</b> prices, the order book and smart-money trades are real. Monday&apos;s orders are simulated and never reach Perpl. An offer fills when the real market trades through its price.
        </p>
      )}
      {sim && (
        <p className="mt-3 rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-[13px]">
          <b>Try it:</b> press <b>Buy burst</b> in the Smart money panel. Within a few seconds Monday pulls its sell offer, and the reason appears under Decisions.
        </p>
      )}
      <form method="dialog" className="mt-5 flex justify-end">
        <Button type="submit">Got it</Button>
      </form>
    </dialog>
  );
}
