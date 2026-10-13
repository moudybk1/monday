// The market read the Agentic Trade and TWAP setup shows before a trade is set up: D1, H4 and H1 by the scalper's trend
// rule, then a few sentences on them from the model (Kimi on the VPS, thinking off) or, when the model is off, late or
// over its daily budget, from a rule. One answer per market for ten minutes, however many people open the page.

import { D1_SEC, H1_SEC, H4_SEC, READ_BARS, ema, marketRead, trendOf, type Bar, type FrameRead, type MarketInsight, type MarketSym, type Trend } from '@monday/core';
import { barsOf } from './plans';
import { ask, llmReady } from './stats/llm';
import type { MarketFeed } from './venue/types';

const TTL_MS = 10 * 60_000;
const MODEL = (process.env.STATS_LLM_MODEL ?? '').trim() || (process.env.LLM_MODEL ?? '').trim() || null;
const cache = new Map<MarketSym, { at: number; data: Promise<MarketInsight> }>();

export function marketInsight(feed: MarketFeed, sym: MarketSym): Promise<MarketInsight> {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = build(feed, sym);
  cache.set(sym, { at: Date.now(), data });
  data.catch(() => cache.delete(sym));
  return data;
}

const SYSTEM = `You write the market read on a trading app's setup page, before the user sets up a trade.
Use only the numbers given. Write 2 or 3 short sentences of plain English: the overall trend (bullish, bearish or mixed)
from D1 and H4, what H1 adds (moving with that trend or pulling back), and the nearest levels from the ranges given.
No advice to buy or sell, no forecasts, no markdown, no emojis, no em dashes.`;

async function build(feed: MarketFeed, sym: MarketSym): Promise<MarketInsight> {
  const [d1, h4, h1] = await Promise.all([D1_SEC, H4_SEC, H1_SEC].map((s) => barsOf(feed, sym, s, READ_BARS, TTL_MS)));
  const t = { d1: trendOf(d1), h4: trendOf(h4), h1: trendOf(h1) };
  const frames = { d1: frameOf(d1), h4: frameOf(h4), h1: frameOf(h1) };
  const market = marketRead(t.d1, t.h4);
  const aligned = market !== 'mixed' && t.h1 === market;
  const price = feed.snapshot(sym)?.mark ?? h1[h1.length - 1]?.c ?? 0;
  const base = { sym, at: Date.now(), price, ...t, market, aligned, frames };
  if (llmReady) {
    try {
      const facts = [`${sym} perpetual, price ${num(price)}.`, line('D1', frames.d1, t.d1), line('H4', frames.h4, t.h4), line('H1', frames.h1, t.h1), `D1 and H4 together: ${market}.`].join('\n');
      const summary = clean(await ask(SYSTEM, facts, { maxTokens: 220, timeoutMs: 20_000 }));
      if (summary) return { ...base, summary, source: 'model', model: MODEL };
    } catch {
      // late, refused or over budget: the rule below answers
    }
  }
  return { ...base, summary: rule(sym, t, market), source: 'rules', model: null };
}

/** One timeframe as the page draws it and the model reads it: the 20 EMA as trendOf takes it, and the last 20 bars' range. */
export function frameOf(bars: Bar[]): FrameRead {
  if (!bars.length) return { closes: [], ema: 0, distPct: 0, slopePct: 0, high: 0, low: 0 };
  let e: number | null = null;
  const emas = bars.map((b) => (e = ema(e, b.c, Math.max(1, Math.min(20, Math.floor(bars.length / 2))))));
  const last = bars[bars.length - 1].c, now = emas[emas.length - 1], before = emas[Math.max(0, emas.length - 6)];
  const recent = bars.slice(-20);
  return {
    closes: bars.slice(-40).map((b) => b.c), ema: now, distPct: ((last - now) / now) * 100, slopePct: ((now - before) / before) * 100,
    high: Math.max(...recent.map((b) => b.h)), low: Math.min(...recent.map((b) => b.l)),
  };
}

function line(name: string, f: FrameRead, trend: Trend): string {
  if (f.closes.length < 6) return `${name}: too few bars.`;
  const last = f.closes[f.closes.length - 1];
  return `${name}: ${trend}; close ${num(last)}, ${f.distPct.toFixed(2)}% from the 20 EMA ${num(f.ema)}, which moved ${f.slopePct.toFixed(2)}% over 5 bars; 20-bar range ${num(f.low)} to ${num(f.high)}.`;
}

const num = (v: number) => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));

/** The model's text as the page shows it: one paragraph, no markdown, no em dashes, not too long. */
export function clean(text: string): string {
  const s = text.replace(/[*_#`]/g, '').replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim();
  return s.length > 600 ? `${s.slice(0, 597).replace(/\s\S*$/, '')}...` : s;
}

/** The read in one sentence when no model answers. */
export function rule(sym: string, t: { d1: Trend; h4: Trend; h1: Trend }, market: 'bullish' | 'bearish' | 'mixed'): string {
  if (market === 'mixed') return `${sym} is mixed: D1 is ${t.d1}, H4 ${t.h4} and H1 ${t.h1}, so the higher timeframes do not agree yet.`;
  if (t.h1 === market) return `${sym} is ${market} on D1, H4 and H1: the trend lines up on all three.`;
  return `${sym} is ${market} on D1 and H4, while H1 is ${t.h1 === 'neutral' ? 'flat' : `${t.h1}, pulling back against it`}.`;
}
