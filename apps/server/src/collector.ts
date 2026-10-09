// Smart-money collector (PRD 9.1, 10.1, 12). One instance serves every runner,
// so Nansen credits are spent once.

import { BASELINE_BUCKETS, BUCKET_MS, DEFAULT_CONFIG, MARKETS, computeSignal, tradeSign, type MarketSignal, type MarketSym, type SmartTrade } from '@monday/core';
import { config } from './config';
import { db, event } from './db';
import type { HlTrade } from './hyperliquid';
import type { SimWorld } from './venue/sim';

const MIN = 60_000;
const STALE_MS = 15 * MIN;
const KEEP_RECENT_MS = 6 * 60 * MIN;
const WEEK_MIN = 7 * 24 * 60;
/** `type` of a trade seen live on Hyperliquid before Nansen reported it. */
export const LIVE = 'live';
/**
 * One trade counts at most this much in the flow. A bigger one already fires the big-trade reflex on its own; in the
 * z-scores it would otherwise let one wallet's single close stand for the whole market's flow.
 */
// ponytail: per trade, so a wallet splitting one order into many still adds up; cap per wallet per window if that shows up.
const FLOW_CAP_USD = DEFAULT_CONFIG.bigTradeUsd;
const flowOf = (t: SmartTrade) => tradeSign(t) * Math.min(t.valueUsd, FLOW_CAP_USD);

interface Source {
  backfill(hours: number): Promise<SmartTrade[]>;
  poll(): Promise<SmartTrade[]>;
}

