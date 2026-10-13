'use client';

import { PauseIcon, PlayIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Mark, Tag, cx } from './ui';

/*
  The hero's drawing of the terminal: what Monday watches, its three modes at work side by side, and the one account
  they all trade on. One clock drives it, a tick every half second; each mode loops on a length of its own, so the three
  drift in and out of step the way they would live. Example numbers, clock sped up. It plays only while on screen, can
  be paused, and under reduced motion holds one busy frame still.
*/

const TICK_MS = 500;
const LOOP = { mm: 28, trade: 16, twap: 22 };
/** The frame held under reduced motion: the ask pulled, inside the second scalp, slice 9 of 15. */
const STILL = { mm: 13, trade: 9, twap: 9 };

// ---- Market maker: calm, Smart Traders start buying, the ask is pulled, Kimi widens both, calm again. ----
type MmPhase = 'calm' | 'burst' | 'pulled' | 'storm';
const mmPhase = (m: number): MmPhase => (m >= 10 && m < 12 ? 'burst' : m >= 12 && m < 18 ? 'pulled' : m >= 18 && m < 24 ? 'storm' : 'calm');
const MM_STATUS: Record<MmPhase, string> = {
  calm: 'Both sides quoted, 2.5 bps from mid',
  burst: 'Smart Traders are buying',
  pulled: 'Ask pulled before it is run over',
  storm: 'Kimi: wider and smaller until it cools',
};

// ---- Agentic Trade: a long bias on an uptrend, two scalps bought on pullbacks, each with its stop and target. ----
// Price as a share of the chart's height from the top (lower is higher), one point per half tick.
const PATH = [0.88, 0.82, 0.85, 0.75, 0.79, 0.69, 0.75, 0.63, 0.53, 0.59, 0.52, 0.56, 0.47, 0.53, 0.44, 0.39, 0.48, 0.39, 0.34, 0.39, 0.28, 0.21, 0.26, 0.17, 0.12];
const LAST = PATH.length - 1;
const SCALPS = [{ entry: 6, exit: 8, gain: '+0.42%' }, { entry: 16, exit: 20, gain: '+0.58%' }];
const TARGET = 0.16, STOP = 0.11; // distance from the entry, in chart heights

// ---- TWAP: fifteen slices, one a tick, then the position holds with its stop resting on Perpl. ----
const SLICES = 15;

