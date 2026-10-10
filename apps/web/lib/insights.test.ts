import { describe, expect, it } from 'vitest';
import type { PxWallet } from '@monday/core';
import { walletInsights } from './insights';

const base = (): PxWallet => ({
  network: 'mainnet', address: '0x1', account: 1, balanceUsd: 100, lockedUsd: 0, frozen: false, equityUsd: 120, positions: [], trades: [], flows: [{ ts: 0, kind: 'deposit', usd: 100 }],
  fills: { total: 10, used: 10, since: 0 }, historyComplete: true, rank: { days: 30, accounts: 1000, volumePct: 0.4, pnlPct: 0.02 },
  performance: {
    trades: 20, closes: 10, volumeUsd: 1000, makerVolumeUsd: 100, feesUsd: 2, fundingUsd: 0, pnlUsd: 30, netUsd: 28, winRate: 0.6, profitFactor: 0.8, grossWinUsd: 40, grossLossUsd: 50,
    avgWinUsd: 6.7, avgLossUsd: 12.5, largestWinUsd: 10, largestLossUsd: 30, maxDrawdownUsd: 5, longestWin: 2, longestLoss: 3, avgHoldMin: 10, firstTs: 0, lastTs: 1,
    sides: { long: { closes: 10, wins: 6, netUsd: 28, volumeUsd: 1000 }, short: { closes: 0, wins: 0, netUsd: 0, volumeUsd: 0 } },
    byMarket: [{ sym: 'BTC', trades: 20, closes: 10, wins: 6, volumeUsd: 1000, feesUsd: 2, netUsd: 28 }], daily: [], hours: Array(24).fill(0), curve: [],
  },
});

describe('wallet insights', () => {
  it('names the win-rate trap, the one big loss, the taker style and the return on deposits', () => {
    const lines = walletInsights(base()).map((i) => i.text);
    expect(lines.some((l) => l.startsWith('Wins 60% of closes but still loses money'))).toBe(true);
    expect(lines.some((l) => l.includes('One fill lost $30'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Takes liquidity: 90%'))).toBe(true);
    expect(lines.some((l) => l === 'Only ever long.')).toBe(true);
    expect(lines.some((l) => l === 'Equity is up 20% on $100 net deposited.')).toBe(true);
    expect(lines.some((l) => l === 'Top 2% by realised PnL among the 1,000 accounts active in the last 30 days.')).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(6);
  });
  it('says so when there is too little to judge', () => {
    const w = base();
    w.performance.closes = 2;
    expect(walletInsights(w)).toEqual([{ tone: 'neutral', text: 'Only 2 closing fills so far: too few to judge a style.' }]);
  });
});
