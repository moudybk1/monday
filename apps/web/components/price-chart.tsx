'use client';

import { useEffect, useRef, useState } from 'react';
import type { CandlestickData, IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesType, Time, UTCTimestamp } from 'lightweight-charts';
import { usdCompact, type Fill, type MarketState, type MarketSym } from '@monday/core';
import { api } from '@/lib/api';
import { bollinger, ema, macd, rsi, vwap } from '@/lib/indicators';
import { Panel, cx } from './ui';

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number }
type Lw = typeof import('lightweight-charts');

// Candle width in seconds; Perpl serves each of these natively.
const FRAMES = { '1m': 60, '5m': 300, '15m': 900, '1H': 3600, '4H': 14_400, '1D': 86_400 } as const;
type Frame = keyof typeof FRAMES;
const BARS = 500; // enough history to warm up EMA 200

const INDICATORS = [
  { id: 'vol', label: 'Volume' },
  { id: 'ema20', label: 'EMA 20' },
  { id: 'ema50', label: 'EMA 50' },
  { id: 'ema200', label: 'EMA 200' },
  { id: 'bb', label: 'Bollinger 20, 2' },
  { id: 'vwap', label: 'VWAP' },
  { id: 'rsi', label: 'RSI 14' },
  { id: 'macd', label: 'MACD 12, 26, 9' },
] as const;
type Ind = (typeof INDICATORS)[number]['id'];
const DEFAULT_IND: Ind[] = ['vol', 'ema20', 'ema50'];
const PREFS = 'monday.chart'; // this viewer's interval and indicators

// The library draws in UTC; shift each time by the viewer's offset so the axis reads local time.
const toTime = (ms: number) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 1000) as UTCTimestamp;
const toBar = (k: Candle): CandlestickData<Time> => ({ time: toTime(k.t), open: k.o, high: k.h, low: k.l, close: k.c });
const decimals = (tick: number) => Math.max(0, Math.round(-Math.log10(tick)));

/** Theme tokens as canvas-ready colours (the canvas normalises any CSS colour syntax). */
function palette(el: HTMLElement) {
  const css = getComputedStyle(document.documentElement);
  const ctx = document.createElement('canvas').getContext('2d')!;
  const color = (name: string) => {
    ctx.fillStyle = '#000';
    ctx.fillStyle = css.getPropertyValue(name).trim() || '#000';
    return String(ctx.fillStyle);
  };
  const soft = (hex: string) => `${hex}59`; // 35% alpha: volume and MACD bars sit behind the lines
  const bid = color('--bid'), ask = color('--ask');
  return {
    text: color('--fg-3'), fg: color('--fg'), fg2: color('--fg-2'), line: color('--line'), line2: color('--line-2'), raised: color('--raised-2'),
    bid, ask, bidSoft: soft(bid), askSoft: soft(ask), ind1: color('--ind-1'), ind2: color('--ind-2'), font: getComputedStyle(el).fontFamily,
  };
}
type Palette = ReturnType<typeof palette>;
type Pt = { time: Time; value?: number; color?: string };

/** Every enabled indicator's points, one per candle (whitespace while it warms up). */
function indicatorPoints(bars: Candle[], on: readonly Ind[], p: Palette): Record<string, Pt[]> {
  const t = bars.map((b) => toTime(b.t));
  const closes = bars.map((b) => b.c);
  const line = (xs: (number | null)[]): Pt[] => xs.map((v, i) => (v == null ? { time: t[i] } : { time: t[i], value: v }));
  const out: Record<string, Pt[]> = {};
  if (on.includes('vol')) out.vol = bars.map((b, i) => ({ time: t[i], value: b.v ?? 0, color: b.c >= b.o ? p.bidSoft : p.askSoft }));
  if (on.includes('ema20')) out.ema20 = line(ema(closes, 20));
  if (on.includes('ema50')) out.ema50 = line(ema(closes, 50));
  if (on.includes('ema200')) out.ema200 = line(ema(closes, 200));
  if (on.includes('bb')) {
    const b = bollinger(closes, 20, 2);
    Object.assign(out, { bbU: line(b.upper), bbM: line(b.mid), bbL: line(b.lower) });
  }
  if (on.includes('vwap')) out.vwap = line(vwap(bars));
  if (on.includes('rsi')) out.rsi = line(rsi(closes, 14));
  if (on.includes('macd')) {
    const m = macd(closes, 12, 26, 9);
    out.macd = line(m.macd);
    out.macdSig = line(m.signal);
    out.macdHist = m.hist.map((v, i) => (v == null ? { time: t[i] } : { time: t[i], value: v, color: v >= 0 ? p.bidSoft : p.askSoft }));
  }
  return out;
}