export function ModesDiagram({ className }: { className?: string }) {
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
  const [n, setN] = useState(0); // ticks played so far
  const live = playing && inView && tabShown && !still;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setN((x) => x + 1), TICK_MS);
    return () => clearTimeout(t);
  }, [live, n]);

  const at = (k: keyof typeof LOOP) => (still ? STILL[k] : n % LOOP[k]);
  const mm = mmPhase(at('mm'));
  const r = Math.min(LAST, at('trade') * 2); // how much of the trade chart is drawn
  const scalp = SCALPS.findIndex((s) => r >= s.entry && r < s.exit);
  const won = SCALPS.filter((s) => r >= s.exit).length;
  const filled = Math.min(SLICES, at('twap'));
  // Something went to Perpl this tick: a slice, a scalp's entry or exit, or a quote moved.
  const sent = !still && (filled < SLICES || SCALPS.some((s) => r === s.entry || r === s.exit) || [10, 12, 18, 24].includes(at('mm')));

  return (
    <figure ref={ref} className={cx('relative', className)}>
      <div
        className={cx('mx-auto grid max-w-[44rem] xl:max-w-none xl:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)_minmax(0,19rem)] xl:gap-x-[var(--wire)]', !live && 'paused')}
        style={{ '--wire': 'clamp(4rem, calc((100vw - 1100px) / 3), 7rem)' } as CSSProperties}
      >
        <Inputs burst={mm === 'burst' || mm === 'pulled'} />
        <Drop><Packet c="fg-3" dur={1400} /><Packet c={mm === 'burst' || mm === 'pulled' ? 'bid' : 'fg-3'} dur={900} delay={500} /></Drop>

        <div className="relative">
          {/* The page's one light: an amber horizon on Monday's top edge, glowing up into the headline. */}
          <div aria-hidden className="pointer-events-none absolute -inset-x-16 -top-44 h-44 bg-[radial-gradient(50%_80%_at_50%_100%,var(--glow),transparent_72%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-x-[10%] -top-px z-[1] h-px bg-[linear-gradient(90deg,transparent,var(--accent)_22%,var(--accent)_78%,transparent)]" />
          <div className="relative overflow-hidden rounded-lg border border-line-2 bg-canvas shadow-[0_30px_80px_-30px_rgb(40_30_16/0.28)] dark:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)]">
            <header className="flex h-11 items-center justify-between gap-3 border-b border-line px-4">
              <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Mark size={18} /> Monday</span>
              <Tag>three modes, one account</Tag>
            </header>
            <div className="grid gap-px bg-line">
              <Lane name="Market maker" kimi="dials every 15 min" status={MM_STATUS[mm]} flash={mm === 'calm' ? null : `mm-${mm}`} tone={mm === 'pulled' ? 'ask' : 'accent'}>
                <BookStrip phase={mm} />
              </Lane>
              <Lane
                name="Agentic Trade" kimi="read D1 and H4" tone="accent"
                status={scalp >= 0 ? 'Long on the pullback. Stop and target on Perpl' : won ? `${won} scalp${won > 1 ? 's' : ''}, ${won} won. Waiting for the next pullback` : 'Long bias, following the trend. Waiting for a pullback'}
                flash={scalp >= 0 ? `in-${scalp}` : won ? `won-${won}` : null}
              >
                <ScalpChart key={still ? 's' : Math.floor(n / LOOP.trade)} r={r} scalp={scalp} />
              </Lane>
              <Lane name="TWAP" kimi="read before the start" tone="accent" status={filled < SLICES ? `Buying 1.00 ETH in slices, ${filled} of ${SLICES} filled` : 'Built 1.00 ETH. Its stop rests on Perpl'} flash={filled === SLICES ? `done-${Math.floor(n / LOOP.twap)}` : null}>
                <Slices filled={filled} />
              </Lane>
            </div>
          </div>
        </div>

        <Drop><Packet c="fg-3" dur={1600} />{sent && <Packet key={n} c="accent" dur={600} once />}</Drop>
        <div className="relative xl:self-center">
          <Account mm={mm} scalp={scalp} filled={filled} />
          <Wire dir="x" className="right-full top-1/2 hidden w-[var(--wire)] xl:block">
            <Packet c="fg-3" dur={1600} />
            {sent && <Packet key={n} c="accent" dur={600} once />}
          </Wire>
        </div>
      </div>
      <figcaption className="mx-auto mt-6 flex max-w-[44rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[13px] text-fg-3 xl:max-w-none">
        <span>Drawn with example numbers and the clock sped up. All three can run at once, each in markets of its own.</span>
        {!still && (
          <button type="button" onClick={() => setPlaying(!playing)} className="inline-flex h-8 items-center gap-2 rounded-sm border border-line-2 px-3 text-[13px] font-medium text-fg-2 hover:border-fg-3 hover:text-fg">
            {playing ? <><PauseIcon size={13} weight="fill" /> Pause</> : <><PlayIcon size={13} weight="fill" /> Play</>}
          </button>
        )}
      </figcaption>
    </figure>
  );
}

/** One mode at work: its name and Kimi's part, what it is doing now, and the picture of it. */
function Lane({ name, kimi, status, flash, tone, children }: { name: string; kimi: string; status: string; flash: string | null; tone: 'accent' | 'ask'; children: ReactNode }) {
  return (
    <div className="relative isolate bg-canvas px-4 py-3.5">
      {/* A mode that just acted: a tint that fades, amber for Monday's own moves, vermilion for a pull. */}
      {flash && <span key={flash} aria-hidden className={cx('absolute inset-0 -z-10', tone === 'ask' ? 'flash-down' : 'flash-num')} />}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[16px] font-semibold tracking-tight">{name}</p>
        <span className="flex items-center gap-1.5 text-[12px] text-fg-3"><Tag tone="accent">Kimi</Tag>{kimi}</span>
      </div>
      <div className="mt-3">{children}</div>
      <p key={status} className="rise mt-2.5 text-[13px] leading-snug text-fg-2">{status}</p>
    </div>
  );
}

