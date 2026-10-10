'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

// Charts are hand-built SVG so they wear the terminal's tokens exactly.
// Rules followed: one axis, thin marks, recessive grid, text in grey (never in the
// series colour), a hover layer on every plot, colour always paired with a label.
// Motion says one thing: the data arriving. Lines draw in, bars grow from their baseline, cells fade in.
// Nothing loops, and under reduced motion everything is simply there.

const TONE = {
  fg: 'var(--fg)', muted: 'var(--fg-3)', bid: 'var(--bid)', ask: 'var(--ask)', accent: 'var(--accent)',
  cat1: 'var(--cat-1)', cat2: 'var(--cat-2)', cat3: 'var(--cat-3)', cat4: 'var(--cat-4)', cat5: 'var(--cat-5)', other: 'var(--fg-3)',
} as const;
export type Tone = keyof typeof TONE;
/** The five market hues, in the order they are assigned (validated for colour-blind separation); the sixth is "other". */
export const CATS: Tone[] = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
export const EASE = [0.16, 1, 0.3, 1] as const;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function niceTicks(lo: number, hi: number, n = 3): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function Tip({ children, left, right, className }: { children: ReactNode; left?: number; right?: number; className?: string }) {
  return (
    <div className={cx('pointer-events-none absolute top-1 z-10 rounded-sm border border-line-2 bg-raised-2 px-2 py-1.5 text-[11.5px] leading-tight shadow-[0_6px_20px_rgb(0_0_0/0.35)]', className)} style={{ left, right }}>
      {children}
    </div>
  );
}

