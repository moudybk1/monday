import { expect, it } from 'vitest';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '', ENVIO_API_TOKEN: '' });
const { buildApi } = await import('./api');

/** The API with a scripted runner behind every user: it records what it was told to do. */
async function harness() {
  const calls: string[] = [];
  const runner = { status: 'quoting', lastSeenAt: 0, kill: async () => void calls.push('kill'), pause: async () => void calls.push('pause'), state: () => ({}), subscribe: () => () => {}, makerMarkets: () => [], committed: () => ({ makerUsd: 0, plansUsd: 0 }) };
  const app = await buildApi({
    driver: { kind: 'sim', feed: { specs: () => ({}), snapshot: () => null, candles: async () => [] }, minDepositUsd: () => 10 } as never,
    world: null, house: () => null, runnerFor: () => runner as never, dropRunner: () => {}, health: () => ({ ok: true }),
  });
  const signIn = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/demo' });
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    return { cookie, wallet: res.json().wallet as string };
  };
  return { app, calls, signIn };
}

it('Stop and Kill still go through after polling has used up the request budget', async () => {
  const { app, calls, signIn } = await harness();
  const { cookie } = await signIn();
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode;
  expect(last).toBe(429); // the ordinary budget is spent
  expect((await app.inject({ method: 'POST', url: '/api/agent/pause', headers: { cookie } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: '/api/agent/kill', headers: { cookie } })).statusCode).toBe(200);
  expect(calls).toEqual(['pause', 'kill']);
  await app.close();
});

it('a tab still showing account A cannot stop account B, who signed in from another tab', async () => {
  const { app, calls, signIn } = await harness();
  const a = await signIn();
  const b = await signIn(); // the shared cookie now belongs to B
  const stale = await app.inject({ method: 'POST', url: '/api/agent/pause', headers: { cookie: b.cookie, 'x-monday-account': a.wallet } });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error).toBe('account_changed');
  expect(calls).toEqual([]); // nobody was stopped
  const fresh = await app.inject({ method: 'POST', url: '/api/agent/pause', headers: { cookie: b.cookie, 'x-monday-account': b.wallet.toLowerCase() } });
  expect(fresh.statusCode).toBe(200);
  expect(calls).toEqual(['pause']);
  await app.close();
});

it('signing out ends that account\'s live stream', async () => {
  const { app, signIn } = await harness();
  await app.ready();
  const { cookie } = await signIn();
  const { ticket } = (await app.inject({ method: 'GET', url: '/api/ws-ticket', headers: { cookie } })).json();
  const ws = await app.injectWS('/ws');
  const closed = new Promise<number>((ok) => ws.on('close', ok));
  ws.send(JSON.stringify({ type: 'auth', ticket }));
  await new Promise((ok) => ws.once('message', ok)); // subscribed: the first state arrives
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  expect(await closed).toBe(4401);
  await app.close();
});

it('SIWE: fresh unrelated nonces, the message\'s own validity window, and signing out voids a copied cookie', async () => {
  const { app } = await harness();
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
  const { createSiweMessage } = await import('viem/siwe');
  const { config } = await import('./config');
  const account = privateKeyToAccount(generatePrivateKey());
  const nonce = async () => (await app.inject({ method: 'POST', url: '/api/auth/nonce' })).json().nonce as string;
  const signIn = async (extra: Partial<Parameters<typeof createSiweMessage>[0]> = {}) => {
    const message = createSiweMessage({
      address: account.address, chainId: config.chain.chainId, domain: new URL(config.webOrigin).host, nonce: await nonce(),
      uri: config.webOrigin, version: '1', ...extra,
    });
    return app.inject({ method: 'POST', url: '/api/auth/verify', payload: { message, signature: await account.signMessage({ message }) } });
  };
  const [a, b] = [await nonce(), await nonce()];
  expect(a.slice(1)).not.toBe(b.slice(0, -1)); // viem's nonces overlapped like this
  expect((await signIn({ expirationTime: new Date(Date.now() - 1000) })).json().error).toBe('bad_time');
  expect((await signIn({ notBefore: new Date(Date.now() + 60_000) })).json().error).toBe('bad_time');
  expect((await signIn({ issuedAt: new Date('2020-01-01') })).json().error).toBe('bad_time');
  const first = await signIn();
  expect(first.statusCode).toBe(200);
  const cookie = String(first.headers['set-cookie']).split(';')[0];
  expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  // The browser dropped it; a copy kept elsewhere must not work either.
  expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  expect((await app.inject({ method: 'GET', url: '/api/ws-ticket', headers: { cookie } })).statusCode).toBe(401);
  await new Promise((ok) => setTimeout(ok, 2)); // a new cookie is issued after the sign-out, not in the same millisecond
  const again = String((await signIn()).headers['set-cookie']).split(';')[0];
  expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: again } })).statusCode).toBe(200);
  await app.close();
});

it('refuses a leverage that is not a whole number, and says which field', async () => {
  const { app, signIn } = await harness();
  const { cookie } = await signIn();
  const res = await app.inject({
    method: 'PUT', url: '/api/policy', headers: { cookie },
    payload: { preset: 'custom', markets: ['BTC'], limits: { quoteSizeUsd: 10, maxInventoryUsd: 100, minHalfSpreadBps: 4, maxDailyLossUsd: 10, maxLeverage: 2.5 } },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ error: 'invalid_request', field: 'limits.maxLeverage', message: 'Max leverage: must be a whole number, like 3x' });
  await app.close();
});
