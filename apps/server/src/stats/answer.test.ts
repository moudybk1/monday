import { expect, it, vi } from 'vitest';
import type { PxMarketRow, PxOverview, PxScreenRow } from '@monday/core';

vi.mock('./perpl', () => ({ meta: async () => ({ markets: new Map([[1, { sym: 'BTC' }], [31, { sym: 'SOL' }]]) }) }));
const { chat } = await import('./answer');

const mkt = (sym: string, o: Partial<PxMarketRow>): PxMarketRow => ({ id: 1, sym, mark: 100, change24hPct: 1, volume24hUsd: 0, openInterestUsd: 0, fundingRate: 0, fundingIntervalMin: 60, longs: 0, shorts: 0, hlVolume24hUsd: null, ...o });
const overview = {
  at: Date.UTC(2026, 9, 12, 8), network: 'mainnet',
  headline: { volume24hUsd: 9e6, volume7dUsd: 6e7, volume30dUsd: 2e8, volumeAllUsd: 1e9, openInterestUsd: 1.5e6, tvlUsd: 3e6, accounts: 5000, fees24hUsd: 3000, fees7dUsd: null, fees30dUsd: null, feesAllUsd: null, activeTraders24h: 250, activeTraders7d: 900, activeTraders30d: null, netFlow24hUsd: 4000, liquidations24hUsd: 0, newAccounts24h: 9, complete: {} },
  markets: [mkt('BTC', { volume24hUsd: 6e6, openInterestUsd: 1e6, fundingRate: 0.00001, longs: 30, shorts: 10 }), mkt('SOL', { volume24hUsd: 3e6, openInterestUsd: 5e5, fundingRate: -0.00002, longs: 5, shorts: 15 })],
  daily: [{ t: 0, volumeUsd: 7.5e6, byMarket: { BTC: 5e6, SOL: 2.5e6 } }, { t: 1, volumeUsd: 9e6, byMarket: { BTC: 6e6, SOL: 3e6 }, trades: 1200 }],
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

it('answers the figure a definition question asks for, and the window the data has', async () => {
  expect((await chat('what is SOL funding', {}, data)).text).toMatch(/^SOL funding is .*shorts pay longs\.$/);
  expect((await chat('what is the volume this month', {}, data)).text).toBe('Perpl traded $200M over the last 30 days.');
  expect((await chat('what are the whales liquidated this month', {}, data)).text).toMatch(/^2 of 3 active wallets match whales \+ liquidated/);
  const fees = { ...overview, headline: { ...overview.headline, fees30dUsd: 9000 } };
  expect((await chat('fees this quarter', {}, { ...data, overview: async () => fees })).text).toBe('Perpl collected $9,000.00 in fees over the last 30 days (no 90-day figure is kept).');
  const y = await chat('and yesterday?', { last: { kind: 'metric', metric: 'volume', range: 30 } }, data);
  expect(y.text).toMatch(/in the last 24 hours/);
  expect(y.dropped).toMatch(/yesterday/);
  const flat = { ...overview, markets: overview.markets.map((m) => ({ ...m, longs: 0, shorts: 0, fundingRate: -0.00001 })) };
  expect((await chat('long short skew', {}, { ...data, overview: async () => flat })).text).toMatch(/no open positions/);
  expect((await chat('funding', {}, { ...data, overview: async () => flat })).text).toMatch(/shorts pay\./);
});

it('answers the window asked or says which one it answered, and what it does not know', async () => {
  expect((await chat('BTC volume this week', {}, data)).text).toBe("BTC traded $11M over the last 7 days, 67% of Perpl's volume.");
  const liqs = await chat('liquidations this month', {}, data);
  expect(liqs.text).toMatch(/in the last 24 hours\. Only the 24-hour total is kept/);
  expect((await chat('and this month?', { last: { kind: 'metric', metric: 'liqs' } }, data)).text).toMatch(/Only the 24-hour total is kept/);
  const all = await chat('and all time?', { last: { kind: 'top', days: 7, sort: 'net', n: 3 } }, data);
  expect([all.intent, all.dropped]).toEqual([{ kind: 'top', days: 90, sort: 'net', n: 3 }, 'all time (no such window), so the last 90 days']);
  expect((await chat('and 14 days?', { last: { kind: 'screen', presets: ['whales'] } }, data)).dropped).toBe('14 days (no such window), so the last 7 days');
  expect((await chat('and 14 days?', { last: { kind: 'metric', metric: 'volume' } }, data)).intent).toEqual({ kind: 'metric', metric: 'volume', range: 7 });

  const odd = { ...overview, markets: [{ ...overview.markets[0], fundingUnknown: true as const }, { ...overview.markets[1], fundingRate: 0, longs: 0, shorts: 0 }] };
  const d2 = { ...data, overview: async () => odd };
  expect((await chat('BTC funding', {}, d2)).text).toBe('BTC funding is unavailable right now.');
  expect((await chat('SOL funding', {}, d2)).text).toMatch(/: nobody pays\.$/);
  expect((await chat('funding', {}, d2)).text).toMatch(/^Highest funding: SOL at .*, nobody pays\./);
  expect((await chat('SOL skew', {}, d2)).text).toBe('SOL has no open positions right now.');

  // On a wallet's page "explain" alone is the wallet; "explain funding" is the word.
  expect((await chat('explain funding', { wallet: '7' }, data)).text).toMatch(/^Funding is a payment/);
  expect((await chat('explain', { wallet: '7' }, data)).text).toMatch(/^No Perpl account/);
});

it('lets the model quote only the figures it was given', async () => {
  const { quotesOnly } = await import('./answer');
  const sheet = '24h volume $1.5M, all time $1.0B. BTC: price 64123.4, 24h -1.20%, funding 8.8% a year.';
  expect(quotesOnly('Volume was $1,500,000 (or $1.50M), BTC at $64,123, down 1.2%, funding 8.8%.', sheet)).toBe(true);
  expect(quotesOnly('Volume was $2.3M.', sheet)).toBe(false);
  expect(quotesOnly('BTC holds 67% of it.', sheet)).toBe(false);
  expect(quotesOnly('BTC rose 8%.', `Figures as of 2026-10-12T08:00 UTC. ${sheet}`)).toBe(false);
});
