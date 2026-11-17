'use client';

import { ArrowCounterClockwiseIcon, ArrowRightIcon, ArrowsLeftRightIcon, CrosshairIcon, HourglassIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { type DashboardState, type Decision, type MarketState, type MarketSym, type PxOverview } from '@monday/core';
import { fmtPrice, fmtTime } from '@/lib/format';
import { fieldTargets, type Mine } from '@/lib/field';
import { at } from '@/lib/hosts';
import { useLive } from '@/lib/live';
import { ModePreview } from './agent-diagram';
import { OrderBook } from './book';
import { PriceChart } from './price-chart';
import { Num, money, pct, price, tone } from './stats-ui';
import { Tape } from './tape';
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

const pctText = (c: number) => `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`;

// ---- One live stream for the whole landing page ----

interface Live { state: DashboardState | null; connected: boolean; overdue: boolean }
const LiveContext = createContext<Live>({ state: null, connected: false, overdue: false });

/** The house account's state, streamed once and shared by every live part of the page (the terminal, the closing field). */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { state, connected } = useLive('public');
  // A first snapshot takes a moment: say "connecting" until it is clearly overdue.
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOverdue(true), 8_000);
    return () => clearTimeout(t);
  }, []);
  // The terminal's own panels used on the landing (the order book in the walkthrough) read through react-query, so the
  // landing carries a client of its own, as the app and analytics layouts do.
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <LiveContext.Provider value={{ state, connected, overdue }}>{children}</LiveContext.Provider>
    </QueryClientProvider>
  );
}

/** The house account's live state, for any part of the page inside LiveProvider. */
export const useLiveState = () => useContext(LiveContext).state;

