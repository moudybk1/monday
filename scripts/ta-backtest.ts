// Does a technical reading predict which maker fills are toxic? Replays a quote at a fixed distance on every minute of
// Perpl's on-chain tape (taker prints, see the query in scripts/ta-bars.sql) and scores each indicator as a gate:
// fills it would have allowed vs blocked, against a random gate that drops the same share, plus a one-unit round-trip
// simulation with Monday's profit exit and stop loss. Usage: npx tsx scripts/ta-backtest.ts bars.csv [halfBps]
import { readFileSync } from 'node:fs';
import { DIV0, RSI0, divergenceStep, ema, emaTrendBps, mulberry32, rsiStep } from '../packages/core/src/index';

const SYM: Record<string, string> = { '1': 'BTC', '20': 'ETH', '31': 'SOL' };
const [file, hArg] = process.argv.slice(2);
const H = Number(hArg ?? 2); // maker half-spread in bps
const FEE = 0.45, NEED = 2 * FEE + Number(process.env.TARGET ?? 1), STOP = Number(process.env.STOP ?? 20), TIMEOUT = 60, WARM = 120; // env TARGET, STOP in bps

interface Bar { m: number; o: number; c: number; lo: number; hi: number; slo: number | null; bhi: number | null; buy: number; sell: number }
interface State { trend: number; rsi: number | null; div: -1 | 0 | 1; flow: number; mom5: number }
interface Fill { side: 'bid' | 'ask'; j: number; px: number; mo: [number, number, number]; st: State }

const byPerp = new Map<string, Bar[]>();
for (const line of readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
  const [perp, m, o, c, lo, hi, slo, bhi, buy, sell] = line.split(',');
  if (!SYM[perp]) continue;
  (byPerp.get(perp) ?? byPerp.set(perp, []).get(perp)!).push({ m: +m, o: +o, c: +c, lo: +lo, hi: +hi, slo: slo ? +slo : null, bhi: bhi ? +bhi : null, buy: +buy, sell: +sell });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(2).padStart(7) : '      -');
const pct = (xs: number[]) => (xs.length ? ((100 * xs.filter((x) => x > 0).length) / xs.length).toFixed(0).padStart(3) + '%' : '   -');

type Gate = (side: 'bid' | 'ask', s: State) => boolean; // true = this side is blocked
const T = Number(process.env.T ?? 4), FL = 0.3; // env T: trend threshold in bps
const GATES: Record<string, Gate> = {
  'none': () => false,
  'mom5 momentum (Monday now)': (side, s) => (side === 'bid' ? s.mom5 < -T : s.mom5 > T),
  'mom5 reversion': (side, s) => (side === 'bid' ? s.mom5 > T : s.mom5 < -T),
  'ema20/60 momentum': (side, s) => (side === 'bid' ? s.trend < -T : s.trend > T),
  'ema20/60 reversion': (side, s) => (side === 'bid' ? s.trend > T : s.trend < -T),
  'rsi14 reversion (no buy >70, no sell <30)': (side, s) => s.rsi != null && (side === 'bid' ? s.rsi > 70 : s.rsi < 30),
  'rsi14 momentum (no buy <30, no sell >70)': (side, s) => s.rsi != null && (side === 'bid' ? s.rsi < 30 : s.rsi > 70),
  'divergence reversion (no buy on bear div, no sell on bull div)': (side, s) => (side === 'bid' ? s.div === -1 : s.div === 1),
  'divergence momentum': (side, s) => (side === 'bid' ? s.div === 1 : s.div === -1),
  'taker flow 5m momentum (no buy when sellers dominate)': (side, s) => (side === 'bid' ? s.flow < -FL : s.flow > FL),
  'taker flow 5m reversion': (side, s) => (side === 'bid' ? s.flow > FL : s.flow < -FL),
  'ema momentum + flow momentum': (side, s) => (side === 'bid' ? s.trend < -T || s.flow < -FL : s.trend > T || s.flow > FL),
  'ema momentum + rsi reversion': (side, s) => (side === 'bid' ? s.trend < -T || (s.rsi ?? 50) > 70 : s.trend > T || (s.rsi ?? 50) < 30),
};

