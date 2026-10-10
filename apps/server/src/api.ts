// REST API and the dashboard WebSocket (PRD 15).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { getAddress, keccak256, toHex, verifyMessage } from 'viem';
import { generateSiweNonce, parseSiweMessage } from 'viem/siwe';
import { z } from 'zod';
import {
  MARKETS, MARKET_BIT, PRESETS, analyticsOf, balanceNeededUsd, canonicalJson, fitLimits, policyForHash, usd,
  type Analytics, type AppConfig, type DashboardState, type DecisionRecord, type MarketSym, type Me, type Policy,
} from '@monday/core';
import { agentAddress, anchorOf, chainEnabled, onchainPolicyHash } from './chain';
import { config } from './config';
import { db, seal, upsertUser } from './db';
import { evidence } from './evidence';
import { llmEnabled } from './governor';
import { registerStats } from './stats/routes';
import type { Runner } from './runner';
import type { SimWorld } from './venue/sim';
import { VenueError, type Candle, type VenueDriver } from './venue/types';

export interface ApiDeps {
  driver: VenueDriver;
  world: SimWorld | null;
  house: () => Runner | null;
  runnerFor: (userId: number) => Runner | null;
  dropRunner: (userId: number) => void;
  health: () => Record<string, unknown>;
}

/** What the cookie carries. The user id is resolved from the wallet on every request, never trusted from the cookie. */
interface Cookie {
  w: string;
  demo: boolean;
  exp: number;
}
interface Session extends Cookie {
  uid: number;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
  }
}

