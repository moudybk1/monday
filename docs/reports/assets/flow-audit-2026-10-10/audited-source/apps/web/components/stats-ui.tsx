'use client';

import { StarIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
export function Kpi({ k, v, sub, t, hint }: { k: string; v: ReactNode; sub?: ReactNode; t?: number | null; hint?: string }) {
  return (
    <div className="bg-canvas px-3 py-2.5" title={hint}>
      <dt className="label">{k}</dt>
      <dd className={cx('num mt-1.5 text-[19px] font-medium leading-none tracking-tight', t === undefined ? 'text-fg' : tone(t))}>{v}</dd>
      {sub != null && <dd className="mt-1.5 truncate text-[11px] text-fg-3">{sub}</dd>}
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

/** Wallets the viewer watches, kept in this browser only. Storage can be blocked; then the list simply stays empty. */
const KEY = 'monday.stats.watch';
export function useWatchlist() {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    try {
      setList(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
    } catch {
      setList([]);
    }
  }, []);
  const save = useCallback((next: string[]) => {
    setList(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // per-browser convenience only
    }
  }, []);
  const toggle = useCallback((q: string) => save(list.includes(q) ? list.filter((x) => x !== q) : [...list, q].slice(-12)), [list, save]);
  return { list, toggle, has: (q: string) => list.includes(q) };
}

export function WatchButton({ q }: { q: string }) {
  const w = useWatchlist();
  const on = w.has(q);
  return (
    <button type="button" onClick={() => w.toggle(q)} aria-pressed={on} className={cx('inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[12px]', on ? 'border-accent/45 bg-accent/12 text-accent' : 'border-line-2 text-fg-2 hover:bg-raised')}>
      <StarIcon size={12} weight={on ? 'fill' : 'regular'} /> {on ? 'Watching' : 'Watch'}
    </button>
  );
}

/** A small segmented control, the same one the analytics pages use. */
export function Segments<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-sm border border-line-2">
      {options.map(([v, text]) => (
        <button key={String(v)} role="tab" aria-selected={v === value} onClick={() => onChange(v)} className={cx('num h-6 px-2 text-[11px]', v === value ? 'bg-fg text-canvas' : 'text-fg-2 hover:bg-raised')}>{text}</button>
      ))}
    </div>
  );
}
