import { expect, it } from 'vitest';
import type { SmartTrade } from '@monday/core';

Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', NANSEN_API_KEY: '', LLM_API_KEY: '' });
const { Collector, LIVE } = await import('./collector');

it('counts a labelled wallet live from Hyperliquid, once, and lets Nansen replace it', async () => {
  const c = new Collector(null);
  await c.start();
  const ingest = (rows: SmartTrade[]) => (c as unknown as { ingest(r: SmartTrade[], backfill: boolean): void }).ingest(rows, false);
  const now = Date.now();
  const W = '0xAbC0000000000000000000000000000000000001', OTHER = '0x0000000000000000000000000000000000000002';
  const nansen = (over: Partial<SmartTrade>): SmartTrade => ({
    hash: '0xold', sym: 'BTC', action: 'Add', side: 'Long', valueUsd: 100_000, priceUsd: 85_000, amount: 1, type: 'Market', trader: W, label: 'HL Perps Whale', ts: now - 2 * 3_600_000, fetchedAt: now, ...over,
  });
  const flowNow = () => c.minuteFlows('BTC', now - 120_000, now + 60_000).reduce((a, b) => a + b, 0);

  ingest([nansen({})]); // Nansen has seen W before, so W is on the watch list
  let tid = 0;
  const fill = (over: object) => c.onHyperliquidTrade({ sym: 'BTC', px: 100, sz: 100, time: now, hash: '0xlive', tid: ++tid, buyer: W.toLowerCase(), seller: OTHER, ...over });
  fill({});
  fill({ sz: 200 }); // the same order's second fill
  fill({ sz: 200, tid: 2 }); // that fill again, replayed on reconnect
  fill({ hash: '0xa', buyer: OTHER, seller: '0x3' }); // nobody on the list
  fill({ hash: '0xb', seller: W.toLowerCase() }); // smart on both sides: no net flow
  fill({ hash: '0xc', time: now - 60_000 }); // replayed backlog
  expect(flowNow()).toBe(30_000);
  expect(c.recentTrades('BTC', now - 60_000)).toMatchObject([{ type: LIVE, action: 'Buy', valueUsd: 30_000, trader: W.toLowerCase() }]);

  // Two minutes later Nansen reports the same trade, a second off and under another hash.
  ingest([nansen({ hash: '0xnansen', valueUsd: 30_000, ts: now + 1_000 })]);
  expect(flowNow()).toBe(30_000);
  expect(c.recentTrades('BTC', now - 60_000).map((t) => t.type)).toEqual(['Market']);

  // Two real trades a second apart, then Nansen reports the first: only one live copy goes.
  fill({ hash: '0xd', time: now + 10_000, sz: 50, tid: 100 });
  fill({ hash: '0xe', time: now + 11_000, sz: 80, tid: 101 });
  ingest([nansen({ hash: '0xn2', valueUsd: 5_000, ts: now + 10_200 })]);
  expect(c.recentTrades('BTC', now + 5_000).map((t) => [t.type, t.valueUsd])).toEqual([['Market', 5_000], [LIVE, 8_000]]);
});
