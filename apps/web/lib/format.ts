import type { MarketSpec } from '@monday/core';

const decimals = (step: number) => Math.max(0, Math.round(-Math.log10(step)));

export const fmtPrice = (p: number, spec?: Pick<MarketSpec, 'priceTick'>) =>
  p.toLocaleString('en-US', { minimumFractionDigits: decimals(spec?.priceTick ?? 0.01), maximumFractionDigits: decimals(spec?.priceTick ?? 0.01) });

export const fmtSize = (s: number, spec?: Pick<MarketSpec, 'sizeStep'>) => s.toFixed(Math.min(5, decimals(spec?.sizeStep ?? 0.001)));

export const fmtUsd = (n: number, digits = 2) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export function fmtSigned(n: number, digits = 2) {
  const r = Number(n.toFixed(digits)); // -0.001 must not print as "-$0.00"
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}$${Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const fmtBps = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

export const fmtTime = (t: number, seconds = true) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
