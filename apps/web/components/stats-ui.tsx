'use client';

import { ArrowDownRightIcon, ArrowUpRightIcon, StarIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { animate, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { PxOverview } from '@monday/core';
import { api } from '@/lib/api';
import { cx } from './ui';

// Shared pieces of the public Perpl stats pages. Same tokens as the terminal: mono numerals, 12px workhorse text,
// teal and vermilion for long and short, amber only for what the viewer marked as theirs (watched wallets).

/** $8.57B, $13.3M, $640k, $12.40 */
export function money(n: number | null | undefined, cents = false): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: cents || a < 100 ? 2 : 0, maximumFractionDigits: cents || a < 100 ? 2 : 0 })}`;
}
export const signedMoney = (n: number) => `${n > 0 ? '+' : ''}${money(n, true)}`;

/** Prices across markets that span 0.006 to 86,000: keep about five significant digits. */
export function price(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  const a = Math.abs(n);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : Math.min(8, 4 - Math.floor(Math.log10(a)));
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const pct = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`);
export const tone = (n: number | null | undefined) => (n == null ? 'text-fg-3' : n > 0 ? 'text-bid-fg' : n < 0 ? 'text-ask-fg' : 'text-fg-2');
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const ago = (ts: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`;
};

/** A labelled number in a gap-px grid cell. */
/** Distance to liquidation, coloured as it closes in. Null: the position cannot be liquidated. */
export const liqText = (d: number | null, digits = 2) => (d == null ? 'n/a' : `${d.toFixed(digits)}%`);
export const liqTone = (d: number | null) => (d == null ? 'text-fg-3' : d < 2 ? 'text-ask-fg' : d < 5 ? 'text-warn' : 'text-fg-2');
/** Profit factor as a reader expects it: a ratio, "no losses" when every close won, or n/a without closes. */
export const profitText = (p: { profitFactor: number | null; winRate: number | null }) => (p.profitFactor != null ? p.profitFactor.toFixed(2) : p.winRate === 1 ? 'no losses' : 'n/a');

/**
 * A figure that counts to its value: from zero when it first appears, from the previous value when it changes, with a
 * short tint so a live update is seen. Under reduced motion it simply shows the value.
 */
export function Num({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  const fmt = useRef(format);
  fmt.current = format; // formatters are written inline; a new identity must not restart or cut the tween
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (reduce || !Number.isFinite(value) || from === value) {
      el.textContent = fmt.current(value);
      return;
    }
    if (from != null) {
      el.classList.remove('flash-num');
      void el.offsetWidth; // restart the animation
      el.classList.add('flash-num');
    }
    const c = animate(from ?? 0, value, { duration: from == null ? 1 : 0.6, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { el.textContent = fmt.current(v); } });
    return () => c.stop();
  }, [value, reduce]);
  return <span ref={ref} className={cx('inline-block rounded-[2px]', className)}>{format(value)}</span>;
}

/** Change against an earlier value, signed, coloured by whether up is good. */
export function Delta({ now, prev, up = 'good', suffix, className }: { now: number | null | undefined; prev: number | null | undefined; up?: 'good' | 'bad' | 'none'; suffix?: string; className?: string }) {
  if (now == null || prev == null || !Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  const d = (now / prev - 1) * 100;
  if (!Number.isFinite(d)) return null;
  const good = up === 'none' ? null : (up === 'good') === d >= 0;
  const Icon = d >= 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span className={cx('num inline-flex items-center gap-0.5 text-[11px]', good == null ? 'text-fg-2' : good ? 'text-bid-fg' : 'text-ask-fg', className)}>
      <Icon size={10} weight="bold" />{Math.abs(d) >= 100 ? d.toFixed(0) : Math.abs(d).toFixed(1)}%{suffix && <span className="font-sans text-fg-3"> {suffix}</span>}
    </span>
  );
}

export function Kpi({ k, v, n, format, sub, t, hint, delta, spark }: {
  k: string; v?: ReactNode; n?: number | null; format?: (v: number) => string; sub?: ReactNode; t?: number | null; hint?: string; delta?: ReactNode; spark?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 bg-canvas px-3 py-2.5" title={hint}>
      <div className="min-w-0">
        <dt className="label truncate">{k}</dt>
        <dd className={cx('num mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[19px] font-medium leading-none tracking-tight', t === undefined ? 'text-fg' : tone(t))}>
          {n != null && format ? <Num value={n} format={format} /> : v}
          {delta}
        </dd>
        {sub != null && <dd className="mt-1.5 truncate text-[11px] text-fg-3">{sub}</dd>}
      </div>
      {spark && <div className="h-7 w-14 opacity-80 sm:w-16" aria-hidden>{spark}</div>}
    </div>
  );
}

/** Tabs with one underline that slides to the chosen tab. */
export function Tabs<T extends string>({ value, options, onChange, label, size = 'md', className }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; className?: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div role="tablist" aria-label={label} className={cx('no-bar flex min-w-0 overflow-x-auto', size === 'md' ? 'h-9 gap-0' : 'h-8 gap-2', className)}>
      {options.map(([v, text]) => (
        <button key={String(v)} role="tab" aria-selected={v === value} onClick={() => onChange(v)} className={cx('relative flex flex-none items-center transition-colors duration-150', size === 'md' ? 'px-3 text-[12.5px]' : 'px-1 text-[12px]', v === value ? 'font-semibold text-fg' : 'text-fg-3 hover:text-fg')}>
          {text}
          {v === value && <motion.span layoutId={`${id}-u`} aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}

/** An account, by address when known: every one of them opens its wallet page. */
export function AccountLink({ account, address, className }: { account: number; address?: string | null; className?: string }) {
  return (
    <Link href={`/analytics/wallet/${address || account}`} className={cx('num text-fg underline-offset-2 hover:text-accent hover:underline', className)}>
      {address ? shortAddress(address) : `#${account}`}
    </Link>
  );
}

