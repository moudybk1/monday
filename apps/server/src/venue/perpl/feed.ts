// Public market data: one socket, one subscription frame, a local L2 book per
// market, and 1-minute candles over REST.

import type { BookLevel, MarketSpec, MarketSym } from '@monday/core';
import type { Candle, MarketFeed, MarketSnapshot, TapeTrade } from '../types';
import type { PerplConfig } from './index';
import { getJson, type PerplContext } from './rest';
import { openLink, type Link } from './socket';

const DEPTH = 15;
const MAX_CANDLES = 1024; // documented per-call maximum
const START_TIMEOUT_MS = 10_000;

type Levels = Map<number, number>; // wire price -> wire size
interface WireLevel { p: number; s: number; o: number }
interface WireState { orl: number; mrk: number; oi: number }

export class PerplFeed implements MarketFeed {
  private ctx: PerplContext | null = null;
  private link: Link | null = null;
  private bookSids = new Map<number, number>(); // subscription id -> market id
  private tradeSids = new Map<number, number>();
  private tradeCbs: ((t: TapeTrade) => void)[] = [];
  private books = new Map<number, { bid: Levels; ask: Levels }>();
  private states = new Map<number, WireState>();
  private funding = new Map<number, number>(); // market id -> rate, micros
  private lastSn: number | null = null;
  private lastFrameAt = 0;
  private onReady: (() => void) | null = null;

  constructor(private cfg: PerplConfig, private loadCtx: () => Promise<PerplContext>) {}

  async start(): Promise<void> {
    if (this.link) return;
    const ctx = (this.ctx = await this.loadCtx());
    const ids = [...ctx.byId.keys()];
    // One frame for everything: 9 of the 16 allowed subscriptions, 1 of the 10 requests/min.
    const subs = [`market-state@${this.cfg.chainId}`, `funding@${this.cfg.chainId}`, `heartbeat@${this.cfg.chainId}`, ...ids.flatMap((id) => [`order-book@${id}`, `trades@${id}`])]
      .map((stream) => ({ stream, subscribe: true }));

    await new Promise<void>((resolve) => {
      // If the venue is unreachable the socket keeps retrying; snapshot() stays null until data arrives.
      const timer = setTimeout(resolve, START_TIMEOUT_MS);
      this.onReady = () => (clearTimeout(timer), resolve());
      this.link = openLink(`${this.cfg.wsUrl}/ws/v1/market-data`, {
        open: () => {
          this.lastSn = null;
          this.bookSids.clear();
          this.tradeSids.clear();
          this.link?.send({ mt: 5, subs });
        },
        frame: (m) => this.onFrame(m),
        closed: () => true, // always reconnect; market-data needs no keep-alive pings
      });
    });
  }

  onTrade(cb: (t: TapeTrade) => void): void {
    this.tradeCbs.push(cb);
  }

  stop(): void {
    this.link?.stop();
    this.link = null;
  }

  specs(): Partial<Record<MarketSym, MarketSpec>> {
    const out: Partial<Record<MarketSym, MarketSpec>> = {};
    for (const m of this.ctx?.byId.values() ?? []) out[m.spec.sym] = m.spec;
    return out;
  }

  snapshot(sym: MarketSym): MarketSnapshot | null {
    const m = this.ctx?.markets[sym];
    const st = m && this.states.get(m.id);
    const book = m && this.books.get(m.id);
    if (!m || !st || !book) return null;
    // Sorts the whole side on every read (a few hundred levels); keep a sorted array if this shows up in a profile.
    const top = (side: Levels, dir: 1 | -1): BookLevel[] =>
      [...side].sort((a, b) => dir * (a[0] - b[0])).slice(0, DEPTH).map(([p, s]) => ({ price: p / m.px, size: s / m.sz }));
    const bids = top(book.bid, -1);
    const asks = top(book.ask, 1);
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    return {
      sym,
      mark: st.mrk / m.px,
      oracle: st.orl / m.px,
      mid: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
      bestBid,
      bestAsk,
      bids,
      asks,
      fundingRate: (this.funding.get(m.id) ?? 0) / 1e6,
      openInterest: st.oi / m.sz,
      // Heartbeats arrive every block and cover every market, so one receive clock serves all three.
      updatedAt: this.lastFrameAt,
    };
  }

