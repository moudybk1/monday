import Fastify from 'fastify';
import { expect, it } from 'vitest';

// run.ts rate-limits by the matched route. The router decodes %xx, so the raw URL is not enough: "/api/stats/%61sk"
// reached /ask uncounted (2026-10-12). This pins the Fastify behaviour that check relies on.
it('names the matched route in onRequest, however the path is encoded', async () => {
  const app = Fastify();
  const seen: string[] = [];
  app.addHook('onRequest', async (req) => void seen.push(req.routeOptions.url ?? '(none)'));
  app.post('/api/stats/ask', async () => '');
  app.post('/api/stats/chat', async () => '');
  app.get('/api/stats/wallet/:q/explain', async () => '');
  app.get('/api/stats/wallet/:q', async () => '');
  for (const [method, url] of [['POST', '/api/stats/%61sk'], ['POST', '/api/%73tats/chat'], ['GET', '/api/stats/%77allet/5/explain'], ['GET', '/api/stats/wallet/5'], ['GET', '/nope']] as const) {
    await app.inject({ method, url });
  }
  expect(seen).toEqual(['/api/stats/ask', '/api/stats/chat', '/api/stats/wallet/:q/explain', '/api/stats/wallet/:q', '(none)']);
});
