'use client';

import { CircleIcon, TriangleIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { DataProvider, OHLCV } from '@luxalgo/vela';
import type { DrawingLabel, NativeIndicatorContext, PriceLine } from '@luxalgo/vela/plugin';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { DEFAULT_CONFIG, MARKETS, tradeSign, usdCompact, type Fill, type MarketState, type MarketSym, type SmartTrade } from '@monday/core';
import { api } from '@/lib/api';
import { Panel } from './ui';

/** A price the chart marks with a labelled line: a plan's entry, stop loss and take profit. */
export interface ChartLevel { price: number; label: string; tone: 'bid' | 'ask' | 'accent' }

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number }

// Vela's timeframe strings (and their aliases) to the candle widths Perpl serves, in seconds.
const RES: Record<string, number> = { '1': 60, '1m': 60, '5': 300, '5m': 300, '15': 900, '15m': 900, '60': 3600, '1h': 3600, '240': 14_400, '4h': 14_400, D: 86_400, '1D': 86_400, '1d': 86_400 };
const TIMEFRAMES = ['1', '5', '15', '60', '240', '1D'];
const MAX_BARS = 1000; // the API's ceiling

/**
 * Perpl's candles from our own API, for Vela. The API serves only the latest window, so paging further back ends the
 * history. Live bars come from the market's mark (see the component), not from polling.
 */
const ticks = new Map<string, number>(); // market -> price tick, for the axis precision
const newest = new Map<string, OHLCV>(); // `${market}:${res}` -> the forming bar the last history fetch returned
type Sub = { ticker: string; res: number; last: OHLCV | null; onBar: (b: OHLCV) => void };
const subs = new Set<Sub>();
const perpl: DataProvider = {
  async getBars(ticker, timeframe, range) {
    const res = RES[timeframe];
    if (!res) return [];
    const rows = await api<Candle[]>(`/candles?market=${ticker}&res=${res}&bars=${MAX_BARS}`);
    const bars = rows.map((k) => ({ time: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }));
    if (bars.length) newest.set(`${ticker}:${res}`, bars[bars.length - 1]);
    // `to` is exclusive: a page that asks before the oldest bar gets nothing, which ends the history.
    const out = bars.filter((b) => (range.from == null || b.time >= range.from) && (range.to == null || b.time < range.to));
    return range.limit ? out.slice(-range.limit) : out;
  },
  async listSymbols() {
    return MARKETS.map((s) => ({ ticker: s, description: `${s} perpetual on Perpl`, type: 'crypto' }));
  },
  async getSymbolInfo(ticker) {
    return { ticker, description: `${ticker} PERP`, type: 'crypto', timezone: 'Etc/UTC', session: '24x7', mintick: ticks.get(ticker), timeframes: { finest: '1', default: '1', list: TIMEFRAMES } };
  },
  // Our own copies (public/coins): same origin, so the chart's screenshot export still works.
  resolveSymbolIcon: (s) => ((MARKETS as readonly string[]).includes(s.ticker) ? `/coins/${s.ticker}.png` : undefined),
  subscribe(ticker, timeframe, onBar) {
    const sub: Sub = { ticker, res: RES[timeframe] ?? 0, last: null, onBar };
    subs.add(sub);
    return () => void subs.delete(sub);
  },
};

/** What Monday draws over the candles, shared with the "Monday" indicator below. One chart per page. */
const overlay = {
  sym: '' as string,
  fills: [] as Fill[],
  // ponytail: grows for as long as the page stays open; serve the collector's six hours from the API if that matters.
  smart: new Map<string, SmartTrade>(),
  quotes: { bid: null as number | null, ask: null as number | null },
  levels: [] as ChartLevel[],
  pal: null as Palette | null,
  view: null as { from: number; to: number } | null, // the times in view, for placing the line labels
};
const redraws = new Set<() => void>();
const redraw = () => redraws.forEach((f) => f());

