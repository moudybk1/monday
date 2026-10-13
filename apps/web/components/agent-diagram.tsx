'use client';

import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Mark, Tag, cx } from './ui';

/*
  The hero's drawing of how Monday works: what it watches, its three loops, and what it does on your Perpl account.
  It plays one Smart Trader burst on a loop, with the example numbers the walkthrough below uses and the clock sped up
  (in the product the engine runs every second and Kimi every 15 minutes). It plays only while on screen, can be
  paused, and under reduced motion holds the burst's busiest moment still.
*/

type Who = 'Reflex' | 'Governor';
interface Step { ms: number; burst?: boolean; pulled?: boolean; storm?: boolean; review?: boolean; log?: { who: Who; text: string } }

const STEPS: Step[] = [
  { ms: 4200 }, // calm: the engine reprices both quotes every second
  { ms: 1200, burst: true }, // Smart Traders start buying
  { ms: 3000, burst: true, pulled: true, log: { who: 'Reflex', text: 'Ask pulled for 5 min' } }, // the next tick
  { ms: 4400, burst: true, pulled: true, storm: true, review: true, log: { who: 'Governor', text: 'Storm regime' } },
  { ms: 3400, storm: true }, // the flow cools: the ask comes back, wider and smaller
  { ms: 3200, review: true, log: { who: 'Governor', text: 'Calm regime' } },
];
/** The frame shown still under reduced motion: burst, ask pulled, storm dials. */
const BUSIEST = 3;
const HASHES = ['0x3f9c…a1e2', '0x81d2…7e05', '0xc47a…19bd', '0x5be0…d34c', '0x9a61…02f7', '0x2ed8…6b91'];

/** The two newest decisions up to step n, newest first; before the first one, the calm review that came before. */
function decisions(n: number) {
  const out: { id: number; who: Who; text: string }[] = [];
  for (let k = n; k >= 0 && out.length < 2; k--) {
    const l = STEPS[k % STEPS.length].log;
    if (l) out.push({ id: k, ...l });
  }
  if (out.length < 2) out.push({ id: -1, who: 'Governor', text: 'Calm regime' });
  return out;
}

