// Trading for one Perpl account over /ws/v1/trading: Ed25519 sign-in, order
// requests (mt 22) correlated by `sn` -> mt 3 and `rq` -> mt 24, and local
// state rebuilt from the wallet / orders / positions snapshots on every connect.

import { createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';
import { MARKETS, type MarketSym, type QuoteTarget, type Side } from '@monday/core';
import { VenueError, type Venue, type VenueAccount, type VenueCredentials, type VenueEvents, type VenueFill, type VenuePosition } from '../types';
import type { PerplConfig } from './index';
import type { PerplContext, PerplMarket } from './rest';
import { openLink, type Link } from './socket';

// OrderType
const OPEN_LONG = 1, OPEN_SHORT = 2, CLOSE_LONG = 3, CLOSE_SHORT = 4, CANCEL = 5, CHANGE = 7;
// OrderFlags
const POST_ONLY = 1, IOC = 4;
// OrderStatus
const PENDING = 1, OPEN = 2, PARTIALLY_FILLED = 3, FILLED = 4, CANCELED = 5, EXPIRED = 6, FAILED = 7, UNTRIGGERED = 8;
// OrderStatusReason values this adapter acts on
const SR_CROSSES_BOOK = 13, SR_ORDER_CHANGED = 31, SR_DESC_ID_TOO_LOW = 32;
const SR_ORDER_GONE = [21 /* InvalidOrderId */, 33 /* OrderDoesNotExist */, 50 /* WrongAccountForOrder: the id was recycled */];

const SR_NAMES: Record<number, string> = {
  1: 'AmountExceedsAvailableBalance', 2: 'AccountFrozen', 4: 'CantChangeCloseOrder', 13: 'CrossesBook', 14: 'ExceedsLastExecutionBlock',
  15: 'ForwardingReverted', 24: 'MaximumAccountOrders', 32: 'OrderDescIdTooLow', 34: 'OrderForwardingNotAllowed (enable One-Click Trading)',
  36: 'OrderPostFailed', 39: 'PostOrderUnderMinimum', 40: 'PriceOutOfRange', 42: 'SizeOutOfRange', 44: 'TakerOrderSettlementFailed',
};
const FR_NAMES: Record<number, string> = {
  1: 'InsufficientBalance', 2: 'InsufficientCollateralIncrease', 3: 'InsufficientCollateralInvert', 4: 'NoPositionToClose',
  6: 'NegativePositionValue', 7: 'ReferencePriceStale', 8: 'ExceedsMaxNegPnlCollat',
};

const SIGN_IN_TIMEOUT_MS = 15_000;
const SNAPSHOT_GRACE_MS = 2_000;
const PING_MS = 30_000;
const PROBE_OID = 0xffff_ffff; // an order id that does not exist; the probe is refused on `lb` before it matters

// ---- signing ----

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The secret is the 32-byte Ed25519 private key (hex, as Perpl hands it out); base64 and PEM are accepted too. */
export function parseSecret(secret: string): KeyObject {
  const s = secret.trim();
  try {
    if (s.startsWith('-----BEGIN')) return createPrivateKey(s);
    const hex = s.replace(/^0x/i, '');
    const raw = /^(?:[0-9a-f]{64}|[0-9a-f]{128})$/i.test(hex) ? Buffer.from(hex, 'hex') : Buffer.from(s, 'base64url');
    if (raw.length !== 32 && raw.length !== 64) throw new Error('length'); // 64 = seed || public key
    return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  } catch {
    throw new VenueError('bad_signature', 'API secret is not an Ed25519 private key (expected the 32-byte key in hex)');
  }
}

/** ApiKeySignIn (mt 29): Ed25519 over `<chain_id>\ntrading-ws-signin\n<timestamp_ms>\n<nonce>`, base64url without padding. */
export function signInFrame(chainId: number, token: string, key: KeyObject, now = Date.now()) {
  const timestamp = String(now);
  const nonce = randomBytes(16).toString('base64url');
  const canonical = [chainId, 'trading-ws-signin', timestamp, nonce].join('\n');
  return { mt: 29, chain_id: chainId, api_key: token, timestamp, nonce, signature: sign(null, Buffer.from(canonical), key).toString('base64url') };
}

// ---- venue ----

interface Resting { mkt: number; oid: number; p: number; left: number } // wire units
interface OrderReq { mkt: number; t: number; s: number; fl: number; lv: number; oid?: number; p?: number; lp?: number; lb?: number }
interface Pending {
  req: OrderReq;
  slot?: string; // the quote slot this request fills
  rq: number;
  sn: number;
  lb: number;
  retried: boolean;
  resolve: () => void;
  reject: (e: VenueError) => void;
}

const FLAT: VenuePosition = { size: 0, entryPrice: 0 };

export class PerplVenue implements Venue {
  private ctx: PerplContext | null = null;
  private link: Link | null = null;
  private boot: { resolve: () => void; reject: (e: VenueError) => void } | null = null;
  private ready = false; // signed in and all three snapshots applied
  private wasReady = false; // this key has had a good session before
  private snaps = 0; // snapshots seen on this socket: wallet 1 | orders 2 | positions 4
  private snapGrace?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;

  private scopeOk = true;
  private forwarding = false; // Account.fw, "One-Click Trading"
  private frozen = false;
  private freeUsd = 0; // Account.b
  private rq = 0; // last request id used; kept >= Account.lfr
  private sn = 0; // outbound frame counter, never 0 on the wire
  private head = 0; // latest Heartbeat.h
  private hbSn: number | null = null;

  private orders = new Map<string, Resting>(); // `${mkt}:${oid}` -> every open order of the account in a tracked market
  private slots = new Map<string, string>(); // `${mkt}:${side}` -> key of the order that is our quote
  private strays: string[] = [];
  private positions = new Map<number, any>(); // pid -> wire Position (all markets: their collateral is part of the balance)
  private basis: Partial<Record<MarketSym, VenuePosition>> = {}; // average-cost basis for per-fill realised PnL
  private pending = new Map<number, Pending>(); // by rq
  private acks = new Map<number, Pending>(); // by sn, until the mt 3 arrives
  private queue = new Map<string, Promise<void>>(); // one quote request in flight per slot
  private seenFills = new Set<string>();
  private mine = new Set<string>(); // `${mkt}:${oid}` of orders Monday placed or adopted as its quotes; fills of any other order are external
  private sent = 0; // frames that spend the rate limit: order requests (retries included) and keep-alive pings
  private handlers: { [E in keyof VenueEvents]: VenueEvents[E][] } = { fill: [], error: [] };

  constructor(private cfg: PerplConfig, private loadCtx: () => Promise<PerplContext>, private creds: VenueCredentials) {}

  // ---- Venue ----

  async connect(): Promise<VenueAccount> {
    if (this.link) return this.account();
    const key = parseSecret(this.creds.secret);
    try {
      this.ctx = await this.loadCtx();
    } catch (e) {
      throw new VenueError('disconnected', `Perpl context unavailable: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.failBoot(new VenueError('disconnected', 'Perpl sign-in timed out')), SIGN_IN_TIMEOUT_MS);
      this.boot = { resolve: () => (clearTimeout(timer), resolve()), reject: (e) => (clearTimeout(timer), reject(e)) };
      this.link = openLink(`${this.cfg.wsUrl}/ws/v1/trading`, {
        open: () => {
          this.snaps = 0;
          this.hbSn = null;
          // First frame, sent at once (idle window: 10 s testnet, 5 s mainnet). Fresh timestamp + nonce on every connect.
          this.link?.send(signInFrame(this.cfg.chainId, this.creds.token, key));
        },
        frame: (m) => this.onFrame(m),
        closed: (code, reason) => this.onClosed(code, reason),
      });
    });
    await this.probeScope();
    return this.account();
  }

  close(): void {
    this.ready = false;
    this.snaps = 0;
    clearInterval(this.ping);
    clearTimeout(this.snapGrace);
    this.ping = undefined;
    this.link?.stop();
    this.link = null;
    this.failPending(new VenueError('disconnected', 'venue closed'));
  }

  connected(): boolean {
    return this.ready;
  }

  account(): VenueAccount {
    // Perpl moves margin out of the account balance into each position's collateral. Adding it back gives a
    // cash balance that only moves with realised PnL, fees and funding, which is what callers add unrealised PnL to.
    let inPositions = 0;
    for (const p of this.positions.values()) inPositions += Number(p.c ?? 0);
    return {
      accountId: this.creds.accountId,
      balanceUsd: this.freeUsd + inPositions / (this.ctx?.usd ?? 1),
      canTrade: this.scopeOk && this.forwarding && !this.frozen,
    };
  }

  position(sym: MarketSym): VenuePosition {
    const m = this.ctx?.markets[sym];
    if (m) {
      for (const p of this.positions.values()) {
        // `epr` is the Q16 fractional residue of the entry price.
        if (p.mkt === m.id) return { size: ((p.sd === 1 ? 1 : -1) * p.s) / m.sz, entryPrice: (p.ep + (p.epr ?? 0) / 65536) / m.px };
      }
    }
    return { ...FLAT };
  }

  quote(sym: MarketSym, side: Side): QuoteTarget | null {
    const m = this.ctx?.markets[sym];
    const o = m && this.resting(`${m.id}:${side}`);
    return m && o ? { price: o.p / m.px, size: o.left / m.sz } : null;
  }

  setQuote(sym: MarketSym, side: Side, target: QuoteTarget | null, leverage: number): Promise<void> {
    const m = this.ctx?.markets[sym];
    if (!m) return Promise.reject(new VenueError(this.ctx ? 'rejected' : 'disconnected', `${sym} is not tradable on this venue`));
    const slot = `${m.id}:${side}`;
    // Serialise per slot: a second Open sent before the first one's order id is known would leave two quotes resting.
    const run = (this.queue.get(slot) ?? Promise.resolve()).catch(() => {}).then(() => this.applyQuote(m, side, slot, target, leverage));
    this.queue.set(slot, run);
    return run;
  }

  async cancelAll(onlyOwn = false): Promise<void> {
    this.requireReady();
    await Promise.allSettled(this.queue.values()); // let in-flight quotes land first so nothing posts behind the sweep
    // Monday's own: every order it placed or adopted, and whatever rests in a quote slot now (`mine` forgets its oldest).
    const own = new Set([...this.mine, ...this.slots.values()]);
    await allOrThrow([...this.orders.keys()].filter((key) => !onlyOwn || own.has(key)).map((key) => this.cancel(key)));
  }

  async flatten(): Promise<void> {
    this.requireReady();
    // Close* orders are reduce-only and clamped to the position size. p: 0 + IOC is a market order, bounded by the
    // market's default slippage (order_max_market_slippage_bps) because `ms` is omitted.
    await allOrThrow(this.openPositions().map((p) =>
      this.request({ mkt: p.mkt, t: p.sd === 1 ? CLOSE_LONG : CLOSE_SHORT, p: 0, s: p.s, fl: IOC, lv: 0, lp: p.pid })));
    // An IOC close "succeeds" even when a thin book fills it partly or not at all, and the position update can
    // trail the order status by a frame. Give it a moment, then say so rather than report flat.
    for (let i = 0; i < 20 && this.openPositions().length; i++) await new Promise((r) => setTimeout(r, 100));
    const left = this.openPositions().length;
    if (left) throw new VenueError('rejected', `${left} position(s) still open after the IOC close`);
  }

  on<E extends keyof VenueEvents>(event: E, cb: VenueEvents[E]): void {
    this.handlers[event].push(cb);
  }

  requests(): number {
    return this.sent;
  }

  // ---- quotes and requests ----

  private applyQuote(m: PerplMarket, side: Side, slot: string, target: QuoteTarget | null, leverage: number): Promise<void> {
    if (!this.ready) return Promise.reject(new VenueError('disconnected', 'trading socket is down'));
    const cur = this.resting(slot);
    if (!target) return cur ? this.request({ mkt: m.id, t: CANCEL, oid: cur.oid, s: 0, fl: 0, lv: 0 }) : Promise.resolve();
    const p = Math.round(target.price * m.px);
    const s = Math.round(target.size * m.sz);
    const lv = Math.round(leverage * 100); // hundredths
    if (!(p > 0 && s > 0 && lv > 0)) return Promise.reject(new VenueError('rejected', `invalid quote ${target.size} @ ${target.price}, ${leverage}x`));
    // Open* orders net against an opposite position (decrease, close, invert), so a quote is always an Open:
    // bid = OpenLong, ask = OpenShort. Close* orders are reduce-only and cannot be amended with Change (sr 4).
    if (!cur) return this.request({ mkt: m.id, t: side === 'bid' ? OPEN_LONG : OPEN_SHORT, p, s, fl: POST_ONLY, lv }, slot);
    if (cur.p === p && cur.left === s) return Promise.resolve();
    return this.request({ mkt: m.id, t: CHANGE, oid: cur.oid, p, s, fl: POST_ONLY, lv }, slot);
  }

  /** Positions in the markets Monday trades. Anything the user holds elsewhere on the account is left alone. */
  private openPositions(): any[] {
    return [...this.positions.values()].filter((p) => this.ctx?.byId.has(p.mkt));
  }

  private resting(slot: string): Resting | undefined {
    const key = this.slots.get(slot);
    return key ? this.orders.get(key) : undefined;
  }

  private cancel(key: string): Promise<void> {
    const o = this.orders.get(key);
    return o ? this.request({ mkt: o.mkt, t: CANCEL, oid: o.oid, s: 0, fl: 0, lv: 0 }) : Promise.resolve();
  }

  private requireReady(): void {
    if (!this.ready) throw new VenueError('disconnected', 'trading socket is down');
  }

  private request(req: OrderReq, slot?: string): Promise<void> {
    if (!this.ready) return Promise.reject(new VenueError('disconnected', 'trading socket is down'));
    return new Promise((resolve, reject) => this.dispatch({ req, slot, rq: 0, sn: 0, lb: 0, retried: false, resolve, reject }));
  }

  private dispatch(p: Pending): void {
    p.rq = ++this.rq; // strictly increasing: max(local counter, account.lfr) + 1
    p.sn = ++this.sn; // unique and non-zero, echoed as `cid` on the mt 3
    // head < lb <= head + order_ttl_blocks. Before the first heartbeat, 0 lets the server apply the same ceiling.
    p.lb = p.req.lb ?? (this.head ? this.head + this.ttl(p.req.mkt) : 0);
    // Cancels and closes are the kill path: lb 0 lets Perpl apply its current TTL, so a TTL cut can never refuse them.
    const kill = p.req.t === CANCEL || p.req.t === CLOSE_LONG || p.req.t === CLOSE_SHORT;
    this.pending.set(p.rq, p);
    this.acks.set(p.sn, p);
    this.sent++;
    if (!this.link?.send({ mt: 22, sn: p.sn, rq: p.rq, acc: this.creds.accountId, ...p.req, lb: p.req.lb ?? (kill ? 0 : p.lb) })) {
      this.finish(p, new VenueError('disconnected', 'trading socket is down'));
    }
  }

  private ttl(mkt: number): number {
    return this.ctx!.byId.get(mkt)!.ttlBlocks; // requests only ever name a tracked market
  }

  private finish(p: Pending, err?: VenueError): void {
    this.pending.delete(p.rq);
    this.acks.delete(p.sn);
    if (err) p.reject(err);
    else p.resolve();
  }

  private failPending(err: VenueError): void {
    for (const p of [...this.pending.values()]) this.finish(p, err);
  }

  /**
   * A read-scoped key signs in and receives snapshots exactly like a trade key; the only documented scope signal
   * is a 403 on the mt 3 of an order. So send one cancel the gateway has to refuse before forwarding (its last
   * execution block is long past): a trade key gets 400, a read key 403. Nothing reaches the chain either way.
   */
  private async probeScope(): Promise<void> {
    const mkt = this.ctx!.byId.keys().next().value;
    if (mkt === undefined) return;
    try {
      await this.request({ mkt, t: CANCEL, oid: PROBE_OID, s: 0, fl: 0, lv: 0, lb: 1 });
    } catch (e) {
      if (e instanceof VenueError && e.code === 'rejected') return; // the expected 400
      this.close();
      throw e;
    }
  }

  // ---- inbound frames ----

  private onFrame(m: any): void {
    switch (m.mt) {
      case 3: this.onAck(m); break;
      case 19: this.onWallet(m); break;
      case 21: if (m.id === this.creds.accountId) this.onAccount(m); break;
      case 23:
        this.resetOrders();
        for (const o of m.d ?? []) this.onOrder(o, true);
        this.snaps |= 2;
        break;
      case 24: for (const o of m.d ?? []) this.onOrder(o, false); break;
      case 25: for (const f of m.d ?? []) this.onFill(f); break;
      case 26:
        this.resetPositions();
        for (const p of m.d ?? []) this.onPosition(p, true);
        this.reseedBasis();
        this.snaps |= 4;
        break;
      case 27: for (const p of m.d ?? []) this.onPosition(p, false); break;
      case 100: this.onHeartbeat(m); break;
    }
    if (!this.ready && this.snaps === 7 && this.link) this.onReady();
  }

  private onWallet(m: any): void {
    const acc = (m.as ?? []).find((a: any) => a.id === this.creds.accountId);
    if (!acc) {
      const owned = (m.as ?? []).map((a: any) => a.id).join(', ') || 'none';
      return this.fail(new VenueError('no_account', `API key's wallet ${m.addr ?? ''} does not own exchange account ${this.creds.accountId} (it owns: ${owned})`));
    }
    this.onAccount(acc);
    // Heartbeats continue from the wallet snapshot's sequence number.
    this.hbSn = Math.max(this.hbSn ?? 0, m.sn ?? 0) || null;
    this.snaps |= 1;
    // The docs promise orders and positions snapshots next. If an empty one is ever skipped, do not hang sign-in on it.
    clearTimeout(this.snapGrace);
    this.snapGrace = setTimeout(() => {
      if (this.ready || !this.link || !(this.snaps & 1)) return;
      if (!(this.snaps & 2)) this.resetOrders();
      if (!(this.snaps & 4)) (this.resetPositions(), this.reseedBasis());
      this.snaps = 7;
      this.onReady();
    }, SNAPSHOT_GRACE_MS);
  }

  private onAccount(a: any): void {
    this.rq = Math.max(this.rq, a.lfr ?? 0);
    if (a.b != null) this.freeUsd = Number(a.b) / this.ctx!.usd;
    // fw can be toggled from any client of the wallet at any time, so it is re-read on every update.
    this.forwarding = !!a.fw;
    this.frozen = !!a.fr;
  }

  private onReady(): void {
    clearTimeout(this.snapGrace);
    this.ready = true;
    this.wasReady = true;
    this.ping ??= setInterval(() => {
      if (this.link?.send({ mt: 1, t: Date.now() })) this.sent++;
    }, PING_MS);
    // More than one plain order on a side cannot all be "the" quote: keep the first, cancel the rest.
    for (const key of this.strays.splice(0)) void this.cancel(key).catch(() => {});
    this.boot?.resolve();
    this.boot = null;
  }

  private onHeartbeat(m: any): void {
    if (this.hbSn !== null && m.sn !== this.hbSn + 1) return void this.link?.bounce(); // missed a block: resync from snapshots
    this.hbSn = m.sn;
    this.head = m.h ?? this.head;
    if (!this.ready) return;
    this.link?.ok();
    for (const p of [...this.pending.values()]) {
      if (!p.lb) p.lb = this.head + this.ttl(p.req.mkt); // sent with lb 0: the server's window cannot outlast this
      // Past the last execution block with no status and no reconnect in between: the request is dead.
      // The caller's next setQuote goes out under a new rq, as the retry rules require.
      else if (this.head > p.lb + 2) this.finish(p, new VenueError('rejected', 'no order status before the last execution block'));
    }
  }

  private onAck(m: any): void {
    const p = this.acks.get(m.cid);
    if (!p) return;
    this.acks.delete(m.cid);
    const code = m.status?.code ?? 0;
    if (code === 0) return; // accepted for forwarding only; the outcome arrives on mt 24
    if (code === 403) this.scopeOk = false;
    // Non-zero: refused at the gateway, no mt 24 will follow.
    this.finish(p, new VenueError(code === 403 ? 'read_only_key' : 'rejected', `Perpl gateway refused the order (${code}): ${m.status?.error ?? ''}`));
  }

  private onOrder(o: any, snapshot: boolean): void {
    if (o.acc !== this.creds.accountId || !this.ctx?.byId.has(o.mkt)) return; // other accounts and markets are not ours to touch
    const key = `${o.mkt}:${o.oid}`;
    const gone = o.r === true || o.st === FILLED || o.st === CANCELED || o.st === EXPIRED;
    const p = snapshot ? undefined : this.pending.get(o.rq) ?? this.pendingOn(o, gone);
    if (p && o.oid) this.remember(key);
    if (gone) this.drop(key);
    else if (o.oid && (snapshot || o.st === OPEN || o.st === PARTIALLY_FILLED || o.st === UNTRIGGERED)) this.track(key, o, p);
    if (p) this.settle(p, o);
  }

  /** Fallback when an update does not echo our `rq`: a cancel is done once its order is gone, a change once it reports OrderChanged. */
  private pendingOn(o: any, gone: boolean): Pending | undefined {
    for (const p of this.pending.values()) {
      if (p.req.oid !== o.oid || p.req.mkt !== o.mkt) continue;
      if ((p.req.t === CANCEL && gone) || (p.req.t === CHANGE && o.sr === SR_ORDER_CHANGED)) return p;
    }
    return undefined;
  }

  private track(key: string, o: any, p?: Pending): void {
    const known = this.orders.has(key);
    this.orders.set(key, { mkt: o.mkt, oid: o.oid, p: o.p ?? 0, left: (o.os ?? 0) - (o.fs ?? 0) });
    if (known) return;
    // Only a plain Open-type limit order can be a quote. Close and trigger orders stay tracked (cancelAll
    // sweeps them) but are never adopted.
    const side = o.tp ? null : o.t === OPEN_LONG ? 'bid' : o.t === OPEN_SHORT ? 'ask' : null;
    const slot = p?.slot ?? (side ? `${o.mkt}:${side}` : null);
    if (!slot) return;
    if (p?.slot || !this.slots.has(slot)) {
      this.slots.set(slot, key); // our own request's order, or adoption of an existing one
      this.remember(key);
    } else if (this.ready) void this.cancel(key).catch(() => {}); // a late lander from before a reconnect
    else this.strays.push(key);
  }

  private remember(key: string): void {
    this.mine.add(key);
    if (this.mine.size > 5_000) for (const k of [...this.mine].slice(0, 1_000)) this.mine.delete(k); // oldest first
  }

  private drop(key: string): void {
    this.orders.delete(key);
    for (const [slot, k] of this.slots) if (k === key) this.slots.delete(slot);
  }

  /** Deduplication per the docs: Pending is not a verdict, the first non-failure status is definitive, else the first failure. */
  private settle(p: Pending, o: any): void {
    if (o.st === PENDING) return;
    if (o.st !== FAILED && o.st !== EXPIRED) return this.finish(p); // finish() forgets the rq, so later updates are ignored
    if (o.sr === SR_DESC_ID_TOO_LOW && !p.retried) {
      // Another client of this account moved lfr past us: retry once under a fresh rq.
      p.retried = true;
      this.pending.delete(p.rq);
      this.acks.delete(p.sn);
      return this.dispatch(p);
    }
    if (p.req.oid && SR_ORDER_GONE.includes(o.sr)) {
      // The quote was filled or cancelled under us. The slot is empty, which a cancel wanted anyway and which the
      // caller's next setQuote repairs with a fresh Open; counting it as an order failure would be wrong.
      this.drop(`${p.req.mkt}:${p.req.oid}`);
      return this.finish(p);
    }
    const why = `${SR_NAMES[o.sr] ?? `sr ${o.sr}`}${o.fr ? ` / ${FR_NAMES[o.fr] ?? `fr ${o.fr}`}` : ''}`;
    this.finish(p, new VenueError(o.sr === SR_CROSSES_BOOK ? 'crosses_book' : 'rejected', `Perpl order failed: ${why}`));
  }

  private onFill(f: any): void {
    if (f.acc !== this.creds.accountId) return;
    const m = this.ctx?.byId.get(f.mkt);
    const side: Side | null = f.t === OPEN_LONG || f.t === CLOSE_SHORT ? 'bid' : f.t === OPEN_SHORT || f.t === CLOSE_LONG ? 'ask' : null;
    if (!m || !side) return;
    const id = `perpl:${this.creds.accountId}:${f.at?.txid ?? f.at?.b}:${f.at?.l ?? 0}:${f.oid}`;
    if (this.seenFills.has(id)) return;
    if (this.seenFills.size > 10_000) this.seenFills.clear(); // Coarse bound; a replay would have to span 10k fills to slip through
    this.seenFills.add(id);
    const price = (f.p ?? 0) / m.px;
    const size = f.s / m.sz;
    this.emit('fill', {
      id,
      sym: m.spec.sym,
      side,
      price,
      size,
      feeUsd: Number(f.f ?? 0) / this.ctx!.usd, // gross (protocol + builder); negative is a rebate
      realizedUsd: this.realize(m, side === 'bid' ? size : -size, price),
      isMaker: f.l === 1,
      ts: f.at?.t ?? Date.now(),
      external: !this.mine.has(`${f.mkt}:${f.oid}`),
    });
  }

  /**
   * Fill frames carry no PnL (Perpl reports it only on position events, in a separate message with no documented
   * ordering), so realised PnL is computed here: average cost against a basis seeded from the positions snapshot
   * and advanced by fills alone, which makes it independent of whether mt 25 or mt 27 arrives first.
   * Drifts if a position changes without a fill (liquidation, ADL) until the next reconnect reseeds it.
   */
  private realize(m: PerplMarket, q: number, price: number): number {
    const b = this.basis[m.spec.sym] ?? FLAT;
    const closed = b.size * q < 0 ? Math.min(Math.abs(b.size), Math.abs(q)) : 0;
    const size = Math.round((b.size + q) * m.sz) / m.sz;
    let entryPrice = b.entryPrice;
    if (size === 0) entryPrice = 0;
    else if (b.size * size <= 0) entryPrice = price; // opened from flat, or inverted through it
    else if (!closed) entryPrice = (b.entryPrice * Math.abs(b.size) + price * Math.abs(q)) / Math.abs(size); // increased
    this.basis[m.spec.sym] = { size, entryPrice };
    return closed * (price - b.entryPrice) * Math.sign(b.size);
  }

  private onPosition(p: any, snapshot: boolean): void {
    if (p.acc !== this.creds.accountId) return;
    // Keyed by position id: an inversion closes one id and opens another in the same update, in either order.
    if (p.s > 0 && (snapshot || p.st === 1)) this.positions.set(p.pid, p);
    else this.positions.delete(p.pid);
  }

  private resetOrders(): void {
    this.orders.clear();
    this.slots.clear();
    this.strays = [];
  }

  private resetPositions(): void {
    this.positions.clear();
  }

  private reseedBasis(): void {
    for (const sym of MARKETS) this.basis[sym] = this.position(sym);
  }

  // ---- connection lifecycle ----

  private onClosed(code: number, reason: string): boolean {
    const live = this.ready;
    this.ready = false;
    clearTimeout(this.snapGrace);
    const what = `trading socket closed (${code}${reason ? ` ${reason}` : ''})`;
    const down = new VenueError('disconnected', what);
    // A close carries no per-request status: whatever was in flight may or may not have landed.
    // The orders snapshot after reconnect is the truth.
    this.failPending(down);
    // 1008 is also "ping timeout", "idle timeout" and "too many connections": only "too many requests" is the rate limit.
    const err = code === 1008 && /too many requests/i.test(reason) ? new VenueError('rate_limited', what)
      : code === 1011 ? new VenueError('fatal', what)
      : code === 3401 ? new VenueError(this.wasReady ? 'revoked' : 'bad_signature', what)
      : down;
    if (this.boot) {
      this.failBoot(err); // connect() failed: stay down, the caller decides
      return false;
    }
    if (code === 3401 && live) {
      // A session that was good until now gets one fresh sign-in before the key is declared dead.
      this.emit('error', down);
      return true;
    }
    this.emit('error', err);
    if (err.code !== 'fatal' && err.code !== 'revoked') return true; // back off, sign in again, reconcile from snapshots
    this.close();
    return false;
  }

  private fail(err: VenueError): void {
    if (this.boot) return this.failBoot(err);
    this.close();
    this.emit('error', err);
  }

  private failBoot(err: VenueError): void {
    const boot = this.boot;
    this.boot = null;
    this.close();
    boot?.reject(err);
  }

  private emit<E extends keyof VenueEvents>(event: E, arg: Parameters<VenueEvents[E]>[0]): void {
    for (const cb of this.handlers[event]) {
      try {
        (cb as (a: typeof arg) => void)(arg);
      } catch (e) {
        console.error(`[perpl] ${event} listener failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
}

async function allOrThrow(requests: Promise<void>[]): Promise<void> {
  const failed = (await Promise.allSettled(requests)).find((r) => r.status === 'rejected');
  if (failed) throw (failed as PromiseRejectedResult).reason;
}