/** Theme tokens as concrete colours (the canvas normalises any CSS colour syntax). */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const ctx = document.createElement('canvas').getContext('2d')!;
  const color = (name: string) => {
    ctx.fillStyle = '#000';
    ctx.fillStyle = css.getPropertyValue(name).trim() || '#000';
    return String(ctx.fillStyle);
  };
  const bid = color('--bid'), ask = color('--ask');
  return {
    dark: document.documentElement.dataset.theme !== 'light',
    bg: color('--raised'), text: color('--fg-3'), line: color('--line'), line2: color('--line-2'), accent: color('--accent'),
    bid, ask, bidDot: `${bid}b3`, askDot: `${ask}b3`, font: css.getPropertyValue('--font-text').trim() || 'ui-sans-serif',
  };
}
type Palette = ReturnType<typeof palette>;

/** Dot size from a dollar amount: under $10k tiny, $1M and up large. */
const dotSize = (usd: number): DrawingLabel['size'] => (usd < 10_000 ? 'tiny' : usd < 100_000 ? 'small' : usd < 1_000_000 ? 'normal' : 'large');

/** Monday's resting offers and a plan's levels as price lines; its fills and Smart Trader flow as marks per candle. */
function mondayOutput(ctx: NativeIndicatorContext, sid: typeof import('@luxalgo/vela/plugin').stableSeriesId) {
  const p = overlay.pal;
  const sym = ctx.symbol.split(':').pop();
  if (!p || sym !== overlay.sym) return {};
  const span = (RES[ctx.timeframe] ?? 60) * 1000;
  const from = ctx.bars()[0]?.time ?? Infinity;
  const by = new Map<number, { buyUsd: number; sellUsd: number; buys: number; sells: number; mBought: number; mSold: number }>();
  const at = (ts: number) => {
    const k = Math.floor(ts / span) * span;
    let f = by.get(k);
    if (!f) by.set(k, (f = { buyUsd: 0, sellUsd: 0, buys: 0, sells: 0, mBought: 0, mSold: 0 }));
    return f;
  };
  for (const f of overlay.fills) if (f.sym === sym && f.ts >= from) f.side === 'bid' ? at(f.ts).mBought++ : at(f.ts).mSold++;
  for (const t of overlay.smart.values()) {
    if (t.sym !== sym || t.ts < from) continue;
    const f = at(t.ts);
    if (tradeSign(t) > 0) (f.buyUsd += t.valueUsd), f.buys++;
    else (f.sellUsd += t.valueUsd), f.sells++;
  }
  // Marks are label drawings: Vela 0.10 does not paint marker series (its own Williams Fractal shows nothing either).
  const big = DEFAULT_CONFIG.bigTradeUsd;
  const marks: DrawingLabel[] = [];
  const mark = (time: number, key: string, below: boolean, style: DrawingLabel['style'], color: string, size: DrawingLabel['size'], text?: string) =>
    marks.push({ id: `monday.mark:${time}:${key}`, paneId: '', xloc: 'bar_time', x: time, y: 0, yloc: below ? 'belowbar' : 'abovebar', style, color, textColor: color, text, size, textAlign: 'center', fontFamily: 'default' });
  for (const [time, f] of by) {
    // Monday's own fills in the accent; Smart Traders in the side colours, sized by dollars, labelled when large.
    if (f.mBought) mark(time, 'mb', true, 'arrowup', p.accent, 'small', f.mBought > 1 ? String(f.mBought) : undefined);
    if (f.mSold) mark(time, 'ms', false, 'arrowdown', p.accent, 'small', f.mSold > 1 ? String(f.mSold) : undefined);
    if (f.buys) mark(time, 'sb', true, 'circle', p.bidDot, dotSize(f.buyUsd), f.buyUsd >= big ? usdCompact(f.buyUsd) : undefined);
    if (f.sells) mark(time, 'ss', false, 'circle', p.askDot, dotSize(f.sellUsd), f.sellUsd >= big ? usdCompact(f.sellUsd) : undefined);
  }
  const line = (title: string, price: number, color: string, lineStyle: PriceLine['lineStyle'], i: number): PriceLine => ({
    id: sid({ instanceId: 'monday.overlay', kind: 'hline', title, ordinal: i }), paneId: '', price, color, lineStyle, width: 1, title,
  });
  const priceLines: PriceLine[] = [];
  if (overlay.quotes.bid != null) priceLines.push(line('Monday Buy', overlay.quotes.bid, p.bid, 'dashed', 0));
  if (overlay.quotes.ask != null) priceLines.push(line('Monday Sell', overlay.quotes.ask, p.ask, 'dashed', 0));
  overlay.levels.forEach((l, i) => priceLines.push(line(l.label, l.price, p[l.tone], l.tone === 'accent' ? 'dotted' : 'solid', i + 1)));
  // Vela puts no axis tag on these lines, so each gets a label a fifth of the way into the view: clear of the legend,
  // the axis and the newest candles.
  const bars = ctx.bars();
  const v = overlay.view;
  const x = (v && bars.find((b) => b.time >= v.from + (v.to - v.from) / 5)?.time) ?? bars.at(-1)?.time;
  const d = Math.max(0, Math.round(-Math.log10(ticks.get(sym!) ?? 0.01)));
  const labels: DrawingLabel[] = x == null ? [] : priceLines.map((l) => ({
    id: `${l.id}:label`, paneId: '', xloc: 'bar_time', x, y: l.price, yloc: 'price', style: 'label_left',
    text: `${l.title} ${l.price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`,
    color: l.color, textColor: p.bg, size: 'small', textAlign: 'left', fontFamily: 'default',
  }));
  return { priceLines, labels: [...marks, ...labels] };
}

