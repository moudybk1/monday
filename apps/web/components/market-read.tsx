'use client';

// The market read that opens the Agentic Trade and TWAP setup: the overall trend, D1, H4 and H1 each with its recent
// closes, the model's few sentences, and the nearest levels from the timeframes' ranges.

import { ArrowsLeftRightIcon, TrendDownIcon, TrendUpIcon } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { TREND_LABEL, type FrameRead, type MarketInsight, type MarketSpec, type MarketState, type MarketSym, type Trend } from '@monday/core';
import { EASE, Sparkline } from './charts';
import { Skeleton, cx } from './ui';
import { fmtPrice } from '@/lib/format';

const LOOK = {
  bullish: { text: 'text-bid-fg', chip: 'border-bid/40 bg-bid/12 text-bid-fg', bar: 'bg-bid', spark: 'bid', tint: 'var(--bid)', Icon: TrendUpIcon },
  bearish: { text: 'text-ask-fg', chip: 'border-ask/40 bg-ask/12 text-ask-fg', bar: 'bg-ask', spark: 'ask', tint: 'var(--ask)', Icon: TrendDownIcon },
  neutral: { text: 'text-fg-2', chip: 'border-line-2 bg-raised-2 text-fg-2', bar: 'bg-fg-3', spark: 'muted', tint: 'var(--fg-3)', Icon: ArrowsLeftRightIcon },
} as const;
const FRAMES = [['d1', 'D1'], ['h4', 'H4'], ['h1', 'H1']] as const;

export function InsightCard({ sym, q, m, spec }: { sym: MarketSym; q: UseQueryResult<MarketInsight>; m?: MarketState; spec?: MarketSpec }) {
  const reduce = useReducedMotion();
  const r = q.data?.sym === sym ? q.data : null;
  if (!r) {
    return (
      <section aria-label={`${sym} market read`} aria-busy={!q.isError} className="overflow-hidden rounded-md border border-line-2 bg-raised">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <span className="text-[18px] font-semibold tracking-tight">{sym}</span>
          {!q.isError && <span className="text-[13px] text-fg-3" role="status">Reading D1, H4 and H1</span>}
        </div>
        {q.isError ? (
          <p className="px-4 py-5 text-[14px] text-ask-fg">Could not read {sym} right now. <button type="button" className="underline underline-offset-2" onClick={() => void q.refetch()}>Try again</button></p>
        ) : (
          <>
            <div className="grid grid-cols-3 divide-x divide-line">{FRAMES.map(([k]) => <div key={k} className="grid gap-2 px-4 py-3"><Skeleton className="h-3 w-10" /><Skeleton className="h-10" /><Skeleton className="h-3 w-20" /></div>)}</div>
            <div className="grid gap-2 border-t border-line px-4 py-4"><Skeleton className="h-3.5" /><Skeleton className="h-3.5 w-4/5" /></div>
          </>
        )}
      </section>
    );
  }

  const overall: Trend = r.market === 'mixed' ? 'neutral' : r.market;
  const look = LOOK[overall];
  const caption = r.market === 'mixed' ? 'D1 and H4 disagree' : r.aligned ? `${TREND_LABEL[r.market]} on D1, H4 and H1` : r.h1 === 'neutral' ? 'H1 is flat' : 'H1 is pulling back';
  const change = m?.day.changePct;
  const levels = levelsOf(r);
  return (
    <motion.section
      aria-label={`${sym} market read`} aria-live="polite" className="overflow-hidden rounded-md border border-line-2 bg-raised"
      initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3.5"
        style={{ backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${look.tint} 16%, transparent), transparent 75%)` }}
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-[18px] font-semibold tracking-tight">{sym}</span>
          <span className="num text-[16px]">{fmtPrice(m?.mark ?? r.price, spec)}</span>
          {change != null && <span className={cx('num text-[13px]', change >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>{change >= 0 ? '+' : ''}{change.toFixed(2)}% 24h</span>}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] text-fg-2">{caption}</span>
          <span className={cx('inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[13px] font-semibold uppercase tracking-[0.06em]', look.chip)}>
            <look.Icon size={14} weight="bold" />{r.market === 'mixed' ? 'Mixed' : TREND_LABEL[r.market]}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-3 divide-x divide-line">
        {FRAMES.map(([k, name], i) => <Frame key={k} name={name} trend={r[k]} f={r.frames[k]} delay={reduce ? 0 : 0.1 + i * 0.08} />)}
      </div>

      <p className="border-t border-line px-4 py-4 text-[15px] leading-relaxed">
        <span className="block border-l-2 border-accent/70 pl-3">{r.summary}</span>
      </p>

      {levels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5 text-[13px]">
          <span className="label mr-1">Levels</span>
          {levels.map((l) => (
            <span key={`${l.kind}${l.tf}`} className={cx('inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5', l.kind === 'Resistance' ? 'border-ask/30' : 'border-bid/30')}>
              <span className={l.kind === 'Resistance' ? 'text-ask-fg' : 'text-bid-fg'}>{l.kind}</span>
              <span className="num text-fg">{fmtPrice(l.price, spec)}</span>
              <span className="text-fg-3">{l.tf}</span>
            </span>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function Frame({ name, trend, f, delay }: { name: string; trend: Trend; f: FrameRead; delay: number }) {
  const look = LOOK[trend];
  return (
    <motion.div className="relative min-w-0 px-4 pt-3.5 pb-3" initial={delay ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.35, ease: EASE }}>
      <span aria-hidden className={cx('absolute inset-x-0 top-0 h-0.5', look.bar)} />
      <div className="flex items-center justify-between gap-2">
        <span className="label">{name}</span>
        <span className={cx('inline-flex items-center gap-1 text-[13px] font-semibold', look.text)}><look.Icon size={13} weight="bold" />{TREND_LABEL[trend]}</span>
      </div>
      <div className="mt-2.5 h-11"><Sparkline values={f.closes} tone={look.spark} /></div>
      <p className="num mt-2 truncate text-[13px] text-fg-3">
        <span className={f.distPct >= 0 ? 'text-bid-fg' : 'text-ask-fg'}>{f.distPct >= 0 ? '+' : ''}{f.distPct.toFixed(2)}%</span> vs 20 EMA
      </p>
    </motion.div>
  );
}

/** The nearest highs above the price and lows below it, from the timeframes' 20-bar ranges: two of each at most. */
function levelsOf(r: MarketInsight): { kind: 'Resistance' | 'Support'; price: number; tf: string }[] {
  const all = FRAMES.map(([k, tf]) => ({ tf, ...r.frames[k] })).filter((f) => f.closes.length);
  const nearest = (kind: 'Resistance' | 'Support', ls: { price: number; tf: string }[]) => {
    const out: { kind: typeof kind; price: number; tf: string }[] = [];
    // Two timeframes often share an extreme: one chip for it.
    for (const l of ls) if (!out.length || Math.abs(l.price - out[out.length - 1].price) / r.price > 0.001) out.push({ kind, ...l });
    return out.slice(0, 2);
  };
  return [
    ...nearest('Resistance', all.filter((f) => f.high > r.price).map((f) => ({ price: f.high, tf: f.tf })).sort((a, b) => a.price - b.price)),
    ...nearest('Support', all.filter((f) => f.low < r.price).map((f) => ({ price: f.low, tf: f.tf })).sort((a, b) => b.price - a.price)),
  ];
}
