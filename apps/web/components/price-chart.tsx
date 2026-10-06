'use client';

import { useEffect, useRef, useState } from 'react';
import type { CandlestickData, IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, Time, UTCTimestamp } from 'lightweight-charts';
import type { Fill, MarketState, MarketSym } from '@monday/core';
import { api } from '@/lib/api';
import { Panel, cx } from './ui';

interface Candle { t: number; o: number; h: number; l: number; c: number }
type Lw = typeof import('lightweight-charts');

// Candle width in minutes, and how much one-minute history to load for it.
const FRAMES = { '1m': { min: 1, history: 360 }, '5m': { min: 5, history: 1440 }, '15m': { min: 15, history: 4320 } } as const;
type Frame = keyof typeof FRAMES;

// The library draws in UTC; shift each time by the viewer's offset so the axis reads local time.
const toTime = (ms: number) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 1000) as UTCTimestamp;
const toBar = (k: Candle): CandlestickData<Time> => ({ time: toTime(k.t), open: k.o, high: k.h, low: k.l, close: k.c });
const decimals = (tick: number) => Math.max(0, Math.round(-Math.log10(tick)));

function aggregate(candles: Candle[], min: number): Candle[] {
  if (min === 1) return candles;
  const span = min * 60_000;
  const out: Candle[] = [];
  for (const k of candles) {
    const t = Math.floor(k.t / span) * span;
    const last = out[out.length - 1];
    if (last?.t === t) {
      last.h = Math.max(last.h, k.h);
      last.l = Math.min(last.l, k.l);
      last.c = k.c;
    } else out.push({ ...k, t });
  }
  return out;
}

/** Theme tokens as canvas-ready colours (the canvas normalises any CSS colour syntax). */
function palette(el: HTMLElement) {
  const css = getComputedStyle(document.documentElement);
  const ctx = document.createElement('canvas').getContext('2d')!;
  const color = (name: string) => {
    ctx.fillStyle = '#000';
    ctx.fillStyle = css.getPropertyValue(name).trim() || '#000';
    return String(ctx.fillStyle);
  };
  return { text: color('--fg-3'), fg: color('--fg'), line: color('--line'), line2: color('--line-2'), raised: color('--raised-2'), bid: color('--bid'), ask: color('--ask'), font: getComputedStyle(el).fontFamily };
}

/**
 * Candlestick chart of one market with Monday drawn on it: its resting offers as price lines and
 * its fills as arrows. History comes from /api/candles; the live mark keeps the last candle moving.
 */