export function AgentDiagram({ onchain = false, className }: { onchain?: boolean; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduce = useReducedMotion();
  // Set after mount, so the server's markup and the first client render agree.
  const [still, setStill] = useState(false);
  useEffect(() => setStill(Boolean(reduce)), [reduce]);
  const [tabShown, setTabShown] = useState(true);
  useEffect(() => {
    const onChange = () => setTabShown(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  const [playing, setPlaying] = useState(true);
  const [n, setN] = useState(0); // steps played so far
  const live = playing && inView && tabShown && !still;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setN((x) => x + 1), STEPS[n % STEPS.length].ms);
    return () => clearTimeout(t);
  }, [live, n]);

  const k = still ? BUSIEST : n;
  const s = STEPS[k % STEPS.length];
  const log = decisions(k);
  return (
    <figure ref={ref} className={cx('relative', className)}>
      <div
        className={cx('mx-auto grid max-w-[44rem] xl:max-w-none xl:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)_minmax(0,19rem)] xl:gap-x-[var(--wire)]', !live && 'paused')}
        style={{ '--wire': 'clamp(4rem, calc((100vw - 1100px) / 3), 7rem)' } as CSSProperties}
      >
        <Inputs burst={Boolean(s.burst)} />
        <Drop>
          <Packet c="fg-3" dur={1400} />
          <Packet c={s.burst ? 'bid' : 'fg-3'} dur={s.burst ? 700 : 1400} delay={600} />
        </Drop>

        <div className="relative">
          {/* The page's one light: an amber horizon on Monday's top edge, glowing up into the headline. */}
          <div aria-hidden className="pointer-events-none absolute -inset-x-16 -top-44 h-44 bg-[radial-gradient(50%_80%_at_50%_100%,var(--glow),transparent_72%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-x-[10%] -top-px z-[1] h-px bg-[linear-gradient(90deg,transparent,var(--accent)_22%,var(--accent)_78%,transparent)]" />
          <div className="relative overflow-hidden rounded-lg border border-line-2 bg-canvas shadow-[0_30px_80px_-30px_rgb(40_30_16/0.28)] dark:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)]">
            <header className="flex h-11 items-center justify-between gap-3 border-b border-line px-4">
              <span className="flex items-center gap-2 text-[14px] font-semibold tracking-tight"><Mark size={18} /> Monday</span>
              <Tag>within your limits</Tag>
            </header>
            <div className="grid gap-px bg-line sm:grid-cols-2">
              <Cell name="Governor" who="Kimi" when="every 15 min" note="Turns the dials. Never places an order." flash={s.review ? `num-${k}` : null} className="shadow-[inset_2px_0_0_var(--accent)] sm:col-span-2">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <Gauge label="Spread" value={s.storm ? '2.5x' : '1.0x'} p={s.storm ? 0.8 : 0.2} />
                  <Gauge label="Size" value={s.storm ? '40%' : '100%'} p={s.storm ? 0.4 : 1} />
                  <div className="min-w-[11rem] flex-1">
                    <Tag tone={s.storm ? 'accent' : 'neutral'}>{s.storm ? 'storm' : 'calm'} regime</Tag>
                    <p className="mt-2 max-w-[32ch] text-[13px] leading-snug text-fg-2">
                      {s.storm ? 'Smart Traders are buying hard. Wider and smaller until the flow cools.' : 'Normal width, full size, both sides quoted.'}
                    </p>
                  </div>
                </div>
              </Cell>
              <Cell name="Engine" who="code" when="every 1 s" note="Reprices both quotes from the book, the reference market and the position.">
                <div aria-hidden className="flex h-10 items-end gap-[3px]">
                  {Array.from({ length: 12 }, (_, i) => <span key={i} className="beat h-full w-[3px] rounded-[1px] bg-line-2" style={{ '--i': i } as CSSProperties} />)}
                </div>
              </Cell>
              <Cell name="Reflex" who="code" when="next tick" note="Pulls the side about to be run over." flash={s.pulled && !STEPS[(k + STEPS.length - 1) % STEPS.length].pulled ? `down-${k}` : null}>
                <div className="flex h-10 flex-col justify-between">
                  <Switch label="Ask" on={!s.pulled} />
                  <Switch label="Bid" on />
                </div>
              </Cell>
            </div>
          </div>
        </div>

        <Drop>
          <Packet c="accent" dur={1000} />
        </Drop>
        {/* At xl the record sits level with Kimi, which writes the reasons, and the account level with the code that
            places the orders. */}
        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:flex xl:flex-col-reverse xl:justify-between xl:gap-0">
          <div className="relative">
            <Book storm={Boolean(s.storm)} pulled={Boolean(s.pulled)} />
            <Wire dir="x" className="right-full top-[calc(2.5rem+4.75rem)] hidden w-[var(--wire)] xl:block"><Packet c="accent" dur={1000} /></Wire>
          </div>
          <div className="relative xl:mt-14 xl:pl-3">
            <p className="label">{onchain ? 'Logged on Monad' : 'Decision log'}</p>
            {/* Room for two entries from the start, so the second one does not move the page. */}
            <ul className="mt-3 grid min-h-[2.875rem] content-start gap-2">
              {log.map((e) => (
                <li key={e.id} className="rise flex min-w-0 items-center gap-2 text-[12.5px]">
                  <Tag tone={e.who === 'Reflex' ? 'ask' : 'neutral'}>{e.who}</Tag>
                  <span className="truncate">{e.text}</span>
                  <span className="num ml-auto pl-2 text-[11px] text-fg-3">{HASHES[(e.id + HASHES.length) % HASHES.length]}</span>
                </li>
              ))}
            </ul>
            <Wire dir="x" className="right-full top-[5px] hidden w-[var(--wire)] xl:block">{s.log && <Packet key={k} c="accent" dur={700} once />}</Wire>
          </div>
        </div>
      </div>
      <figcaption className="mx-auto mt-6 flex max-w-[44rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[12.5px] text-fg-3 xl:max-w-none">
        <span>Drawn with example numbers and the clock sped up. In the product the engine runs every second and Kimi every 15 minutes.</span>
        {!still && (
          <button type="button" onClick={() => setPlaying(!playing)} className="inline-flex h-8 items-center gap-2 rounded-sm border border-line-2 px-3 text-[12px] font-medium text-fg-2 hover:border-fg-3 hover:text-fg">
            {playing ? <><PauseIcon size={13} weight="fill" /> Pause</> : <><PlayIcon size={13} weight="fill" /> Play</>}
          </button>
        )}
      </figcaption>
    </figure>
  );
}

const INPUTS = [
  { name: 'Perpl', sub: 'Order book, trades, funding', packets: [[1600, 0], [1600, 800]] },
  { name: 'Reference market', sub: 'Prices and the trade tape', packets: [[2100, 300], [2100, 1350]] },
  { name: 'Smart Traders', sub: 'Wallets with a record of profit', packets: [[3200, 400]] },
] as const;
// The Smart Trader flow, bar by bar: quiet, then the burst.
const QUIET = [3, 5, 2, 6, 4, 3, 7, 4, 2, 5, 3, 4];
const LOUD = [5, 8, 11, 9, 14, 12, 17, 15, 13, 18, 16, 20];

/** What Monday watches, each wired into it. The Smart Traders' wire carries the burst. */
function Inputs({ burst }: { burst: boolean }) {
  return (
    // On a phone the three sit in one row, names only; the lines under them return from sm up.
    <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:gap-x-6 xl:flex xl:flex-col xl:justify-between xl:pt-14 xl:text-right">
      {INPUTS.map((x) => {
        const st = x.name === 'Smart Traders';
        return (
          <div key={x.name} className="relative xl:pr-3">
            <p className="flex items-center gap-2 text-[14px] font-semibold tracking-tight sm:text-[15px] xl:justify-end">
              {st && burst && <span className="hidden sm:inline-flex"><Tag tone="bid">buying</Tag></span>}
              {x.name}
            </p>
            <p className="mt-1 hidden text-[13px] text-fg-3 sm:block">{x.sub}</p>
            {st && (
              <div aria-hidden className="mt-2.5 flex h-5 items-end gap-[3px] xl:justify-end">
                {QUIET.map((q, i) => (
                  <span
                    key={i}
                    className={cx('w-[3px] rounded-[1px] motion-safe:transition-[height,background-color] motion-safe:duration-500', burst ? 'bg-bid' : 'bg-line-2')}
                    style={{ height: burst ? LOUD[i] : q, transitionDelay: `${i * 25}ms` }}
                  />
                ))}
              </div>
            )}
            <Wire dir="x" className="left-full top-[11px] hidden w-[var(--wire)] xl:block">
              {x.packets.map(([dur, delay]) => <Packet key={delay} c={st ? 'bid' : 'fg-3'} dur={dur} delay={delay} />)}
              {st && burst && [0, 180, 360, 540].map((d) => <Packet key={`b${d}`} c="bid" dur={800} delay={d} />)}
            </Wire>
          </div>
        );
      })}
    </div>
  );
}

/** One of Monday's loops: who runs it and how often, what it is doing now, and what it is for. */
function Cell({ name, who, when, note, flash = null, className, children }: { name: string; who: string; when: string; note: string; flash?: string | null; className?: string; children: ReactNode }) {
  return (
    <div className={cx('relative isolate bg-canvas px-4 py-4', className)}>
      {/* A loop that just acted: a tint that fades, amber for Kimi, vermilion for the reflex. */}
      {flash && <span key={flash} aria-hidden className={cx('absolute inset-0 -z-10', flash.startsWith('num') ? 'flash-num' : 'flash-down')} />}
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">{name}<Tag tone={who === 'Kimi' ? 'accent' : 'neutral'}>{who}</Tag></p>
        <p className="num text-[12px] text-fg-3">{when}</p>
      </div>
      <div className="mt-4">{children}</div>
      <p className="mt-3 text-[12.5px] leading-snug text-fg-3">{note}</p>
    </div>
  );
}

/** A half dial: the track, the amber share up to the value, a needle on it. `p` is 0 to 1. */
function Gauge({ label, value, p }: { label: string; value: string; p: number }) {
  return (
    <div className="flex w-[5.5rem] flex-col items-center">
      <svg viewBox="0 0 100 56" className="w-full" aria-hidden>
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--line-2)" strokeWidth="5" />
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--accent)" strokeWidth="5" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out-expo" />
        <line x1="50" y1="50" x2="50" y2="18" stroke="var(--fg)" strokeWidth="2" className="motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out-expo" style={{ transformBox: 'view-box', transformOrigin: '50px 50px', transform: `rotate(${-90 + p * 180}deg)` }} />
        <circle cx="50" cy="50" r="4" fill="var(--fg)" />
      </svg>
      <span key={value} className="flash-num num mt-1 rounded-xs px-1 text-[17px] font-medium leading-tight">{value}</span>
      <span className="label mt-1">{label}</span>
    </div>
  );
}

