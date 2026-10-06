'use client';

import { useState } from 'react';
import { MARKETS, PRESETS, balanceNeededUsd, limitsForBalance, limitsFromMargin, usd, type MarketSpec, type MarketSym, type PolicyLimits, type PresetName } from '@monday/core';
import { INPUT, cx } from './ui';

export type Caps = Pick<PolicyLimits, 'quoteSizeUsd' | 'maxInventoryUsd' | 'maxDailyLossUsd'>;

export interface PolicyDraft {
  preset: PresetName;
  markets: MarketSym[];
  limits: PolicyLimits;
}

export const draftFrom = (p?: Partial<PolicyDraft> & Partial<PolicyLimits> | null): PolicyDraft => ({
  preset: p?.preset ?? 'balanced',
  markets: p?.markets?.length ? p.markets : ['BTC'],
  limits: p && 'quoteSizeUsd' in p && p.quoteSizeUsd ? { quoteSizeUsd: p.quoteSizeUsd, maxInventoryUsd: p.maxInventoryUsd!, minHalfSpreadBps: p.minHalfSpreadBps!, maxDailyLossUsd: p.maxDailyLossUsd!, maxLeverage: p.maxLeverage! } : PRESETS[p?.preset && p.preset !== 'custom' ? p.preset : 'balanced'],
});

const ROWS: { key: keyof PolicyLimits; label: string; help: string; fmt: (v: number) => string; step: number }[] = [
  { key: 'quoteSizeUsd', label: 'Quote size per side', help: 'How much Monday offers to buy and to sell at once.', fmt: (v) => usd(v), step: 10 },
  { key: 'maxInventoryUsd', label: 'Max inventory', help: 'The largest position Monday may build in one market.', fmt: (v) => usd(v), step: 50 },
  { key: 'minHalfSpreadBps', label: 'Min half-spread', help: 'The closest Monday quotes to fair price. 1 bp is 0.01%.', fmt: (v) => `${v} bps`, step: 0.5 },
  { key: 'maxDailyLossUsd', label: 'Daily loss limit', help: 'Monday kills itself for the day at this loss.', fmt: (v) => usd(v), step: 5 },
  { key: 'maxLeverage', label: 'Max leverage', help: 'Cap on position size relative to your balance.', fmt: (v) => `${v}x`, step: 0.5 },
];
const NAMES: { id: PresetName; label: string; note: string }[] = [
  { id: 'conservative', label: 'Conservative', note: 'Small and wide' },
  { id: 'balanced', label: 'Balanced', note: 'A sensible start' },
  { id: 'active', label: 'Active', note: 'Larger and tighter' },
  { id: 'high', label: 'High leverage', note: 'Balanced at 10x' },
  { id: 'custom', label: 'Custom', note: 'Set each limit' },
];

// While real funds are at stake the server caps every policy; presets above the cap are shown but locked.
const overCap = (l: PolicyLimits, caps: Caps | null) => Boolean(caps && (l.quoteSizeUsd > caps.quoteSizeUsd || l.maxInventoryUsd > caps.maxInventoryUsd || l.maxDailyLossUsd > caps.maxDailyLossUsd));

/** Same rule the server applies on save (FR-POL-2). Unknown balance: let the server decide. */
export const draftFits = (d: PolicyDraft, balance: number | null) => balance == null || balanceNeededUsd(d.limits, d.markets.length) <= balance;

/** A first draft that will save: Balanced, else Conservative, else Conservative shrunk to the balance. */
export function draftForBalance(balance: number, caps: Caps | null, markets: MarketSym[] = ['BTC']): PolicyDraft {
  for (const id of ['balanced', 'conservative'] as const) {
    if (balanceNeededUsd(PRESETS[id], markets.length) <= balance && !overCap(PRESETS[id], caps)) return { preset: id, markets, limits: PRESETS[id] };
  }
  return { preset: 'custom', markets, limits: limitsForBalance(balance, markets.length) };
}

