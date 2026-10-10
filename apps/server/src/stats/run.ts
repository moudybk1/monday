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
// ponytail: no rate limit here (the trading server's one no longer covers /api/stats); the worst a flood does now is slow
// the analytics pages, never trading. Add a per-address limit on /api/stats/wallet if that ever happens.
const app = Fastify({ trustProxy: ['loopback', 'uniquelocal'], logger: { level: config.prod ? 'info' : 'warn' } });
app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
  if (err instanceof z.ZodError) return reply.status(400).send({ error: 'invalid_request', message: err.issues[0]?.message ?? 'Invalid request.' });
  if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
  app.log.error(err);
  return reply.status(500).send({ error: 'internal', message: 'Something went wrong on our side.' });
});
app.get('/api/stats/health', async () => ({ ok: true, at: Date.now(), indexer: indexerStatus() }));
registerStats(app);

startIndexer();
await app.listen({ port, host: '0.0.0.0' });
console.log(JSON.stringify({ service: 'stats', event: 'listening', port, network: config.network }));
