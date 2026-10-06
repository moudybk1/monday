// Evidence (PRD 19): an event study of smart-money flow against forward returns,
// and a replay that runs a naive maker and Monday over the same recorded minutes.
// Both run on whatever the collector and the feed hold: simulated data by default,
// real Nansen trades and Perpl candles once those are configured.

import {
  DEFAULT_CONFIG, MARKETS, PRESETS, compositeS, computeQuotes, decileMeans, ewmaVar, fallbackParams, markoutBps, median, nextReflex,
  reflexTrigger, regimeOf, robustScale, spearman, spearmanCI, varToBps,
  type EventStudy, type Evidence, type GovernorParams, type MarketSpec, type MarketSym, type ReflexState, type Replay, type ReplayArm,
} from '@monday/core';
import type { Collector } from './collector';
import { config } from './config';
import type { Candle, VenueDriver } from './venue/types';

const MIN = 60_000;
const DAY_MIN = 1440;
const POLICY = PRESETS.balanced;

let current: Evidence | null = null;
export const evidence = () => current;
/** PRD 19.1 decision rule: lean with the flow only when the 15-minute correlation is positive with its interval above zero. */
export const nansenK = (sym: MarketSym) => (current?.studies[sym]?.skewEnabled ? DEFAULT_CONFIG.k : 0);

/** Robust scale of a series using only the data before each day boundary, so no sample sees its own future. */
function rollingZ(series: number[], perDay: number): (number | null)[] {
  const out = new Array<number | null>(series.length).fill(null);
  let med = 0, scale = 0;
  for (let i = perDay; i < series.length; i++) {
    if (i % perDay === 0) ({ med, scale } = robustScale(series.slice(0, i)));
    out[i] = scale > 0 ? (series[i] - med) / scale : 0;
  }
  return out;
}

// Summed directly: a running add-and-subtract leaves float residue in empty windows (see windowSums).
const trailing = (xs: number[], n: number) => xs.map((_, i) => {
  let acc = 0;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) acc += xs[j];
  return acc;
});

function eventStudy(sym: MarketSym, flows: number[], closes: (number | null)[]): EventStudy {
  // Features at the end of every 5-minute bucket; closes[i] is the price at the end of minute i.
  const nB = Math.floor(flows.length / 5);
  const b5 = Array.from({ length: nB }, (_, i) => flows[i * 5] + flows[i * 5 + 1] + flows[i * 5 + 2] + flows[i * 5 + 3] + flows[i * 5 + 4]);
  const z = { 5: rollingZ(b5, 288), 15: rollingZ(trailing(b5, 3), 288), 60: rollingZ(trailing(b5, 12), 288) } as Record<number, (number | null)[]>;
  const price = (bucket: number, plusMin: number) => closes[(bucket + 1) * 5 - 1 + plusMin] ?? null;
  const pairs = (w: number, h: number) => {
    const x: number[] = [], y: number[] = [];
    const step = Math.max(w, h) / 5; // non-overlapping samples keep the interval honest
    for (let i = 288; i < nB; i += step) {
      const zi = z[w][i], p0 = price(i, 0), p1 = price(i, h);
      if (zi == null || p0 == null || p1 == null) continue;
      x.push(zi);
      y.push(Math.log(p1 / p0) * 1e4);
    }
    return { x, y };
  };
  const grid = [5, 15, 60].flatMap((w) => [5, 15, 60].map((h) => {
    const { x, y } = pairs(w, h);
    const [lo, hi] = spearmanCI(x, y, 300);
    return { window: w, horizon: h, rho: spearman(x, y), lo, hi, n: x.length };
  }));
  const d = pairs(15, 15);
  const strong = pairs(5, 15);
  const hits = strong.x.map((v, i) => [v, strong.y[i]] as const).filter(([v]) => Math.abs(v) > DEFAULT_CONFIG.z2);
  const head = grid.find((g) => g.window === 15 && g.horizon === 15)!;
  return {
    sym, samples: d.x.length, grid,
    deciles: decileMeans(d.x, d.y).map((r) => ({ decile: r.decile, meanZ: r.meanX, meanRetBps: r.meanY, n: r.n })),
    hit: { n: hits.length, rate: hits.length ? hits.filter(([v, r]) => Math.sign(v) === Math.sign(r)).length / hits.length : 0 },
    skewEnabled: head.rho > 0 && head.lo > 0,
  };
}

