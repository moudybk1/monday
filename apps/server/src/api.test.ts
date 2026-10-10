import { expect, it } from 'vitest';

// Before config loads: nothing in this test may touch a real database, chain or LLM.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '', ENVIO_API_TOKEN: '' });
const { buildApi } = await import('./api');

/** The API with a scripted runner behind every user: it records what it was told to do. */
async function harness() {
  const calls: string[] = [];
  const runner = { status: 'quoting', lastSeenAt: 0, kill: async () => void calls.push('kill'), pause: async () => void calls.push('pause'), state: () => ({}), subscribe: () => () => {} };
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
