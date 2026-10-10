'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './ui';

// Charts are hand-built SVG so they wear the terminal's tokens exactly.
// Rules followed: one axis, thin marks, recessive grid, text in grey (never in the
// series colour), a hover layer on every plot, colour always paired with a label.

const TONE = { fg: 'var(--fg)', muted: 'var(--fg-3)', bid: 'var(--bid)', ask: 'var(--ask)', accent: 'var(--accent)' } as const;
export type Tone = keyof typeof TONE;

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

export interface Series {
  name: string;
  points: { t: number; v: number | null }[];
  tone: Tone;
  dash?: boolean;
  step?: boolean;
}

/** Fills its parent when `height` is omitted, so it can sit inside a flex panel. */
export function LineChart({ series, height, format, baseline, label, empty = 'Collecting data', timeFormat }: {
  series: Series[];
  height?: number;
  format: (v: number) => string;
  /** A reference level drawn as a dotted rule (for example the day's starting equity). */
  baseline?: { v: number; label: string };
  label: string;
  empty?: string;
  timeFormat?: (t: number) => string;
}) {
  const [ref, box] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = box.w;
  const h = height ?? box.h;
  const PAD = { l: 4, r: 68, t: 12, b: 20 };

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const vals = all.map((p) => p.v).filter((v): v is number => v != null);
    if (vals.length < 2 || w === 0 || h < 40) return null;
    if (baseline) vals.push(baseline.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) * 0.001 || 1) * 0.12;
    lo -= pad;
    hi += pad;
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (w - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
    return { x, y, t0, t1, ticks: niceTicks(lo, hi, h > 220 ? 5 : 3) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, w, h, baseline?.v]);

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

  const path = (s: Series) => {
    let d = '', pen = false;
    for (const p of s.points) {
      if (p.v == null) {
        pen = false;
        continue;
      }
      const px = x(p.t).toFixed(1), py = y(p.v).toFixed(1);
      d += pen ? (s.step ? `H${px}V${py}` : `L${px} ${py}`) : `M${px} ${py}`;
      pen = true;
    }
    return d;
  };

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
        {series.map((s) => (
          <path key={s.name} d={path(s)} fill="none" stroke={TONE[s.tone]} strokeWidth={s.tone === 'fg' ? 1.75 : 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash ? '5 4' : undefined} />
        ))}
        {ends.map((e) => (
          <g key={e.s.name}>
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
            {tips.map(({ s, p }) => <circle key={s.name} cx={x(p.t)} cy={y(p.v)} r={3.5} fill={TONE[s.tone]} stroke="var(--canvas)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hover != null && tips.length > 0 && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-sm border border-line-2 bg-raised-2 px-2 py-1.5 text-[11.5px] leading-tight"
          style={x(tips[0].p.t) > w / 2 ? { right: w - x(tips[0].p.t) + 10 } : { left: x(tips[0].p.t) + 10 }}
        >
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
        </div>
      )}
    </div>
  );
}

/**
 * Bars on a zero baseline, coloured by sign unless `tone` fixes one colour (for values with no good or bad side, like volume).
 * A null value is a slot with no data (drawn hatched, so a missing day never reads as a quiet one); `faded` marks a partial value.
 */
export function SignedBars({ data, height = 220, format, label, lowLabel, highLabel, tone }: {
  data: { key: string; v: number | null; tip: string; faded?: boolean }[];
  height?: number;
  format: (v: number) => string;
  label: string;
  lowLabel: string;
  highLabel: string;
  tone?: Tone;
}) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hatch = `hatch${useId().replace(/[^\w-]/g, '')}`;
  const PAD = { l: 2, r: 2, t: 14, b: 24 };
  if (!data.length) return <div ref={ref} style={{ height }} />;
  const values = data.flatMap((d) => (d.v == null ? [] : [d.v]));
  const hi = Math.max(0, ...values), lo = Math.min(0, ...values);
  const span = (hi - lo || 1) * 1.15;
  const y = (v: number) => PAD.t + ((hi * 1.075 - v) / span) * (height - PAD.t - PAD.b);
  const slot = (w - PAD.l - PAD.r) / data.length;
  const bw = Math.min(40, Math.max(4, slot - 2));

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
            const top = Math.min(y(d.v), y(0)), h = Math.max(1, Math.abs(y(d.v) - y(0)));
            const r = Math.min(2, h);
            // Rounded at the data end only, square at the baseline.
            const shape = d.v >= 0
              ? `M${cx0 - bw / 2} ${top + h}V${top + r}q0 ${-r} ${r} ${-r}H${cx0 + bw / 2 - r}q${r} 0 ${r} ${r}V${top + h}Z`
              : `M${cx0 - bw / 2} ${top}V${top + h - r}q0 ${r} ${r} ${r}H${cx0 + bw / 2 - r}q${r} 0 ${r} ${-r}V${top}Z`;
            return (
              <g key={d.key} onPointerEnter={() => setHover(i)}>
                <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={height - PAD.t - PAD.b} fill="transparent" />
                <path d={shape} fill={tone ? TONE[tone] : d.v >= 0 ? 'var(--bid)' : 'var(--ask)'} opacity={(hover == null || hover === i ? 1 : 0.4) * (d.faded ? 0.5 : 1)} />
              </g>
            );
          })}
          {/* Tick labels after the bars, with a canvas halo, so dense bars cannot hide them. */}
          {niceTicks(lo, hi, 4).map((v) => (
            <text key={v} x={PAD.l + 2} y={y(v) - 4} className="num" fontSize="10" fill="var(--fg-3)" stroke="var(--canvas)" strokeWidth="3" paintOrder="stroke">{format(v)}</text>
          ))}
          <text x={PAD.l} y={height - 6} fontSize="10.5" fill="var(--fg-3)">{lowLabel}</text>
          <text x={w - PAD.r} y={height - 6} textAnchor="end" fontSize="10.5" fill="var(--fg-3)">{highLabel}</text>
        </svg>
      )}
      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 max-w-56 rounded-sm border border-line-2 bg-raised-2 px-2 py-1.5 text-[11.5px] leading-snug"
          style={hover >= data.length / 2 ? { right: w - (PAD.l + slot * hover) + 4 } : { left: PAD.l + slot * (hover + 1) + 4 }}
        >
          {data[hover].tip}
        </div>
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