function replay(sym: MarketSym, spec: MarketSpec, candles: Candle[], flows: number[], k: number): Replay {
  const f5 = trailing(flows, 5), f15 = trailing(flows, 15), f60 = trailing(flows, 60);
  // z at minute i uses flows through minute i - 1 and a scale from before that day.
  const z5 = rollingZ(f5, DAY_MIN), z15 = rollingZ(f15, DAY_MIN), z60 = rollingZ(f60, DAY_MIN);
  const cfg = { ...DEFAULT_CONFIG, k };
  const mk = () => ({ pos: 0, entry: 0, bal: 0, fees: 0, fills: 0, m1: 0, m5: 0, adverse: 0, inv: [] as number[], quoted: 0, peak: 0, dd: 0, curve: [] as { t: number; v: number }[] });
  const arms = { naive: mk(), monday: mk() };
  let var1m = 0, reflex: ReflexState | null = null, pulls = 0, minutes = 0;
  const sigmas: number[] = [];
  let gov: Omit<GovernorParams, 'reason'> = fallbackParams(sym, 'calm', 0, POLICY.maxInventoryUsd);
  const calm = fallbackParams(sym, 'calm', 0, POLICY.maxInventoryUsd);
  let nextGov = 0, wasStorm = false;

  for (let i = 1; i < candles.length - 6; i++) {
    const c = candles[i];
    var1m = ewmaVar(var1m, Math.log(candles[i].o / candles[i - 1].o));
    const sigma = varToBps(var1m);
    sigmas.push(sigma);
    if (i < DAY_MIN || z5[i - 1] == null) continue; // first day warms up the baseline
    minutes++;
    const S = compositeS(z5[i - 1]!, z15[i - 1]!, z60[i - 1]!);
    const r = nextReflex(reflex, reflexTrigger(z5[i - 1]!, 0, cfg), c.t, z5[i - 1]!, [], cfg);
    if (r.changed && r.state?.action === 'pull') pulls++;
    reflex = r.state;
    const storm = Math.abs(S) >= cfg.z2;
    if (i >= nextGov || (storm && !wasStorm)) {
      gov = fallbackParams(sym, regimeOf(S, sigma, median(sigmas.slice(-DAY_MIN)), false, cfg), S, POLICY.maxInventoryUsd);
      nextGov = i + config.governorIntervalMin;
    }
    wasStorm = storm;

    for (const name of ['naive', 'monday'] as const) {
      const a = arms[name];
      const monday = name === 'monday';
      const q = computeQuotes({
        mark: c.o, mid: null, bestBid: null, bestAsk: null, sigma1mBps: sigma, positionUsd: a.pos * c.o, S: monday ? S : 0, policy: POLICY,
        gov: monday ? gov : calm, reflex: monday ? reflex : null, spec, cfg: monday ? cfg : { ...cfg, k: 0 },
      });
      if (q.bid && q.ask) a.quoted++;
      // Fill model (PRD 19.2): a quote fills when the minute's range trades through it. Queue position is ignored in both arms.
      for (const side of ['bid', 'ask'] as const) {
        const t = q[side];
        if (!t || (side === 'bid' ? c.l > t.price : c.h < t.price)) continue;
        const signed = side === 'bid' ? t.size : -t.size;
        const reducing = a.pos !== 0 && Math.sign(a.pos) !== Math.sign(signed) ? Math.min(Math.abs(a.pos), t.size) : 0;
        const opening = t.size - reducing;
        a.bal += reducing * (t.price - a.entry) * Math.sign(a.pos);
        const fee = (t.size * t.price * spec.makerFeeBps) / 1e4;
        a.bal -= fee;
        a.fees += fee;
        const np = Number((a.pos + signed).toFixed(8));
        a.entry = np === 0 ? 0 : reducing === 0 ? (Math.abs(a.pos) * a.entry + t.size * t.price) / (Math.abs(a.pos) + t.size) : opening > 0 ? t.price : a.entry;
        a.pos = np;
        a.fills++;
        const m1 = markoutBps(side, t.price, candles[i + 1].c);
        a.m1 += m1;
        a.m5 += markoutBps(side, t.price, candles[i + 5].c);
        if (m1 < 0) a.adverse += (-m1 * t.price * t.size) / 1e4;
      }
      const eq = a.bal + a.pos * (c.c - a.entry);
      a.inv.push(a.pos * c.c);
      a.peak = Math.max(a.peak, eq);
      a.dd = Math.max(a.dd, a.peak - eq);
      if (i % 30 === 0) a.curve.push({ t: c.t, v: eq });
    }
  }
  const finish = (a: ReturnType<typeof mk>): ReplayArm => {
    const mean = a.inv.reduce((s, x) => s + x, 0) / Math.max(1, a.inv.length);
    const last = candles[candles.length - 7];
    return {
      pnlUsd: a.bal + a.pos * ((last?.c ?? 0) - a.entry), feesUsd: a.fees, fills: a.fills, markout1mBps: a.fills ? a.m1 / a.fills : 0, markout5mBps: a.fills ? a.m5 / a.fills : 0,
      adverseUsd: a.adverse, inventoryStdUsd: Math.sqrt(a.inv.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, a.inv.length)), maxDrawdownUsd: a.dd,
      quotedPct: minutes ? (a.quoted / minutes) * 100 : 0, curve: a.curve,
    };
  };
  return { sym, from: candles[Math.min(DAY_MIN, candles.length - 1)]?.t ?? 0, to: candles[candles.length - 1]?.t ?? 0, naive: finish(arms.naive), monday: finish(arms.monday), reflexPulls: pulls };
}