// ---- sessions: signed, httpOnly, SameSite=Strict cookie (PRD 17.4) ----
const COOKIE = 'monday_session';
/** The account a browser tab is showing, sent with every change it asks for. */
export const ACCOUNT_HEADER = 'x-monday-account';
const sign = (body: string) => createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
function encodeSession(s: Cookie): string {
  const body = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${body}.${sign(body)}`;
}
function decodeSession(raw: string | undefined): Cookie | null {
  if (!raw) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Cookie;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

const PolicyBody = z.object({
  preset: z.enum(['conservative', 'balanced', 'active', 'high', 'custom']),
  markets: z.array(z.enum(MARKETS)).min(1).max(3),
  limits: z.object({
    // $1 floors: any deposit can start. A quote below a market's size step simply does not post.
    quoteSizeUsd: z.number().min(1).max(5_000),
    maxInventoryUsd: z.number().min(1).max(50_000),
    minHalfSpreadBps: z.number().min(1).max(100),
    maxDailyLossUsd: z.number().min(1).max(10_000),
    maxLeverage: z.number().min(1).max(50),
  }).optional(),
});
const usdLimit = z.number().positive().max(1_000_000).nullable().optional();
/** How the forms name the fields a schema can reject, so a rejection points at the right box. */
const FIELD_LABELS: Record<string, string> = {
  'limits.quoteSizeUsd': 'Quote size', 'limits.maxInventoryUsd': 'Max inventory', 'limits.minHalfSpreadBps': 'Min half-spread', 'limits.maxDailyLossUsd': 'Daily loss limit', 'limits.maxLeverage': 'Max leverage',
  stopLossUsd: 'Session stop loss', takeProfitUsd: 'Take profit',
};
const StartBody = z.object({ stopLossUsd: usdLimit, takeProfitUsd: usdLimit });
const CredsBody = z.object({ apiKeyToken: z.string().trim().min(1).max(512), apiKeySecret: z.string().trim().min(1).max(512) });

const RES_SEC = [60, 300, 900, 3600, 14_400, 86_400];
const MAX_BARS = 1_000;
const MAX_SOCKETS = 1_000; // live dashboards at once; beyond this a viewer waits and reconnects
/** Merge candles into `spanMs` buckets aligned to UTC. A no-op on candles that already have that width. */
function rollUp(cs: Candle[], spanMs: number): Candle[] {
  const out: Candle[] = [];
  for (const k of cs) {
    const t = Math.floor(k.t / spanMs) * spanMs;
    const last = out[out.length - 1];
    if (last?.t !== t) out.push({ ...k, t });
    else Object.assign(last, { h: Math.max(last.h, k.h), l: Math.min(last.l, k.l), c: k.c, v: last.v == null && k.v == null ? undefined : (last.v ?? 0) + (k.v ?? 0) });
  }
  return out;
}

export async function buildApi(deps: ApiDeps) {
  const app = Fastify({ logger: { level: config.prod ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers.authorization', '*.secret', '*.token', '*.signature', '*.apikey', '*.apiKeySecret', '*.apiKeyToken'] } });
  await app.register(cookie);
  // Clients only ever send a one-line hello; anything bigger is not ours.
  await app.register(websocket, { options: { maxPayload: 4_096 } });

  const nonces = new Map<string, number>();
  /** Signed-in live streams by user, so signing out can end them. */
  const streams = new Map<number, Set<{ close(code?: number, reason?: string): void }>>();
  const tickets = new Map<string, { uid: number; exp: number }>();
  const hits = new Map<string, { n: number; at: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of nonces) if (exp < now) nonces.delete(k);
    for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
    for (const [k, h] of hits) if (now - h.at > 60_000) hits.delete(k);
  }, 30_000).unref();

  const need = (req: FastifyRequest): Session => {
    const s = decodeSession(req.cookies[COOKIE]);
    if (!s) throw new HttpError(401, 'unauthorized', 'Sign in with your wallet first.');
    return { ...s, uid: upsertUser(s.w) };
  };
  const setSession = (reply: FastifyReply, s: Omit<Cookie, 'exp'>) =>
    reply.setCookie(COOKIE, encodeSession({ ...s, exp: Date.now() + 7 * 86_400_000 }), { httpOnly: true, sameSite: 'strict', secure: config.webOrigin.startsWith('https:'), path: '/', maxAge: 7 * 86_400 });

  // 60 requests per minute per signed-in wallet, else per address (PRD 15.3). Public reads served from a shared cache are
  // exempt: their cost does not grow with viewers, and behind the web app's proxy every anonymous viewer has the proxy's
  // address, so counting them would let a handful of dashboard tabs lock everyone out, sign-in included.
  const CACHED_READS = /^\/api\/(stats\/(overview|risk|liquidations|traders)|public\/preview|config|health|evidence|candles)(\?|$)/;
  // Emergency controls are never rate limited: a dashboard's polling must not stand between a user and Stop or Kill.
  // Both are authenticated and idempotent (a second Kill or Stop does nothing).
  const EMERGENCY = /^\/api\/agent\/(kill|pause)(\?|$)/;
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const session = decodeSession(req.cookies[COOKIE]);
    // A tab still showing another account must not act on whoever is signed in now (another tab may have switched).
    // The web app names the account it shows on every change; the session still decides what the request may do.
    const shown = req.headers[ACCOUNT_HEADER];
    if (req.method !== 'GET' && !req.url.startsWith('/api/auth/') && typeof shown === 'string' && session && shown.toLowerCase() !== session.w.toLowerCase()) {
      throw new HttpError(409, 'account_changed', 'This tab shows a different account from the one now signed in. Reload the page to continue.');
    }
    if ((req.method === 'GET' && CACHED_READS.test(req.url)) || (req.method === 'POST' && EMERGENCY.test(req.url))) return;
    const key = session?.w ?? req.ip;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.at > 60_000) hits.set(key, { n: 1, at: now });
    else if (++h.n > 60) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, field: err.field });
    if (err instanceof z.ZodError) {
      const i = err.issues[0];
      const field = i?.path.join('.');
      const label = field && FIELD_LABELS[field];
      const message = !i ? 'Invalid request.'
        : label && i.code === 'too_small' ? `${label} must be ${i.inclusive === false ? 'more than' : 'at least'} ${i.minimum}.`
        : label && i.code === 'too_big' ? `${label} can be at most ${i.maximum}.`
        : label ? `${label}: ${i.message}` : i.message;
      return reply.status(400).send({ error: 'invalid_request', message, field });
    }
    if (err instanceof VenueError) return reply.status(400).send({ error: err.code, message: err.message });
    // Fastify's own client errors (malformed JSON, too large, wrong content type) are the client's, not ours.
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong on our side.' });
  });

  interface PolicyRow { json: string | null; policy_hash: string | null; onchain_tx: string | null; pending_json: string | null; pending_hash: string | null; version: number }
  const policyRow = (uid: number) => db.prepare('select * from policies where user_id = ?').get(uid) as PolicyRow | undefined;
  // Arguments for MondayRegistry.setPolicy, signed by the user's own wallet in the browser.
  const onchainArgs = (policy: Policy, policyHash: string) => (config.chain.registry ? {
    registry: config.chain.registry, agent: agentAddress,
    policy: {
      policyHash, marketsBitmap: policy.markets.reduce((b, m) => b | (1 << MARKET_BIT[m]), 0), maxInventoryUsd: Math.round(policy.maxInventoryUsd),
      maxDailyLossUsd: Math.round(policy.maxDailyLossUsd), maxLeverageX100: Math.round(policy.maxLeverage * 100), mode: 1, updatedAt: 0,
    },
  } : null);
  const policyView = (uid: number) => {
    const p = policyRow(uid);
    const pending = p?.pending_json ? (JSON.parse(p.pending_json) as Policy) : null;
    return {
      policy: p?.json ? (JSON.parse(p.json) as Policy) : null, policyHash: p?.policy_hash ?? null, onchainTx: p?.onchain_tx ?? null,
      pending: pending ? { policy: pending, policyHash: p!.pending_hash!, onchain: onchainArgs(pending, p!.pending_hash!) } : null,
    };
  };
  const credRow = (uid: number) => db.prepare('select account_id, status from perpl_credentials where user_id = ?').get(uid) as { account_id: number; status: string } | undefined;

  // ---- public ----
  app.get('/api/config', async (): Promise<AppConfig> => ({
    sim: deps.driver.kind === 'sim', paper: deps.driver.kind === 'paper', network: config.network, networkName: config.networkName, realFunds: config.realFunds, caps: config.caps,
    smartMoney: config.smartMoney, chainId: config.chain.chainId, registry: config.chain.registry || null,
    agentAddress: chainEnabled ? agentAddress : null, explorerUrl: config.chain.explorerUrl, perplAppUrl: config.perpl.appUrl,
    minDepositUsd: deps.driver.minDepositUsd(), llm: llmEnabled, specs: deps.driver.feed.specs(),
  }));
  app.get('/api/health', async () => deps.health());
  app.get('/api/evidence', async () => evidence() ?? { pending: true });
  app.get('/api/public/preview', async () => deps.house()?.state() ?? null);
  // Candles for the price chart, 1m to 1D. Cached for 30 s per market and resolution at the most bars anyone may ask for,
  // so any number of viewers costs Perpl one request per window and the cache holds at most 18 entries.
  const candleCache = new Map<string, { at: number; data: Promise<Candle[]> }>();
  app.get('/api/candles', async (req) => {
    const q = z.object({
      market: z.enum(MARKETS),
      res: z.coerce.number().int().refine((r) => RES_SEC.includes(r), 'res must be 60, 300, 900, 3600, 14400 or 86400').default(60),
      bars: z.coerce.number().int().min(30).max(MAX_BARS).default(500),
    }).parse(req.query);
    const key = `${q.market}:${q.res}`;
    const now = Date.now();
    let hit = candleCache.get(key);
    if (!hit || now - hit.at >= 30_000) {
      // The simulator only keeps minutes, so roll them up; Perpl's own candles are already aligned and pass through.
      const data = deps.driver.feed.candles(q.market, now - MAX_BARS * q.res * 1000, now, q.res).then((cs) => rollUp(cs, q.res * 1000));
      candleCache.set(key, (hit = { at: now, data }));
      data.catch(() => candleCache.delete(key));
    }
    return hit.data.then((cs) => cs.slice(-q.bars));
  });
  app.get('/api/decisions/:id', async (req): Promise<DecisionRecord> => {
    const id = Number((req.params as { id: string }).id);
    const r = db.prepare('select d.*, u.wallet from decisions d join users u on u.id = d.user_id where d.id = ?').get(id) as Record<string, never> | undefined;
    if (!r) throw new HttpError(404, 'not_found', 'No decision with that id.');
    return {
      id: r.id, at: r.at, market: r.market, source: r.source, regime: r.regime, params: JSON.parse(r.params), evidence: JSON.parse(r.evidence), reason: r.reason ?? '',
      paramsHash: r.params_hash, evidenceHash: r.evidence_hash, llmModel: r.llm_model, txHash: r.tx_hash, onchainId: r.onchain_id, wallet: r.wallet,
      anchor: anchorOf(id)?.status ?? (r.tx_hash ? 'confirmed' : chainEnabled ? 'pending' : 'off'),
    };
  });

  // ---- auth: Sign-In with Ethereum ----
  app.post('/api/auth/nonce', async () => {
    if (nonces.size >= 10_000) throw new HttpError(503, 'busy', 'Too many sign-ins in progress. Try again in a minute.');
    const nonce = generateSiweNonce();
    nonces.set(nonce, Date.now() + 10 * 60_000);
    return { nonce };
  });
  app.post('/api/auth/verify', async (req, reply) => {
    const { message, signature } = z.object({ message: z.string().max(2_000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(req.body);
    const m = parseSiweMessage(message);
    if (!m.address || !m.nonce || !nonces.delete(m.nonce)) throw new HttpError(400, 'bad_nonce', 'Sign-in expired. Try again.');
    if (m.domain !== new URL(config.webOrigin).host) throw new HttpError(400, 'bad_domain', 'This sign-in message was issued for another site.');
    if (m.chainId !== config.chain.chainId) throw new HttpError(400, 'bad_chain', `Switch your wallet to ${config.networkName} and sign in again.`);
    // EOA signatures only. Use publicClient.verifySiweMessage (ERC-1271/6492) when smart wallets matter.
    const ok = await verifyMessage({ address: m.address, message, signature: signature as `0x${string}` }).catch(() => false);
    if (!ok) throw new HttpError(401, 'bad_signature', 'Signature does not match the wallet.');
    const w = getAddress(m.address);
    setSession(reply, { w, demo: false });
    return { wallet: w };
  });
  app.post('/api/auth/demo', async (_req, reply) => {
    if (deps.driver.kind === 'perpl') throw new HttpError(403, 'demo_disabled', 'Demo accounts exist only when orders are simulated.');
    const w = getAddress(`0x${randomBytes(20).toString('hex')}`);
    setSession(reply, { w, demo: true });
    return { wallet: w };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    // Signed out means no more private data: end this account's live streams. A device still signed in reconnects.
    const s = decodeSession(req.cookies[COOKIE]);
    if (s) for (const socket of streams.get(upsertUser(s.w)) ?? []) socket.close(4401, 'signed out');
    return { ok: true };
  });

  // ---- session ----
  app.get('/api/me', async (req): Promise<Me> => {
    const s = need(req);
    const c = credRow(s.uid);
    const p = policyRow(s.uid);
    const r = deps.runnerFor(s.uid);
    if (r) r.lastSeenAt = Date.now();
    return {
      wallet: s.w, demo: s.demo, accountId: c?.account_id ?? null, hasKey: c?.status === 'active', keyStatus: c?.status ?? null,
      policy: p?.json ? (JSON.parse(p.json) as Policy) : null, policyHash: p?.policy_hash ?? null, policyTx: p?.onchain_tx ?? null,
      policyPending: Boolean(p?.pending_json), status: r?.status ?? 'idle',
    };
  });

  app.get('/api/perpl/account', async (req) => {
    const s = need(req);
    const a = await deps.driver.detectAccount(s.w);
    return { exists: !!a, accountId: a?.accountId ?? null, balanceUsd: a?.balanceUsd ?? null, minDepositUsd: deps.driver.minDepositUsd(), depositUrl: config.perpl.appUrl };
  });

  app.post('/api/credentials', async (req) => {
    const s = need(req);
    const body = CredsBody.parse(req.body);
    const acct = await deps.driver.detectAccount(s.w);
    if (!acct) throw new HttpError(400, 'no_account', 'You need a Perpl account first. Deposit on Perpl to open one.');
    // Validate by actually signing in to the trading socket (FR-ONB-3, FR-ONB-4).
    const probe = deps.driver.open({ wallet: s.w, accountId: acct.accountId, token: body.apiKeyToken, secret: body.apiKeySecret });
    try {
      const a = await probe.connect();
      // Perpl only forwards orders for accounts that enabled One-Click Trading; without it every order fails.
      if (!a.canTrade) throw new HttpError(400, 'forwarding_off', 'One-Click Trading is off for this account. Turn it on in Perpl settings, then validate the key again.');
    } finally {
      probe.close();
    }
    const sealed = seal(JSON.stringify({ token: body.apiKeyToken, secret: body.apiKeySecret }));
    // A new key while quoting: pull the old session's orders first, or they would rest with nobody watching them.
    await deps.runnerFor(s.uid)?.pause();
    deps.dropRunner(s.uid);
    db.prepare('insert or replace into perpl_credentials (user_id, chain_id, account_id, enc, iv, tag, status, created_at) values (?,?,?,?,?,?,?,?)')
      .run(s.uid, config.perpl.chainId, acct.accountId, sealed.enc, sealed.iv, sealed.tag, 'active', Date.now());
    void deps.runnerFor(s.uid)?.resumeCleanup(); // whatever the old key could not cancel, the new one does
    return { accountId: acct.accountId, balanceUsd: acct.balanceUsd, tradeScope: true };
  });
  app.delete('/api/credentials', async (req) => {
    const s = need(req);
    const r = deps.runnerFor(s.uid);
    await r?.pause();
    // Without the key nothing could ever cancel what is still resting. A revoked key cannot anyway, so it may go.
    if (r?.owes && db.prepare("select 1 from perpl_credentials where user_id = ? and status = 'active'").get(s.uid)) {
      throw new HttpError(409, 'cleanup_pending', 'Monday is still cancelling your orders on Perpl. Try again in a few seconds, or cancel them on Perpl first.');
    }
    deps.dropRunner(s.uid);
    db.prepare('delete from perpl_credentials where user_id = ?').run(s.uid);
    db.prepare("update agents set status = 'idle' where user_id = ?").run(s.uid);
    return { ok: true };
  });

  app.get('/api/policy', async (req) => policyView(need(req).uid));
  app.put('/api/policy', async (req) => {
    const s = need(req);
    const body = PolicyBody.parse(req.body);
    const markets = MARKETS.filter((m) => body.markets.includes(m));
    const acct = await deps.driver.detectAccount(s.w);
    const balance = acct?.balanceUsd ?? 0;
    // A preset shrinks to what the account and the operator caps allow; custom limits are taken as typed.
    const limits = body.preset === 'custom' ? body.limits : fitLimits(PRESETS[body.preset], balance, markets.length, config.caps);
    if (!limits) throw new HttpError(400, 'invalid_request', 'Custom policies need limits.', 'limits');
    if (limits.quoteSizeUsd > limits.maxInventoryUsd) throw new HttpError(400, 'invalid_request', 'Quote size cannot exceed max inventory.', 'limits.quoteSizeUsd');
    // On real funds the operator's ceilings win over anything a user asks for.
    const caps = config.caps;
    if (caps) {
      const over = ([['quoteSizeUsd', 'Quote size'], ['maxInventoryUsd', 'Max inventory'], ['maxDailyLossUsd', 'Daily loss limit']] as const).find(([k]) => limits[k] > caps[k]);
      if (over) throw new HttpError(400, 'over_cap', `${over[1]} is capped at ${usd(caps[over[0]])} on this server while it trades real funds.`, `limits.${over[0]}`);
    }
    const specs = deps.driver.feed.specs();
    // FR-POL-2: validate against each market's leverage cap and the account balance.
    for (const m of markets) {
      const sp = specs[m];
      if (!sp) throw new HttpError(400, 'invalid_request', `${m} is not available on this venue.`, 'markets');
      if (limits.maxLeverage > sp.maxLeverage) throw new HttpError(400, 'invalid_request', `${m} allows at most ${sp.maxLeverage}x leverage.`, 'limits.maxLeverage');
    }
    // Custom limits beyond the balance would trip the margin kill the moment Monday starts.
    if (balanceNeededUsd(limits, markets.length) > balance) {
      throw new HttpError(400, 'insufficient_balance', `Balance ${usd(balance)} is too small for ${usd(limits.maxInventoryUsd)} of inventory in ${markets.length} market${markets.length > 1 ? 's' : ''} at ${limits.maxLeverage}x. Pick a preset (they shrink to fit your balance) or use Fit to my balance.`, 'preset');
    }
    const policy: Policy = { mode: 'maker', markets, preset: body.preset, ...limits };
    const policyHash = keccak256(toHex(canonicalJson(policyForHash(policy))));
    const prev = policyRow(s.uid);
    const version = (prev?.version ?? 0) + 1;
    // PRD 17.4: with a registry configured, a policy only takes effect once the user's own wallet has
    // published it on Monad. A stolen session cookie alone cannot loosen the limits.
    const mustSign = Boolean(config.chain.registry) && !s.demo && prev?.policy_hash !== policyHash;
    if (mustSign) {
      db.prepare('insert into policies (user_id, version, pending_json, pending_hash, updated_at) values (?,?,?,?,?) on conflict(user_id) do update set version = excluded.version, pending_json = excluded.pending_json, pending_hash = excluded.pending_hash, updated_at = excluded.updated_at')
        .run(s.uid, version, JSON.stringify(policy), policyHash, Date.now());
    } else {
      db.prepare('insert into policies (user_id, version, json, policy_hash, updated_at) values (?,?,?,?,?) on conflict(user_id) do update set version = excluded.version, json = excluded.json, policy_hash = excluded.policy_hash, pending_json = null, pending_hash = null, updated_at = excluded.updated_at')
        .run(s.uid, version, JSON.stringify(policy), policyHash, Date.now());
      deps.runnerFor(s.uid)?.setPolicy(policy);
    }
    return policyView(s.uid);
  });
  app.post('/api/policy/confirm', async (req) => {
    const s = need(req);
    const { txHash } = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body);
    const p = policyRow(s.uid);
    if (!p?.pending_json || !p.pending_hash) throw new HttpError(409, 'nothing_pending', 'There is no policy waiting for confirmation.');
    // Trust the chain, not the browser: read the registry and compare hashes.
    if ((await onchainPolicyHash(s.w as `0x${string}`)) !== p.pending_hash.toLowerCase()) {
      throw new HttpError(409, 'not_confirmed', 'Monad does not show this policy yet. Wait for the transaction to confirm, then try again.');
    }
    // Promote exactly the policy that was checked on chain: another save during the read above must not ride along.
    const done = db.prepare('update policies set json = ?, policy_hash = ?, onchain_tx = ?, pending_json = null, pending_hash = null, updated_at = ? where user_id = ? and pending_hash = ?')
      .run(p.pending_json, p.pending_hash, txHash, Date.now(), s.uid, p.pending_hash);
    if (!done.changes) throw new HttpError(409, 'pending_changed', 'The pending policy changed while it was being confirmed. Sign the new one, then confirm again.');
    deps.runnerFor(s.uid)?.setPolicy(JSON.parse(p.pending_json) as Policy);
    return policyView(s.uid);
  });

  const runner = (req: FastifyRequest): Runner => {
    const r = deps.runnerFor(need(req).uid);
    if (!r) throw new HttpError(409, 'not_onboarded', 'Add a trade key and a policy before starting the agent.');
    r.lastSeenAt = Date.now();
    return r;
  };
  app.post('/api/agent/start', async (req) => {
    const r = runner(req);
    const b = StartBody.parse(req.body ?? {});
    await r.start({ stopLossUsd: b.stopLossUsd ?? null, takeProfitUsd: b.takeProfitUsd ?? null });
    return { status: r.status };
  });
  app.post('/api/agent/pause', async (req) => {
    const r = runner(req);
    await r.pause();
    return { status: r.status };
  });
  app.post('/api/agent/kill', async (req) => {
    const r = runner(req);
    await r.kill('manual');
    return { status: r.status };
  });
  app.get('/api/state', async (req): Promise<DashboardState> => runner(req).state());
  app.get('/api/analytics', async (req): Promise<Analytics> => {
    const s = need(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(req.query);
    const to = Date.now();
    const from = to - days * 86_400_000;
    // Monday's own fills: a trade placed by hand on the same account is not Monday's result.
    const rows = db.prepare("select *, json_extract(ctx, '$.reduces') as reduces from fills where user_id = ? and ts >= ? and coalesce(external, 0) = 0 order by ts").all(s.uid, from) as Record<string, never>[];
    return analyticsOf(rows.map((r) => ({
      sym: r.sym, side: r.side, price: r.price, size: r.size, fee: r.fee, isMaker: !!r.is_maker, ts: r.ts, regime: r.regime, realized: r.realized, halfBps: r.half_bps,
      closes: r.reduces == null ? null : Boolean(r.reduces),
      markouts: [r.markout_1s, r.markout_5s, r.markout_10s, r.markout_1m, r.markout_5m],
    })), from, to);
  });

  app.post('/api/sim/burst', async (req) => {
    need(req);
    if (!deps.world) throw new HttpError(403, 'sim_only', 'Bursts can only be triggered on the simulated market.');
    const b = z.object({ market: z.enum(MARKETS), direction: z.enum(['buy', 'sell']) }).parse(req.body);
    deps.world.triggerBurst(b.market, b.direction === 'buy' ? 1 : -1);
    return { ok: true };
  });

  registerStats(app);

  // ---- realtime ----
  // The session cookie never leaves the web origin, so the socket authenticates with a one-time ticket.
  app.get('/api/ws-ticket', async (req) => {
    const s = need(req);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { uid: s.uid, exp: Date.now() + 30_000 });
    return { ticket };
  });
  // One serialisation per state and channel, however many sockets watch it: the state is rebuilt every second, so
  // stringifying it once per subscriber would let a crowd of viewers stall the event loop and the trading socket with it.
  const frames = new WeakMap<DashboardState, Map<string, string>>();
  const frame = (type: string, data: DashboardState) => {
    let f = frames.get(data);
    if (!f) frames.set(data, (f = new Map()));
    let s = f.get(type);
    if (s == null) f.set(type, (s = JSON.stringify({ type, data })));
    return s;
  };
  let sockets = 0;
  app.get('/ws', { websocket: true }, (socket) => {
    if (sockets >= MAX_SOCKETS) return void socket.close(1013, 'busy');
    sockets++;
    let off: (() => void) | null = null;
    let uid: number | null = null;
    const unlist = () => {
      if (uid != null) streams.get(uid)?.delete(socket);
      uid = null;
    };
    const send = (type: string) => (data: DashboardState) => socket.readyState === 1 && socket.send(frame(type, data));
    socket.on('message', (raw: Buffer) => {
      let msg: { type?: string; ticket?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      off?.();
      off = null;
      unlist();
      if (msg.type === 'public') {
        const h = deps.house();
        if (h) off = h.subscribe(send('public'));
      } else if (msg.type === 'auth' && msg.ticket) {
        const t = tickets.get(msg.ticket);
        tickets.delete(msg.ticket);
        const r = t && t.exp > Date.now() ? deps.runnerFor(t.uid) : null;
        if (!r) return void socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
        uid = t!.uid;
        (streams.get(uid) ?? streams.set(uid, new Set()).get(uid)!).add(socket);
        off = r.subscribe((s) => {
          r.lastSeenAt = Date.now();
          send('state')(s);
        });
        send('state')(r.state());
      }
    });
    socket.on('close', () => {
      sockets--;
      off?.();
      unlist();
    });
  });

  return app;
}
