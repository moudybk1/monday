import { expect, it, vi } from 'vitest';
import type { PxMarketRow, PxOverview, PxScreenRow } from '@monday/core';

vi.mock('./perpl', () => ({ meta: async () => ({ markets: new Map([[1, { sym: 'BTC' }], [31, { sym: 'SOL' }]]) }) }));
const { chat } = await import('./answer');

const mkt = (sym: string, o: Partial<PxMarketRow>): PxMarketRow => ({ id: 1, sym, mark: 100, change24hPct: 1, volume24hUsd: 0, openInterestUsd: 0, fundingRate: 0, fundingIntervalMin: 60, longs: 0, shorts: 0, hlVolume24hUsd: null, ...o });
const overview = {
  at: Date.UTC(2026, 9, 12, 8), network: 'mainnet',
  headline: { volume24hUsd: 9e6, volume7dUsd: 6e7, volume30dUsd: 2e8, volumeAllUsd: 1e9, openInterestUsd: 1.5e6, tvlUsd: 3e6, accounts: 5000, fees24hUsd: 3000, fees7dUsd: null, fees30dUsd: null, feesAllUsd: null, activeTraders24h: 250, activeTraders7d: 900, activeTraders30d: null, netFlow24hUsd: 4000, liquidations24hUsd: 0, newAccounts24h: 9, complete: {} },
  markets: [mkt('BTC', { volume24hUsd: 6e6, openInterestUsd: 1e6, fundingRate: 0.00001, longs: 30, shorts: 10 }), mkt('SOL', { volume24hUsd: 3e6, openInterestUsd: 5e5, fundingRate: -0.00002, longs: 5, shorts: 15 })],
  daily: [{ t: 0, volumeUsd: 7.5e6 }, { t: 1, volumeUsd: 9e6, trades: 1200 }],
} as unknown as PxOverview;
const row = (account: number, o: Partial<PxScreenRow>): PxScreenRow => ({ account, address: null, volumeUsd: 1e5, netUsd: 0, feesUsd: 0, trades: 50, closes: 40, wins: 20, grossWinUsd: 1, grossLossUsd: 1, makerVolumeUsd: 0, activeDays: 3, lastDay: 0, daily: [], streak: 0, liquidations: 0, liquidatedUsd: 0, ...o } as PxScreenRow);
const data = {
  overview: async () => overview,
  screen: async (days: number) => ({ days, rows: [row(1, { volumeUsd: 9e6, liquidations: 2, netUsd: -500 }), row(2, { volumeUsd: 5e6 }), row(3, { volumeUsd: 1e3, liquidations: 1 })] }) as never,
  leaderboard: async () => [],
  wallet: async () => null,
};

it('answers with the figures, follows up on the window, defines words, and declines predictions', async () => {
  const whales = await chat('whales liquidated this month', {}, data);
  expect(whales.text).toMatch(/^2 of 3 active wallets match whales \+ liquidated over the last 30 days\. First: #1, -\$500/);
  expect(whales.table?.rows.map((r) => r.cells[0])).toEqual(['#1', '#3']); // by volume, the whales sort
  expect(whales.actions[0].href).toBe('/analytics/screener?preset=whales%2Cliquidated&days=30');

  const later = await chat('and this week?', { last: whales.intent }, data);
  expect(later.text).toMatch(/over the last 7 days/);

  const oi = await chat('what is open interest?', {}, data);
  expect(oi.text).toMatch(/^Open interest is the size of all open positions.*Open interest on Perpl is \$1\.5M.*BTC holds 67%/);

  const funding = await chat('BTC funding', {}, data);
  expect(funding.text).toMatch(/^BTC funding is 0\.0010% per hour \(8\.8% a year\): longs pay shorts\.$/);

  expect((await chat('will BTC go up tomorrow?', {}, data)).text).toMatch(/does not predict prices/);
  expect((await chat('show me SOL', {}, data)).text).toMatch(/^SOL is at 100 .*5 accounts long against 15 short\.$/);
});
