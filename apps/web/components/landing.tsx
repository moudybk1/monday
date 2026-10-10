'use client';

import { PauseIcon, PlayIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MARKETS, type Decision, type Evidence, type MarketState, type MarketSym } from '@monday/core';
import { api } from '@/lib/api';
import { fmtPrice, fmtTime } from '@/lib/format';
import { useLive } from '@/lib/live';
import { OrderBook } from './book';
import { SignedBars } from './charts';
import { PriceChart } from './price-chart';
import { FlowBars, SmartTape } from './smart-money';
import { Panel, Skeleton, Tag, cx } from './ui';

/** A block that rises into place as it scrolls into view. Still under reduced motion. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className} initial={reduce ? false : { opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

const pct = (c: number) => `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`;

/** The product itself, in the hero: the house account's terminal on the live market. */
export function LiveMarket() {
  const { state, connected } = useLive('public');
  // A first snapshot takes a moment: say "connecting" until it is clearly overdue.
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOverdue(true), 8_000);
    return () => clearTimeout(t);
  }, []);
  const [picked, setPicked] = useState<MarketSym>('BTC');
  const syms = state ? (Object.keys(state.markets) as MarketSym[]) : [];
  const sym = syms.includes(picked) ? picked : syms[0];
  const m = sym ? state?.markets[sym] : undefined;

  if (!state || !m) {
    return (
      <div className="rounded-lg border border-line bg-canvas p-1">
        <Skeleton className="h-[420px] lg:h-[560px]" />
        <p className="px-2 py-2 text-[12px] text-fg-3">{overdue ? 'The live market feed is not reachable right now. The walkthrough below shows what Monday does.' : 'Connecting to the live market.'}</p>
      </div>
    );
  }
  const quoting = state.status === 'quoting';
  const venue = state.sim ? 'simulated book' : state.paper ? 'paper on Perpl' : 'Perpl';
  return (
    <figure>
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-void p-1">
        <div className="panel flex-row flex-wrap items-stretch">
          {/* Phones: the three tabs share the row and the day's change waits for a wider screen. */}
          <div role="tablist" aria-label="Market" className="flex w-full sm:w-auto">
            {syms.map((s) => {
              const x = state.markets[s]!;
              const c = x.day.changePct;
              return (
                <button key={s} role="tab" aria-selected={s === sym} onClick={() => setPicked(s)} className={cx('flex h-12 flex-1 flex-col justify-center border-r border-line px-3 text-left sm:min-w-[7.5rem] sm:flex-none', s === sym ? 'bg-raised shadow-[inset_0_-2px_0_var(--accent)]' : 'hover:bg-raised')}>
                  <span className="text-[12px] font-semibold leading-tight">{s} <span className="font-normal text-fg-3">perp</span></span>
                  <span className="num text-[11.5px] leading-tight text-fg-2">
                    {fmtPrice(x.mark, x.spec)}
                    {c != null && <span className={cx('ml-1.5 hidden sm:inline', c >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>{pct(c)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 px-2.5 py-2">
            {m.reflex ? <Tag tone="ask">{m.reflex.side} {m.reflex.action === 'pull' ? 'pulled' : 'widened'}: Smart Traders {m.reflex.side === 'ask' ? 'buying' : 'selling'}</Tag>
              : quoting ? <Tag tone="accent">Monday is quoting</Tag> : <Tag>book only</Tag>}
            {quoting && <Tag>{m.params.regime} regime</Tag>}
            {/* The one live indicator on the page: real state, not decoration. */}
            <span className="num ml-1 inline-flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em] text-fg-2">
              <span aria-hidden className={cx('size-1.5 rounded-full', connected ? 'live-dot bg-bid' : 'bg-warn')} />
              {connected ? `Live, ${venue}` : 'Reconnecting'}
            </span>
          </div>
        </div>
        <div className="grid gap-1 lg:h-[520px] lg:grid-cols-[292px_minmax(0,1fr)_340px]">
          <Panel title="Order book" aside={<span>Perpl</span>} bodyClassName="!overflow-hidden">
            <OrderBook m={m} rows={10} now={state.at} />
          </Panel>
          <PriceChart sym={sym} m={m} fills={state.fills} now={state.at} wheel={false} className="h-[320px] lg:h-auto" />
          <Panel title="Smart Traders on Hyperliquid" className="h-[320px] lg:h-auto" bodyClassName="flex flex-col !overflow-hidden">
            <div className="flex-none border-b border-line"><FlowBars m={m} /></div>
            <div className="scroll min-h-0 flex-1"><SmartTape m={m} now={state.at} limit={20} /></div>
          </Panel>
        </div>
      </div>
      {/* "Live" only while the stream is: a frozen book must say it is frozen. */}
      <figcaption className={cx('mt-2.5 text-[12.5px]', connected ? 'text-fg-3' : 'text-warn')} aria-live="polite">
        {!connected ? `Disconnected. Showing the last data from ${fmtTime(state.at, false)}; prices on screen are not moving. `
          : state.sim ? "Monday's house account quoting on a simulated book, streaming from its server. Pick a market. "
          : state.paper ? "Monday's house account paper-trading on Perpl's real book. Prices are real, its orders are simulated. "
          : `Perpl's live order book${m.signal ? ' and Smart Trader flow' : ''}, streaming from Monday's server. Not an illustration. `}
        {!state.sim && !state.paper && "Monday's own quotes appear in your terminal once you start it."}
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
    inPolicy: true, stage: 'normal', why: '', quotedPct: null, quoteAgeMs: { bid: null, ask: null }, basisBps: null,
    aheadUsd: { bid: 2_045, ask: pulled ? null : 1_790 }, tape: [], day: { volumeUsd: null, changePct: null, high: null, low: null }, openInterestUsd: 0, fills1h: 0, markout1mBps: null, trend5mBps: 0,
  };
}

const STEPS = [
  { verb: 'Quote', ms: 3000, text: 'Monday rests one bid and one ask around fair price. It aims to earn the spread when both fill; fees and price moves can still make a round trip lose.' },
  { verb: 'Detect', ms: 4000, text: 'Smart Traders buy $640k of BTC on Hyperliquid in five minutes. The flow score passes 2.5.' },
  { verb: 'Step aside', ms: 4000, text: 'On the next one-second tick the reflex pulls the ask, so a better-informed buyer cannot lift it. The bid stays.' },
  { verb: 'Explain', ms: 4000, text: 'The governor sets a storm regime and writes its reason in plain words, with a hash of the data behind it.' },
];

const CARDS: Pick<Decision, 'id' | 'source' | 'reason'>[] = [
  { id: 1, source: 'reflex', reason: 'Smart Traders bought $640k BTC on Hyperliquid in 5 min (z = 2.9). Ask pulled for 5 minutes.' },
  { id: 2, source: 'governor', reason: 'Storm regime. Widening quotes 2.5x and cutting size to 40% until flow cools.' },
];

type Play = 'ready' | 'playing' | 'paused' | 'done';

/**
 * The walkthrough: the steps down the left, the terminal panels beside them. It plays once, from the moment it is on
 * screen, and stops on the last step with Replay; a step picked by hand pauses it. Out of view it holds still. With
 * reduced motion it never plays by itself.
 * `onchain`: the Monad registry is live, so the governor's record can say it is anchored there.
 */
export function Story({ onchain = false }: { onchain?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [play, setPlay] = useState<Play>('ready');
  const [tabShown, setTabShown] = useState(true);
  useEffect(() => {
    const onChange = () => setTabShown(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  const seen = inView && tabShown;

  useEffect(() => {
    if (seen && play === 'ready' && !reduce) setPlay('playing');
  }, [seen, play, reduce]);
  useEffect(() => {
    if (play !== 'playing' || !seen) return;
    const t = setTimeout(() => (step < STEPS.length - 1 ? setStep(step + 1) : setPlay('done')), STEPS[step].ms);
    return () => clearTimeout(t);
  }, [play, seen, step]);

  const toggle = () => {
    if (play === 'playing') return setPlay('paused');
    if (play === 'done') setStep(0);
    setPlay('playing');
  };
  const m = scene(step);
  return (
    <div ref={ref} className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div>
        <ol aria-label="What happens during a Smart Trader burst" className="border-t border-line-2">
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <li key={s.verb} className="relative border-b border-line-2">
                <button
                  type="button" aria-current={on ? 'step' : undefined} onClick={() => { setStep(i); setPlay('paused'); }}
                  className={cx('block w-full border-l-2 py-4 pl-4 pr-2 text-left transition-colors duration-300', on ? 'border-accent' : 'border-transparent hover:bg-raised/60')}
                >
                  <span className={cx('block text-[18px] font-semibold tracking-tight', on ? 'text-fg' : 'text-fg-3')}>{s.verb}</span>
                  <span className={cx('mt-1 block max-w-[46ch] text-[14px] leading-snug', on ? 'text-fg-2' : 'text-fg-3')}>{s.text}</span>
                </button>
                {/* How long this step has left: drawn only while it plays, so a pause never shows a frozen bar. */}
                {on && play === 'playing' && seen && !reduce && (
                  <motion.span key={step} aria-hidden className="absolute inset-x-0 bottom-[-1px] h-px origin-left bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: s.ms / 1000, ease: 'linear' }} />
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={toggle} className="inline-flex h-9 items-center gap-2 rounded-sm border border-line-2 px-3 text-[12.5px] font-medium text-fg-2 hover:border-fg-3 hover:text-fg">
            {play === 'playing' ? <><PauseIcon size={14} weight="fill" /> Pause</> : play === 'done' ? <><ArrowCounterClockwiseIcon size={14} /> Replay</> : <><PlayIcon size={14} weight="fill" /> Play</>}
          </button>
          <p className="text-[12px] text-fg-3">Example data, drawn with the terminal&apos;s own components. In the product the reflex acts within a second and the governor every 15 minutes.</p>
        </div>
      </div>
      <div className="grid gap-1 self-start rounded-lg border border-line bg-void p-1 sm:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
        <Panel title="Order book" aside={<span>BTC perp</span>} bodyClassName="!overflow-hidden">
          <OrderBook m={m} rows={6} now={T0} />
        </Panel>
        <div className="flex min-h-0 flex-col gap-1">
          <Panel title="Smart Traders on Hyperliquid" className="flex-none" bodyClassName="!overflow-visible">
            <FlowBars m={m} />
          </Panel>
          <Panel title="Decisions" className="min-h-[10rem] flex-1">
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
                  {c.source === 'governor' && <p className="num mt-1 text-[11px] text-fg-3">{onchain ? 'hash logged on Monad' : 'reason and data hash recorded'}</p>}
                </motion.div>
              ))}
            </AnimatePresence>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function EvidenceTeaser() {
  const [ev, setEv] = useState<Evidence | 'pending' | 'error' | null>(null);
  const load = () => void api<Evidence & { pending?: boolean }>('/evidence').then((e) => setEv(e.pending ? 'pending' : e)).catch(() => setEv('error'));
  useEffect(load, []);
  if (ev === null) return <Skeleton className="h-72" />;
  if (ev === 'error') {
    return (
      <p className="panel px-4 py-10 text-fg-3">
        The evidence could not be loaded right now.{' '}
        <button type="button" onClick={() => { setEv(null); load(); }} className="font-medium text-fg underline underline-offset-2 hover:text-accent">Try again</button>
      </p>
    );
  }
  const sym = ev === 'pending' ? undefined : MARKETS.find((m) => ev.studies[m]); // BTC first when it has one
  const s = sym && ev !== 'pending' ? ev.studies[sym] : undefined;
  if (ev === 'pending' || !sym || !s) return <p className="panel px-4 py-10 text-fg-3">The event study is still collecting data. It needs two days of prices and Smart Trader trades before it reports anything.</p>;
  const head = s.grid.find((g) => g.window === 15 && g.horizon === 15 && [g.rho, g.lo, g.hi].every(Number.isFinite) && g.n > 0);
  if (!head) return <p className="panel px-4 py-10 text-fg-3">The study has no 15-minute result yet. The full tables are on the evidence page.</p>;
  const stats = [
    { k: 'Rank correlation, 15 min flow vs next 15 min', v: head.rho.toFixed(2), sub: `95% interval ${head.lo.toFixed(2)} to ${head.hi.toFixed(2)}` },
    { k: 'Independent samples', v: String(head.n), sub: `${sym}, non-overlapping 15-minute windows` },
    { k: 'Price moved the same way after a burst', v: s.hit.n > 0 && s.hit.rate >= 0 && s.hit.rate <= 1 ? `${Math.round(s.hit.rate * 100)}%` : 'n/a', sub: `${s.hit.n} bursts past z 2.5. Not a trading win rate.` },
  ];
  // What the interval says, in one sentence. A correlation is never a profit claim.
  const reading = head.lo > 0
    ? `In this sample, ${sym} tended to move the way Smart Traders traded over the next 15 minutes. That is a correlation, not a profit.`
    : head.hi < 0
      ? `In this sample, ${sym} tended to move against Smart Trader flow over the next 15 minutes.`
      : `This sample does not show a clear link between Smart Trader flow and where ${sym} went next.`;
  const computed = Number.isFinite(ev.at) ? new Date(ev.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  // Simulated data says so before the numbers, not under them.
  const synthetic = ev.synthetic && <p className="mb-2 text-[12px] text-warn">Simulated data. The simulator makes flow move price, so this shows the method working, not a proven edge.</p>;
  return (
    <div>
      {synthetic}
      <p className="mb-3 max-w-[70ch] text-[15px]">{reading}</p>
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
        <Panel title={`Mean ${sym} return over the next 15 minutes, by strength of Smart Trader flow`} aside={<span>bps</span>} bodyClassName="p-2 !overflow-hidden">
          <SignedBars
            height={230} format={(v) => v.toFixed(1)} label={`Mean forward 15-minute ${sym} return in basis points for each decile of the 15-minute Smart Trader z-score`}
            lowLabel="strongest selling" highLabel="strongest buying"
            data={s.deciles.filter((d) => Number.isFinite(d.meanRetBps) && Number.isFinite(d.meanZ)).map((d) => ({ key: `Decile ${d.decile}`, v: d.meanRetBps, tip: `Decile ${d.decile}: mean z ${d.meanZ.toFixed(1)}, next 15 min ${d.meanRetBps >= 0 ? '+' : ''}${d.meanRetBps.toFixed(2)} bps, ${d.n} samples` }))}
          />
        </Panel>
      </div>
      <p className="mt-3 text-[12px] text-fg-3">
        {computed && <>Computed {computed}. </>}Sources: {ev.smartMoneySource}; {ev.priceSource}.{' '}
        <Link href="/evidence" className="font-medium text-fg underline underline-offset-2 hover:text-accent">Read the evidence</Link>
      </p>
    </div>
  );
}
