// REST API and the dashboard WebSocket (PRD 15).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { getAddress, keccak256, toHex, verifyMessage } from 'viem';
import { generateSiweNonce, parseSiweMessage } from 'viem/siwe';
import { z } from 'zod';
import {
  MARKETS, MARKET_BIT, PRESETS, balanceNeededUsd, canonicalJson, policyForHash, usd,
  type AppConfig, type DashboardState, type DecisionRecord, type MarketSym, type Me, type Policy,
} from '@monday/core';
import { agentAddress, chainEnabled, onchainPolicyHash } from './chain';
import { config } from './config';
import { db, seal, upsertUser } from './db';
import { evidence } from './evidence';
import { llmEnabled } from './governor';
import type { Runner } from './runner';
import type { SimWorld } from './venue/sim';
import { VenueError, type VenueDriver } from './venue/types';

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
  preset: z.enum(['conservative', 'balanced', 'active', 'custom']),
  markets: z.array(z.enum(MARKETS)).min(1).max(3),
  limits: z.object({
    quoteSizeUsd: z.number().min(10).max(5_000),
    maxInventoryUsd: z.number().min(20).max(50_000),
    minHalfSpreadBps: z.number().min(1).max(100),
    maxDailyLossUsd: z.number().min(5).max(10_000),
    maxLeverage: z.number().min(1).max(50),
  }).optional(),
});
const CredsBody = z.object({ apiKeyToken: z.string().trim().min(1).max(512), apiKeySecret: z.string().trim().min(1).max(512) });

