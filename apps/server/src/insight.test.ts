import { expect, it } from 'vitest';

// Before config loads: nothing in this test may touch a real database, chain or model.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '', MONDAY_REGISTRY_ADDRESS: '', TELEGRAM_BOT_TOKEN: '', ENVIO_API_TOKEN: '' });
const { marketInsight, rule, clean } = await import('./insight');

/** A market that has only risen, on every timeframe asked for. */
const rising = {
  snapshot: () => null,
  candles: async (_sym: string, from: number, to: number, resSec = 60) => {
    const step = resSec * 1000, out = [];
    for (let t = Math.ceil(from / step) * step, k = 0; t + step <= to; t += step, k++) out.push({ t, o: 100 + k, h: 101.5 + k, l: 99.5 + k, c: 101 + k, v: 1 });
    return out;
  },
};

it('reads D1, H4 and H1 by rule when no model is set, and says the trend lines up', async () => {
  const r = await marketInsight(rising as never, 'BTC');
  expect(r).toMatchObject({ d1: 'bullish', h4: 'bullish', h1: 'bullish', market: 'bullish', aligned: true, source: 'rules', model: null });
  expect(r.summary).toBe('BTC is bullish on D1, H4 and H1: the trend lines up on all three.');
  expect(r.price).toBeGreaterThan(100); // the last H1 close when the feed has no snapshot
});

it('names a pullback and a mixed market; the model text loses markdown and em dashes', () => {
  expect(rule('ETH', { d1: 'bearish', h4: 'bearish', h1: 'bullish' }, 'bearish')).toBe('ETH is bearish on D1 and H4, while H1 is bullish, pulling back against it.');
  expect(rule('SOL', { d1: 'bullish', h4: 'bearish', h1: 'neutral' }, 'mixed')).toBe('SOL is mixed: D1 is bullish, H4 bearish and H1 neutral, so the higher timeframes do not agree yet.');
  expect(clean('**BTC** is bearish — H1 is   bouncing.\n')).toBe('BTC is bearish, H1 is bouncing.');
});
