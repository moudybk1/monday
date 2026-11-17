import { expect, it, vi } from 'vitest';

// The governor on Jev, with the network replaced: one typed question, the regime, turned into the rules' table.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', GOVERNOR_LLM_PROVIDER: '', LLM_PROVIDER: 'jev', LLM_BASE_URL: '', LLM_API_KEY: 'k', LLM_MODEL: '' });
const { decide } = await import('./governor');
const { PRESETS } = await import('@monday/core');

const w = { netUsd: 0, grossUsd: 0, imbalance: 0, z: 0, n: 0 };
const proposal = { spread_mult: 1.5, skew_bias_bps: 0, size_mult: 0.7, max_inventory_usd: 225, ttl_min: 15, regime: 'active' as const, market: 'BTC' as const, enabled: true };
const ctx = (stale = false) => ({
  market: 'BTC' as const, signal: { sym: 'BTC' as const, at: 0, stale, S: 0, w5: w, w15: w, w60: w }, topTrades: [], mark: 85_000, sigma1mBps: 2,
  sigmaMedianBps: 2, fundingRate: 0, inventoryUsd: 0, pnlTodayUsd: 0, feesUsd: 0, avgMarkout1mBps: null, lossLimitUsedPct: 0, policy: PRESETS.balanced,
  lean: false, prev: null, fills1h: 0, markoutSamples1h: 0, quotedPct1h: null, inventoryAgeMin: null, inventoryStage: 'normal', feedAgeMs: 50,
  orderLatencyMs: null, proposal,
});
const jev = (choice: string, confidence: number) => {
  const calls: { url: string; body: Record<string, any> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { regime: { type: 'choice', choice, confidence, probabilities: {} } }, usage: {} }));
  });
  return calls;
};

it('asks Jev for the regime and sets the rules table for it', async () => {
  const calls = jev('storm', 0.92);
  const r = await decide(ctx());
  expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
  expect(calls[0].body).toMatchObject({ model: 'jev-latest', questions: { regime: { type: 'choice' } } });
  expect(calls[0].body.state).not.toHaveProperty('rules_proposal');
  expect(r).toMatchObject({ source: 'governor', llmModel: 'jev-1.14.0', params: { regime: 'storm', spread_mult: 2.5, size_mult: 0.4 } });
  expect(r.params.reason).toMatch(/storm \(92% sure\)/);
});

it('keeps the rules when an unsure answer would loosen, and stale when the signal is stale', async () => {
  jev('calm', 0.3);
  expect((await decide(ctx())).params).toMatchObject({ regime: 'active', spread_mult: 1.5 });
  jev('calm', 0.8);
  expect((await decide(ctx())).params.regime).toBe('calm');
  expect((await decide(ctx(true))).params.regime).toBe('stale');
});

it('falls back to the rules when Jev fails', async () => {
  vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }));
  expect((await decide(ctx())).source).toBe('fallback');
  vi.unstubAllGlobals();
});
