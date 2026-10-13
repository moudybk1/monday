import { expect, it, vi } from 'vitest';

Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '' });
const { computeEvidence } = await import('./evidence');

it('asks Perpl for a week of candles once, then only for the minutes since the last run', async () => {
  const MIN = 60_000;
  const calls: [number, number][] = [];
  // Perpl answers with the last ten minutes before `to`: too short for a study, so no worker starts.
  const candles = async (_sym: string, from: number, to: number) => {
    calls.push([from, to]);
    return Array.from({ length: 10 }, (_, i) => to - (10 - i) * MIN).filter((t) => t >= from).map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 0 }));
  };
  const driver = { kind: 'perpl', feed: { specs: () => ({ BTC: { sym: 'BTC' } }), candles } };
  const collector = { kind: 'nansen', medianLagMs: 0, minuteFlows: () => [] };
  let now = Date.UTC(2026, 9, 13, 12, 0);
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  await computeEvidence(driver as never, collector as never);
  expect(calls).toEqual([[now - 7 * 1440 * MIN, now]]); // the first run: the whole week
  const firstEnd = now;
  now += 10 * MIN;
  await computeEvidence(driver as never, collector as never);
  expect(calls[1]).toEqual([firstEnd, now]); // the next: only the ten minutes since
  await computeEvidence(driver as never, collector as never);
  expect(calls).toHaveLength(2); // nothing new: no request at all
  vi.restoreAllMocks();
});
