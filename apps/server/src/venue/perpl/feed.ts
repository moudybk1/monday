// Public market data: a few sockets, one subscription frame each, a local L2 book per
// market, and 1-minute candles over REST.

import { candleScale, type BookLevel, type MarketSpec, type MarketSym } from '@monday/core';
import type { Candle, MarketFeed, MarketSnapshot, TapeTrade } from '../types';
import type { PerplConfig } from './index';
import { getJson, type PerplContext, type PerplMarket } from './rest';
import { openLink, type Link } from './socket';

const DEPTH = 15;
const MAX_CANDLES = 1024; // documented per-call maximum
const START_TIMEOUT_MS = 10_000;
// A book that has not been restated this long after a (re)connect is asked for again. At most 6 subscribe frames a
// minute, inside Perpl's 10, and well before the runner's 30 s stale-data kill.
const RESUBSCRIBE_MS = 10_000;
// A socket may hold 16 subscriptions: the three chain-wide streams plus a book and trades for 6 markets is 15. Eleven
// markets take two sockets, each with its own heartbeat, so each can tell its own books are current.
const MARKETS_PER_SOCKET = 6;

/** One market-data socket and the markets it carries. */
interface Shard {
  ids: number[];
  subs: { stream: string; subscribe: true }[];
  link: Link | null;
  bookSids: Map<number, number>; // subscription id -> market id, on this socket
  tradeSids: Map<number, number>;
  lastSn: number | null;
  lastFrameAt: number;
  resubscribe?: ReturnType<typeof setTimeout>;
}

type Levels = Map<number, number>; // wire price -> wire size
interface WireLevel { p: number; s: number; o: number }
interface WireState { orl: number; mrk: number; oi: number }

export class PerplFeed implements MarketFeed {
  private ctx: PerplContext | null = null;
  private scales = new Map<number, { at: number; k: Promise<number> }>(); // market id -> candle volume calibration
  private shards: Shard[] = [];
  private shardOf = new Map<number, Shard>(); // market id -> its socket
  private tradeCbs: ((t: TapeTrade) => void)[] = [];
  private books = new Map<number, { bid: Levels; ask: Levels }>();
  private states = new Map<number, WireState>();
  private funding = new Map<number, number>(); // market id -> rate, micros
  // A book is only as fresh as its last snapshot on the current socket: heartbeats keep arriving after a failed
  // order-book subscription, so they cannot vouch for it. `staleSince` is when a market's book was last known good.
  private live = new Set<number>();
  private staleSince = new Map<number, number>();
  private onReady: (() => void) | null = null;

  constructor(private cfg: PerplConfig, private loadCtx: () => Promise<PerplContext>) {}

  async start(): Promise<void> {
    if (this.shards.length) return;
    const ctx = (this.ctx = await this.loadCtx());
    const ids = [...ctx.byId.keys()];
    const chain = [`market-state@${this.cfg.chainId}`, `funding@${this.cfg.chainId}`, `heartbeat@${this.cfg.chainId}`];
    for (let i = 0; i < ids.length; i += MARKETS_PER_SOCKET) {
      const part = ids.slice(i, i + MARKETS_PER_SOCKET);
      // One frame per socket: at most 15 of its 16 subscriptions, 1 of its 10 requests/min.
      const subs = [...chain, ...part.flatMap((id) => [`order-book@${id}`, `trades@${id}`])].map((stream) => ({ stream, subscribe: true as const }));
      const sh: Shard = { ids: part, subs, link: null, bookSids: new Map(), tradeSids: new Map(), lastSn: null, lastFrameAt: 0 };
      this.shards.push(sh);
      for (const id of part) this.shardOf.set(id, sh);
    }

    await new Promise<void>((resolve) => {
      // If the venue is unreachable the sockets keep retrying; snapshot() stays null until data arrives.
      const timer = setTimeout(resolve, START_TIMEOUT_MS);
      this.onReady = () => (clearTimeout(timer), resolve());
      for (const sh of this.shards) {
        sh.link = openLink(`${this.cfg.wsUrl}/ws/v1/market-data`, {
          open: () => this.onOpen(sh),
          frame: (m) => this.onFrame(sh, m),
          closed: () => true, // always reconnect; market-data needs no keep-alive pings
        });
      }
    });
  }

  onTrade(cb: (t: TapeTrade) => void): void {
    this.tradeCbs.push(cb);
  }