  /** Perpl serves 60, 300, 900, 3600, 14400 and 86400-second candles, each aligned to UTC. */
  async candles(sym: MarketSym, fromMs: number, toMs: number, resSec = 60): Promise<Candle[]> {
    const m = this.ctx?.markets[sym];
    if (!m) return [];
    const step = resSec * 1000;
    const out: Candle[] = [];
    for (let from = Math.floor(fromMs / step) * step; from < toMs; from += MAX_CANDLES * step) {
      const to = Math.min(toMs, from + (MAX_CANDLES - 1) * step);
      const res = (await getJson(`${this.cfg.apiUrl}/v1/market-data/${m.id}/candles/${resSec}/${from}-${to}`)) as { d?: { t: number; o: number; h: number; l: number; c: number; v?: string }[] };
      for (const k of res.d ?? []) {
        // `v` is the sum of wire price x wire size (checked against single-trade candles), so it scales by px * sz.
        if (k.t >= fromMs && k.t < toMs) out.push({ t: k.t, o: k.o / m.px, h: k.h / m.px, l: k.l / m.px, c: k.c / m.px, v: Number(k.v ?? 0) / (m.px * m.sz) });
      }
    }
    return out;
  }

  private onFrame(m: any): void {
    this.lastFrameAt = Date.now();
    const tracked = this.ctx!.byId;
    switch (m.mt) {
      case 6: // SubscriptionResponse: failures are per stream, the socket stays open
        for (const s of m.subs ?? []) {
          if (s.status?.code) console.warn(`[perpl] subscribe ${s.stream} failed: ${s.status.code} ${s.status.error ?? ''}`);
          else if (s.stream.startsWith('order-book@')) this.bookSids.set(s.sid, Number(s.stream.slice('order-book@'.length)));
          else if (s.stream.startsWith('trades@')) this.tradeSids.set(s.sid, Number(s.stream.slice('trades@'.length)));
        }
        break;
      case 9: // MarketStateUpdate: only the markets that changed
        for (const [id, st] of Object.entries(m.d ?? {})) if (tracked.has(+id)) this.states.set(+id, st as WireState);
        break;
      case 10: // MarketFundingUpdate: a repeated `feb` restates the same rate, so last write wins
        for (const [id, f] of Object.entries(m.d ?? {})) if (tracked.has(+id)) this.funding.set(+id, (f as { rate: number }).rate);
        break;
      case 15: // L2BookSnapshot
      case 16: { // L2BookUpdate
        const id = this.bookSids.get(m.sid);
        if (id === undefined) break;
        let book = this.books.get(id);
        if (!book || m.mt === 15) this.books.set(id, (book = { bid: new Map(), ask: new Map() }));
        applyLevels(book.bid, m.bid);
        applyLevels(book.ask, m.ask);
        break;
      }
      case 100: // Heartbeat: the only stream with contiguous sequence numbers (one per block)
        if (this.lastSn !== null && m.sn !== this.lastSn + 1) {
          // A missed block may have carried book updates. Reconnecting resubscribes and brings fresh snapshots.
          this.lastSn = null;
          this.link?.bounce();
          return;
        }
        this.lastSn = m.sn;
        this.link?.ok();
        break;
      case 18: { // TradesUpdate: new prints only (the mt 17 snapshot is history and is skipped)
        const mk = tracked.get(this.tradeSids.get(m.sid) ?? -1);
        if (!mk) break;
        for (const t of m.d ?? []) {
          const trade: TapeTrade = { sym: mk.spec.sym, price: t.p / mk.px, size: t.s / mk.sz, side: t.sd === 1 ? 'buy' : 'sell', ts: this.lastFrameAt };
          for (const cb of this.tradeCbs) cb(trade);
        }
        break;
      }
    }
    if (this.onReady && [...tracked.keys()].every((id) => this.books.has(id) && this.states.has(id))) {
      this.onReady();
      this.onReady = null;
    }
  }
}

function applyLevels(side: Levels, levels: WireLevel[] | null | undefined): void {
  for (const l of levels ?? []) {
    if (l.o > 0 && l.s > 0) side.set(l.p, l.s);
    else side.delete(l.p); // `o: 0` (or zero size) removes the level
  }
}