export async function buildApi(deps: ApiDeps) {
  const app = Fastify({ logger: { level: config.prod ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers.authorization', '*.secret', '*.token', '*.signature', '*.apikey', '*.apiKeySecret', '*.apiKeyToken'] } });
  await app.register(cookie);
  await app.register(websocket);

  const nonces = new Map<string, number>();
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
    reply.setCookie(COOKIE, encodeSession({ ...s, exp: Date.now() + 7 * 86_400_000 }), { httpOnly: true, sameSite: 'strict', secure: config.prod, path: '/', maxAge: 7 * 86_400 });

  // 60 requests per minute per session or address (PRD 15.3)
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const key = req.cookies[COOKIE]?.slice(-24) ?? req.ip;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.at > 60_000) hits.set(key, { n: 1, at: now });
    else if (++h.n > 60) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, field: err.field });
    if (err instanceof z.ZodError) {
      const i = err.issues[0];
      return reply.status(400).send({ error: 'invalid_request', message: i?.message ?? 'Invalid request.', field: i?.path.join('.') });
    }
    if (err instanceof VenueError) return reply.status(400).send({ error: err.code, message: err.message });
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
    sim: deps.driver.kind === 'sim', network: config.network, networkName: config.networkName, realFunds: config.realFunds, caps: config.caps,
    smartMoney: config.smartMoney, chainId: config.chain.chainId, registry: config.chain.registry || null,
    agentAddress: chainEnabled ? agentAddress : null, explorerUrl: config.chain.explorerUrl, perplAppUrl: config.perpl.appUrl,
    minDepositUsd: deps.driver.minDepositUsd(), llm: llmEnabled, specs: deps.driver.feed.specs(),
  }));
  app.get('/api/health', async () => deps.health());
  app.get('/api/evidence', async () => evidence() ?? { pending: true });
  app.get('/api/public/preview', async () => deps.house()?.state() ?? null);
  app.get('/api/decisions/:id', async (req): Promise<DecisionRecord> => {
    const id = Number((req.params as { id: string }).id);
    const r = db.prepare('select d.*, u.wallet from decisions d join users u on u.id = d.user_id where d.id = ?').get(id) as Record<string, never> | undefined;
    if (!r) throw new HttpError(404, 'not_found', 'No decision with that id.');
    return {
      id: r.id, at: r.at, market: r.market, source: r.source, regime: r.regime, params: JSON.parse(r.params), evidence: JSON.parse(r.evidence), reason: r.reason ?? '',
      paramsHash: r.params_hash, evidenceHash: r.evidence_hash, llmModel: r.llm_model, txHash: r.tx_hash, onchainId: r.onchain_id, wallet: r.wallet,
    };
  });

  // ---- auth: Sign-In with Ethereum ----
  app.post('/api/auth/nonce', async () => {
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
    if (deps.driver.kind !== 'sim') throw new HttpError(403, 'demo_disabled', 'Demo accounts exist only on the simulated market.');
    const w = getAddress(`0x${randomBytes(20).toString('hex')}`);
    setSession(reply, { w, demo: true });
    return { wallet: w };
  });
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
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
    deps.dropRunner(s.uid);
    db.prepare('insert or replace into perpl_credentials (user_id, chain_id, account_id, enc, iv, tag, status, created_at) values (?,?,?,?,?,?,?,?)')
      .run(s.uid, config.perpl.chainId, acct.accountId, sealed.enc, sealed.iv, sealed.tag, 'active', Date.now());
    return { accountId: acct.accountId, balanceUsd: acct.balanceUsd, tradeScope: true };
  });
  app.delete('/api/credentials', async (req) => {
    const s = need(req);
    await deps.runnerFor(s.uid)?.pause();
    deps.dropRunner(s.uid);
    db.prepare('delete from perpl_credentials where user_id = ?').run(s.uid);
    db.prepare("update agents set status = 'idle' where user_id = ?").run(s.uid);
    return { ok: true };
  });

  app.get('/api/policy', async (req) => policyView(need(req).uid));
  app.put('/api/policy', async (req) => {
    const s = need(req);
    const body = PolicyBody.parse(req.body);
    const limits = body.preset === 'custom' ? body.limits : PRESETS[body.preset];
    if (!limits) throw new HttpError(400, 'invalid_request', 'Custom policies need limits.', 'limits');
    if (limits.quoteSizeUsd > limits.maxInventoryUsd) throw new HttpError(400, 'invalid_request', 'Quote size cannot exceed max inventory.', 'limits.quoteSizeUsd');
    // On real funds the operator's ceilings win over anything a user asks for.
    const caps = config.caps;
    if (caps) {
      const over = ([['quoteSizeUsd', 'Quote size'], ['maxInventoryUsd', 'Max inventory'], ['maxDailyLossUsd', 'Daily loss limit']] as const).find(([k]) => limits[k] > caps[k]);
      if (over) throw new HttpError(400, 'over_cap', `${over[1]} is capped at ${usd(caps[over[0]])} on this server while it trades real funds.`, `limits.${over[0]}`);
    }
    const specs = deps.driver.feed.specs();
    const markets = MARKETS.filter((m) => body.markets.includes(m));
    // FR-POL-2: validate against each market's leverage cap and the account balance.
    for (const m of markets) {
      const sp = specs[m];
      if (!sp) throw new HttpError(400, 'invalid_request', `${m} is not available on this venue.`, 'markets');
      if (limits.maxLeverage > sp.maxLeverage) throw new HttpError(400, 'invalid_request', `${m} allows at most ${sp.maxLeverage}x leverage.`, 'limits.maxLeverage');
    }
    const acct = await deps.driver.detectAccount(s.w);
    const balance = acct?.balanceUsd ?? 0;
    if (balanceNeededUsd(limits, markets.length) > balance) {
      throw new HttpError(400, 'insufficient_balance', `Balance ${usd(balance)} is too small for ${usd(limits.maxInventoryUsd)} of inventory in ${markets.length} market${markets.length > 1 ? 's' : ''} at ${limits.maxLeverage}x. Pick a smaller preset, fewer markets, or deposit more.`, 'preset');
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
    db.prepare('update policies set json = pending_json, policy_hash = pending_hash, onchain_tx = ?, pending_json = null, pending_hash = null, updated_at = ? where user_id = ?').run(txHash, Date.now(), s.uid);
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
    await r.start();
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

  app.post('/api/sim/burst', async (req) => {
    need(req);
    if (!deps.world) throw new HttpError(403, 'sim_only', 'Bursts can only be triggered on the simulated market.');
    const b = z.object({ market: z.enum(MARKETS), direction: z.enum(['buy', 'sell']) }).parse(req.body);
    deps.world.triggerBurst(b.market, b.direction === 'buy' ? 1 : -1);
    return { ok: true };
  });

  // ---- realtime ----
  // The session cookie never leaves the web origin, so the socket authenticates with a one-time ticket.
  app.get('/api/ws-ticket', async (req) => {
    const s = need(req);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { uid: s.uid, exp: Date.now() + 30_000 });
    return { ticket };
  });
  app.get('/ws', { websocket: true }, (socket) => {
    let off: (() => void) | null = null;
    const send = (type: string) => (data: DashboardState) => socket.readyState === 1 && socket.send(JSON.stringify({ type, data }));
    socket.on('message', (raw: Buffer) => {
      let msg: { type?: string; ticket?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      off?.();
      off = null;
      if (msg.type === 'public') {
        const h = deps.house();
        if (h) off = h.subscribe(send('public'));
      } else if (msg.type === 'auth' && msg.ticket) {
        const t = tickets.get(msg.ticket);
        tickets.delete(msg.ticket);
        const r = t && t.exp > Date.now() ? deps.runnerFor(t.uid) : null;
        if (!r) return void socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
        off = r.subscribe((s) => {
          r.lastSeenAt = Date.now();
          send('state')(s);
        });
        send('state')(r.state());
      }
    });
    socket.on('close', () => off?.());
  });

  return app;
}