/** A dozen points in a cell: the trend behind a figure. No axes, no labels; the figure beside it carries the value. */
export function Sparkline({ values, tone = 'muted', fill = true, className }: { values: (number | null)[]; tone?: Tone; fill?: boolean; className?: string }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const reduce = useReducedMotion();
  const id = useId();
  const vals = values.filter((v): v is number => v != null);
  if (vals.length < 2) return <div ref={ref} className={cx('h-full w-full', className)} />;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => 1 + (i / (values.length - 1)) * (w - 2);
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (h - 4);
  let d = '', pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  const lastI = values.length - 1 - [...values].reverse().findIndex((v) => v != null);
  const last = values[lastI]!;
  return (
    <div ref={ref} className={cx('h-full w-full', className)}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={TONE[tone]} stopOpacity="0.22" />
              <stop offset="1" stopColor={TONE[tone]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {fill && <motion.path d={`${d}V${h}H${x(0).toFixed(1)}Z`} fill={`url(#${id})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} />}
          <motion.path d={d} fill="none" stroke={TONE[tone]} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: EASE }} />
          <motion.circle cx={x(lastI)} cy={y(last)} r={2.5} fill={TONE[tone]} stroke="var(--canvas)" strokeWidth={1.5} initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.9, type: 'spring', stiffness: 400, damping: 20 }} style={{ transformOrigin: `${x(lastI)}px ${y(last)}px` }} />
        </svg>
      )}
    </div>
  );
}

export interface Series {
  name: string;
  points: { t: number; v: number | null }[];
  tone: Tone;
  dash?: boolean;
  step?: boolean;
}

/** Fills its parent when `height` is omitted, so it can sit inside a flex panel. */
export function LineChart({ series, height, format, baseline, label, empty = 'Collecting data', timeFormat, area, under, drawKey }: {
  series: Series[];
  height?: number;
  format: (v: number) => string;
  /** A reference level drawn as a dotted rule (for example the day's starting equity). */
  baseline?: { v: number; label: string };
  label: string;
  empty?: string;
  timeFormat?: (t: number) => string;
  /** Wash the first series down to the bottom of the plot (a single level over time). */
  area?: boolean;
  /** Shade between the first series and this one, where it is below (a drawdown under its running peak). */
  under?: { t: number; v: number | null }[];
  /** Changing it redraws the lines; by default a change of series names or length does. */
  drawKey?: string;
}) {
  const [ref, box] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const gid = useId();
  const w = box.w;
  const h = height ?? box.h;
  const PAD = { l: 4, r: 68, t: 12, b: 20 };

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const vals = all.map((p) => p.v).filter((v): v is number => v != null);
    if (vals.length < 2 || w === 0 || h < 40) return null;
    if (baseline) vals.push(baseline.v);
    for (const p of under ?? []) if (p.v != null) vals.push(p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (area) lo = Math.min(lo, 0);
    const pad = (hi - lo || Math.abs(hi) * 0.001 || 1) * 0.12;
    lo -= area && lo === 0 ? 0 : pad;
    hi += pad;
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (w - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
    return { x, y, t0, t1, lo, ticks: niceTicks(lo, hi, h > 220 ? 5 : 3) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, w, h, baseline?.v, area, under]);

  const frame = cx('relative', height == null && 'h-full min-h-[120px]');
  if (!geo) {
    return (
      <div ref={ref} style={height ? { height } : undefined} className={cx(frame, 'grid place-items-center text-[12px] text-fg-3')}>
        {w > 0 && empty}
      </div>
    );
  }
  const { x, y, t0, t1, ticks } = geo;
  // Short spans need seconds on the axis or every label reads the same.
  const tf = timeFormat ?? ((t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: t1 - t0 < 600_000 ? '2-digit' : undefined }));

  const path = (pts: { t: number; v: number | null }[], step?: boolean) => {
    let d = '', pen = false;
    for (const p of pts) {
      if (p.v == null) {
        pen = false;
        continue;
      }
      const px = x(p.t).toFixed(1), py = y(p.v).toFixed(1);
      d += pen ? (step ? `H${px}V${py}` : `L${px} ${py}`) : `M${px} ${py}`;
      pen = true;
    }
    return d;
  };
  const key = drawKey ?? `${series.map((s) => s.name).join('|')}:${series[0]?.points.length ?? 0}`;
  const first = series[0];
  const firstPts = first?.points.filter((p) => p.v != null) ?? [];
  const bottom = h - PAD.b;
  const areaPath = area && firstPts.length ? `${path(firstPts, first.step)}V${bottom}H${x(firstPts[0].t).toFixed(1)}Z` : null;
  // The under-shade: the first series forward, the reference backward, closed.
  const underPath = under && firstPts.length ? `${path(firstPts, first.step)}${[...under].reverse().filter((p) => p.v != null).map((p) => `L${x(p.t).toFixed(1)} ${y(p.v!).toFixed(1)}`).join('')}Z` : null;

  // Direct labels at the line ends, nudged apart so they never overlap.
  const ends = series
    .map((s) => ({ s, last: [...s.points].reverse().find((p) => p.v != null) }))
    .filter((e): e is { s: Series; last: { t: number; v: number } } => !!e.last)
    .map((e) => ({ ...e, y: y(e.last.v) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  const at = hover == null ? null : t0 + ((hover - PAD.l) / (w - PAD.l - PAD.r)) * (t1 - t0);
  const nearest = (s: Series) => (at == null ? null : s.points.reduce<{ t: number; v: number | null } | null>((best, p) => (p.v != null && (!best || Math.abs(p.t - at) < Math.abs(best.t - at)) ? p : best), null));
  const tips = series.map((s) => ({ s, p: nearest(s) })).filter((r) => r.p && r.p.v != null) as { s: Series; p: { t: number; v: number } }[];
  const draw = reduce ? {} : { initial: { pathLength: 0, opacity: 0.5 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.2, ease: EASE } };

  return (
    <div ref={ref} className={frame} style={height ? { height } : undefined}>
      <svg
        width={w} height={h} role="img" aria-label={label} className="absolute inset-0 block touch-none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(w - PAD.r, Math.max(PAD.l, e.clientX - r.left)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={first ? TONE[first.tone] : 'currentColor'} stopOpacity="0.2" />
            <stop offset="1" stopColor={first ? TONE[first.tone] : 'currentColor'} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.l + 2} y={y(v) - 4} className="num" fontSize="10" fill="var(--fg-3)">{format(v)}</text>
          </g>
        ))}
        {baseline && (
          <g>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(baseline.v)} y2={y(baseline.v)} stroke="var(--line-2)" strokeDasharray="2 4" />
            <text x={w - PAD.r - 4} y={y(baseline.v) - 4} textAnchor="end" fontSize="10" fill="var(--fg-3)">{baseline.label}</text>
          </g>
        )}
        {areaPath && <motion.path key={`a${key}`} d={areaPath} fill={`url(#${gid})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.6 }} />}
        {underPath && <motion.path key={`u${key}`} d={underPath} fill="var(--ask)" fillOpacity={0.14} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.6 }} />}
        {series.map((s) => (
          s.dash
            ? <path key={s.name} d={path(s.points, s.step)} fill="none" stroke={TONE[s.tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 4" />
            : <motion.path key={`${s.name}${key}`} d={path(s.points, s.step)} fill="none" stroke={TONE[s.tone]} strokeWidth={s.tone === 'fg' ? 1.75 : 2} strokeLinejoin="round" strokeLinecap="round" {...draw} />
        ))}
        {ends.map((e) => (
          <g key={e.s.name}>
            <motion.circle cx={x(e.last.t)} cy={y(e.last.v)} r={4} fill={TONE[e.s.tone]} stroke="var(--canvas)" strokeWidth={2} initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: reduce ? 0 : 1.1, type: 'spring', stiffness: 400, damping: 22 }} style={{ transformOrigin: `${x(e.last.t)}px ${y(e.last.v)}px` }} />
            {series.length > 1 && <rect x={w - PAD.r + 6} y={e.y - 1} width={8} height={2} fill={TONE[e.s.tone]} />}
            <text x={w - PAD.r + (series.length > 1 ? 18 : 6)} y={e.y + 3.5} fontSize="10.5" fill="var(--fg)" className={series.length === 1 ? 'num' : undefined} fontWeight={500}>
              {series.length === 1 ? format(e.last.v) : e.s.name}
            </text>
          </g>
        ))}
        {[t0, (t0 + t1) / 2, t1].map((t, i) => (
          <text key={i} x={x(t)} y={h - 5} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="num" fontSize="10" fill="var(--fg-3)">{tf(t)}</text>
        ))}
        {hover != null && tips.length > 0 && (
          <g pointerEvents="none">
            <line x1={x(tips[0].p.t)} x2={x(tips[0].p.t)} y1={PAD.t} y2={h - PAD.b} stroke="var(--line-2)" />
            {tips.map(({ s, p }) => <circle key={s.name} cx={x(p.t)} cy={y(p.v)} r={4} fill={TONE[s.tone]} stroke="var(--canvas)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hover != null && tips.length > 0 && (
        <Tip {...(x(tips[0].p.t) > w / 2 ? { right: w - x(tips[0].p.t) + 10 } : { left: x(tips[0].p.t) + 10 })}>
          <div className="num mb-1 text-fg-3">{new Date(tips[0].p.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: timeFormat ? undefined : '2-digit' })}</div>
          {tips.map(({ s, p }) => (
            <div key={s.name} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-fg-2">
                <span aria-hidden className="inline-block h-0.5 w-2.5" style={{ background: TONE[s.tone] }} />
                {s.name}
              </span>
              <span className="num font-medium text-fg">{format(p.v)}</span>
            </div>
          ))}
        </Tip>
      )}
    </div>
  );
}

/**
 * Bars on a zero baseline, coloured by sign unless `tone` fixes one colour (for values with no good or bad side, like volume).
 * A null value is a slot with no data (drawn hatched, so a missing day never reads as a quiet one); `faded` marks a partial value.
 * `line` draws a reference series on the same scale over the bars (a rolling average).
 */
export function SignedBars({ data, height = 220, format, label, lowLabel, highLabel, tone, line }: {
  data: { key: string; v: number | null; tip: string; faded?: boolean }[];
  height?: number;
  format: (v: number) => string;
  label: string;
  lowLabel: string;
  highLabel: string;
  tone?: Tone;
  line?: { values: (number | null)[]; name: string };
}) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const hatch = `hatch${useId().replace(/[^\w-]/g, '')}`;
  const PAD = { l: 2, r: 2, t: 14, b: 24 };
  if (!data.length) return <div ref={ref} style={{ height }} />;
  const values = [...data.flatMap((d) => (d.v == null ? [] : [d.v])), ...(line?.values.filter((v): v is number => v != null) ?? [])];
  const hi = Math.max(0, ...values), lo = Math.min(0, ...values);
  const span = (hi - lo || 1) * 1.15;
  const y = (v: number) => PAD.t + ((hi * 1.075 - v) / span) * (height - PAD.t - PAD.b);
  const slot = (w - PAD.l - PAD.r) / data.length;
  const bw = Math.min(24, Math.max(3, slot - Math.max(2, slot * 0.25)));
  const y0 = y(0);
  const shape = (cx0: number, v: number) => {
    const top = Math.min(y(v), y0), hh = Math.max(1, Math.abs(y(v) - y0));
    const r = Math.min(3, hh, bw / 2);
    // Rounded at the data end only, square at the baseline.
    return v >= 0
      ? `M${(cx0 - bw / 2).toFixed(1)} ${(top + hh).toFixed(1)}V${(top + r).toFixed(1)}q0 ${-r} ${r} ${-r}H${(cx0 + bw / 2 - r).toFixed(1)}q${r} 0 ${r} ${r}V${(top + hh).toFixed(1)}Z`
      : `M${(cx0 - bw / 2).toFixed(1)} ${top.toFixed(1)}V${(top + hh - r).toFixed(1)}q0 ${r} ${r} ${r}H${(cx0 + bw / 2 - r).toFixed(1)}q${r} 0 ${r} ${-r}V${top.toFixed(1)}Z`;
  };
  const flat = (cx0: number, v: number) => (v >= 0
    ? `M${(cx0 - bw / 2).toFixed(1)} ${y0.toFixed(1)}V${y0.toFixed(1)}q0 0 0 0H${(cx0 + bw / 2).toFixed(1)}q0 0 0 0V${y0.toFixed(1)}Z`
    : `M${(cx0 - bw / 2).toFixed(1)} ${y0.toFixed(1)}V${y0.toFixed(1)}q0 0 0 0H${(cx0 + bw / 2).toFixed(1)}q0 0 0 0V${y0.toFixed(1)}Z`);
  const lineD = line ? line.values.reduce((d, v, i) => (v == null ? d : `${d}${d ? 'L' : 'M'}${(PAD.l + slot * i + slot / 2).toFixed(1)} ${y(v).toFixed(1)}`), '') : '';

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label} className="block" onPointerLeave={() => setHover(null)}>
          <defs>
            <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" stroke="var(--line-2)" strokeWidth="1.5" />
            </pattern>
          </defs>
          {niceTicks(lo, hi, 4).map((v) => (
            <line key={v} x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--line-2)' : 'var(--line)'} />
          ))}
          {data.map((d, i) => {
            const cx0 = PAD.l + slot * i + slot / 2;
            if (d.v == null) {
              return (
                <g key={d.key} onPointerEnter={() => setHover(i)}>
                  <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={height - PAD.t - PAD.b} fill="transparent" />
                  <rect x={cx0 - bw / 2} y={PAD.t} width={bw} height={height - PAD.t - PAD.b} fill={`url(#${hatch})`} opacity={hover === i ? 1 : 0.6} />
                </g>
              );
            }
            return (
              <g key={d.key} onPointerEnter={() => setHover(i)}>
                <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={height - PAD.t - PAD.b} fill="transparent" />
                <motion.path
                  initial={reduce ? false : { d: flat(cx0, d.v) }} animate={{ d: shape(cx0, d.v) }}
                  transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.01, 0.3) }}
                  fill={tone ? TONE[tone] : d.v >= 0 ? 'var(--bid)' : 'var(--ask)'} opacity={(hover == null || hover === i ? 1 : 0.4) * (d.faded ? 0.5 : 1)}
                  style={{ transition: 'opacity 150ms' }}
                />
              </g>
            );
          })}
          {line && lineD && (
            <motion.path key={line.values.length} d={lineD} fill="none" stroke="var(--fg)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.2, ease: EASE, delay: 0.3 }} />
          )}
          {/* Tick labels after the bars, with a canvas halo, so dense bars cannot hide them. */}
          {niceTicks(lo, hi, 4).map((v) => (
            <text key={v} x={PAD.l + 2} y={y(v) - 4} className="num" fontSize="10" fill="var(--fg-3)" stroke="var(--canvas)" strokeWidth="3" paintOrder="stroke">{format(v)}</text>
          ))}
          <text x={PAD.l} y={height - 6} fontSize="10.5" fill="var(--fg-3)">{lowLabel}</text>
          <text x={w - PAD.r} y={height - 6} textAnchor="end" fontSize="10.5" fill="var(--fg-3)">{highLabel}</text>
          {line && (
            <g aria-hidden>
              <line x1={w - PAD.r - 78} x2={w - PAD.r - 66} y1={PAD.t - 6} y2={PAD.t - 6} stroke="var(--fg)" strokeWidth={1.5} />
              <text x={w - PAD.r - 62} y={PAD.t - 3} fontSize="10" fill="var(--fg-3)">{line.name}</text>
            </g>
          )}
        </svg>
      )}
      {hover != null && (
        <Tip className="max-w-56 leading-snug" {...(hover >= data.length / 2 ? { right: w - (PAD.l + slot * hover) + 4 } : { left: PAD.l + slot * (hover + 1) + 4 })}>
          {data[hover].tip}
          {line?.values[hover] != null && <div className="mt-0.5 text-fg-3">{line.name}: <span className="num text-fg">{format(line.values[hover]!)}</span></div>}
        </Tip>
      )}
      {/* Table view for screen readers. The wrapper clips it: a bare table ignores sr-only's 1px box. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>{data.map((d) => <tr key={d.key}><th scope="row">{d.key}</th><td>{d.tip}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Part-to-whole over time: one column per slot, stacked in a fixed series order with a surface gap between parts.
 * Series keep their colour whatever is shown; the sixth and later fold into "Other".
 */
export function StackedBars({ data, series, tones, height = 220, format, label, lowLabel, highLabel }: {
  data: { key: string; parts: Record<string, number>; tip: string }[];
  /** Names in display order; each takes the next of CATS, the rest "other". */
  series: string[];
  /** Fixed colours instead of the market hues (longs and shorts, for example). */
  tones?: Record<string, Tone>;
  height?: number;
  format: (v: number) => string;
  label: string;
  lowLabel: string;
  highLabel: string;
}) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const PAD = { l: 2, r: 2, t: 14, b: 24 };
  if (!data.length) return <div ref={ref} style={{ height }} />;
  const named = series.slice(0, CATS.length);
  const toneOf = (name: string): Tone => tones?.[name] ?? CATS[named.indexOf(name)] ?? 'other';
  const order = [...named, 'Other'];
  const stacks = data.map((d) => {
    const parts: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.parts)) parts[named.includes(k) ? k : 'Other'] = (parts[named.includes(k) ? k : 'Other'] ?? 0) + v;
    return parts;
  });
  const hi = Math.max(1, ...stacks.map((p) => Object.values(p).reduce((a, b) => a + b, 0)));
  const plotH = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + (1 - v / (hi * 1.075)) * plotH;
  const slot = (w - PAD.l - PAD.r) / data.length;
  const bw = Math.min(24, Math.max(3, slot - Math.max(2, slot * 0.25)));
  const gap = slot > 6 ? 2 : 1;
  const shown = order.filter((k) => stacks.some((p) => p[k]));

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label} className="block" onPointerLeave={() => setHover(null)}>
          {niceTicks(0, hi, 4).map((v) => <line key={v} x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--line-2)' : 'var(--line)'} />)}
          {stacks.map((parts, i) => {
            const x0 = PAD.l + slot * i + slot / 2 - bw / 2;
            let acc = 0;
            return (
              <g key={data[i].key} onPointerEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.45} style={{ transition: 'opacity 150ms' }}>
                <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={plotH} fill="transparent" />
                {order.map((k) => {
                  const v = parts[k] ?? 0;
                  if (!v) return null;
                  const top = y(acc + v), bottom = y(acc);
                  acc += v;
                  const hh = Math.max(0, bottom - top - gap);
                  return (
                    <motion.rect
                      key={k} x={x0} width={bw} rx={1} fill={TONE[toneOf(k)]}
                      initial={reduce ? false : { y: y(0), height: 0 }} animate={{ y: top, height: hh }}
                      transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.01, 0.3) }}
                    />
                  );
                })}
              </g>
            );
          })}
          {niceTicks(0, hi, 4).map((v) => (
            <text key={v} x={PAD.l + 2} y={y(v) - 4} className="num" fontSize="10" fill="var(--fg-3)" stroke="var(--canvas)" strokeWidth="3" paintOrder="stroke">{format(v)}</text>
          ))}
          <text x={PAD.l} y={height - 6} fontSize="10.5" fill="var(--fg-3)">{lowLabel}</text>
          <text x={w - PAD.r} y={height - 6} textAnchor="end" fontSize="10.5" fill="var(--fg-3)">{highLabel}</text>
        </svg>
      )}
      <div className="absolute top-0 right-1 flex flex-wrap justify-end gap-x-2.5 gap-y-0.5 text-[10.5px] text-fg-3" aria-label="Legend">
        {shown.map((k) => <span key={k} className="inline-flex items-center gap-1"><span aria-hidden className="size-2 rounded-[1px]" style={{ background: TONE[toneOf(k)] }} />{k}</span>)}
      </div>
      {hover != null && (
        <Tip className="min-w-40 leading-snug" {...(hover >= data.length / 2 ? { right: w - (PAD.l + slot * hover) + 4 } : { left: PAD.l + slot * (hover + 1) + 4 })}>
          <div className="mb-1 text-fg-3">{data[hover].tip}</div>
          {[...order].reverse().filter((k) => stacks[hover][k]).map((k) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-fg-2"><span aria-hidden className="size-2 rounded-[1px]" style={{ background: TONE[toneOf(k)] }} />{k}</span>
              <span className="num text-fg">{format(stacks[hover][k])}</span>
            </div>
          ))}
        </Tip>
      )}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>{data.map((d, i) => <tr key={d.key}><th scope="row">{d.key}</th><td>{order.filter((k) => stacks[i][k]).map((k) => `${k} ${format(stacks[i][k])}`).join(', ')}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A grid of values: rows by columns, each cell tinted by its value. `sign` colours by direction (teal up, vermilion down)
 * with strength for size; `mag` uses one hue, more is darker. Cells with no value stay the surface colour.
 */
export function HeatGrid({ rows, cols, cells, mode = 'mag', tone = 'accent', cell = 20, colLabelEvery = 1, label, className }: {
  rows: string[];
  cols: string[];
  cells: { r: number; c: number; v: number | null; tip: string }[];
  mode?: 'mag' | 'sign';
  tone?: Tone;
  cell?: number;
  colLabelEvery?: number;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const max = Math.max(1e-9, ...cells.filter((c) => c.v != null).map((c) => Math.abs(c.v!)));
  const byPos = new Map(cells.map((c) => [`${c.r}:${c.c}`, c]));
  return (
    <div className={cx('overflow-x-auto', className)} role="img" aria-label={label}>
      <div className="grid gap-px text-[10.5px]" style={{ gridTemplateColumns: `2.6rem repeat(${cols.length}, minmax(0, 1fr))`, minWidth: cols.length * 14 + 48 }}>
        <span />
        {cols.map((c, i) => <span key={i} className="num truncate text-center text-fg-3">{i % colLabelEvery === 0 ? c : ''}</span>)}
        {rows.map((r, ri) => (
          <RowCells key={r} name={r} cells={cols.map((_, ci) => byPos.get(`${ri}:${ci}`))} max={max} mode={mode} tone={tone} cell={cell} reduce={!!reduce} offset={ri * cols.length} />
        ))}
      </div>
    </div>
  );
}

function RowCells({ name, cells, max, mode, tone, cell, reduce, offset }: { name: string; cells: ({ v: number | null; tip: string } | undefined)[]; max: number; mode: 'mag' | 'sign'; tone: Tone; cell: number; reduce: boolean; offset: number }) {
  return (
    <>
      <span className="flex items-center text-fg-3">{name}</span>
      {cells.map((c, i) => {
        const k = c?.v == null ? 0 : Math.round(12 + Math.min(1, Math.abs(c.v) / max) * 76);
        const hue = mode === 'sign' ? (c && c.v != null && c.v < 0 ? 'var(--ask)' : 'var(--bid)') : TONE[tone];
        return (
          <motion.span
            key={i} title={c?.tip} className="rounded-[2px] bg-raised" style={{ height: cell, background: k ? `color-mix(in oklab, ${hue} ${k}%, var(--raised))` : undefined }}
            initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: EASE, delay: Math.min((offset + i) * 0.003, 0.6) }}
          />
        );
      })}
    </>
  );
}

/**
 * A value on a centred scale from -1 to 1: right is buying or long, left is selling or short.
 * Marks at `ticks` show thresholds. No filled track, only a centre rule.
 */
export function Diverging({ value, ticks = [], className }: { value: number; ticks?: number[]; className?: string }) {
  const v = Math.max(-1, Math.min(1, value));
  return (
    <div className={cx('relative h-3', className)} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {ticks.flatMap((t) => [t, -t]).map((t) => <span key={t} className="absolute top-0.5 bottom-0.5 w-px bg-line-2" style={{ left: `${50 + t * 50}%` }} />)}
      <span className="absolute inset-y-0 left-1/2 w-px bg-fg-3" />
      <span
        className="absolute top-[3px] bottom-[3px] transition-[width,left] duration-300"
        style={{ left: `${v >= 0 ? 50 : 50 + v * 50}%`, width: `${Math.abs(v) * 50}%`, background: v >= 0 ? 'var(--bid)' : 'var(--ask)', borderRadius: v >= 0 ? '0 1px 1px 0' : '1px 0 0 1px' }}
      />
    </div>
  );
}

/** A share of a whole as a thin bar: the filled part in `tone`, the rest a lighter step of the surface. */
export function Share({ value, tone = 'accent', className }: { value: number; tone?: Tone; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={cx('flex h-1.5 overflow-hidden rounded-[1px] bg-raised-2', className)} aria-hidden>
      <motion.span className="h-full" style={{ background: TONE[tone] }} initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} transition={{ duration: 0.8, ease: EASE }} />
    </span>
  );
}