  stop(): void {
    for (const sh of this.shards) {
      clearTimeout(sh.resubscribe);
      sh.link?.stop();
    }
    this.shards = [];
    this.shardOf.clear();
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
      // Heartbeats arrive every block, so while the book is live the receive clock is its age; otherwise the last good time.
      updatedAt: this.live.has(m.id) ? this.shardOf.get(m.id)?.lastFrameAt ?? 0 : this.staleSince.get(m.id) ?? 0,
    };
  }

  /** Perpl serves 60, 300, 900, 3600, 14400 and 86400-second candles, each aligned to UTC. */
  async candles(sym: MarketSym, fromMs: number, toMs: number, resSec = 60): Promise<Candle[]> {
    const m = this.ctx?.markets[sym];
    if (!m) return [];
    const [cs, k] = await Promise.all([this.rawCandles(m, fromMs, toMs, resSec), this.volumeScale(m)]);
    return k === 1 ? cs : cs.map((c) => ({ ...c, v: (c.v ?? 0) / k }));
  }

  /**
   * Some markets' candle `v` runs a power of ten off Perpl's own 24h ticker (ETH: 10x), so it is calibrated against the
   * ticker the way the stats side does (candleScale). Refreshed every 10 minutes; a failed check keeps the last answer.
   */
  private volumeScale(m: PerplMarket): Promise<number> {
    const hit = this.scales.get(m.id);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.k;
    const now = Date.now();
    const k = Promise.all([
      this.rawCandles(m, now - 86_400_000, now, 3600),
      getJson(`${this.cfg.apiUrl}/v1/market-data/ticker`) as Promise<{ d?: Record<string, { dva?: string }> }>,
    ]).then(([cs, t]) => candleScale(cs.reduce((s, c) => s + (c.v ?? 0), 0), Number(t.d?.[m.id]?.dva ?? 0) / (this.ctx?.usd ?? 1)))
      .catch(() => hit?.k ?? 1);
    this.scales.set(m.id, { at: now, k });
    return k;
  }

  private async rawCandles(m: PerplMarket, fromMs: number, toMs: number, resSec: number): Promise<Candle[]> {
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

  private onOpen(sh: Shard): void {
    sh.lastSn = null;
    sh.bookSids.clear();
    sh.tradeSids.clear();
    // Every book on this socket is stale until it restates it: since its last frame on the old socket, or since now if
    // it never had one. A market already stale keeps its earlier time.
    const now = Date.now();
    for (const id of sh.ids) {
      if (!this.staleSince.has(id)) this.staleSince.set(id, this.live.has(id) ? sh.lastFrameAt : now);
      this.live.delete(id);
    }
    sh.link?.send({ mt: 5, subs: sh.subs });
    clearTimeout(sh.resubscribe);
    sh.resubscribe = setTimeout(() => {
      if (sh.ids.some((id) => !this.live.has(id))) sh.link?.bounce(); // a stream failed or never answered
    }, RESUBSCRIBE_MS);
  }

  private onFrame(sh: Shard, m: any): void {
    sh.lastFrameAt = Date.now();
    const tracked = this.ctx!.byId;
    switch (m.mt) {
      case 6: // SubscriptionResponse: failures are per stream, the socket stays open
        for (const s of m.subs ?? []) {
          if (s.status?.code) console.warn(`[perpl] subscribe ${s.stream} failed: ${s.status.code} ${s.status.error ?? ''}`);
          else if (s.stream.startsWith('order-book@')) sh.bookSids.set(s.sid, Number(s.stream.slice('order-book@'.length)));
          else if (s.stream.startsWith('trades@')) sh.tradeSids.set(s.sid, Number(s.stream.slice('trades@'.length)));
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
        const id = sh.bookSids.get(m.sid);
        if (id === undefined) break;
        let book = this.books.get(id);
        if (!book || m.mt === 15) this.books.set(id, (book = { bid: new Map(), ask: new Map() }));
        applyLevels(book.bid, m.bid);
        applyLevels(book.ask, m.ask);
        if (m.mt === 15) {
          this.live.add(id);
          this.staleSince.delete(id);
        }
        break;
      }
      case 100: // Heartbeat: the only stream with contiguous sequence numbers (one per block)
        if (sh.lastSn !== null && m.sn !== sh.lastSn + 1) {
          // A missed block may have carried book updates. Reconnecting resubscribes and brings fresh snapshots.
          sh.lastSn = null;
          sh.link?.bounce();
          return;
        }
        sh.lastSn = m.sn;
        sh.link?.ok();
        break;
      case 18: { // TradesUpdate: new prints only (the mt 17 snapshot is history and is skipped)
        const mk = tracked.get(sh.tradeSids.get(m.sid) ?? -1);
        if (!mk) break;
        for (const t of m.d ?? []) {
          const trade: TapeTrade = { sym: mk.spec.sym, price: t.p / mk.px, size: t.s / mk.sz, side: t.sd === 1 ? 'buy' : 'sell', ts: sh.lastFrameAt };
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