// ---- live Nansen client (PRD 12.3 - 12.5) ----
function nansenSource(): Source {
  let credits: number | null = null;
  const fetchPage = async (lookbackHours: number, page: number): Promise<{ rows: SmartTrade[]; last: boolean }> => {
    const res = await fetch(`${config.nansen.apiUrl}/api/v1/smart-money/perp-trades`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: config.nansen.apiKey },
      body: JSON.stringify({
        lookback_hours: lookbackHours,
        pagination: { page, per_page: 1000 },
        order_by: [{ field: 'block_timestamp', direction: 'DESC' }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const remaining = Number(res.headers.get('x-nansen-credits-remaining'));
    const used = Number(res.headers.get('x-nansen-credits-used'));
    if (Number.isFinite(remaining) && res.headers.has('x-nansen-credits-remaining')) {
      if (credits !== null && used > 0 && remaining / (remaining + used) < 0.2) event(null, 'nansen_credits_low', { remaining });
      credits = remaining;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 30;
      throw new Error(`rate_limit_exceeded, retry after ${wait}s`);
    }
    if (!res.ok) throw new Error(`Nansen ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { data?: Record<string, unknown>[]; pagination?: { is_last_page?: boolean } };
    const now = Date.now();
    const rows: SmartTrade[] = [];
    for (const r of body.data ?? []) {
      const sym = String(r.token_symbol ?? '').toUpperCase();
      if (!(MARKETS as readonly string[]).includes(sym)) continue;
      const raw = String(r.block_timestamp ?? '');
      const ts = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
      if (!Number.isFinite(ts)) continue;
      rows.push({
        hash: String(r.transaction_hash ?? ''), sym: sym as MarketSym, action: String(r.action ?? ''),
        side: String(r.side) === 'Short' ? 'Short' : 'Long', valueUsd: Number(r.value_usd) || 0, priceUsd: Number(r.price_usd) || 0,
        amount: Number(r.token_amount) || 0, type: String(r.type ?? ''), trader: String(r.trader_address ?? ''),
        // Labels are third-party strings: stored and displayed as data, never interpreted.
        label: String(r.trader_address_label ?? '').slice(0, 80), ts, fetchedAt: now,
      });
    }
    return { rows, last: body.pagination?.is_last_page !== false };
  };
  const fetchAll = async (hours: number) => {
    const out: SmartTrade[] = [];
    for (let page = 1; page <= 60; page++) {
      const { rows, last } = await fetchPage(hours, page);
      out.push(...rows);
      if (last) break;
    }
    return out;
  };
  return { backfill: (hours) => fetchAll(hours), poll: () => fetchAll(1) };
}

function simSource(world: SimWorld): Source {
  let last = 0;
  const take = () => {
    const rows = world.smartTrades(last);
    for (const r of rows) last = Math.max(last, r.ts);
    return rows;
  };
  return { backfill: async () => take(), poll: async () => take() };
}

const insert = db.prepare(
  'insert or ignore into nansen_trades (hash, sym, action, amount, side, value_usd, price_usd, type, trader, label, ts, fetched_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
);

export class Collector {
  readonly kind = config.smartMoney;
  private source: Source | null;
  private recent = { BTC: [], ETH: [], SOL: [] } as Record<MarketSym, SmartTrade[]>;
  /** Net flow per one-minute bucket, keyed by minute index. Seven days are kept. */
  private flows = { BTC: new Map(), ETH: new Map(), SOL: new Map() } as Record<MarketSym, Map<number, number>>;
  /** Wallets Nansen has labelled (lowercase address -> label), learned from every row it sends. */
  private watch = new Map<string, string>();
  /** Trades counted live from Hyperliquid, by `${trader}:${hash}`, until Nansen's own row replaces them. */
  // ponytail: memory only, so a restart drops live trades Nansen never confirmed; persist them if that ever matters.
  private live = new Map<string, SmartTrade>();
  /** Hyperliquid fills already counted, by `${coin}:${tid}`: a reconnect replays recent trades. */
  private seenFills = new Set<string>();
  liveSeen = 0;
  private lastOkAt = 0;
  private lags: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  lastError: string | null = null;

  constructor(world: SimWorld | null) {
    this.source = this.kind === 'nansen' ? nansenSource() : this.kind === 'sim' && world ? simSource(world) : null;
  }

  async start() {
    // Rebuild from disk first: the API only serves 7 days, so our table is the only long history.
    const since = Date.now() - WEEK_MIN * MIN;
    const rows = db.prepare('select * from nansen_trades where ts > ? order by ts').all(since) as Record<string, never>[];
    for (const r of rows) {
      this.absorb({ hash: r.hash, sym: r.sym, action: r.action, amount: r.amount, side: r.side, valueUsd: r.value_usd, priceUsd: r.price_usd, type: r.type, trader: r.trader, label: r.label, ts: r.ts, fetchedAt: r.fetched_at });
    }
    if (!this.source) return;
    // Fetch only the hours missing since the newest stored trade (a cold start pulls all 7 days), and do not
    // hold up boot for it: until it lands the signal counts as stale and Monday quotes conservatively.
    const newest: number = rows.length ? rows[rows.length - 1].ts : 0;
    const hours = newest ? Math.min(WEEK_MIN / 60, Math.ceil((Date.now() - newest) / (60 * MIN)) + 1) : WEEK_MIN / 60;
    void this.source.backfill(hours).then((t) => {
      this.ingest(t, true);
      this.lastOkAt = Date.now();
      this.lastError = null;
    }, (e) => this.fail(e));
    const everyMs = this.kind === 'sim' ? 3_000 : config.nansen.pollSeconds * 1000;
    this.timer = setInterval(() => void this.poll(), everyMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll() {
    try {
      this.ingest(await this.source!.poll(), false);
      this.lastOkAt = Date.now();
      this.lastError = null;
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown) {
    this.lastError = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ service: 'collector', event: 'poll_failed', error: this.lastError }));
  }

  private ingest(trades: SmartTrade[], backfill: boolean) {
    db.exec('begin');
    try {
      for (const t of trades) {
        const r = insert.run(t.hash, t.sym, t.action, t.amount, t.side, t.valueUsd, t.priceUsd, t.type, t.trader, t.label, t.ts, t.fetchedAt);
        if (r.changes === 0) continue; // deduplicated on (hash, symbol, action, amount)
        this.replaceLive(t);
        this.absorb(t);
        if (!backfill) this.lags.push(t.fetchedAt - t.ts);
      }
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
    if (this.lags.length > 500) this.lags = this.lags.slice(-500);
    const now = Date.now();
    const oldest = Math.floor(now / MIN) - WEEK_MIN;
    for (const sym of MARKETS) {
      const r = this.recent[sym];
      r.sort((a, b) => a.ts - b.ts);
      while (r.length && r[0].ts < now - KEEP_RECENT_MS) r.shift();
      for (const k of this.flows[sym].keys()) if (k < oldest) this.flows[sym].delete(k);
    }
    // A live trade Nansen has not confirmed in half an hour never will be: it stays counted, it stops waiting.
    for (const [k, l] of this.live) if (l.ts < now - 30 * MIN) this.live.delete(k);
  }
  private addFlow(sym: MarketSym, ts: number, usd: number) {
    const k = Math.floor(ts / MIN);
    const f = this.flows[sym];
    f.set(k, (f.get(k) ?? 0) + usd);
  }
  private absorb(t: SmartTrade) {
    this.addFlow(t.sym, t.ts, flowOf(t));
    if (t.type !== LIVE) this.watch.set(t.trader.toLowerCase(), t.label);
    if (t.ts > Date.now() - KEEP_RECENT_MS) this.recent[t.sym].push(t);
  }

  /**
   * A Hyperliquid fill by a wallet Nansen has labelled. It counts in the signal at once, so the reflex can act within a
   * second of the trade; Nansen's row for the same trade replaces it when it arrives (see replaceLive).
   */
  onHyperliquidTrade(t: HlTrade) {
    if (Date.now() - t.time > 10_000) return; // replayed on (re)connect: old news, and Nansen may already have it
    const id = `${t.sym}:${t.tid}`;
    if (this.seenFills.has(id)) return;
    this.seenFills.add(id);
    if (this.seenFills.size > 20_000) for (const k of [...this.seenFills].slice(0, 5_000)) this.seenFills.delete(k); // oldest first
    const buyer = this.watch.get(t.buyer), seller = this.watch.get(t.seller);
    if ((buyer === undefined) === (seller === undefined)) return; // no smart side, or smart on both (no net flow)
    const trader = buyer !== undefined ? t.buyer : t.seller;
    const usd = t.px * t.sz;
    const prev = this.live.get(`${trader}:${t.hash}`);
    if (prev) {
      // One order fills against several makers. Nansen reports it as one trade, so it is one trade here too.
      const before = flowOf(prev);
      prev.valueUsd += usd;
      prev.amount += t.sz;
      this.addFlow(prev.sym, prev.ts, flowOf(prev) - before);
      return;
    }
    const s: SmartTrade = {
      hash: t.hash, sym: t.sym, action: buyer !== undefined ? 'Buy' : 'Sell', side: buyer !== undefined ? 'Long' : 'Short', valueUsd: usd, priceUsd: t.px,
      amount: t.sz, type: LIVE, trader, label: (buyer ?? seller)!, ts: t.time, fetchedAt: Date.now(),
    };
    this.live.set(`${trader}:${t.hash}`, s);
    this.liveSeen++;
    this.absorb(s);
  }
  /**
   * Nansen's row for a trade already counted live: take that one live copy out so the flow is not counted twice.
   * One row replaces one copy (the closest in time, then in size), so two real trades a second apart both stay.
   */
  private replaceLive(n: SmartTrade) {
    const trader = n.trader.toLowerCase();
    let best: [string, SmartTrade] | null = null;
    const cost = (l: SmartTrade) => Math.abs(l.ts - n.ts) + Math.abs(Math.log(l.valueUsd / Math.max(n.valueUsd, 1)));
    for (const e of this.live) {
      const l = e[1];
      // Same wallet, market and direction within 3 s: Nansen's timestamp and hash do not always match the fill's.
      if (l.trader !== trader || l.sym !== n.sym || tradeSign(l) !== tradeSign(n) || Math.abs(l.ts - n.ts) > 3_000) continue;
      if (!best || cost(l) < cost(best[1])) best = e;
    }
    if (!best) return;
    const [k, l] = best;
    this.live.delete(k);
    this.addFlow(l.sym, l.ts, -flowOf(l));
    const r = this.recent[l.sym];
    const i = r.indexOf(l);
    if (i >= 0) r.splice(i, 1);
  }

  // ---- read side ----
  /** A smart-money source is configured (Nansen, or the simulator's). Without one the regime rests on volatility alone. */
  get hasSource() {
    return this.source !== null;
  }
  /** A configured source has not answered for 15 minutes. With no source at all there is nothing to be late. */
  get stale() {
    return this.source !== null && Date.now() - this.lastOkAt > STALE_MS;
  }
  get ageMs() {
    return this.lastOkAt ? Date.now() - this.lastOkAt : Number.POSITIVE_INFINITY;
  }
  /** Median delay between a trade's block time and when we saw it (PRD 19.1 point-in-time rule). */
  get medianLagMs() {
    if (this.lags.length < 5) return 0;
    const s = [...this.lags].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  /** Net flow per minute for [fromMs, toMs), oldest first. */
  minuteFlows(sym: MarketSym, fromMs: number, toMs: number): number[] {
    const a = Math.floor(fromMs / MIN), b = Math.floor(toMs / MIN);
    const out = new Array<number>(Math.max(0, b - a));
    const f = this.flows[sym];
    for (let k = a; k < b; k++) out[k - a] = f.get(k) ?? 0;
    return out;
  }
  /** Closed 5-minute buckets ending before `now`, oldest first, up to 7 days. */
  buckets(sym: MarketSym, now = Date.now()): number[] {
    const end = Math.floor(now / BUCKET_MS) * BUCKET_MS;
    const m = this.minuteFlows(sym, end - BASELINE_BUCKETS * BUCKET_MS, end);
    const out = new Array<number>(BASELINE_BUCKETS);
    for (let i = 0; i < BASELINE_BUCKETS; i++) out[i] = m[i * 5] + m[i * 5 + 1] + m[i * 5 + 2] + m[i * 5 + 3] + m[i * 5 + 4];
    return out;
  }

  private cache = {} as Record<MarketSym, MarketSignal>;
  signal(sym: MarketSym): MarketSignal {
    const now = Date.now();
    const c = this.cache[sym];
    if (c && now - c.at < 1000) return c;
    return (this.cache[sym] = computeSignal(sym, this.recent[sym], this.buckets(sym, now), now, this.stale));
  }
  recentTrades(sym: MarketSym, sinceMs: number): SmartTrade[] {
    return this.recent[sym].filter((t) => t.ts > sinceMs);
  }
  latestTrades(sym: MarketSym, n: number): SmartTrade[] {
    return this.recent[sym].slice(-n).reverse();
  }
}