// Other traders' depth on each side, from the touch outward: share of the strip's height.
const DEPTH = [0.45, 0.7, 0.4, 0.85, 0.55, 0.95, 0.6];

/**
 * The book as a strip, price left to right: bids in teal, asks in vermilion, Monday's two quotes in amber either side
 * of the mid. A pull hatches the ask and slides it out; Kimi's storm settings set both further out and shorter.
 */
function BookStrip({ phase }: { phase: MmPhase }) {
  const off = phase === 'storm' ? 15 : 6; // % of the width from the mid
  const size = phase === 'storm' ? 0.45 : 1;
  const pulled = phase === 'pulled';
  const ease = 'motion-safe:duration-700 motion-safe:ease-out-expo';
  return (
    <div aria-hidden className="relative h-14">
      {DEPTH.map((h, i) => (
        <span key={`b${i}`} className="absolute bottom-0 w-[3.5%] rounded-t-[1px] bg-bid/25" style={{ right: `calc(50% + ${10 + i * 5.6}%)`, height: `${h * 70}%` }} />
      ))}
      {DEPTH.map((h, i) => (
        <span key={`a${i}`} className="absolute bottom-0 w-[3.5%] rounded-t-[1px] bg-ask/25" style={{ left: `calc(50% + ${10 + i * 5.6}%)`, height: `${DEPTH[(i + 3) % DEPTH.length] * 70}%` }} />
      ))}
      <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-line-2" />
      <span className="label absolute -top-0.5 left-1/2 ml-1.5">mid</span>
      {(['bid', 'ask'] as const).map((side) => {
        const gone = side === 'ask' && pulled;
        return (
          <span
            key={side}
            className={cx('absolute bottom-0 flex w-[5%] flex-col items-center motion-safe:transition-[left,right]', ease)}
            style={side === 'bid' ? { right: `calc(50% + ${off}%)` } : { left: `calc(50% + ${gone ? off + 9 : off}%)` }}
          >
            <span
              className={cx('w-full rounded-t-[2px] motion-safe:transition-[height,background-color,opacity]', ease, gone ? 'hatch border border-dashed border-ask/80 opacity-60' : 'bg-accent')}
              style={{ height: `${(gone ? 0.5 : size) * 52}px` }}
            />
          </span>
        );
      })}
    </div>
  );
}

/**
 * The trade's chart drawing itself from left to right. A scalp shows its entry, its target and stop as dashed lines,
 * and a gain where the target fills. Remounted each loop so the line starts fresh instead of rewinding.
 */