export async function computeEvidence(driver: VenueDriver, collector: Collector): Promise<Evidence | null> {
  if (collector.kind === 'none') return null;
  const end = Math.floor(Date.now() / (5 * MIN)) * 5 * MIN;
  const from = end - 7 * DAY_MIN * MIN;
  const lag = Math.round(collector.medianLagMs / MIN) * MIN;
  const out: Evidence = {
    at: Date.now(), synthetic: collector.kind === 'sim' || driver.kind === 'sim', smartMoneySource: collector.kind === 'nansen' ? 'Nansen Smart Money Perp Trades, Hyperliquid' : 'Simulated smart-money trades',
    priceSource: driver.kind === 'perpl' ? 'Perpl 1-minute candles' : 'Simulated 1-minute candles', lagMs: lag, policy: POLICY, studies: {}, replays: {},
  };
  for (const sym of MARKETS) {
    const spec = driver.feed.specs()[sym];
    if (!spec) continue;
    const raw = await driver.feed.candles(sym, from, end);
    if (raw.length < 2 * DAY_MIN) continue; // under two days of prices is not a study
    // Align candles to a dense minute grid; gaps carry the previous close forward.
    const byMin = new Map(raw.map((c) => [Math.floor(c.t / MIN), c]));
    const candles: Candle[] = [];
    const closes: (number | null)[] = [];
    let prev: Candle | null = null;
    for (let m = from / MIN; m < end / MIN; m++) {
      const c: Candle | null = byMin.get(m) ?? (prev ? { t: m * MIN, o: prev.c, h: prev.c, l: prev.c, c: prev.c } : null);
      closes.push(c ? c.c : null);
      if (c) {
        candles.push(c);
        prev = c;
      }
    }
    // Point-in-time rule: a trade counts from the moment we could have seen it.
    const flows = collector.minuteFlows(sym, from - lag, end - lag);
    const study = eventStudy(sym, flows, closes);
    out.studies[sym] = study;
    const offset = closes.length - candles.length; // leading minutes with no price yet
    out.replays[sym] = replay(sym, spec, candles, flows.slice(offset), study.skewEnabled ? DEFAULT_CONFIG.k : 0);
    await new Promise((r) => setImmediate(r)); // let ticks run between markets
  }
  current = out;
  return out;
}