export function PriceChart({ sym, m, fills, now, className, wheel = true }: { sym: MarketSym; m: MarketState; fills: Fill[]; now: number; className?: string; wheel?: boolean }) {
  const [frame, setFrame] = useState<Frame>('1m');
  const box = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const lw = useRef<Lw | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lines = useRef<{ bid: IPriceLine | null; ask: IPriceLine | null }>({ bid: null, ask: null });
  const last = useRef<Candle | null>(null);
  const offers = useRef<number[]>([]);
  const hovering = useRef(false);
  const [ready, setReady] = useState(false);

  const { min, history } = FRAMES[frame];
  // History for this market and interval, refreshed every minute. Plain fetch: the chart also renders outside the app's query provider.
  const [candles, setCandles] = useState<{ data: Candle[] | null; failed: boolean }>({ data: null, failed: false });
  useEffect(() => {
    let live = true;
    setCandles({ data: null, failed: false });
    const load = () => api<Candle[]>(`/candles?market=${sym}&minutes=${history}`).then(
      (data) => live && setCandles({ data, failed: false }),
      () => live && setCandles((c) => ({ ...c, failed: true })),
    );
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [sym, history]);

  const showLegend = (k: Candle | null) => {
    const el = legend.current;
    if (!el || !k) return;
    const f = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals(m.spec.priceTick), maximumFractionDigits: decimals(m.spec.priceTick) });
    const chg = k.o ? ((k.c - k.o) / k.o) * 100 : 0;
    el.textContent = `O ${f(k.o)}  H ${f(k.h)}  L ${f(k.l)}  C ${f(k.c)}  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    el.style.color = k.c >= k.o ? 'var(--bid-fg)' : 'var(--ask-fg)';
  };
  const showLegendRef = useRef(showLegend);
  showLegendRef.current = showLegend;

  // Create the chart once. The library touches the DOM, so it loads in the browser only.
  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    void import('lightweight-charts').then((mod) => {
      if (dead || !box.current) return;
      lw.current = mod;
      const el = box.current;
      const c = mod.createChart(el, { autoSize: true });
      const s = c.addSeries(mod.CandlestickSeries, {
        borderVisible: false,
        priceLineStyle: mod.LineStyle.Dotted,
        // Keep Monday's offers on screen: the price scale stretches to include them, not just the candles.
        autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
          const r = base();
          if (!r || !offers.current.length) return r;
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...offers.current), maxValue: Math.max(r.priceRange.maxValue, ...offers.current) } };
        },
      });
      const theme = () => {
        const p = palette(el);
        c.applyOptions({
          layout: { background: { type: mod.ColorType.Solid, color: 'transparent' }, textColor: p.text, fontFamily: p.font, fontSize: 11 },
          grid: { vertLines: { color: p.line }, horzLines: { color: p.line } },
          rightPriceScale: { borderColor: p.line2, scaleMargins: { top: 0.14, bottom: 0.08 } },
          timeScale: { borderColor: p.line2, timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 7 },
          crosshair: { mode: mod.CrosshairMode.Normal, vertLine: { color: p.line2, labelBackgroundColor: p.raised }, horzLine: { color: p.line2, labelBackgroundColor: p.raised } },
          // On a scrolling page the wheel must keep scrolling the page; drag and pinch still pan and zoom.
          handleScroll: wheel ? true : { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: wheel ? true : { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
        });
        s.applyOptions({ upColor: p.bid, downColor: p.ask, wickUpColor: p.bid, wickDownColor: p.ask, priceLineColor: p.text });
        lines.current.bid?.applyOptions({ color: p.bid });
        lines.current.ask?.applyOptions({ color: p.ask });
      };
      theme();
      const onMove = (param: MouseEventParams<Time>) => {
        const bar = param.seriesData.get(s) as CandlestickData<Time> | undefined;
        hovering.current = Boolean(bar);
        showLegendRef.current(bar ? { t: 0, o: bar.open, h: bar.high, l: bar.low, c: bar.close } : last.current);
      };
      c.subscribeCrosshairMove(onMove);
      // Follow the theme toggle and the system setting.
      const mo = new MutationObserver(theme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', theme);
      chart.current = c;
      series.current = s;
      markers.current = mod.createSeriesMarkers(s, []);
      setReady(true);
      cleanup = () => {
        mo.disconnect();
        mq.removeEventListener('change', theme);
        c.unsubscribeCrosshairMove(onMove);
        c.remove();
      };
    });
    return () => {
      dead = true;
      cleanup();
      chart.current = series.current = markers.current = null;
      lines.current = { bid: null, ask: null };
    };
  }, [wheel]);

  // Price precision follows the market's tick.
  useEffect(() => {
    series.current?.applyOptions({ priceFormat: { type: 'price', precision: decimals(m.spec.priceTick), minMove: m.spec.priceTick } });
  }, [ready, m.spec.priceTick]);

  // A different market or interval starts from an empty series until its history arrives.
  useEffect(() => {
    last.current = null;
    series.current?.setData([]);
  }, [ready, sym, frame]);

  useEffect(() => {
    const s = series.current;
    if (!s || !candles.data) return;
    const bars = aggregate(candles.data, min);
    s.setData(bars.map(toBar));
    last.current = bars.length ? { ...bars[bars.length - 1] } : null;
    if (!hovering.current) showLegendRef.current(last.current);
  }, [ready, candles.data, min]);

  // The live mark moves the current candle every tick, and opens the next one on time.
  useEffect(() => {
    const s = series.current;
    const k = last.current;
    if (!s || !k || !m.mark) return;
    const span = min * 60_000;
    const t = Math.floor(now / span) * span;
    if (t < k.t) return;
    const cur = t > k.t ? { t, o: k.c, h: Math.max(k.c, m.mark), l: Math.min(k.c, m.mark), c: m.mark } : { ...k, h: Math.max(k.h, m.mark), l: Math.min(k.l, m.mark), c: m.mark };
    last.current = cur;
    s.update(toBar(cur));
    if (!hovering.current) showLegendRef.current(cur);
  }, [now, m.mark, min]);

  // Monday's resting offers as labelled price lines; a pulled side has no line.
  useEffect(() => {
    const s = series.current;
    const mod = lw.current;
    if (!s || !mod || !box.current) return;
    const p = palette(box.current);
    offers.current = [m.quotes.bid?.price, m.quotes.ask?.price].filter((x): x is number => x != null);
    for (const side of ['bid', 'ask'] as const) {
      const q = m.quotes[side];
      const line = lines.current[side];
      if (!q) {
        if (line) s.removePriceLine(line);
        lines.current[side] = null;
      } else if (line) line.applyOptions({ price: q.price });
      else {
        lines.current[side] = s.createPriceLine({
          price: q.price, color: side === 'bid' ? p.bid : p.ask, lineWidth: 1, lineStyle: mod.LineStyle.Dashed, axisLabelVisible: true, title: side === 'bid' ? 'Monday buy' : 'Monday sell',
        });
      }
    }
  }, [ready, m.quotes]);

  // Monday's fills as arrows on the candle they happened in.
  useEffect(() => {
    if (!markers.current || !box.current || !candles.data?.length) return;
    const p = palette(box.current);
    const span = min * 60_000;
    const from = candles.data[0].t;
    markers.current.setMarkers(
      fills
        .filter((f) => f.sym === sym && f.ts >= from)
        .sort((a, b) => a.ts - b.ts)
        .map((f) => ({
          time: toTime(Math.floor(f.ts / span) * span),
          position: f.side === 'bid' ? 'belowBar' : 'aboveBar',
          shape: f.side === 'bid' ? 'arrowUp' : 'arrowDown',
          color: f.side === 'bid' ? p.bid : p.ask,
          size: 0.6,
        })),
    );
  }, [ready, fills, sym, min, candles.data]);

  return (
    <Panel
      title={<>{sym} perp <span className="font-normal text-fg-3">price, Monday&apos;s offers and trades</span></>}
      aside={
        <div role="tablist" aria-label="Candle interval" className="flex">
          {(Object.keys(FRAMES) as Frame[]).map((f) => (
            <button key={f} role="tab" aria-selected={frame === f} onClick={() => setFrame(f)} className={cx('num rounded-sm px-1.5 py-0.5 text-[11px]', frame === f ? 'bg-raised-2 font-semibold text-fg' : 'text-fg-3 hover:text-fg')}>
              {f}
            </button>
          ))}
        </div>
      }
      className={className}
      bodyClassName="relative !overflow-hidden"
    >
      <div ref={box} className="num absolute inset-0" aria-label={`${sym} candlestick chart with Monday's offers and trades`} role="img" />
      <div ref={legend} className="num pointer-events-none absolute left-2 top-1.5 z-[2] text-[11px]" />
      {!candles.data && <p className="absolute inset-0 grid place-items-center text-[12px] text-fg-3">{candles.failed ? 'Price history is unavailable right now.' : 'Loading price history'}</p>}
    </Panel>
  );
}