/** One side's switch in the reflex: on while Monday quotes that side, off while it is pulled. */
function Switch({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="flex items-center gap-2 text-[12.5px]">
      <span aria-hidden className={cx('relative h-4 w-[30px] rounded-sm border motion-safe:transition-colors motion-safe:duration-300', on ? 'border-accent/50 bg-accent/12' : 'border-ask/55 bg-ask/12')}>
        <span className={cx('absolute top-[2px] size-2.5 rounded-[2px] motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out-expo', on ? 'translate-x-[16px] bg-accent' : 'translate-x-[2px] bg-ask')} />
      </span>
      <span className="font-medium">{label}</span>
      <span className={cx('num text-[11px]', on ? 'text-fg-3' : 'text-ask-fg')}>{on ? 'quoted' : 'pulled'}</span>
    </span>
  );
}

// Other traders' orders, from the touch outward: share of the widest bar.
const ASKS = [0.38, 0.62, 0.3, 0.8, 0.52];
const BIDS = [0.44, 0.34, 0.7, 0.5, 0.86];

/**
 * The account the orders rest on: other traders' depth from the price column, Monday's two quotes in amber, and the
 * spread between them. The spread dial sets how far the quotes sit from the mid, the size dial how long they are.
 */
function Book({ storm, pulled }: { storm: boolean; pulled: boolean }) {
  const off = storm ? 42 : 18; // px from the mid
  const size = storm ? 0.4 : 1;
  const ease = 'motion-safe:duration-700 motion-safe:ease-out-expo';
  return (
    <div className="panel">
      <header className="flex h-10 flex-none items-center justify-between gap-3 border-b border-line px-3">
        <h3 className="text-[13px] font-semibold">Your Perpl account</h3>
        <Tag tone="accent">funds stay here</Tag>
      </header>
      <div aria-hidden className="relative h-[9.5rem]">
        <span className={cx('absolute left-3 top-1/2 w-1.5 -translate-y-1/2 border-y border-l border-fg-3 motion-safe:transition-[height]', ease)} style={{ height: off * 2 }} />
        <span className="label absolute left-6 top-1/2 -translate-y-1/2">spread</span>
        <div className="absolute inset-y-0 left-[5.25rem] right-[7rem]">
          {ASKS.map((w, i) => <span key={`a${i}`} className="absolute right-0 h-[3px] rounded-[1px] bg-ask/30" style={{ top: `calc(50% - ${(i + 1) * 12 + 1}px)`, width: `${w * 100}%` }} />)}
          {BIDS.map((w, i) => <span key={`b${i}`} className="absolute right-0 h-[3px] rounded-[1px] bg-bid/30" style={{ top: `calc(50% + ${(i + 1) * 12 - 2}px)`, width: `${w * 100}%` }} />)}
        </div>
        <span className="absolute left-[5.25rem] right-3 top-1/2 border-t border-dashed border-line-2" />
        <span className="label absolute right-3 top-1/2 -translate-y-1/2 bg-canvas pl-2">mid</span>
        {(['ask', 'bid'] as const).map((side) => {
          const gone = side === 'ask' && pulled;
          return (
            <div key={side} className={cx('absolute left-[5.25rem] right-3 top-1/2 flex items-center gap-3 motion-safe:transition-transform', ease)} style={{ transform: `translateY(calc(${side === 'ask' ? -off : off}px - 50%))` }}>
              <span className="relative h-[7px] flex-1">
                <span
                  className={cx('absolute inset-y-0 right-0 rounded-[1px] motion-safe:transition-[width,background-color,border-color]', ease, gone ? 'hatch border border-dashed border-ask/80' : 'border border-transparent bg-accent')}
                  style={{ width: `${size * 78}%` }}
                />
              </span>
              <span className={cx('num w-[5.5rem] text-[10.5px] font-semibold uppercase tracking-[0.04em]', gone ? 'text-ask-fg' : 'text-accent')}>{gone ? 'Ask pulled' : `Monday ${side}`}</span>
            </div>
          );
        })}
      </div>
      <p className="border-t border-line px-3 py-2.5 text-[12px] text-fg-3">Post-only maker orders. They never cross the book.</p>
    </div>
  );
}

/** A wire between two parts of the drawing, with a pin at each end; what travels along it is drawn by its packets. */
function Wire({ dir, className, children }: { dir: 'x' | 'y'; className?: string; children?: ReactNode }) {
  return (
    <span aria-hidden className={cx('wire', dir === 'x' ? 'wire-x' : 'wire-y', className)}>
      {children}
      <span className="pin" />
      <span className="pin" />
    </span>
  );
}

/** The vertical wire between the stacked parts, below xl where the drawing reads top to bottom. */
function Drop({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden className="relative mx-auto h-12 w-px xl:hidden">
      <Wire dir="y" className="inset-y-0 left-0">{children}</Wire>
    </div>
  );
}

/** Something travelling along a wire: a short bar with a fading tail, in a token colour. */
function Packet({ c, dur, delay = 0, once = false }: { c: string; dur: number; delay?: number; once?: boolean }) {
  return <span className={cx('packet', once && 'once')} style={{ '--c': `var(--${c})`, '--dur': `${dur}ms`, '--delay': `${delay}ms` } as CSSProperties} />;
}
