'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Decision, Evidence, MarketState, MarketSym } from '@monday/core';
import { api } from '@/lib/api';
import { fmtPrice } from '@/lib/format';
import { useLive } from '@/lib/live';
import { OrderBook } from './book';
import { SignedBars } from './charts';
import { PriceChart } from './price-chart';
import { FlowBars, SmartTape } from './smart-money';
import { Panel, Skeleton, Tag, cx } from './ui';

/** The hero's visual is the product itself: the house account's terminal, live. */
export function HeroTerminal() {
  const { state } = useLive('public');
  const [picked, setPicked] = useState<MarketSym>('BTC');
  const syms = state ? (Object.keys(state.markets) as MarketSym[]) : [];
  const sym = syms.includes(picked) ? picked : syms[0];
  const m = sym ? state?.markets[sym] : undefined;

  if (!state || !m) {
    return (
      <div className="rounded-lg border border-line bg-canvas p-1">
        <Skeleton className="h-[420px]" />
        <p className="px-2 py-2 text-[12px] text-fg-3">Waiting for the Monday server. Start it with npm run dev to see the live terminal.</p>
      </div>
    );
  }
  const quoting = state.status === 'quoting';
  return (
    <figure>
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-void p-1">
        <div className="panel flex-row flex-wrap items-stretch">
          <div role="tablist" aria-label="Market" className="flex">
            {syms.map((s) => {
              const x = state.markets[s]!;
              return (
                <button key={s} role="tab" aria-selected={s === sym} onClick={() => setPicked(s)} className={cx('flex h-11 min-w-[6.75rem] flex-col justify-center border-r border-line px-3 text-left', s === sym ? 'bg-raised shadow-[inset_0_-2px_0_var(--accent)]' : 'hover:bg-raised')}>
                  <span className="text-[12px] font-semibold leading-tight">{s} <span className="font-normal text-fg-3">perp</span></span>
                  <span className="num text-[11.5px] leading-tight text-fg-2">{fmtPrice(x.mark, x.spec)}</span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 px-2.5 py-2">
            {m.reflex ? <Tag tone="ask">{m.reflex.side} {m.reflex.action === 'pull' ? 'pulled' : 'widened'}: smart money {m.reflex.side === 'ask' ? 'buying' : 'selling'}</Tag>
              : quoting ? <Tag tone="accent">Monday is quoting</Tag> : <Tag>book only</Tag>}
            {quoting && <Tag>{m.params.regime} regime</Tag>}
          </div>
        </div>
        <div className="grid gap-1 lg:h-[388px] lg:grid-cols-[272px_minmax(0,1fr)_332px]">
          <Panel title="Order book" aside={<span>Perpl</span>} bodyClassName="!overflow-hidden">
            <OrderBook m={m} rows={7} now={state.at} />
          </Panel>
          <PriceChart sym={sym} m={m} fills={state.fills} now={state.at} wheel={false} className="h-[300px] lg:h-auto" />
          <Panel title="Smart money on Hyperliquid" className="h-[300px] lg:h-auto" bodyClassName="flex flex-col !overflow-hidden">
            <div className="flex-none border-b border-line"><FlowBars m={m} /></div>
            <div className="scroll min-h-0 flex-1"><SmartTape m={m} now={state.at} limit={14} /></div>
          </Panel>
        </div>
      </div>
      <figcaption className="mt-2 text-[12px] text-fg-3">
        {state.sim ? "Live: Monday's house account quoting on a simulated book. Pick a market."
          : state.paper ? "Live: Monday's house account paper-trading on Perpl's real book. Prices are real, its orders are simulated."
          : `Live Perpl order book${m.signal ? ' with Nansen smart-money flow' : ''}. Monday's own quotes appear in your terminal once you start it.`}
      </figcaption>
    </figure>
  );
}

// ---- The burst, step by step (PRD 6.3). Example numbers, real components. ----

const T0 = 1_760_000_000_000;
const SPEC = { sym: 'BTC' as const, marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15 };
const lv = (px: number[], sz: number[]) => px.map((price, i) => ({ price, size: sz[i] }));
const win = (netUsd: number, z: number, n: number) => ({ netUsd, grossUsd: Math.abs(netUsd) * 1.2, imbalance: Math.sign(netUsd) * 0.83, z, n });

function scene(step: number): MarketState {
  const burst = step >= 1;
  const pulled = step >= 2;
  return {
    sym: 'BTC', spec: SPEC, mark: 85_200, oracle: 85_200, mid: 85_200, bestBid: 85_180.4, bestAsk: 85_219.8,
    asks: lv([85_219.8, 85_231.1, 85_242.6, 85_254.0], [0.021, 0.034, 0.047, 0.058]),
    bids: lv([85_180.4, 85_168.9, 85_157.2, 85_146.1], [0.024, 0.031, 0.049, 0.061]),
    fundingRate: 0, dataAgeMs: 200, sigma1mBps: 2.4, book: 0, hlMid: null,
    quotes: { bid: { price: 85_162.1, size: 0.00117 }, ask: pulled ? null : { price: 85_237.9, size: 0.00117 } },
    model: null, position: { size: 0, entryPrice: 0, notionalUsd: 0, unrealizedUsd: 0 },
    params: { market: 'BTC', enabled: true, spread_mult: 1, skew_bias_bps: 0, size_mult: 1, max_inventory_usd: 500, ttl_min: 15, regime: 'calm', reason: '' },
    paramsSource: 'fallback',
    reflex: pulled ? { side: 'ask', action: 'pull', until: T0 + 300_000, z: 2.9, triggerHashes: [] } : null,
    signal: {
      sym: 'BTC', at: T0, stale: false, S: burst ? 2.6 : 0.2,
      w5: burst ? win(640_000, 2.9, 14) : win(38_000, 0.3, 4), w15: burst ? win(710_000, 2.2, 22) : win(-21_000, -0.1, 11), w60: burst ? win(820_000, 1.1, 51) : win(96_000, 0.2, 40),
    },
    trades: [], priceSeries: [],
  };
}

const STEPS = [
  { verb: 'Quote', text: 'Monday rests one bid and one ask around fair price and earns the spread each time both fill.' },
  { verb: 'Detect', text: 'Traders Nansen labels as smart money buy $640k of BTC on Hyperliquid in five minutes. The flow score passes 2.5.' },
  { verb: 'Step aside', text: 'On the next one-second tick the reflex pulls the ask. Only the bid stays, so nobody can lift Monday before price moves.' },
  { verb: 'Explain', text: 'The governor sets a storm regime, writes its reason in plain words and logs the hash on Monad for anyone to check.' },
];

const CARDS: Pick<Decision, 'id' | 'source' | 'reason'>[] = [
  { id: 1, source: 'reflex', reason: 'Smart money bought $640k BTC on Hyperliquid in 5 min (z = 2.9). Ask pulled for 5 minutes.' },
  { id: 2, source: 'governor', reason: 'Storm regime. Widening quotes 2.5x and cutting size to 40% until flow cools.' },
];

export function Story() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const reduce = useReducedMotion();

  // Motion here is storytelling: the sequence is the explanation. It stops for good once the reader takes over.
  useEffect(() => {
    if (!auto || reduce) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 4200);
    return () => clearInterval(t);
  }, [auto, reduce]);

  const m = scene(step);
  return (
    <div onPointerEnter={() => setAuto(false)} onFocusCapture={() => setAuto(false)}>
      <div role="tablist" aria-label="What happens during a smart-money burst" className="grid border-y border-line sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <button
            key={s.verb} role="tab" aria-selected={i === step} onClick={() => { setStep(i); setAuto(false); }}
            className={cx('border-line px-0 py-4 text-left sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0', i === step ? 'shadow-[inset_0_2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg-2')}
          >
            <span className={cx('text-xl font-semibold tracking-tight', i === step && 'text-accent')}>{s.verb}</span>
            <span className={cx('mt-1.5 block text-[13px] leading-snug', i === step ? 'text-fg-2' : 'hidden sm:block')}>{s.text}</span>
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-1 rounded-lg border border-line bg-void p-1 md:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
        <Panel title="Order book" aside={<span>BTC perp</span>} bodyClassName="!overflow-hidden">
          <OrderBook m={m} rows={5} now={T0} />
        </Panel>
        <div className="flex min-h-0 flex-col gap-1">
          <Panel title="Smart money on Hyperliquid" className="flex-none" bodyClassName="!overflow-visible">
            <FlowBars m={m} />
          </Panel>
          <Panel title="Decisions" className="min-h-[9rem] flex-1">
            <AnimatePresence initial={false} mode="popLayout">
              {step < 2 && (
                <motion.p key="none" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-2.5 py-3 text-[12.5px] text-fg-3">
                  Calm regime. Normal width, full size, both sides quoted.
                </motion.p>
              )}
              {CARDS.filter((_, i) => step >= i + 2).map((c) => (
                <motion.div
                  key={c.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className={cx('border-b border-line py-2 pl-2.5 pr-2.5', c.source === 'reflex' ? 'border-l-2 border-l-ask' : 'border-l-2 border-l-transparent')}
                >
                  <div className="flex gap-1"><Tag>BTC</Tag><Tag tone={c.source === 'reflex' ? 'ask' : 'neutral'}>{c.source === 'reflex' ? 'Reflex' : 'Governor'}</Tag>{c.source === 'governor' && <Tag tone="accent">storm</Tag>}</div>
                  <p className="mt-1.5 text-[12.5px] leading-snug">{c.reason}</p>
                  {c.source === 'governor' && <p className="num mt-1 text-[11px] text-fg-3">logged on Monad</p>}
                </motion.div>
              ))}
            </AnimatePresence>
          </Panel>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-fg-3">Illustration with example numbers, drawn with the same components as the terminal.</p>
    </div>
  );
}

export function EvidenceTeaser() {
  const [ev, setEv] = useState<Evidence | null | 'none'>(null);
  useEffect(() => {
    api<Evidence & { pending?: boolean }>('/evidence').then((e) => setEv(e.pending ? 'none' : e)).catch(() => setEv('none'));
  }, []);
  if (ev === null) return <Skeleton className="h-72" />;
  const s = ev === 'none' ? undefined : ev.studies.BTC;
  if (ev === 'none' || !s) return <p className="panel px-4 py-10 text-fg-3">The event study is still collecting data. It needs two days of prices and smart-money trades before it reports anything.</p>;
  const head = s.grid.find((g) => g.window === 15 && g.horizon === 15)!;
  const stats = [
    { k: 'Rank correlation, 15 min flow vs next 15 min', v: head.rho.toFixed(2), sub: `95% interval ${head.lo.toFixed(2)} to ${head.hi.toFixed(2)}` },
    { k: 'Independent samples', v: String(head.n), sub: 'seven days, BTC' },
    { k: 'Same-way moves after a burst', v: s.hit.n ? `${Math.round(s.hit.rate * 100)}%` : 'n/a', sub: `${s.hit.n} bursts past z 2.5` },
  ];
  return (
    <div>
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-void p-1">
        <dl className="grid gap-1 sm:grid-cols-3">
          {stats.map((x) => (
            <div key={x.k} className="panel px-3.5 py-3">
              <dt className="text-[12px] text-fg-3">{x.k}</dt>
              <dd className="num mt-1.5 text-[28px] font-medium leading-none tracking-tight">{x.v}</dd>
              <dd className="num mt-2 text-[11.5px] text-fg-3">{x.sub}</dd>
            </div>
          ))}
        </dl>
        <Panel title="Mean BTC return over the next 15 minutes, by strength of smart-money flow" aside={<span>bps</span>} bodyClassName="p-2 !overflow-hidden">
          <SignedBars
            height={230} format={(v) => v.toFixed(1)} label="Mean forward 15-minute return in basis points for each decile of the 15-minute smart-money z-score"
            lowLabel="strongest selling" highLabel="strongest buying"
            data={s.deciles.map((d) => ({ key: `Decile ${d.decile}`, v: d.meanRetBps, tip: `Decile ${d.decile}: mean z ${d.meanZ.toFixed(1)}, next 15 min ${d.meanRetBps >= 0 ? '+' : ''}${d.meanRetBps.toFixed(2)} bps, ${d.n} samples` }))}
          />
        </Panel>
      </div>
      {ev.synthetic && <p className="mt-2 text-[12px] text-fg-3">Simulated data. The simulator makes flow move price, so this shows the method working, not a proven edge. Real Nansen and Perpl data replace it once keys are configured.</p>}
    </div>
  );
}
