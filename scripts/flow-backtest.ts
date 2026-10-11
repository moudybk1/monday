// Does seconds-scale taker flow on Perpl predict which maker fills are toxic? Every taker order on Perpl's on-chain tape
// is a fill for some maker; this scores that maker's markout against what the tape showed just before (strictly earlier
// blocks): the net taker flow of the last 10 and 60 seconds, the move of the last 10 seconds, the previous order's
// direction. Mid is the average of the last taker buy and sell price, so every markout carries about half a spread of
// bounce; compare buckets with each other, not with zero.
// Usage: sqlite3 -csv stats.sqlite "select perp, block, ts, account, long, price, size from px_trades where taker=1 and
//   perp in (1,20,31) and ts > ... order by perp, block, idx" > taker.csv; npx tsx scripts/flow-backtest.ts taker.csv
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../packages/core/src/index';

const SYM: Record<string, string> = { '1': 'BTC', '20': 'ETH', '31': 'SOL' };
interface Ev { t: number; block: number; dir: 1 | -1; px: number; usd: number; mid: number }

const byPerp = new Map<string, Ev[]>();
let key = '', cur: (Ev & { sz: number; notional: number; perp: string }) | null = null;
const flush = () => { if (cur) (byPerp.get(cur.perp) ?? byPerp.set(cur.perp, []).get(cur.perp)!).push({ t: cur.t, block: cur.block, dir: cur.dir, px: cur.notional / cur.sz, usd: cur.notional, mid: 0 }); };
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!line) continue;
  const [perp, block, ts, account, long, price, size] = line.split(',');
  const k = `${perp}:${block}:${account}:${long}`; // one taker order sweeping several makers is one event
  const px = +price, sz = +size;
  if (k === key && cur) { cur.sz += sz; cur.notional += px * sz; continue; }
  flush();
  key = k;
  cur = { perp, t: +ts, block: +block, dir: long === '1' ? 1 : -1, px, usd: 0, mid: 0, sz, notional: px * sz };
}
flush();

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2).padStart(7) : '      -');
const pct = (xs: number[]) => (xs.length ? `${((100 * xs.filter((x) => x > 0).length) / xs.length).toFixed(0).padStart(3)}%` : '   -');

for (const [perp, ev] of byPerp) {
  // Mid after each event: average of the last buy and last sell price.
  let lb = 0, ls = 0;
  for (const e of ev) {
    if (e.dir === 1) lb = e.px; else ls = e.px;
    e.mid = lb && ls ? (lb + ls) / 2 : e.px;
  }
  const midAt = (t: number, from: number) => { // last event at or before t
    let lo = from, hi = ev.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev[m].t <= t) lo = m; else hi = m - 1; }
    return ev[lo].mid;
  };
  type Row = { mo60: number; mo300: number; run10: number; n10: number; run60: number; mom10: number; prevSame: boolean; usd: number };
  const rows: Row[] = [];
  let a10 = 0, a60 = 0; // window starts
  let prevBlockStart = 0; // first event of the current block
  for (let i = 1; i < ev.length; i++) {
    const e = ev[i];
    if (ev[i].block !== ev[i - 1].block) prevBlockStart = i;
    const before = prevBlockStart; // events [.., before) are in strictly earlier blocks
    if (before === 0) continue;
    while (ev[a10].t < e.t - 10_000) a10++;
    while (ev[a60].t < e.t - 60_000) a60++;
    let f10 = 0, g10 = 0, n10 = 0, f60 = 0, g60 = 0;
    for (let j = a10; j < before; j++) { f10 += ev[j].dir * ev[j].usd; g10 += ev[j].usd; n10++; }
    for (let j = a60; j < before; j++) { f60 += ev[j].dir * ev[j].usd; g60 += ev[j].usd; }
    const last = ev[before - 1];
    if (e.t + 300_000 > ev[ev.length - 1].t) break;
    const m0 = last.mid, mBack = midAt(e.t - 10_000, 0);
    // The maker sold to a taker buy (dir 1) and bought from a taker sell.
    const mo = (h: number) => (-e.dir * (midAt(e.t + h, i) - e.px) / e.px) * 1e4;
    rows.push({
      mo60: mo(60_000), mo300: mo(300_000), n10,
      run10: g10 ? (e.dir * f10) / g10 : 0, // +1: the last 10 s of takers all went the way this one goes
      run60: g60 ? (e.dir * f60) / g60 : 0,
      mom10: mBack ? (e.dir * (m0 / mBack - 1)) * 1e4 : 0, // price already moving the taker's way, in bps
      prevSame: last.dir === e.dir, usd: e.usd,
    });
  }
  const days = ((ev[ev.length - 1].t - ev[0].t) / 86_400_000).toFixed(0);
  console.log(`\n=== ${SYM[perp]}: ${rows.length} taker orders (maker fills) over ${days} days ===`);
  console.log('feature (taker side = the side that hit the maker)       bucket                 n    mo60s   mo300s  pos300');
  const show = (name: string, fn: (r: Row) => string) => {
    const g = new Map<string, Row[]>();
    for (const r of rows) { const k = fn(r); (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
    for (const k of [...g.keys()].sort()) { const x = g.get(k)!; console.log(`${name.padEnd(56)} ${k.padEnd(18)} ${String(x.length).padStart(7)} ${f2(mean(x.map((r) => r.mo60)))} ${f2(mean(x.map((r) => r.mo300)))}  ${pct(x.map((r) => r.mo300))}`); }
  };
  show('all', () => '');
  show('taker flow last 10 s, toward this taker', (r) => (r.n10 === 0 ? 'a no prior print' : r.run10 > 0.6 ? 'd same way >0.6' : r.run10 < -0.6 ? 'b opposite <-0.6' : 'c mixed'));
  show('taker flow last 60 s, toward this taker', (r) => (r.run60 > 0.6 ? 'c same way >0.6' : r.run60 < -0.6 ? 'a opposite <-0.6' : 'b mixed'));
  show('previous taker order', (r) => (r.prevSame ? 'b same direction' : 'a opposite'));
  show('mid move last 10 s, toward this taker', (r) => (r.mom10 > 2 ? 'c >2bps same way' : r.mom10 < -2 ? 'a >2bps opposite' : 'b within 2bps'));
  show('taker order size (known only after: info)', (r) => (r.usd < 500 ? 'a <$500' : r.usd < 5000 ? 'b $500-5k' : 'c >$5k'));
  // As a gate: a maker that steps aside on a side whose takers ran one way in the last 10 s.
  console.log('gate: skip fills where the last 10 s of taker flow ran >0.6 the same way');
  const kept = rows.filter((r) => !(r.n10 > 0 && r.run10 > 0.6));
  const rnd = mulberry32(7), ctl = rows.filter(() => rnd() < kept.length / rows.length);
  console.log(`  kept ${kept.length} of ${rows.length} (${((100 * kept.length) / rows.length).toFixed(0)}%): mo300 ${f2(mean(kept.map((r) => r.mo300)))} vs all ${f2(mean(rows.map((r) => r.mo300)))} vs random same share ${f2(mean(ctl.map((r) => r.mo300)))}`);
}
