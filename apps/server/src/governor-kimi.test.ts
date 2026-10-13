import { expect, it, vi } from 'vitest';

// The governor against an OpenAI-compatible Kimi, with the network replaced: what each kind of review asks for.
Object.assign(process.env, {
  VENUE: 'sim', DATABASE_PATH: ':memory:', LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://llm.test/v1', LLM_API_KEY: 'k', LLM_MODEL: 'kimi-k3',
});
const { decide } = await import('./governor');
const { PRESETS } = await import('@monday/core');

it('asks Kimi to reason on a scheduled review and not on an early one', async () => {
  const bodies: Record<string, unknown>[] = [];
  const answer = { market: 'BTC', enabled: true, spread_mult: 2, skew_bias_bps: 0, size_mult: 0.5, max_inventory_usd: 100, ttl_min: 15, regime: 'active', reason: 'Selling picked up.' };
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  });
  const w = { netUsd: 0, grossUsd: 0, imbalance: 0, z: 0, n: 0 };
  const params = { spread_mult: 1, skew_bias_bps: 0, size_mult: 1, max_inventory_usd: 225, ttl_min: 15, regime: 'calm' as const, market: 'BTC' as const, enabled: true };
  const ctx = {
    market: 'BTC' as const, signal: { sym: 'BTC' as const, at: 0, stale: false, S: 0, w5: w, w15: w, w60: w }, topTrades: [], mark: 85_000, sigma1mBps: 2,
    sigmaMedianBps: 2, fundingRate: 0, inventoryUsd: 0, pnlTodayUsd: 0, feesUsd: 0, avgMarkout1mBps: null, lossLimitUsedPct: 0, policy: PRESETS.balanced,
    lean: false, prev: null, fills1h: 0, markoutSamples1h: 0, quotedPct1h: null, inventoryAgeMin: null, inventoryStage: 'normal', feedAgeMs: 50,
    orderLatencyMs: null, proposal: params,
  };
  expect((await decide(ctx)).source).toBe('governor');
  expect((await decide(ctx, true)).source).toBe('governor');
  expect(bodies[0]).not.toHaveProperty('thinking'); // scheduled: Kimi thinks it through
  expect(bodies[1]).toMatchObject({ model: 'kimi-k3', thinking: { type: 'disabled' } }); // early: an answer in seconds
  vi.unstubAllGlobals();
});