for (const [perp, bars] of byPerp) {
  const sym = SYM[perp];
  const m0 = bars[0].m, N = bars[bars.length - 1].m - m0 + 1;
  const at = new Array<Bar | undefined>(N);
  for (const b of bars) at[b.m - m0] = b;
  // Dense minute grid, closes carried forward; indicator state after each closed minute.
  const close = new Float64Array(N), st: State[] = new Array(N);
  let eF: number | null = null, eS: number | null = null, rs = RSI0, dv = DIV0, prev = bars[0].o;
  const flowWin: { b: number; s: number }[] = [];
  for (let j = 0; j < N; j++) {
    const b = at[j];
    const c = b ? b.c : prev;
    close[j] = c;
    prev = c;
    eF = ema(eF, c, 20);
    eS = ema(eS, c, 60);
    const r = rsiStep(rs, c, 14);
    rs = r.state;
    const d = divergenceStep(dv, c, r.rsi);
    dv = d.state;
    flowWin.push({ b: b?.buy ?? 0, s: b?.sell ?? 0 });
    if (flowWin.length > 5) flowWin.shift();
    const fb = flowWin.reduce((a, x) => a + x.b, 0), fs = flowWin.reduce((a, x) => a + x.s, 0);
    st[j] = { trend: emaTrendBps(eF, eS, c), rsi: r.rsi, div: d.dir, flow: fb + fs > 0 ? (fb - fs) / (fb + fs) : 0, mom5: j >= 5 ? (c / close[j - 5] - 1) * 1e4 : 0 };
  }
  // Fills: a quote at the minute's first print +-H fills when a taker print crosses it. State is as of the minute before.
  const fills: Fill[] = [];
  for (let j = WARM; j < N - 15; j++) {
    const b = at[j];
    if (!b) continue;
    const bid = b.o * (1 - H / 1e4), ask = b.o * (1 + H / 1e4);
    const mo = (side: 'bid' | 'ask', px: number): [number, number, number] => [1, 5, 15].map((k) => ((side === 'bid' ? close[j + k] - px : px - close[j + k]) / px) * 1e4) as [number, number, number];
    if (b.slo != null && b.slo <= bid) fills.push({ side: 'bid', j, px: bid, mo: mo('bid', bid), st: st[j - 1] });
    if (b.bhi != null && b.bhi >= ask) fills.push({ side: 'ask', j, px: ask, mo: mo('ask', ask), st: st[j - 1] });
  }
  const days = ((bars[bars.length - 1].m - m0) / 1440).toFixed(0);
  console.log(`\n=== ${sym}: ${bars.length} traded minutes over ${days} days, quote +-${H} bps, ${fills.length} fills (${fills.filter((f) => f.side === 'bid').length} bid / ${fills.filter((f) => f.side === 'ask').length} ask) ===`);

  // 1. Conditional markouts by indicator bucket.
  const bucketOf: Record<string, (s: State) => string> = {
    'ema20/60 bps': (s) => (s.trend < -T ? 'bear' : s.trend > T ? 'bull' : 'flat'),
    'mom5 bps': (s) => (s.mom5 < -T ? 'down' : s.mom5 > T ? 'up' : 'flat'),
    'rsi14': (s) => (s.rsi == null ? 'n/a' : s.rsi < 30 ? '<30' : s.rsi > 70 ? '>70' : '30-70'),
    'divergence': (s) => (s.div === -1 ? 'bear' : s.div === 1 ? 'bull' : 'none'),
    'taker flow 5m': (s) => (s.flow < -FL ? 'sell' : s.flow > FL ? 'buy' : 'mixed'),
  };
  console.log('feature            bucket  side     n     mo1m    mo5m   mo15m  pos5m');
  for (const [name, fn] of Object.entries(bucketOf)) {
    const groups = new Map<string, Fill[]>();
    for (const f of fills) {
      const k = `${fn(f.st)}|${f.side}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
    }
    for (const k of [...groups.keys()].sort()) {
      const g = groups.get(k)!;
      const [bucket, side] = k.split('|');
      console.log(`${name.padEnd(18)} ${bucket.padEnd(7)} ${side.padEnd(4)} ${String(g.length).padStart(6)} ${f1(mean(g.map((f) => f.mo[0])))} ${f1(mean(g.map((f) => f.mo[1])))} ${f1(mean(g.map((f) => f.mo[2])))}  ${pct(g.map((f) => f.mo[1]))}`);
    }
  }

  // 2. Gates: markout of the fills each one keeps, vs a random gate dropping the same share, and a round-trip simulation.
  console.log('\ngate                                                             kept   share   mo1m    mo5m   mo15m | random5m | trades  win%   net/trade  total bps');
  const base5 = mean(fills.map((f) => f.mo[1]));
  for (const [name, gate] of Object.entries(GATES)) {
    const kept = fills.filter((f) => !gate(f.side, f.st));
    const share = kept.length / Math.max(1, fills.length);
    const rnd = mulberry32(7);
    const ctl = fills.filter(() => rnd() < share);
    // Round trips: one unit at a time, entered by whichever side fills (a minute that fills both is skipped), closed at
    // entry plus both fees plus 1 bp when a taker reaches it, at the stop when the bar's range does, or at the close after an hour.
    let trades = 0, wins = 0, net = 0;
    for (let j = WARM; j < N - TIMEOUT - 1; j++) {
      const b = at[j];
      if (!b) continue;
      const s = st[j - 1];
      const bid = b.o * (1 - H / 1e4), ask = b.o * (1 + H / 1e4);
      const buy = !gate('bid', s) && b.slo != null && b.slo <= bid, sell = !gate('ask', s) && b.bhi != null && b.bhi >= ask;
      if (buy === sell) continue;
      const long = buy, entry = long ? bid : ask;
      const target = entry * (1 + (long ? NEED : -NEED) / 1e4), stop = entry * (1 - (long ? STOP : -STOP) / 1e4);
      let out = 0, k = 1;
      for (; k <= TIMEOUT; k++) {
        const x = at[j + k];
        if (!x) continue;
        if (long ? x.lo <= stop : x.hi >= stop) { out = stop; break; }
        if (long ? (x.bhi ?? -Infinity) >= target : (x.slo ?? Infinity) <= target) { out = target; break; }
      }
      if (!out) out = close[j + TIMEOUT];
      const bps = ((long ? out / entry - 1 : 1 - out / entry) * 1e4) - 2 * FEE;
      trades++;
      if (bps > 0) wins++;
      net += bps;
      j += k; // flat again after the exit
    }
    const flag = name === 'none' ? '' : mean(kept.map((f) => f.mo[1])) - base5 > 0.5 ? ' <-- better' : '';
    console.log(`${name.padEnd(62)} ${String(kept.length).padStart(6)}  ${(100 * share).toFixed(0).padStart(3)}%  ${f1(mean(kept.map((f) => f.mo[0])))} ${f1(mean(kept.map((f) => f.mo[1])))} ${f1(mean(kept.map((f) => f.mo[2])))} |  ${f1(mean(ctl.map((f) => f.mo[1])))} | ${String(trades).padStart(6)}  ${trades ? ((100 * wins) / trades).toFixed(0).padStart(3) : '  -'}%  ${f1(net / Math.max(1, trades))}  ${f1(net)}${flag}`);
  }
}