let registered = false;
function registerMonday(plugin: typeof import('@luxalgo/vela/plugin')) {
  if (registered) return;
  registered = true;
  plugin.registerNativeIndicator({
    type: 'monday.overlay',
    title: 'Monday',
    paneHint: 'price',
    overlay: true,
    reactsToViewport: true, // the line labels follow the view
    inputsSchema: () => [],
    defaultInputs: () => ({}),
    create: () => {
      let ctx: NativeIndicatorContext | null = null;
      const draw = () => ctx?.emit(mondayOutput(ctx, plugin.stableSeriesId));
      return {
        start: (c) => {
          ctx = c;
          redraws.add(draw);
          draw();
        },
        onBars: draw,
        onViewport: (r) => {
          overlay.view = r;
          draw();
        },
        setInputs: draw,
        suspend: () => {},
        resume: draw,
        stop: () => {
          redraws.delete(draw);
          ctx = null;
        },
      };
    },
  });
}

/**
 * LuxAlgo's Vela chart of one Perpl market, with Monday drawn on it as its own indicator: its resting offers as price
 * lines, its fills as accent arrows, Smart Trader trades as dots sized by value, and a running plan's levels.
 * Timeframes, indicators, drawings and chart style are Vela's own, and saved per viewer.
 */
export function PriceChart({ sym, m, fills, now, levels = [], className, wheel = true }: { sym: MarketSym; m: MarketState; fills: Fill[]; now: number; levels?: ChartLevel[]; className?: string; wheel?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const ws = useRef<VelaWorkspace | null>(null);
  ticks.set(sym, m.spec.priceTick);

  // Create the chart once. Vela touches the DOM, so it loads in the browser only. On a scrolling page (wheel off) the
  // chart is a compact one: no drawing tools, and the wheel keeps scrolling the page.
  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    void Promise.all([import('@luxalgo/vela'), import('@luxalgo/vela/plugin'), import('@luxalgo/vela/workspace')]).then(([vela, plugin, { VelaWorkspace }]) => {
      const el = box.current;
      if (dead || !el) return;
      registerMonday(plugin);
      overlay.pal = palette();
      const theme = () => {
        const p = palette();
        overlay.pal = p;
        return vela.createTheme({
          base: p.dark ? 'dark' : 'light', radius: 'sm', font: p.font, accent: p.accent,
          colors: { background: p.bg, text: p.text, grid: p.line, border: p.line2, up: p.bid, down: p.ask, accent: p.accent },
        });
      };
      const w = new VelaWorkspace(el, {
        layout: false,
        symbol: overlay.sym || sym,
        timeframe: '1',
        bars: MAX_BARS,
        live: true,
        providers: { perpl: () => perpl },
        timeframes: TIMEFRAMES,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        theme: theme(),
        // The market comes from the page's own market tabs, so the chart has no symbol search of its own.
        topbar: wheel ? { left: ['timeframes', 'style', 'indicators', 'undo-redo'], right: ['panels', 'screenshot'] } : { left: ['timeframes', 'style', 'indicators'], right: [] },
        drawings: wheel ? undefined : false,
        drawingToolbar: wheel,
        bottombar: wheel,
        persist: wheel ? 'monday.vela' : false,
        autofocus: false,
      });
      ws.current = w;
      void w.chart.ready().then(() => {
        if (dead) return;
        overlay.view = w.chart.getVisibleRange() ?? null; // the indicator hears only later changes
        w.chart.addNativeIndicator('monday.overlay'); // a saved chart has it already: then this returns that one
        redraw();
      });
      // Follow the theme toggle and the system setting.
      const retheme = () => {
        w.setTheme(theme());
        redraw();
      };
      const mo = new MutationObserver(retheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', retheme);
      // Stopping the wheel above the chart lets the page scroll instead of the chart zooming.
      const keepScroll = (e: WheelEvent) => e.stopPropagation();
      if (!wheel) el.addEventListener('wheel', keepScroll, { capture: true });
      cleanup = () => {
        mo.disconnect();
        mq.removeEventListener('change', retheme);
        el.removeEventListener('wheel', keepScroll, { capture: true });
        w.destroy();
      };
    });
    return () => {
      dead = true;
      cleanup();
      ws.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheel]);

  // The page's market tabs switch the chart in place; Vela keeps its indicators and drawings.
  useEffect(() => {
    overlay.sym = sym;
    const c = ws.current?.chart;
    if (c && c.market.symbol?.split(':').pop() !== sym) void c.setMarket({ symbol: sym });
    redraw();
  }, [sym]);

  // The live mark moves the forming candle every tick, and opens the next one on time.
  useEffect(() => {
    if (!m.mark) return;
    for (const s of subs) {
      if (s.ticker !== sym || !s.res) continue;
      const h = newest.get(`${sym}:${s.res}`);
      const k = !s.last || (h && h.time > s.last.time) ? h : s.last;
      if (!k) continue;
      const span = s.res * 1000;
      const t = Math.floor(now / span) * span;
      if (t < k.time) continue;
      s.last = t > k.time
        ? { time: t, open: k.close, high: Math.max(k.close, m.mark), low: Math.min(k.close, m.mark), close: m.mark, volume: 0 }
        : { ...k, high: Math.max(k.high, m.mark), low: Math.min(k.low, m.mark), close: m.mark };
      s.onBar(s.last);
    }
  }, [now, m.mark, sym]);

  // Monday's offers, fills and plan levels, and the Smart Trader trades: redrawn when one of them changes.
  const tradesKey = m.trades[0] ? m.trades[0].hash + m.trades[0].action : '';
  const levelsKey = levels.map((l) => `${l.label}:${l.price}`).join('|');
  useEffect(() => {
    overlay.fills = fills;
    overlay.quotes = { bid: m.quotes.bid?.price ?? null, ask: m.quotes.ask?.price ?? null };
    overlay.levels = levels;
    for (const t of m.trades) overlay.smart.set(t.hash + t.action, t);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fills, m.quotes, tradesKey, levelsKey]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-3">
          <span>{sym} PERP</span>
          {/* The key to what Monday draws: its own fills in the accent, Smart Traders in the side colours. */}
          <span className="hidden items-center gap-3 font-normal text-fg-3 sm:flex">
            <span className="flex items-center gap-1"><TriangleIcon size={9} weight="fill" className="text-accent" />Monday Fills</span>
            {m.signal && <span className="flex items-center gap-1"><CircleIcon size={8} weight="fill" className="text-bid" /><CircleIcon size={8} weight="fill" className="-ml-0.5 text-ask" />Smart Traders</span>}
          </span>
        </span>
      }
      className={className}
      bodyClassName="relative !overflow-hidden"
    >
      <div ref={box} className="absolute inset-0" aria-label={`${sym} price chart with Monday's offers and trades`} />
    </Panel>
  );
}