/**
 * Candlestick chart of one market with Monday drawn on it: its resting offers as price lines and its fills as
 * arrows, plus the indicators this viewer picked. History comes from /api/candles; the live mark keeps the last
 * candle (and every indicator's last point) moving.
 */
export function PriceChart({ sym, m, fills, now, className, wheel = true }: { sym: MarketSym; m: MarketState; fills: Fill[]; now: number; className?: string; wheel?: boolean }) {
  const [frame, setFrame] = useState<Frame>('1m');
  const [on, setOn] = useState<Ind[]>(DEFAULT_IND);
  const box = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const indLegend = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const lw = useRef<Lw | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ind = useRef(new Map<string, ISeriesApi<SeriesType>>());
  const pal = useRef<Palette | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lines = useRef<{ bid: IPriceLine | null; ask: IPriceLine | null }>({ bid: null, ask: null });
  const bars = useRef<Candle[]>([]); // history plus the live candle
  const points = useRef<Record<string, Pt[]>>({});
  const offers = useRef<number[]>([]);
  const hovering = useRef(false);
  const [ready, setReady] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [built, setBuilt] = useState(0);

  const res = FRAMES[frame];
  const span = res * 1000;
  const onKey = on.join(',');

  // This viewer's interval and indicators survive a reload. Storage can be missing or blocked: defaults then.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? 'null') as { frame?: string; ind?: string[] } | null;
      if (p?.frame && p.frame in FRAMES) setFrame(p.frame as Frame);
      if (Array.isArray(p?.ind)) setOn(INDICATORS.map((d) => d.id).filter((id) => p.ind!.includes(id)));
    } catch {}
  }, []);
  // Saved on the viewer's own clicks, never from an effect: a mount-time save would overwrite what the load just read.
  const save = (next: { frame: Frame; ind: Ind[] }) => {
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {}
  };

  // The indicator menu closes on a click elsewhere or Escape, like any other menu.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  // History for this market and interval, refreshed every minute. Plain fetch: the chart also renders outside the app's query provider.
  const [candles, setCandles] = useState<{ data: Candle[] | null; failed: boolean }>({ data: null, failed: false });
  useEffect(() => {
    let live = true;
    setCandles({ data: null, failed: false });
    const load = () => api<Candle[]>(`/candles?market=${sym}&res=${res}&bars=${BARS}`).then(
      (data) => live && setCandles({ data, failed: false }),
      () => live && setCandles((c) => ({ ...c, failed: true })),
    );
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [sym, res]);

  const fmt = (v: number, d = decimals(m.spec.priceTick)) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const showLegend = (k: Candle | null) => {
    const el = legend.current;
    if (!el || !k) return;
    const chg = k.o ? ((k.c - k.o) / k.o) * 100 : 0;
    el.textContent = `O ${fmt(k.o)}  H ${fmt(k.h)}  L ${fmt(k.l)}  C ${fmt(k.c)}  ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    el.style.color = k.c >= k.o ? 'var(--bid-fg)' : 'var(--ask-fg)';
  };
  /** Indicator names and values (hovered bar, else the latest): the text carries identity, a swatch beside it the colour. */
  const showIndicators = (at: (key: string) => number | undefined) => {
    const el = indLegend.current;
    const p = pal.current;
    if (!el || !p) return;
    const v = (key: string, d?: number) => {
      const x = at(key);
      return x == null ? '–' : fmt(x, d);
    };
    const items: [string, string, string][] = [];
    if (on.includes('ema20')) items.push(['EMA 20', p.ind1, v('ema20')]);
    if (on.includes('ema50')) items.push(['EMA 50', p.ind2, v('ema50')]);
    if (on.includes('ema200')) items.push(['EMA 200', p.fg2, v('ema200')]);
    if (on.includes('bb')) items.push(['BB', p.text, `${v('bbU')} / ${v('bbL')}`]);
    if (on.includes('vwap')) items.push(['VWAP', p.fg, v('vwap')]);
    if (on.includes('vol')) items.push(['Vol', p.bidSoft, at('vol') == null ? '–' : usdCompact(at('vol')!)]);
    if (on.includes('rsi')) items.push(['RSI', p.ind1, v('rsi', 1)]);
    if (on.includes('macd')) items.push(['MACD', p.ind1, `${v('macd', decimals(m.spec.priceTick) + 1)} / ${v('macdSig', decimals(m.spec.priceTick) + 1)}`]);
    el.replaceChildren(...items.map(([label, color, text]) => {
      const item = document.createElement('span');
      item.className = 'inline-flex items-center gap-1';
      const swatch = document.createElement('i');
      swatch.className = 'inline-block h-[2px] w-2.5 rounded-full';
      swatch.style.background = color;
      item.append(swatch, `${label} ${text}`);
      return item;
    }));
  };
  const latest = (key: string) => points.current[key]?.at(-1)?.value;
  const showRef = useRef({ showLegend, showIndicators, latest });
  showRef.current = { showLegend, showIndicators, latest };

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
        pal.current = p;
        c.applyOptions({
          layout: { background: { type: mod.ColorType.Solid, color: 'transparent' }, textColor: p.text, fontFamily: p.font, fontSize: 11, panes: { separatorColor: p.line2, separatorHoverColor: p.line2 } },
          grid: { vertLines: { color: p.line }, horzLines: { color: p.line } },
          rightPriceScale: { borderColor: p.line2 },
          timeScale: { borderColor: p.line2, secondsVisible: false, rightOffset: 5, barSpacing: 7 },
          crosshair: { mode: mod.CrosshairMode.Normal, vertLine: { color: p.line2, labelBackgroundColor: p.raised }, horzLine: { color: p.line2, labelBackgroundColor: p.raised } },
          // On a scrolling page the wheel must keep scrolling the page; drag and pinch still pan and zoom.
          handleScroll: wheel ? true : { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: wheel ? true : { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
        });
        s.applyOptions({ upColor: p.bid, downColor: p.ask, wickUpColor: p.bid, wickDownColor: p.ask, priceLineColor: p.text });
        lines.current.bid?.applyOptions({ color: p.bid });
        lines.current.ask?.applyOptions({ color: p.ask });
        setThemeTick((n) => n + 1); // indicator series are rebuilt in the new colours
      };
      theme();
      const onMove = (param: MouseEventParams<Time>) => {
        const bar = param.seriesData.get(s) as CandlestickData<Time> | undefined;
        hovering.current = Boolean(bar);
        const { showLegend, showIndicators, latest } = showRef.current;
        showLegend(bar ? { t: 0, o: bar.open, h: bar.high, l: bar.low, c: bar.close } : bars.current.at(-1) ?? null);
        showIndicators(bar ? (key) => (param.seriesData.get(ind.current.get(key)!) as { value?: number } | undefined)?.value : latest);
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
      ind.current.clear();
      lines.current = { bid: null, ask: null };
    };
  }, [wheel]);

  // Price precision follows the market's tick; dates alone on the daily axis.
  useEffect(() => {
    series.current?.applyOptions({ priceFormat: { type: 'price', precision: decimals(m.spec.priceTick), minMove: m.spec.priceTick } });
  }, [ready, m.spec.priceTick]);
  useEffect(() => {
    chart.current?.applyOptions({ timeScale: { timeVisible: res < 86_400 } });
  }, [ready, res]);

  // Indicator series: rebuilt whenever the selection or the theme changes. Oscillators get their own panes below.
  useEffect(() => {
    const c = chart.current, mod = lw.current, s = series.current, p = pal.current;
    if (!c || !mod || !s || !p) return;
    for (const x of ind.current.values()) c.removeSeries(x);
    ind.current.clear();
    for (let i = c.panes().length - 1; i > 0; i--) c.removePane(i);
    const base = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
    const add = <T extends SeriesType>(key: string, def: Parameters<IChartApi['addSeries']>[0], opts: object, pane = 0) => {
      const x = c.addSeries(def, { ...base, ...opts }, pane) as unknown as ISeriesApi<T>;
      ind.current.set(key, x as unknown as ISeriesApi<SeriesType>);
      return x;
    };
    const { Solid, Dashed, Dotted } = mod.LineStyle;
    const d = decimals(m.spec.priceTick);
    if (on.includes('vol')) {
      add('vol', mod.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false });
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    // The legend may cover the top of the candles, as on any terminal; volume gets the bottom fifth to itself.
    s.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: on.includes('vol') ? 0.2 : 0.05 } });
    if (on.includes('ema20')) add('ema20', mod.LineSeries, { color: p.ind1, lineWidth: 2, lineStyle: Solid });
    if (on.includes('ema50')) add('ema50', mod.LineSeries, { color: p.ind2, lineWidth: 2, lineStyle: Solid });
    if (on.includes('ema200')) add('ema200', mod.LineSeries, { color: p.fg2, lineWidth: 2, lineStyle: Solid });
    if (on.includes('bb')) {
      add('bbU', mod.LineSeries, { color: p.text, lineWidth: 1, lineStyle: Dashed, lastValueVisible: false });
      add('bbM', mod.LineSeries, { color: p.text, lineWidth: 1, lineStyle: Dotted, lastValueVisible: false });
      add('bbL', mod.LineSeries, { color: p.text, lineWidth: 1, lineStyle: Dashed, lastValueVisible: false });
    }
    if (on.includes('vwap')) add('vwap', mod.LineSeries, { color: p.fg, lineWidth: 1, lineStyle: Dashed });
    let pane = 1;
    if (on.includes('rsi')) {
      const r = add<'Line'>('rsi', mod.LineSeries, { color: p.ind1, lineWidth: 2, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } }, pane++);
      for (const level of [70, 30]) r.createPriceLine({ price: level, color: p.line2, lineWidth: 1, lineStyle: Dotted, axisLabelVisible: false });
    }
    if (on.includes('macd')) {
      const fmtMacd = { type: 'price', precision: d + 1, minMove: m.spec.priceTick / 10 };
      add('macdHist', mod.HistogramSeries, { priceFormat: fmtMacd, lastValueVisible: false }, pane);
      add('macd', mod.LineSeries, { color: p.ind1, lineWidth: 2, priceFormat: fmtMacd }, pane);
      add('macdSig', mod.LineSeries, { color: p.ind2, lineWidth: 2, priceFormat: fmtMacd }, pane);
    }
    const panes = c.panes();
    panes.forEach((x, i) => x.setStretchFactor(i === 0 ? 4 : 1)); // price keeps two thirds even with both oscillators
    setBuilt((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, onKey, themeTick, m.spec.priceTick]);

  // A different market or interval starts from an empty chart until its history arrives.
  useEffect(() => {
    bars.current = [];
    points.current = {};
    series.current?.setData([]);
    for (const x of ind.current.values()) x.setData([]);
  }, [ready, sym, frame]);

  const pushIndicators = (full: boolean) => {
    const p = pal.current;
    if (!p) return;
    points.current = indicatorPoints(bars.current, on, p);
    for (const [key, x] of ind.current) {
      const pts = points.current[key] ?? [];
      if (full) x.setData(pts as never);
      else if (pts.length) x.update(pts[pts.length - 1] as never);
    }
    if (!hovering.current) showIndicators(latest);
  };

  useEffect(() => {
    const s = series.current;
    if (!s || !candles.data) return;
    bars.current = candles.data.map((k) => ({ ...k }));
    s.setData(bars.current.map(toBar));
    pushIndicators(true);
    if (!hovering.current) showLegend(bars.current.at(-1) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, candles.data, built]);

  // The live mark moves the current candle every tick, and opens the next one on time.
  useEffect(() => {
    const s = series.current;
    const k = bars.current.at(-1);
    if (!s || !k || !m.mark) return;
    const t = Math.floor(now / span) * span;
    if (t < k.t) return;
    const cur = t > k.t ? { t, o: k.c, h: Math.max(k.c, m.mark), l: Math.min(k.c, m.mark), c: m.mark, v: 0 } : { ...k, h: Math.max(k.h, m.mark), l: Math.min(k.l, m.mark), c: m.mark };
    if (t > k.t) bars.current.push(cur);
    else bars.current[bars.current.length - 1] = cur;
    s.update(toBar(cur));
    pushIndicators(false);
    if (!hovering.current) showLegend(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, m.mark, span]);

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
  }, [ready, fills, sym, span, candles.data]);

  const toggle = (id: Ind) => {
    const next = INDICATORS.map((d) => d.id).filter((x) => (x === id ? !on.includes(x) : on.includes(x)));
    setOn(next);
    save({ frame, ind: next });
  };
  const choose = (f: Frame) => {
    setFrame(f);
    save({ frame: f, ind: on });
  };

  return (
    <Panel
      title={<>{sym} perp <span className="font-normal text-fg-3">price, Monday&apos;s offers and trades</span></>}
      aside={
        <>
          <div role="tablist" aria-label="Candle interval" className="flex">
            {(Object.keys(FRAMES) as Frame[]).map((f) => (
              <button key={f} role="tab" aria-selected={frame === f} onClick={() => choose(f)} className={cx('num rounded-sm px-1.5 py-0.5 text-[11px]', frame === f ? 'bg-raised-2 font-semibold text-fg' : 'text-fg-3 hover:text-fg')}>
                {f}
              </button>
            ))}
          </div>
          <details ref={menu} className="relative" onKeyDown={(e) => e.key === 'Escape' && menu.current && (menu.current.open = false)}>
            <summary className="cursor-pointer list-none rounded-sm px-1.5 py-0.5 text-[11px] text-fg-3 hover:text-fg [&::-webkit-details-marker]:hidden">
              Indicators{on.length ? <span className="num ml-1 text-fg-2">{on.length}</span> : null}
            </summary>
            <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-sm border border-line-2 bg-raised p-1 shadow-lg">
              {INDICATORS.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[12px] text-fg-2 hover:bg-raised-2 hover:text-fg">
                  <input type="checkbox" checked={on.includes(d.id)} onChange={() => toggle(d.id)} className="accent-[var(--accent)]" />
                  {d.label}
                </label>
              ))}
            </div>
          </details>
        </>
      }
      className={className}
      bodyClassName="relative !overflow-hidden"
    >
      <div ref={box} className="num absolute inset-0" aria-label={`${sym} candlestick chart with Monday's offers and trades`} role="img" />
      <div className="pointer-events-none absolute left-2 right-16 top-1.5 z-[2] flex flex-col gap-0.5">
        <div ref={legend} className="num text-[11px]" />
        <div ref={indLegend} className="num flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-fg-2" />
      </div>
      {!candles.data && <p className="absolute inset-0 grid place-items-center text-[12px] text-fg-3">{candles.failed ? 'Price history is unavailable right now.' : 'Loading price history'}</p>}
    </Panel>
  );
}
