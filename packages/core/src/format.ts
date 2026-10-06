// Plain-language copy shared by the server (decision reasons) and the web app.
// No em dashes anywhere in user-facing strings.

import type { MarketSym, Policy, PolicyLimits } from './types';

export function usd(n: number, digits = 0): string {
  const a = Math.abs(n);
  const s = a.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '-' : ''}$${s}`;
}

/** $640k, $1.8M */
export function usdCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}

export function policySummary(p: PolicyLimits & { markets: MarketSym[] }): string {
  const mk = p.markets.length > 1 ? `${p.markets.slice(0, -1).join(', ')} and ${p.markets.at(-1)}` : p.markets[0];
  return `Monday will quote ${usd(p.quoteSizeUsd)} on each side of ${mk}, keep up to ${usd(p.maxInventoryUsd)} of inventory per market, and stop for the day if it loses ${usd(p.maxDailyLossUsd)}.`;
}

export function policyForHash(p: Policy) {
  return {
    mode: p.mode,
    markets: [...p.markets].sort(),
    preset: p.preset,
    quoteSizeUsd: p.quoteSizeUsd,
    maxInventoryUsd: p.maxInventoryUsd,
    minHalfSpreadBps: p.minHalfSpreadBps,
    maxDailyLossUsd: p.maxDailyLossUsd,
    maxLeverage: p.maxLeverage,
  };
}