/** The terminal under the hero headline: a ticker rail of every market Perpl lists, then book, chart and the trades printing. */
export function HeroTerminal({ className }: { className?: string }) {
  const { state, connected, overdue } = useContext(LiveContext);
  const [picked, setPicked] = useState<MarketSym>('BTC');
  const syms = state ? (Object.keys(state.markets) as MarketSym[]) : [];
  const sym = syms.includes(picked) ? picked : syms[0];
  const m = sym ? state?.markets[sym] : undefined;
  const grid = 'lg:h-[clamp(22rem,calc(100dvh_-_28rem),36rem)]';
  return (
    <figure className={cx('tilt-in relative', className)} style={{ '--d': '520ms' } as React.CSSProperties}>
      {/* The page's one light: an amber horizon on the terminal's top edge, glowing up into the headline. */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-24 -top-56 h-56 bg-[radial-gradient(50%_80%_at_50%_100%,var(--glow),transparent_72%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-[8%] -top-px z-[1] h-px bg-[linear-gradient(90deg,transparent,var(--accent)_22%,var(--accent)_78%,transparent)]" />
      <div className="relative flex flex-col gap-1 rounded-lg border border-line bg-void p-1 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)]">
        {!state || !m || !sym ? (
          <>
            <Skeleton className="h-12" />
            <Skeleton className={cx('h-[420px]', grid)} />
            <p className="px-2 py-1.5 text-[13px] text-fg-3">{overdue ? 'The live market feed is not reachable right now. The walkthrough below shows what Monday does.' : 'Connecting to the live market.'}</p>
          </>
        ) : (
          <>
            <div role="tablist" aria-label="Market" className="no-bar panel flex-row overflow-x-auto">
              {syms.map((s) => {
                const x = state.markets[s]!;
                const c = x.day.changePct;
                return (
                  <button key={s} role="tab" aria-selected={s === sym} onClick={() => setPicked(s)} className={cx('flex h-12 min-w-[6.5rem] flex-1 flex-col justify-center whitespace-nowrap border-r border-line px-2.5 text-left transition-colors last:border-r-0', s === sym ? 'bg-raised shadow-[inset_0_-2px_0_var(--accent)]' : 'hover:bg-raised')}>
                    <span className="flex items-baseline justify-between gap-2 text-[13px] font-semibold leading-tight">
                      {s}
                      {c != null && <span className={cx('num text-[12px] font-medium', c >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>{pctText(c)}</span>}
                    </span>
                    <span className="num text-[13px] leading-tight text-fg-2">{fmtPrice(x.mark, x.spec)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-1.5 py-1">
              {m.reflex ? <Tag tone="ask">{m.reflex.side} {m.reflex.action === 'pull' ? 'pulled' : 'widened'}: {m.reflex.fill ? 'a taker is sweeping' : m.reflex.ref ? 'the reference market moved' : m.reflex.book ? 'the book is lopsided' : `Smart Traders ${m.reflex.side === 'ask' ? 'buying' : 'selling'}`}</Tag>
                : state.status === 'quoting' ? <Tag tone="accent">Monday is quoting</Tag> : <Tag>book only</Tag>}
              {state.status === 'quoting' && <Tag>{m.params.regime} regime</Tag>}
              {/* The one live indicator on the page: real state, not decoration. */}
              <span className="num ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.04em] text-fg-2">
                <span aria-hidden className={cx('size-1.5 rounded-full', connected ? 'live-dot bg-bid' : 'bg-warn')} />
                {connected ? `Live, ${state.sim ? 'simulated book' : state.paper ? 'paper on Perpl' : 'Perpl'}` : 'Reconnecting'}
              </span>
            </div>
            <div className={cx('grid gap-1 lg:grid-cols-[292px_minmax(0,1fr)_340px]', grid)}>
              <Panel title="Order Book" aside={<span>Perpl</span>} bodyClassName="!overflow-hidden">
                <OrderBook m={m} rows={10} now={state.at} />
              </Panel>
              <PriceChart sym={sym} m={m} fills={state.fills} now={state.at} wheel={false} className="h-[320px] lg:h-auto" />
              <Panel title="Trades" aside={<span>Perpl</span>} className="h-[320px] lg:h-auto" bodyClassName="!overflow-hidden">
                <Tape m={m} limit={20} />
              </Panel>
            </div>
          </>
        )}
      </div>
      {state && m && (
        // "Live" only while the stream is: a frozen book must say it is frozen.
        <figcaption className={cx('mt-3 text-[13px]', connected ? 'text-fg-3' : 'text-warn')} aria-live="polite">
          {!connected ? `Disconnected. Showing the last data from ${fmtTime(state.at, false)}; prices on screen are not moving. `
            : state.sim ? "Monday's house account quoting on a simulated book, streaming from its server. Pick a market. "
            : state.paper ? "Monday's house account paper-trading on Perpl's real book. Prices are real, its orders are simulated. "
            : "Perpl's live order book and trades, streaming from Monday's server. Not an illustration. "}
          {!state.sim && !state.paper && "Monday's own quotes appear in your terminal once you start it."}
        </figcaption>
      )}
    </figure>
  );
}

/** The live book under the closing call to action, in the band's own ink. BTC, the deepest book. */
export function CloseField({ className }: { className?: string }) {
  const { state } = useContext(LiveContext);
  return <BookField m={state?.markets.BTC} className={className} />;
}

/**
 * Pointer light for the cards inside: sets --mx and --my on the `.spot` under the pointer, straight on the element, so
 * moving the mouse never re-renders anything. Touch and reduced motion get the cards without the light.
 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.spot');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return <div className={className} onPointerMove={move}>{children}</div>;
}

/** A whole number that counts up from zero the first time it scrolls into view. Static under reduced motion. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !seen || reduce) return;
    const c = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { el.textContent = Math.round(v).toLocaleString('en-US'); } });
    return () => c.stop();
  }, [seen, reduce, value]);
  // Server and first paint show the real figure; the count only replays it once the reader gets there.
  return <span ref={ref} className={className}>{value.toLocaleString('en-US')}</span>;
}

// ---- The field: Perpl's order book drawn as a mosaic of cells. ----

/** Cell grid: 7px columns with 2px gaps, 4px rows with 2px gaps. */
const PX = 9, CW = 7, PY = 6, GAP = 2;

interface Geo { w: number; h: number; cx: number; rows: number; L: number; R: number }

/** The whole box: the mid in the centre, columns rising from the bottom edge to just under the top. */
function geometry(w: number, h: number): Geo {
  const cx = Math.round(w / 2);
  return { w, h, cx, rows: Math.max(1, Math.floor((h - 28) / PY)), L: Math.floor(cx / PX), R: Math.floor((w - cx) / PX) };
}

const rgba = (hex: string, a: number) => {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const n = parseInt(h, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Perpl's live order book as a field of cells, drawn in the ink of the band it sits on (--accent-fg): every column is
 * real cumulative depth, bids left of the mid and asks right, Monday's own quotes as full-height lines. It rises from the
 * mid outward on first paint and eases toward each new book. Still under reduced motion; idle while off screen.
 * After the pixel mosaic in MotionSites' "Data Signal", drawn from data instead of a video.
 */
function BookField({ m, className }: { m?: MarketState; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const latest = useRef(m);
  latest.current = m;
  const push = useRef<() => void>(() => {});

  useEffect(() => {
    const el = box.current, c = main.current;
    const ctx = c?.getContext('2d');
    if (!el || !c || !ctx) return;
    let g: Geo | null = null;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let visible = false;
    let born = 0; // when the band first came on screen: the growth wave is timed from it
    let seeded = false; // the field has been drawn from a book once
    let cur: Float32Array = new Float32Array(0);
    let tgt: Float32Array = new Float32Array(0);
    let delay: Float32Array = new Float32Array(0);
    let mine: Mine[] = [];

    const paint = () => {
      if (!g) return;
      const mk = latest.current;
      const css = getComputedStyle(el);
      const ink = css.getPropertyValue('--accent-fg');
      const mono = css.getPropertyValue('--font-figures').trim() || 'ui-monospace, monospace';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);
      const top = g.h - g.rows * PY;
      const x = (i: number) => (i < g!.L ? g!.cx - (i + 1) * PX : g!.cx + (i - g!.L) * PX) + GAP / 2;
      // Bids a shade stronger than asks, so the two sides read apart in one colour.
      for (const [from, to, a] of [[0, g.L, 0.34], [g.L, g.L + g.R, 0.22]] as const) {
        const grad = ctx.createLinearGradient(0, g.h, 0, top);
        grad.addColorStop(0, rgba(ink, a));
        grad.addColorStop(1, rgba(ink, a * 0.25));
        ctx.fillStyle = grad;
        for (let i = from; i < to; i++) if (cur[i] > 0.01) ctx.fillRect(x(i), g.h - cur[i] * PY, CW, cur[i] * PY);
        ctx.fillStyle = rgba(ink, a + 0.2);
        for (let i = from; i < to; i++) if (cur[i] > 0.6) ctx.fillRect(x(i), g.h - cur[i] * PY, CW, PY - GAP);
      }
      for (let r = 0; r <= g.rows; r++) ctx.clearRect(0, g.h - r * PY - GAP, g.w, GAP);
      if (!mk) return;
      ctx.font = `500 11px ${mono}`;
      ctx.fillStyle = rgba(ink, 0.45);
      ctx.fillRect(g.cx - 0.5, top, 1, g.h - top);
      ctx.fillStyle = rgba(ink, 0.85);
      ctx.textAlign = 'center';
      ctx.fillText(`${mk.sym}  ${fmtPrice(mk.mark, mk.spec)}`, g.cx, top - 8);
      ctx.font = `600 10.5px ${mono}`;
      for (const q of mine) {
        const qx = x(q.col) + CW / 2;
        ctx.fillStyle = rgba(ink, 0.9);
        ctx.fillRect(qx - 0.5, top + 14, 1, g.h - top - 14);
        ctx.textAlign = q.side === 'bid' ? 'right' : 'left';
        ctx.fillText(`MONDAY ${q.side.toUpperCase()}`, qx + (q.side === 'bid' ? -7 : 7), top + 22);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const k = 1 - Math.exp(-dt / 170);
      let moving = false;
      for (let i = 0; i < cur.length; i++) {
        if (now < born + delay[i]) { moving = true; continue; }
        const d = tgt[i] - cur[i];
        if (Math.abs(d) > 0.02) { cur[i] += d * k; moving = true; } else cur[i] = tgt[i];
      }
      paint();
      if (moving && visible) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const kick = () => {
      if (reduce) { cur = tgt.slice(); paint(); return; }
      if (!raf && visible) raf = requestAnimationFrame(frame);
    };
    const retarget = () => {
      const mk = latest.current;
      if (!g || !mk) return;
      const r = fieldTargets(mk, g);
      mine = r.mine;
      if (cur.length !== r.t.length) {
        // The first book grows from the mid outward once the band is on screen; after a resize the field stays as it was.
        cur = seeded ? r.t.slice() : new Float32Array(r.t.length);
        delay = new Float32Array(r.t.length);
        if (!seeded) for (let i = 0; i < delay.length; i++) delay[i] = (i < g.L ? i : i - g.L) * 5;
        seeded = true;
      }
      tgt = r.t;
    };
    const resize = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      g = geometry(r.width, r.height);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      cur = new Float32Array(0);
      retarget();
      paint();
      kick();
    };
    push.current = () => { retarget(); kick(); };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    // The growth starts when the band first comes into view, not while it waits off screen at the bottom of the page.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && born === 0) born = performance.now();
      if (visible) kick();
    }, { threshold: 0.2 });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
      cancelAnimationFrame(raf);
      push.current = () => {};
    };
  }, [reduce]);

  useEffect(() => push.current(), [m]);

  return (
    <div ref={box} aria-hidden className={cx('pointer-events-none', className)}>
      <canvas ref={main} className="absolute inset-0 size-full" />
    </div>
  );
}

// ---- Perpl by the numbers: the analytics product, live, on the landing page. ----

const int = (n: number) => Math.round(n).toLocaleString('en-US');
/** Funding paid every 8 hours, in percent. */
const per8h = (r: { fundingRate: number; fundingIntervalMin: number; fundingUnknown?: true }) =>
  r.fundingUnknown ? null : r.fundingRate * (480 / Math.max(1, r.fundingIntervalMin)) * 100;

/** A labelled figure that counts to its value and tints when it changes. */
function Big({ k, n, format, sub }: { k: string; n: number | null; format: (v: number) => string; sub?: ReactNode }) {
  return (
    <div className="bg-canvas px-4 py-4">
      <dt className="label">{k}</dt>
      <dd className="num mt-2.5 text-[26px] font-medium leading-none tracking-tight">{n == null ? 'n/a' : <Num value={n} format={format} />}</dd>
      {sub && <dd className="mt-2 truncate text-[13px] leading-none text-fg-3">{sub}</dd>}
    </div>
  );
}

/** Headline figures and the busiest markets from Monday's own Perpl indexer, refreshed every half minute. */
/** `table`: false leaves out the markets table, for a narrow column. */
export function PerplStats({ table = true }: { table?: boolean }) {
  const [o, setO] = useState<PxOverview | null | undefined>(undefined); // undefined: loading; null: not reachable
  useEffect(() => {
    let stopped = false;
    const load = () => fetch('/api/stats/overview').then((r) => (r.ok ? (r.json() as Promise<PxOverview>) : null)).then((d) => { if (!stopped) setO(d); }).catch(() => { if (!stopped) setO(null); });
    void load();
    const t = setInterval(load, 30_000);
    return () => { stopped = true; clearInterval(t); };
  }, []);
  if (o === undefined) return <Skeleton className="h-[22rem]" />;
  if (!o) return <p className="text-[14px] text-fg-3">The Perpl figures are not reachable from this server right now.</p>;
  const h = o.headline;
  const rows = [...o.markets].sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 6);
  const since = o.indexer.since ? new Date(o.indexer.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null;
  return (
    <div className={cx('grid gap-1 rounded-md border border-line bg-void p-1', table && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
      <dl className={cx('panel grid grid-cols-2 gap-px bg-line', table ? 'md:grid-cols-3 lg:grid-cols-2' : 'sm:grid-cols-3')}>
        <Big k="Volume 24h" n={h.volume24hUsd} format={money} sub={`${money(h.volume7dUsd)} in 7 days`} />
        <Big k="Open Interest" n={h.openInterestUsd} format={money} sub="one side, at mark" />
        <Big k="TVL" n={h.tvlUsd} format={money} sub="held by the Exchange" />
        <Big k="Fees 24h" n={h.fees24hUsd} format={(v) => money(v, true)} sub={h.fees24hUsd != null && h.volume24hUsd ? `${((h.fees24hUsd / h.volume24hUsd) * 1e4).toFixed(2)} bps of volume` : undefined} />
        <Big k="Traders 24h" n={h.activeTraders24h} format={int} sub={`${int(h.accounts)} accounts all time`} />
        <Big k="Volume All Time" n={h.volumeAllUsd} format={money} sub={since ? `since ${since}` : undefined} />
      </dl>
      {table && <Panel title="Markets" aside={<span>24h, busiest first</span>}>
        <table className="w-full table-fixed text-[13px]">
          <thead>
            <tr className="label h-7 text-left [&>th]:font-normal">
              <th className="w-[5.5rem] pl-3">Market</th>
              <th className="text-right">Mark</th>
              <th className="w-[4.5rem] text-right">24h</th>
              <th className="text-right">Volume</th>
              <th className="hidden text-right sm:table-cell">Open Interest</th>
              <th className="hidden w-[6.5rem] pr-3 text-right sm:table-cell">Funding 8h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = per8h(r);
              return (
                <tr key={r.sym} className="num h-9 border-t border-line">
                  <td className="pl-3 font-sans font-semibold">{r.sym}</td>
                  <td className="text-right">{price(r.mark)}</td>
                  <td className={cx('text-right', tone(r.change24hPct))}>{pct(r.change24hPct, 2)}</td>
                  <td className="text-right">{money(r.volume24hUsd)}</td>
                  <td className="hidden text-right text-fg-2 sm:table-cell">{money(r.openInterestUsd)}</td>
                  <td className={cx('hidden pr-3 text-right sm:table-cell', a == null ? 'text-fg-3' : tone(a))}>{a == null ? 'n/a' : pct(a, 4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>}
    </div>
  );
}

// ---- A jump in the reference market, step by step. Example numbers, real components. ----

const T0 = 1_760_000_000_000;
/** The reference market's BTC mid after its jump: 4.1 bps over Perpl's 85,200. */
const REF_JUMPED = 85_234.9;
const SPEC = { sym: 'BTC' as const, marketId: 16, priceTick: 0.1, sizeStep: 0.00001, makerFeeBps: 0.45, takerFeeBps: 3.45, maxLeverage: 15 };
const lv = (px: number[], sz: number[]) => px.map((price, i) => ({ price, size: sz[i] }));

function scene(step: number): MarketState {
  const jumped = step >= 1;
  const pulled = step >= 2;
  return {
    sym: 'BTC', spec: SPEC, mark: 85_200, oracle: 85_200, mid: 85_200, bestBid: 85_180.4, bestAsk: 85_219.8,
    asks: lv([85_219.8, 85_231.1, 85_242.6, 85_254.0], [0.021, 0.034, 0.047, 0.058]),
    bids: lv([85_180.4, 85_168.9, 85_157.2, 85_146.1], [0.024, 0.031, 0.049, 0.061]),
    fundingRate: 0, dataAgeMs: 200, sigma1mBps: 2.4, book: 0, hlMid: jumped ? REF_JUMPED : 85_200,
    quotes: { bid: { price: 85_162.1, size: 0.00117 }, ask: pulled ? null : { price: 85_237.9, size: 0.00117 } },
    model: null, position: { size: 0, entryPrice: 0, notionalUsd: 0, marginUsd: null, unrealizedUsd: 0 },
    params: { market: 'BTC', enabled: true, spread_mult: 1, skew_bias_bps: 0, size_mult: 1, max_inventory_usd: 500, ttl_min: 15, regime: 'calm', reason: '' },
    paramsSource: 'fallback',
    reflex: pulled ? { side: 'ask', action: 'pull', until: T0 + 6_000, z: 4.1, triggerHashes: [], ref: true } : null,
    signal: null,
    trades: [],
    inPolicy: true, stage: 'normal', why: '', quotedPct: null, quoteAgeMs: { bid: null, ask: null }, basisBps: null,
    aheadUsd: { bid: 2_045, ask: pulled ? null : 1_790 }, tape: [], day: { volumeUsd: null, changePct: null, high: null, low: null }, openInterestUsd: 0, fills1h: 0, markout1mBps: null, trend5mBps: 0,
  };
}

const STEPS = [
  { verb: 'Quote', ms: 3000, text: 'Monday rests one bid and one ask around fair price. It aims to earn the spread when both fill; fees and price moves can still make a round trip lose.' },
  { verb: 'Detect', ms: 4000, text: 'The reference market, where these perps price first, jumps 4.1 bps in three seconds. Perpl\'s book has not moved yet.' },
  { verb: 'Step Aside', ms: 4000, text: 'On the next one-second tick the reflex pulls the ask, so a trader arriving from the reference market cannot lift it at the old price. The bid stays.' },
  { verb: 'Explain', ms: 4000, text: 'The governor sets a storm regime and writes its reason in plain words, with a hash of the data behind it.' },
];

const CARDS: Pick<Decision, 'id' | 'source' | 'reason'>[] = [
  { id: 1, source: 'reflex', reason: 'The reference market\'s BTC mid moved up 4.1 bps in 3 seconds and Perpl\'s book has not caught up. Ask pulled for 6 seconds.' },
  { id: 2, source: 'governor', reason: 'Storm regime. One-minute volatility is three times its normal: widening quotes 2.5x and cutting size to 40% until it settles.' },
];

/** The walkthrough's reference panel: the reference market's mid against Perpl's, and how far it moved in three seconds. */
function RefGap({ jumped }: { jumped: boolean }) {
  const rows: [string, string, string][] = [
    ['Reference Mid', fmtPrice(jumped ? REF_JUMPED : 85_200, SPEC), jumped ? 'text-bid-fg' : 'text-fg'],
    ['Perpl Mid', fmtPrice(85_200, SPEC), 'text-fg'],
    ['Move in 3 s', jumped ? '+4.1 bps' : '+0.1 bps', jumped ? 'font-semibold text-accent' : 'text-fg-3'],
  ];
  return (
    <dl className="grid gap-1.5 px-2.5 py-2.5 text-[13px]">
      {rows.map(([k, v, c]) => (
        <div key={k} className="flex justify-between gap-3"><dt className="text-fg-2">{k}</dt><dd className={cx('num transition-colors duration-300', c)}>{v}</dd></div>
      ))}
    </dl>
  );
}

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
        <ol aria-label="What happens when the reference market jumps" className="border-t border-line-2">
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <li key={s.verb} className="relative border-b border-line-2">
                <button
                  type="button" aria-current={on ? 'step' : undefined} onClick={() => { setStep(i); setPlay('paused'); }}
                  className={cx('block w-full border-l-2 py-4 pl-4 pr-2 text-left transition-colors duration-300', on ? 'border-accent' : 'border-transparent hover:bg-raised/60')}
                >
                  <span className={cx('block text-[18px] font-semibold tracking-tight', on ? 'text-fg' : 'text-fg-3')}>{s.verb}</span>
                  <span className={cx('mt-1 block max-w-[46ch] text-[15px] leading-snug', on ? 'text-fg-2' : 'text-fg-3')}>{s.text}</span>
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
          <button type="button" onClick={toggle} className="inline-flex h-9 items-center gap-2 rounded-sm border border-line-2 px-3 text-[13px] font-medium text-fg-2 hover:border-fg-3 hover:text-fg">
            {play === 'playing' ? <><PauseIcon size={14} weight="fill" /> Pause</> : play === 'done' ? <><ArrowCounterClockwiseIcon size={14} /> Replay</> : <><PlayIcon size={14} weight="fill" /> Play</>}
          </button>
          <p className="text-[13px] text-fg-3">Example data, drawn with the terminal&apos;s own components. In the product the reflex acts within a second and the governor every 15 minutes.</p>
        </div>
      </div>
      <div className="grid gap-1 self-start rounded-md border border-line bg-void p-1 sm:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
        <Panel title="Order Book" aside={<span>BTC Perp</span>} bodyClassName="!overflow-hidden">
          <OrderBook m={m} rows={6} now={T0} />
        </Panel>
        <div className="flex min-h-0 flex-col gap-1">
          <Panel title="Reference Market" className="flex-none" bodyClassName="!overflow-visible">
            <RefGap jumped={step >= 1} />
          </Panel>
          <Panel title="Decisions" className="min-h-[10rem] flex-1">
            <AnimatePresence initial={false} mode="popLayout">
              {step < 2 && (
                <motion.p key="none" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-2.5 py-3 text-[13px] text-fg-3">
                  Calm regime. Normal width, full size, both sides quoted.
                </motion.p>
              )}
              {CARDS.filter((_, i) => step >= i + 2).map((c) => (
                <motion.div
                  key={c.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className={cx('border-b border-line py-2 pl-2.5 pr-2.5', c.source === 'reflex' ? 'border-l-2 border-l-ask' : 'border-l-2 border-l-transparent')}
                >
                  <div className="flex gap-1"><Tag>BTC</Tag><Tag tone={c.source === 'reflex' ? 'ask' : 'neutral'}>{c.source === 'reflex' ? 'Reflex' : 'Governor'}</Tag>{c.source === 'governor' && <Tag tone="accent">storm</Tag>}</div>
                  <p className="mt-1.5 text-[13px] leading-snug">{c.reason}</p>
                  {c.source === 'governor' && <p className="num mt-1 text-[12px] text-fg-3">{onchain ? 'hash logged on Monad' : 'reason and data hash recorded'}</p>}
                </motion.div>
              ))}
            </AnimatePresence>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---- The landing's modes: a prompt line, chips to pick a mode, and the mode's facts and drawing in a window. ----

// Same facts as Setup and the plan forms; keep them in step.
const MODE_ROWS = ['What It Does', 'Use It For', 'Runs', 'LLM\'s Part', 'Protection'] as const;
const MODES = [
  {
    key: 'mm', tab: 'Market Maker', name: 'Agentic Market Maker', icon: ArrowsLeftRightIcon, href: '/app/onboarding', cta: 'Set Up the Market Maker',
    rows: ['Quotes both sides of the book in the markets you choose and earns the spread.', 'Earning the spread without a view on direction.', 'Until you stop it.', 'Reviews spread and size every 15 minutes, inside hard bounds. Never places an order.', 'A daily stop loss on the margin. At it, Monday cancels its orders and closes the positions.'],
  },
  {
    key: 'trade', tab: 'Agentic Trade', name: 'Agentic Trade', icon: CrosshairIcon, href: '/app/setup/trade', cta: 'Start a Trade',
    rows: ['Scalps your long or short bias on one market, again and again, on a short timeframe.', 'A view on direction you want worked, entry by entry.', 'Up to a week, or until the stop loss or take profit on its margin.', 'Sums up D1, H4 and H1 before you start. Code reads the trend and picks every entry.', 'Every scalp\'s stop and target rest on Perpl from its fill.'],
  },
  {
    key: 'twap', tab: 'TWAP', name: 'TWAP', icon: HourglassIcon, href: '/app/setup/twap', cta: 'Start a TWAP',
    rows: ['Builds a position in slices, as maker orders where it can, so one large order does not move a thin book.', 'A large entry, spread over minutes or hours.', 'Up to 24 hours to build, then held until its stop, its target or you close it.', 'Sums up D1, H4 and H1 before you start. Code places every slice.', 'A price it must not pass while building, and a stop loss on Perpl from the first fill.'],
  },
] as const;

/** The window's title bar: three dots on the left, what it shows in the middle. */
export function WindowBar({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-11 items-center justify-center border-b border-line px-4 text-[13px] font-medium text-fg-3">
      <span aria-hidden className="absolute left-4 flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-fg/15" />)}</span>
      {children}
    </div>
  );
}

/** What each mode sounds like when you ask for it; typed into the prompt line when its chip is picked. */
const ASK = { mm: 'Make markets on BTC and ETH, and earn the spread', trade: 'Scalp my long bias on SOL, entry by entry', twap: 'Buy 1 ETH in slices over the next two hours' } as const;

/**
 * The modes as a prompt, after Imagica's "What industry do you want to transform?": the request types itself into the
 * line, the chips under it pick the mode, and the window below shows that mode's facts and the mode at work. The chips
 * take turns by themselves while on screen, until one is picked by hand.
 */
export function ModePrompt() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { amount: 0.35 });
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const [n, setN] = useState(0);
  const m = MODES[i];
  const say: string = ASK[m.key];
  useEffect(() => {
    if (reduce) return setN(say.length);
    setN(0);
    const t = setInterval(() => setN((x) => (x >= say.length ? x : x + 1)), 32);
    return () => clearInterval(t);
  }, [say, reduce]);
  useEffect(() => {
    if (!seen || held || reduce) return;
    const t = setTimeout(() => setI((x) => (x + 1) % MODES.length), 9_000);
    return () => clearTimeout(t);
  }, [seen, held, reduce, i]);
  const pick = (j: number) => { setHeld(true); setI((j + MODES.length) % MODES.length); };
  return (
    <div ref={ref}>
      <div className="flex items-end justify-between gap-4 border-b border-line-2 pb-4">
        <p className="min-h-[2.3em] text-[clamp(1.5rem,3.4vw,2.5rem)] font-medium leading-[1.15] tracking-[-0.03em] text-fg sm:min-h-0">
          <span className="sr-only">{say}</span>
          <span aria-hidden>{say.slice(0, n)}<span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.1em] bg-accent motion-safe:animate-pulse" /></span>
        </p>
        <span aria-hidden className="bead mb-1 grid size-10 flex-none place-items-center rounded-lg text-fg"><ArrowRightIcon size={16} weight="bold" /></span>
      </div>
      <div role="tablist" aria-label="Trading modes" className="mt-6 flex flex-wrap gap-2">
        {MODES.map((x, j) => (
          <button
            key={x.key} role="tab" id={`mode-${x.key}`} aria-selected={i === j} aria-controls="mode-panel" tabIndex={i === j ? 0 : -1}
            onClick={() => pick(j)} onKeyDown={(e) => { if (e.key === 'ArrowRight') pick(i + 1); if (e.key === 'ArrowLeft') pick(i - 1); }}
            className={cx('inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[15px] font-medium transition-[background-color,color,box-shadow,transform] duration-300 active:scale-[0.98]', i === j ? 'bg-fg text-canvas' : 'bead text-fg-2 hover:text-fg')}
          >
            <x.icon size={16} />{x.tab}
          </button>
        ))}
      </div>
      <div className="frost mt-12">
        <div className="frost-in">
          <WindowBar><m.icon size={14} className="mr-2 text-accent" />{m.name}</WindowBar>
          <div id="mode-panel" role="tabpanel" aria-labelledby={`mode-${m.key}`} className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <dl key={m.key} className="grid content-start gap-5 p-6 md:p-8">
              {m.rows.map((r, j) => (
                <div key={MODE_ROWS[j]} className="rise" style={{ animationDelay: `${j * 50}ms` }}>
                  <dt className="text-[13px] font-medium text-fg-3">{MODE_ROWS[j]}</dt>
                  <dd className="mt-1 max-w-[52ch] text-[16px] leading-relaxed text-fg">{r}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col justify-between gap-10 border-t border-line bg-raised-2 p-6 md:p-10 lg:border-l lg:border-t-0">
              <ModePreview key={m.key} mode={m.key} />
              <Link href={at(m.href)} className="group inline-flex h-11 w-fit items-center gap-2 rounded-lg bg-fg px-5 text-[15px] font-medium text-canvas transition-[opacity,transform] hover:opacity-90 active:translate-y-px">
                {m.cta}
                <ArrowRightIcon size={15} weight="bold" className="nudge" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- The market maker part by part: the list on the left, the part at work in a window on the right. ----

export interface PartView { title: string; when: string; text: string; icon: ReactNode; glyph: ReactNode }

/** After Imagica's "The simplest way to build an AI app". Takes turns by itself while on screen until one is picked. */
export function PartsTabs({ parts }: { parts: PartView[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { amount: 0.35 });
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!seen || held || reduce) return;
    const t = setTimeout(() => setI((x) => (x + 1) % parts.length), 5_000);
    return () => clearTimeout(t);
  }, [seen, held, reduce, i, parts.length]);
  const p = parts[i];
  const pick = (j: number) => { setHeld(true); setI((j + parts.length) % parts.length); };
  return (
    <div ref={ref} className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
      <div role="tablist" aria-orientation="vertical" aria-label="Parts of the market maker" className="grid gap-1">
        {parts.map((x, j) => {
          const on = i === j;
          return (
            <button
              key={x.title} role="tab" id={`part-${j}`} aria-selected={on} aria-controls="part-panel" tabIndex={on ? 0 : -1}
              onClick={() => pick(j)} onKeyDown={(e) => { if (e.key === 'ArrowDown') pick(i + 1); if (e.key === 'ArrowUp') pick(i - 1); }}
              className={cx('flex gap-3.5 rounded-2xl px-4 py-3.5 text-left transition-[background-color,box-shadow] duration-300', on ? 'bg-raised shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_12px_30px_-14px_rgb(0_0_0/0.7)]' : 'hover:bg-raised/50')}
            >
              <span className={cx('mt-0.5 grid size-8 flex-none place-items-center rounded-lg transition-colors', on ? 'bg-fg text-canvas' : 'bg-raised/70 text-fg-2')}>{x.icon}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[16px] font-semibold tracking-tight text-fg">{x.title}</span>
                  <span className="text-[13px] text-fg-3">{x.when}</span>
                </span>
                {on && <span className="rise mt-1 block max-w-[44ch] text-[15px] leading-relaxed text-fg-2">{x.text}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="frost">
        <div id="part-panel" role="tabpanel" aria-labelledby={`part-${i}`} className="frost-in">
          <WindowBar>{p.title} · {p.when}</WindowBar>
          <div key={i} className="rise grid min-h-[20rem] place-items-center p-8 md:min-h-[24rem]">
            <div aria-hidden className="[zoom:1.35] md:[zoom:1.6]">{p.glyph}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Limits: pick a control, and the rows it governs light up in the house account's readout. ----

const CONTROL_LIST = [
  { k: 'Position Limit', v: 'The most Monday may hold in each market. Margin and leverage set it, or you type it.', rows: ['Quote Size', 'Position Limit', 'Leverage'] },
  { k: 'Stop Loss', v: 'Every mode has one, a share of its margin. At it Monday stops and closes the position. Fast markets can overshoot it.', rows: ['Stop Loss'] },
  { k: 'Stop and Kill', v: 'Stop pulls Monday\'s orders and leaves positions to you. Kill also closes them. One click each, under Plans in the terminal.', rows: [] },
] as const;

export interface LimitsView { title: string; note: string; markets: string[]; rows: [string, string][]; collateral: string }

const LIT = 'bg-[color-mix(in_oklab,var(--accent)_9%,var(--raised))]';

/** `children`: the heading and lead, set above the controls in the left column. */
export function LimitsExplorer({ view, children }: { view: LimitsView; children?: ReactNode }) {
  const [c, setC] = useState(0);
  const lit = CONTROL_LIST[c].rows as readonly string[];
  const kill = c === 2;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
      <div>
        {children}
        <div className="mt-8 grid gap-1">
          {CONTROL_LIST.map((x, j) => (
            <button
              key={x.k} type="button" aria-pressed={c === j} onClick={() => setC(j)}
              className={cx('rounded-2xl px-5 py-4 text-left transition-[background-color,box-shadow] duration-300', c === j ? 'bg-raised shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_12px_30px_-14px_rgb(0_0_0/0.7)]' : 'hover:bg-raised/50')}
            >
              <span className="block text-[16px] font-semibold tracking-tight text-fg">{x.k}</span>
              <span className={cx('mt-1 block max-w-[46ch] text-[15px] leading-relaxed transition-colors', c === j ? 'text-fg-2' : 'text-fg-3')}>{x.v}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="frost">
        <div className="frost-in">
          <WindowBar>{view.title}</WindowBar>
          <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
            <div className="bg-raised px-5 py-5">
              <dt className="text-[13px] text-fg-3">Markets</dt>
              <dd className="mt-3 flex flex-wrap gap-1">{view.markets.map((s) => <span key={s} className="rounded-md bg-canvas px-1.5 py-0.5 text-[13px] font-semibold">{s}</span>)}</dd>
            </div>
            {view.rows.map(([k, v]) => {
              const on = lit.includes(k);
              return (
                <div key={k} className={cx('px-5 py-5 transition-colors duration-300', on ? LIT : 'bg-raised')}>
                  <dt className={cx('text-[13px] transition-colors', on ? 'text-accent' : 'text-fg-3')}>{k}</dt>
                  <dd className="num mt-3 text-[20px] font-medium leading-none tracking-tight">{v}</dd>
                </div>
              );
            })}
          </dl>
          <div className={cx('flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 text-[13px] transition-colors duration-300', kill && LIT)}>
            {kill ? (
              <>
                <span className="text-fg-2">Under Plans in the terminal, for every running mode</span>
                <span className="flex gap-2">
                  <span className="rounded-md bg-void px-3.5 py-1.5 font-semibold text-fg">Stop</span>
                  <span className="rounded-md bg-ask-deep px-3.5 py-1.5 font-semibold text-white">Kill</span>
                </span>
              </>
            ) : (
              <>
                <span className="text-fg-3">Collateral this needs: <span className="num text-fg">{view.collateral}</span>, so the stop loss fires while the margin is intact.</span>
                <span className="text-fg-3">{view.note}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