/** Long/short split as a two-tone bar plus counts. */
export function Skew({ longs, shorts }: { longs: number; shorts: number }) {
  const n = longs + shorts;
  const l = n ? (longs / n) * 100 : 50;
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="num text-bid-fg">{longs}</span>
      <span className="flex h-1.5 w-16 overflow-hidden rounded-[1px] bg-raised-2" aria-hidden>
        <span className="h-full bg-bid" style={{ width: `${l}%` }} />
        <span className="h-full flex-1 bg-ask" />
      </span>
      <span className="num text-ask-fg">{shorts}</span>
    </span>
  );
}

/**
 * One wallet, however it was reached: account number, lower-case address or checksummed address. The account number is
 * the identity; an address is only another way to type it.
 */
export type WalletRef = { account: number | null; address: string };
export const walletKey = (w: WalletRef) => (w.account != null ? String(w.account) : w.address.toLowerCase());
export const sameWallet = (q: string, w: WalletRef) => q.toLowerCase() === walletKey(w) || (!!w.address && q.toLowerCase() === w.address.toLowerCase());

/**
 * Wallets the viewer watches, kept in this browser only and per network (an account number means a different wallet on
 * testnet). Storage can be blocked; then the list simply stays empty.
 */
/** The network the public stats read: the overview the analytics header already polls, shared through its cache. */
export const useStatsNetwork = () => useQuery({ queryKey: ['stats-overview'], queryFn: () => api<PxOverview>('/stats/overview'), refetchInterval: 15_000 }).data?.network;

const LEGACY_KEY = 'monday.stats.watch'; // before 2026-10-10: one list for every network, entries as typed
export function useWatchlist(network: string | undefined) {
  const key = network ? `monday.stats.watch.${network}` : null;
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    if (!key) return;
    try {
      let saved = localStorage.getItem(key);
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (saved == null && legacy != null) {
        // The old list was kept by the mainnet deployment; it moves to the first network that asks, normalised.
        saved = JSON.stringify([...new Set((JSON.parse(legacy) as string[]).map((q) => q.toLowerCase()))]);
        localStorage.setItem(key, saved);
        localStorage.removeItem(LEGACY_KEY);
      }
      setList(JSON.parse(saved ?? '[]'));
    } catch {
      setList([]);
    }
  }, [key]);
  const save = useCallback((next: string[]) => {
    setList(next);
    try {
      if (key) localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // per-browser convenience only
    }
  }, [key]);
  const has = (w: WalletRef) => list.some((q) => sameWallet(q, w));
  // Watching stores the account number; un-watching removes every way the wallet was ever stored.
  const toggle = (w: WalletRef) => save(has(w) ? list.filter((q) => !sameWallet(q, w)) : [...list, walletKey(w)].slice(-12));
  return { list, has, toggle };
}

export function WatchButton({ wallet, network }: { wallet: WalletRef; network: string }) {
  const w = useWatchlist(network);
  const on = w.has(wallet);
  return (
    <button type="button" onClick={() => w.toggle(wallet)} aria-pressed={on} className={cx('inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[12px]', on ? 'border-accent/45 bg-accent/12 text-accent' : 'border-line-2 text-fg-2 hover:bg-raised')}>
      <StarIcon size={12} weight={on ? 'fill' : 'regular'} /> {on ? 'Watching' : 'Watch'}
    </button>
  );
}

/** A small segmented control, the same one the analytics pages use: the filled pill slides to the chosen option. */
export function Segments<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div role="tablist" aria-label={label} className="flex rounded-sm border border-line-2 p-px">
      {options.map(([v, text]) => (
        <button key={String(v)} role="tab" aria-selected={v === value} onClick={() => onChange(v)} className={cx('num relative h-[22px] px-2 text-[11px] transition-colors duration-200', v === value ? 'text-canvas' : 'text-fg-2 hover:text-fg')}>
          {v === value && <motion.span layoutId={`${id}-p`} aria-hidden className="absolute inset-0 rounded-[3px] bg-fg" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 45 }} />}
          <span className="relative">{text}</span>
        </button>
      ))}
    </div>
  );
}
