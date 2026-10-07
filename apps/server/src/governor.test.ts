import { expect, it } from 'vitest';

Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', LLM_PROVIDER: 'anthropic', LLM_API_KEY: '' });
const { fallbackDecision, firstJsonObject, walletKind } = await import('./governor');
const { PRESETS } = await import('@monday/core');

it('reads the first JSON object of an LLM reply, whatever surrounds it', () => {
  const obj = '{"market":"BTC","reason":"a {brace} in text"}';
  expect(firstJsonObject(obj)).toEqual({ market: 'BTC', reason: 'a {brace} in text' });
  expect(firstJsonObject('```json\n' + obj + '\n```')).toEqual(JSON.parse(obj));
  expect(firstJsonObject(obj + '\n\n{"market":"ETH"}')).toEqual(JSON.parse(obj)); // Opus once added a second object
  expect(() => firstJsonObject('no json here')).toThrow(SyntaxError);
});

it('tells skill from size in Nansen labels', () => {
  expect(['Smart HL Perps Trader', '30D Smart Trader', 'Fund', 'HL Perps Whale', 'Uses "MMREFCSI" HL Referral Code'].map(walletKind)).toEqual(['smart', 'smart', 'smart', 'whale', 'other']);
});

it('the rules never lean with the flow until the evidence allows it', () => {
  const w = (z: number, netUsd: number) => ({ netUsd, grossUsd: Math.abs(netUsd), imbalance: 1, z, n: 3 });
  const ctx = { market: 'BTC' as const, signal: { sym: 'BTC' as const, at: 0, stale: false, S: 1.6, w5: w(2, 400_000), w15: w(1.5, 500_000), w60: w(1, 600_000) }, sigma1mBps: 2, sigmaMedianBps: 2, policy: PRESETS.balanced };
  const off = fallbackDecision({ ...ctx, lean: false });
  expect(off.params).toMatchObject({ regime: 'active', skew_bias_bps: 0 });
  expect(off.params.reason).not.toMatch(/lean/);
  expect(fallbackDecision({ ...ctx, lean: true }).params.skew_bias_bps).toBe(2);
});
