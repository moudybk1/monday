// The Perpl stats process: npm run indexer. It indexes Perpl's history and serves the public stats API (/api/stats/*)
// on its own port, apart from the trading server: a heavy analytics query or an indexer batch is synchronous SQLite and
// would otherwise stall the trading server's event loop past Perpl's ping timeout (1008), which drops the trading socket.
// Both processes share nothing but the stats database file (WAL).

import Fastify from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { indexerStatus, startIndexer } from './indexer';
import { registerStats } from './routes';

const port = Number(process.env.STATS_PORT ?? 3002);
// Behind Caddy or the web app's proxy every visitor arrives from a private address: trust the forwarded one from those only.
const app = Fastify({ trustProxy: ['loopback', 'uniquelocal'], logger: { level: config.prod ? 'info' : 'warn' } });
app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
  if (err instanceof z.ZodError) return reply.status(400).send({ error: 'invalid_request', message: err.issues[0]?.message ?? 'Invalid request.' });
  if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
  app.log.error(err);
  return reply.status(500).send({ error: 'internal', message: 'Something went wrong on our side.' });
});
// A wallet profile is computed per request (up to 100k fills); the other routes come from shared caches. 60 a minute per
// address matches the trading server's limit and leaves room for a page polling a few wallets every 15 to 30 s.
// ponytail: in-memory fixed window in this one process; pruned when it grows, no shared store needed.
const hits = new Map<string, { n: number; at: number }>();
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/stats/wallet/')) return;
  const now = Date.now();
  if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.at > 60_000) hits.delete(k);
  const h = hits.get(req.ip);
  if (!h || now - h.at > 60_000) hits.set(req.ip, { n: 1, at: now });
  else if (++h.n > 60) return reply.status(429).send({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' });
});
app.get('/api/stats/health', async () => ({ ok: true, at: Date.now(), indexer: indexerStatus() }));
registerStats(app);

startIndexer();
await app.listen({ port, host: '0.0.0.0' });
console.log(JSON.stringify({ service: 'stats', event: 'listening', port, network: config.network }));