function ScalpChart({ r, scalp }: { r: number; scalp: number }) {
  // Drawn in pixels at about its desktop size; stretched a little on a phone. (A non-scaling stroke would keep the
  // width but breaks the dash that draws the line in.)
  const pt = (i: number) => `${((i / LAST) * 480).toFixed(1)},${(PATH[i] * 56).toFixed(1)}`;
  const d = `M${PATH.map((_, i) => pt(i)).join(' L')}`;
  const x = (i: number) => `${(i / LAST) * 100}%`;
  const y = (v: number) => `${v * 100}%`;
  return (
    <div aria-hidden className="relative h-14">
      <svg viewBox="0 0 480 56" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={d} fill="none" stroke="var(--fg-2)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - r / LAST} className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500 motion-safe:ease-linear" />
      </svg>
      {SCALPS.map((s, i) => {
        const open = i === scalp;
        return (
          <span key={i}>
            {r >= s.entry && <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-accent" style={{ left: x(s.entry), top: y(PATH[s.entry]) }} />}
            {open && (
              <>
                <span className="rise absolute right-0 border-t border-dashed border-bid" style={{ left: x(s.entry), top: y(PATH[s.entry] - TARGET) }} />
                <span className="rise absolute right-0 border-t border-dashed border-ask" style={{ left: x(s.entry), top: y(PATH[s.entry] + STOP) }} />
              </>
            )}
            {r >= s.exit && <span className="rise num absolute -translate-x-1/2 -translate-y-full rounded-xs bg-bid/15 px-1 text-[12px] font-semibold text-bid-fg" style={{ left: x(s.exit), top: `calc(${y(PATH[s.exit])} - 6px)` }}>{s.gain}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** The TWAP's slices: each fills as its maker order fills, with a small lift as it lands. */
function Slices({ filled }: { filled: number }) {
  return (
    <div aria-hidden className="flex h-14 items-end gap-1">
      {Array.from({ length: SLICES }, (_, i) => (
        <span
          key={i}
          className={cx('h-full flex-1 rounded-[2px] border motion-safe:transition-[background-color,border-color,transform] motion-safe:duration-300 motion-safe:ease-out-expo', i < filled ? 'border-transparent bg-accent' : 'border-line-2 bg-raised')}
          style={{ transform: i === filled - 1 ? 'translateY(-4px)' : undefined, height: `${40 + i * 4}%` }}
        />
      ))}
    </div>
  );
}

/** The one account all three trade on: what each mode has there now, and what protects it. */
function Account({ mm, scalp, filled }: { mm: MmPhase; scalp: number; filled: number }) {
  const rows: [string, ReactNode, boolean][] = [
    ['Market maker', mm === 'pulled' ? <><span className="text-accent">Bid</span> resting, <span className="text-ask-fg">ask pulled</span></> : <><span className="text-accent">Bid</span> and <span className="text-accent">ask</span> resting{mm === 'storm' ? ', wider' : ''}</>, false],
    ['Agentic Trade', scalp >= 0 ? <>Long <span className="num">0.010 BTC</span></> : <span className="text-fg-3">Flat between scalps</span>, scalp >= 0],
    ['TWAP', filled ? <>Long <span className="num">{(filled / SLICES).toFixed(2)}</span> of <span className="num">1.00 ETH</span></> : <span className="text-fg-3">Flat, first slice next</span>, filled > 0],
  ];
  return (
    <div className="panel">
      <header className="flex h-10 flex-none items-center justify-between gap-3 border-b border-line px-3">
        <h3 className="text-[14px] font-semibold">Your Perpl account</h3>
        <Tag tone="accent">funds stay here</Tag>
      </header>
      <ul className="grid gap-px bg-line">
        {rows.map(([k, v, safe]) => (
          <li key={k} className="bg-canvas px-3 py-3">
            <p className="label">{k}</p>
            <p className="mt-1.5 flex items-center justify-between gap-2 text-[14px]">
              <span className="truncate">{v}</span>
              {safe && <span className="flex flex-none items-center gap-1 text-[12px] text-fg-3"><ShieldCheckIcon size={13} className="text-accent" />{k === 'TWAP' ? 'stop' : 'stop, target'}</span>}
            </p>
            {k === 'TWAP' && (
              <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-raised-2">
                <span className="block h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out-expo" style={{ width: `${(filled / SLICES) * 100}%` }} />
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-3 py-2.5 text-[13px] text-fg-3">Monday trades with a key that cannot withdraw.</p>
    </div>
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
    <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:gap-x-6 xl:flex xl:flex-col xl:justify-between xl:py-14 xl:text-right">
      {INPUTS.map((x) => {
        const st = x.name === 'Smart Traders';
        return (
          <div key={x.name} className="relative xl:pr-3">
            <p className="flex items-center gap-2 text-[15px] font-semibold tracking-tight sm:text-[16px] xl:justify-end">
              {st && burst && <span className="hidden sm:inline-flex"><Tag tone="bid">buying</Tag></span>}
              {x.name}
            </p>
            <p className="mt-1 hidden text-[14px] text-fg-3 sm:block">{x.sub}</p>
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