export function PolicyForm({ value, onChange, available, caps = null, balance = null, specs = {} }: { value: PolicyDraft; onChange: (d: PolicyDraft) => void; available: MarketSym[]; caps?: Caps | null; balance?: number | null; specs?: Partial<Record<MarketSym, Pick<MarketSpec, 'maxLeverage'>>> }) {
  const pick = (id: PresetName) => onChange({ ...value, preset: id, limits: id === 'custom' ? value.limits : PRESETS[id] });
  const toggle = (m: MarketSym) => {
    const next = value.markets.includes(m) ? value.markets.filter((x) => x !== m) : [...value.markets, m];
    if (next.length) onChange({ ...value, markets: MARKETS.filter((x) => next.includes(x)) });
  };
  const limitsOf = (id: PresetName) => (id === 'custom' ? value.limits : PRESETS[id]);
  const need = (id: PresetName) => balanceNeededUsd(limitsOf(id), value.markets.length);
  // A preset the account cannot carry is shown with what it needs, and locked like a capped one.
  const short = (id: PresetName) => balance != null && id !== 'custom' && need(id) > balance;
  const locked = (id: PresetName) => (id !== 'custom' && overCap(PRESETS[id], caps)) || short(id);
  const fits = draftFits(value, balance);
  const fit = () => balance != null && onChange({ ...value, preset: 'custom', limits: limitsForBalance(balance, value.markets.length) });
  // The highest leverage every selected market allows.
  const maxLev = Math.min(...value.markets.map((m) => specs[m]?.maxLeverage ?? 10));

  return (
    <div className="grid gap-8">
      <fieldset>
        <legend className="text-[13px] font-medium">Markets</legend>
        <div className="mt-2 flex gap-2">
          {MARKETS.map((m) => {
            const on = value.markets.includes(m);
            const ok = available.includes(m);
            return (
              <label key={m} className={cx('flex h-10 cursor-pointer items-center gap-2 rounded-sm border px-4 text-sm font-medium has-focus-visible:outline-2', on ? 'border-fg bg-fg text-canvas' : 'border-line-2 hover:border-fg', !ok && 'cursor-not-allowed opacity-40')}>
                <input type="checkbox" className="sr-only" checked={on} disabled={!ok} onChange={() => toggle(m)} />
                {m}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-fg-3">Each market gets its own bid, ask and inventory limit.</p>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-medium">Risk preset</legend>
        {/* Desktop: one table, a column per preset. The whole column is the radio. */}
        <div className="mt-2 hidden grid-cols-[minmax(9rem,1.2fr)_repeat(5,minmax(0,1fr))] grid-rows-[auto_repeat(5,2.5rem)] border-y border-line-2 sm:grid">
          <div className="row-span-6 grid grid-rows-subgrid text-[13px] text-fg-2">
            <span />
            {ROWS.map((r) => <span key={r.key} className="flex items-center border-t border-line" title={r.help}>{r.label}</span>)}
          </div>
          {NAMES.map((n) => {
            const on = value.preset === n.id;
            const l = limitsOf(n.id);
            return (
              <label key={n.id} className={cx('row-span-6 grid grid-rows-subgrid text-center has-focus-visible:outline-2', locked(n.id) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer', on ? 'bg-raised' : !locked(n.id) && 'hover:bg-raised/60')}>
                <span className={cx('px-2 py-3', on && 'bg-accent/12 shadow-[inset_0_2px_0_var(--accent)]')}>
                  <input type="radio" name="preset" className="sr-only" checked={on} disabled={locked(n.id)} onChange={() => pick(n.id)} />
                  <span className={cx('block text-sm font-semibold', on && 'text-accent')}>{n.label}</span>
                  <span className="block text-[12px] text-fg-3">{short(n.id) ? `Needs ${usd(need(n.id))}` : n.note}</span>
                </span>
                {ROWS.map((r) => (
                  <span key={r.key} className="num flex items-center justify-center border-t border-line px-2 text-sm">
                    {n.id === 'custom' && on ? (
                      <input
                        type="number" inputMode="decimal" min={0} step={r.step} aria-label={r.label} value={value.limits[r.key]}
                        onChange={(e) => onChange({ ...value, limits: { ...value.limits, [r.key]: Number(e.target.value) } })}
                        className="num h-8 w-full rounded-sm border border-line-2 bg-canvas px-2 text-center text-sm focus:border-fg focus:outline-none"
                      />
                    ) : n.id === 'custom' ? <span className="text-fg-3">yours</span> : r.fmt(l[r.key])}
                  </span>
                ))}
              </label>
            );
          })}
        </div>
        {/* Mobile: one row per preset. */}
        <div className="mt-2 grid gap-2 sm:hidden">
          {NAMES.map((n) => {
            const on = value.preset === n.id;
            const l = limitsOf(n.id);
            return (
              <label key={n.id} className={cx('block rounded-sm border p-3', locked(n.id) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer', on ? 'border-fg bg-raised' : 'border-line-2')}>
                <input type="radio" name="preset-m" className="sr-only" checked={on} disabled={locked(n.id)} onChange={() => pick(n.id)} />
                <span className={cx('text-sm font-semibold', on && 'text-accent')}>{n.label}</span>{short(n.id) && <span className="ml-2 text-[12px] text-fg-3">Needs {usd(need(n.id))}</span>}
                <span className="num mt-1 block text-[12.5px] text-fg-2">{usd(l.quoteSizeUsd)} per side, up to {usd(l.maxInventoryUsd)}, stop at {usd(-l.maxDailyLossUsd)}</span>
              </label>
            );
          })}
          {value.preset === 'custom' && ROWS.map((r) => (
            <label key={r.key} className="grid grid-cols-[1fr_7rem] items-center gap-3 text-[13px]">
              {r.label}
              <input type="number" inputMode="decimal" min={0} step={r.step} value={value.limits[r.key]} onChange={(e) => onChange({ ...value, limits: { ...value.limits, [r.key]: Number(e.target.value) } })} className={cx(INPUT, 'num text-right')} />
            </label>
          ))}
        </div>
      </fieldset>
      <MarginSizer markets={value.markets} maxLeverage={maxLev} balance={balance} caps={caps} onLimits={(limits) => onChange({ ...value, preset: 'custom', limits })} />
      {balance != null && (
        <p role={fits ? undefined : 'alert'} className={cx('-mt-4 text-[13px]', fits ? 'text-fg-3' : 'text-ask-fg')}>
          {fits
            ? <>Uses up to <span className="num">{usd(balanceNeededUsd(value.limits, value.markets.length))}</span> of your <span className="num">{usd(balance)}</span> collateral.</>
            : <>These limits need <span className="num">{usd(balanceNeededUsd(value.limits, value.markets.length))}</span> of collateral and the account has <span className="num">{usd(balance)}</span>.</>}
          {!fits && <button type="button" onClick={fit} className="ml-2 font-medium text-fg underline underline-offset-2 hover:text-accent">Fit to my balance</button>}
        </p>
      )}
      {caps && (
        <p className="-mt-4 text-[12.5px] text-fg-3">
          Real funds: this server caps every policy at {usd(caps.quoteSizeUsd)} per side, {usd(caps.maxInventoryUsd)} of inventory per market and a {usd(caps.maxDailyLossUsd)} daily loss limit. Larger presets are locked until the operator raises the caps.
        </p>
      )}
    </div>
  );
}

/**
 * Tread-style sizing: say how much collateral to commit and at what leverage, and Monday derives the limits.
 * Every change writes a Custom policy, so the numbers stay editable in the Custom column.
 */
function MarginSizer({ markets, maxLeverage, balance, caps, onLimits }: { markets: MarketSym[]; maxLeverage: number; balance: number | null; caps: Caps | null; onLimits: (l: PolicyLimits) => void }) {
  const [margin, setMargin] = useState(() => String(Math.floor(balance ?? 200)));
  const [lev, setLev] = useState(() => Math.min(10, maxLeverage));
  const leverage = Math.min(lev, maxLeverage);
  const derived = (m: string, l: number): PolicyLimits => {
    const raw = limitsFromMargin(Math.max(0, Number(m) || 0), l, markets.length);
    // On real funds the operator caps still win.
    return caps ? { ...raw, quoteSizeUsd: Math.min(raw.quoteSizeUsd, caps.quoteSizeUsd), maxInventoryUsd: Math.min(raw.maxInventoryUsd, caps.maxInventoryUsd), maxDailyLossUsd: Math.min(raw.maxDailyLossUsd, caps.maxDailyLossUsd) } : raw;
  };
  const l = derived(margin, leverage);
  const apply = (m: string, v: number) => {
    setMargin(m);
    setLev(v);
    onLimits(derived(m, v));
  };

  return (
    <fieldset className="-mt-2">
      <legend className="text-[13px] font-medium">Or size from margin and leverage</legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
        <div className="flex flex-col gap-2">
          <label htmlFor="sizer-margin" className="text-[12.5px] text-fg-2">Margin to commit</label>
          <input id="sizer-margin" type="number" inputMode="decimal" min={0} step={10} value={margin} onChange={(e) => apply(e.target.value, leverage)} className={cx(INPUT, 'num')} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="sizer-lev" className="flex justify-between text-[12.5px] text-fg-2">
            Leverage <span className="num text-fg">{leverage}x <span className="text-fg-3">of {maxLeverage}x max</span></span>
          </label>
          <input id="sizer-lev" type="range" min={1} max={maxLeverage} step={0.5} value={leverage} onChange={(e) => apply(margin, Number(e.target.value))} className="h-9 w-full accent-[var(--accent)]" />
        </div>
      </div>
      <p className="num mt-2 text-[12.5px] text-fg-2">
        {usd(l.quoteSizeUsd)} per side, up to {usd(l.maxInventoryUsd)} per market, stop for the day at {usd(-l.maxDailyLossUsd)}.
        <span className="font-sans text-fg-3"> A tenth of the margin is the daily loss limit. Higher leverage means less collateral per dollar of inventory, and a closer liquidation price on Perpl.</span>
      </p>
    </fieldset>
  );
}

/** What gets sent to PUT /api/policy. */
export const toBody = (d: PolicyDraft) => ({ preset: d.preset, markets: d.markets, ...(d.preset === 'custom' ? { limits: d.limits } : {}) });
