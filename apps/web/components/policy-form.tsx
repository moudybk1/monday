'use client';

import { CaretDownIcon, CheckIcon, SlidersHorizontalIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MARKETS, PRESETS, balanceNeededUsd, fitLimits, usd, type MarketSpec, type MarketSym, type PolicyLimits, type PresetName } from '@monday/core';
import { INPUT, Panel, cx } from './ui';

export type Caps = Pick<PolicyLimits, 'quoteSizeUsd' | 'maxInventoryUsd' | 'maxDailyLossUsd'>;
type Specs = Partial<Record<MarketSym, Pick<MarketSpec, 'maxLeverage'>>>;

export interface PolicyDraft {
  preset: PresetName;
  markets: MarketSym[];
  limits: PolicyLimits;
  /** The margin as typed. Never saved: without it the form shows the collateral the limits need. */
  margin?: string;
}

export const draftFrom = (p?: Partial<PolicyDraft> & Partial<PolicyLimits> | null): PolicyDraft => ({
  preset: p?.preset ?? 'balanced',
  markets: p?.markets?.length ? p.markets : ['BTC'],
  limits: p && 'quoteSizeUsd' in p && p.quoteSizeUsd ? { quoteSizeUsd: p.quoteSizeUsd, maxInventoryUsd: p.maxInventoryUsd!, minHalfSpreadBps: p.minHalfSpreadBps!, maxDailyLossUsd: p.maxDailyLossUsd!, maxLeverage: p.maxLeverage! } : PRESETS[p?.preset && p.preset !== 'custom' ? p.preset : 'balanced'],
});

const TEMPLATES: { id: Exclude<PresetName, 'custom'>; label: string; note: string }[] = [
  { id: 'conservative', label: 'Conservative', note: 'Small and wide' },
  { id: 'balanced', label: 'Balanced', note: 'A sensible start' },
  { id: 'active', label: 'Active', note: 'Larger and tighter' },
  { id: 'high', label: 'High leverage', note: 'Balanced at 10x' },
];
const LOSS_PCT = [0.05, 0.1, 0.2];
const EPS = 1e-9;

/** Same rule the server applies on save (FR-POL-2). Unknown balance: let the server decide. */
export const draftFits = (d: PolicyDraft, balance: number | null) => balance == null || balanceNeededUsd(d.limits, d.markets.length) <= balance;

/** A first draft that will save: Balanced when the account carries it in full, else Conservative shrunk to fit. */
export function draftForBalance(balance: number, caps: Caps | null, markets: MarketSym[] = ['BTC']): PolicyDraft {
  const balanced = fitLimits(PRESETS.balanced, balance, markets.length, caps);
  return balanced === PRESETS.balanced ? { preset: 'balanced', markets, limits: balanced } : { preset: 'conservative', markets, limits: fitLimits(PRESETS.conservative, balance, markets.length, caps) };
}

/** The selected market with the lowest leverage cap, and that cap (the schema stops at 50x). */
function leverageCap(markets: MarketSym[], specs: Specs): { sym: MarketSym; max: number } {
  const sym = markets.reduce((a, m) => ((specs[m]?.maxLeverage ?? 10) < (specs[a]?.maxLeverage ?? 10) ? m : a));
  return { sym, max: Math.min(50, specs[sym]?.maxLeverage ?? 10) };
}

/**
 * Tread-style sizing: the margin, less the daily loss, at the chosen leverage carries the position limits, split
 * across markets, and a tenth of a limit is quoted per side. The operator caps win, and the quote is taken from the
 * capped limit, so a template and the margin give the same proportions under a cap.
 */
function sized(margin: number, l: Pick<PolicyLimits, 'maxLeverage' | 'maxDailyLossUsd'>, markets: number, caps: Caps | null): Pick<PolicyLimits, 'quoteSizeUsd' | 'maxInventoryUsd'> {
  const inv = Math.min(Math.max(0, Math.floor(((margin - l.maxDailyLossUsd) * l.maxLeverage) / markets + EPS)), caps?.maxInventoryUsd ?? Infinity);
  return { maxInventoryUsd: inv, quoteSizeUsd: Math.min(Math.floor(inv / 10), caps?.quoteSizeUsd ?? Infinity) };
}

type Problems = Partial<Record<keyof PolicyLimits | 'margin', string>>;

/** What the server would refuse (schema, operator caps, market leverage), said per field. The balance check is draftFits. */
export function draftProblems(d: PolicyDraft, caps: Caps | null, specs: Specs): Problems {
  const l = d.limits;
  const p: Problems = {};
  const over = (k: keyof Caps, schemaMax: number) => {
    const cap = Math.min(schemaMax, caps?.[k] ?? Infinity);
    return l[k] > cap ? `At most ${usd(cap)}${cap < schemaMax ? ' on this server while it trades real funds' : ''}.` : undefined;
  };
  p.maxDailyLossUsd = !(l.maxDailyLossUsd >= 1) ? 'At least $1.' : over('maxDailyLossUsd', 10_000);
  p.maxInventoryUsd = !(l.maxInventoryUsd >= 1) ? 'At least $1. Raise the margin or the leverage.' : over('maxInventoryUsd', 50_000);
  p.quoteSizeUsd = !(l.quoteSizeUsd >= 1) ? 'At least $1. Raise the position limit.' : l.quoteSizeUsd > l.maxInventoryUsd ? 'Cannot be more than the position limit.' : over('quoteSizeUsd', 5_000);
  if (!(l.minHalfSpreadBps >= 1 && l.minHalfSpreadBps <= 100)) p.minHalfSpreadBps = 'Between 1 and 100 bps.';
  const lev = leverageCap(d.markets, specs);
  if (!(l.maxLeverage >= 1)) p.maxLeverage = 'At least 1x.';
  else if (l.maxLeverage > lev.max) p.maxLeverage = `${lev.sym} allows at most ${lev.max}x.`;
  if (d.margin != null && !(Number(d.margin) > l.maxDailyLossUsd)) p.margin = 'Must be more than the daily loss limit.';
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Problems;
}

/** Ready to save: nothing the server would refuse and, when the balance is known, enough of it. */
export const draftOk = (d: PolicyDraft, balance: number | null, caps: Caps | null, specs: Specs) => draftFits(d, balance) && !Object.keys(draftProblems(d, caps, specs)).length;

const money = (v: number, digits = Number.isInteger(v) ? 0 : 2) => (Number.isFinite(v) ? usd(v, digits) : '-');
const parse = (s: string) => (s.trim() === '' ? NaN : Number(s));

/**
 * The bot settings editor, laid out like Tread's bot form: the inputs on the left, what they add up to on the right
 * next to the page's own action (`children`). Margin, leverage, daily loss and markets size the limits; typing a
 * position limit instead makes the margin follow it, so the two always agree.
 */
export function PolicyForm({ value, onChange, available, caps = null, balance = null, specs = {}, children }: { value: PolicyDraft; onChange: (d: PolicyDraft) => void; available: MarketSym[]; caps?: Caps | null; balance?: number | null; specs?: Specs; children?: ReactNode }) {
  const l = value.limits;
  const n = value.markets.length;
  const need = balanceNeededUsd(l, n);
  // The margin as shown, rounded up to the cent so it always carries the limits it came from. Resizing pins it, so
  // stepping the leverage back and forth cannot drift the limits through rounding.
  const shown = value.margin ?? (Number.isFinite(need) ? String(Math.ceil(need * 100 - 1e-6) / 100) : '');
  const marginNum = parse(shown);
  const lev = leverageCap(value.markets, specs);
  const bad = draftProblems(value, caps, specs);
  const fits = draftFits(value, balance);

  // Templates shrink to what the balance and the operator caps allow (the server applies the same fit on save).
  const fitted = (id: Exclude<PresetName, 'custom'>, markets = n) => fitLimits(PRESETS[id], balance ?? Infinity, markets, caps);
  const template = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (t) onChange({ preset: t.id, markets: value.markets, limits: fitted(t.id) });
  };
  const resize = (patch: Partial<Pick<PolicyLimits, 'maxLeverage' | 'maxDailyLossUsd'>>, markets = value.markets, typed = shown) => {
    const next = { ...l, ...patch };
    onChange({ preset: 'custom', markets, margin: typed, limits: { ...next, ...sized(parse(typed), next, markets.length, caps) } });
  };
  const toggle = (m: MarketSym) => {
    const next = MARKETS.filter((x) => (x === m ? !value.markets.includes(m) : value.markets.includes(x)));
    if (!next.length) return;
    if (value.preset !== 'custom') onChange({ ...value, markets: next, limits: fitted(value.preset, next.length) });
    else resize({}, next);
  };
  // A position limit typed by hand: the quote follows it at a tenth, and the margin shows what it now needs.
  const setLimit = (k: keyof PolicyLimits, v: number) => onChange({
    ...value, preset: 'custom', margin: k === 'maxInventoryUsd' ? undefined : value.margin,
    limits: { ...l, [k]: v, ...(k === 'maxInventoryUsd' && Number.isFinite(v) ? { quoteSizeUsd: Math.min(Math.max(1, Math.floor(v / 10)), caps?.quoteSizeUsd ?? Infinity) } : {}) },
  });

  // Shrink only what the balance cannot carry (quote size, inventory, daily loss), keeping the spread and leverage chosen.
  const [shrunk, setShrunk] = useState<{ from: PolicyLimits; to: PolicyLimits } | null>(null);
  const fit = () => {
    if (balance == null) return;
    const to = fitLimits(l, balance, n, caps);
    setShrunk({ from: l, to });
    onChange({ ...value, preset: 'custom', margin: undefined, limits: to });
  };
  useEffect(() => {
    if (shrunk && l !== shrunk.to) setShrunk(null); // any later edit retires the note
  }, [l, shrunk]);


  return (
    <div className="@container">
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:items-start">
        <Panel
          title="Settings"
          aside={
            <TemplateMenu
              current={TEMPLATES.find((t) => t.id === value.preset)?.label ?? 'Custom'}
              options={TEMPLATES.map((t) => {
                const f = fitted(t.id);
                const needs = balanceNeededUsd(f, n);
                return { ...t, on: value.preset === t.id, detail: `${usd(f.quoteSizeUsd)} per side, ${f.maxLeverage}x`, short: balance != null && needs > balance ? `Needs ${money(needs, 2)}` : null };
              })}
              onPick={template}
            />
          }
        >
          <div className="grid gap-x-5 gap-y-5 p-4 @2xl:grid-cols-2">
            <Choices legend="Markets" note="Each market gets its own bid, ask and position limit.">
              {MARKETS.map((m) => (
                <Chip key={m} type="checkbox" name="markets" checked={value.markets.includes(m)} disabled={!available.includes(m)} onChange={() => toggle(m)}>{m}</Chip>
              ))}
            </Choices>
            <Row id="leverage" label="Leverage" value={Number.isFinite(l.maxLeverage) ? `${l.maxLeverage}x` : '-'} note={`Up to ${lev.max}x for ${n > 1 ? 'these markets' : lev.sym}. Higher leverage needs less margin per dollar of position.`} error={bad.maxLeverage}>
              <Slider id="leverage" min={1} max={lev.max} step={0.5} value={l.maxLeverage} unit="x" ticks={levTicks(lev.max)} onChange={(v) => resize({ maxLeverage: v })} />
            </Row>

            <Row id="margin" label="Margin" note="Sizes the limits. It does not reserve or move funds." error={bad.margin}>
              <Money id="margin" value={shown} invalid={!!bad.margin} onChange={(s) => resize({}, value.markets, s)} />
            </Row>
            <Row id="loss" label="Daily loss limit" note="At this loss Monday stops and closes positions for the day. Resets 00:00 UTC." error={bad.maxDailyLossUsd}>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                <div role="group" aria-label="Daily loss as a share of margin" className={SEG}>
                  {LOSS_PCT.map((pct) => {
                    const v = Math.max(1, Math.floor(marginNum * pct + EPS));
                    return <Chip key={pct} type="radio" name="loss" checked={Number.isFinite(marginNum) && l.maxDailyLossUsd === v} disabled={!(marginNum > 0)} onChange={() => resize({ maxDailyLossUsd: v })}>{pct * 100}%</Chip>;
                  })}
                </div>
                <Money id="loss" value={num(l.maxDailyLossUsd)} invalid={!!bad.maxDailyLossUsd} onChange={(s) => resize({ maxDailyLossUsd: parse(s) })} />
              </div>
            </Row>

            <Row id="inventory" label="Position limit per market" note="Margin less the daily loss, times leverage, split across markets." error={bad.maxInventoryUsd}>
              <Money id="inventory" value={num(l.maxInventoryUsd)} invalid={!!bad.maxInventoryUsd} onChange={(s) => setLimit('maxInventoryUsd', parse(s))} />
            </Row>
            <Row id="quote" label="Quote per side" note="A tenth of the position limit. In a calm market one order may grow to 1.5 times it." error={bad.quoteSizeUsd}>
              <Money id="quote" value={num(l.quoteSizeUsd)} invalid={!!bad.quoteSizeUsd} onChange={(s) => setLimit('quoteSizeUsd', parse(s))} />
            </Row>

            <Row id="spread" label="Base spread" value={`${l.minHalfSpreadBps} bps`} note="How far from fair price Monday starts quoting; 1 bp is 0.01%. In a calm market it may quote at the best price instead." error={bad.minHalfSpreadBps} className="@2xl:col-span-2">
              <Slider id="spread" min={1} max={Math.max(20, l.minHalfSpreadBps || 0)} step={0.5} value={l.minHalfSpreadBps} unit=" bps" onChange={(v) => setLimit('minHalfSpreadBps', v)} />
            </Row>
          </div>
        </Panel>

        <Panel title="Summary" aside={value.markets.join(', ')}>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 p-3 text-[12.5px]">
            <Line k="Balance on Perpl" v={balance == null ? '-' : money(balance, 2)} />
            <Line k="Margin needed" v={money(need, 2)} tone={!fits ? 'text-ask-fg' : undefined} />
            <Line k="Quote per side" v={money(l.quoteSizeUsd)} />
            <Line k="Position limit" v={`${money(l.maxInventoryUsd)} per market`} />
            <Line k="Daily loss limit" v={money(l.maxDailyLossUsd)} />
            <Line k="Leverage" v={Number.isFinite(l.maxLeverage) ? `${l.maxLeverage}x` : '-'} />
            <Line k="Base spread" v={`${l.minHalfSpreadBps} bps`} />
          </dl>
          {balance != null && !fits && (
            <p role="alert" className="mx-3 mb-3 text-[12px] text-ask-fg">
              These limits need <span className="num">{money(need, 2)}</span> and the account has <span className="num">{money(balance, 2)}</span>.{' '}
              <button type="button" onClick={fit} className="font-medium text-fg underline underline-offset-2 hover:text-accent">Fit to my balance</button>
            </p>
          )}
          {shrunk && (
            <p role="status" className="num mx-3 mb-3 text-[12px] text-fg-2">
              <span className="font-sans">Fitted: </span>quote {money(shrunk.from.quoteSizeUsd)} to {money(shrunk.to.quoteSizeUsd)}, position {money(shrunk.from.maxInventoryUsd)} to {money(shrunk.to.maxInventoryUsd)}, daily loss {money(shrunk.from.maxDailyLossUsd)} to {money(shrunk.to.maxDailyLossUsd)}.
              <span className="font-sans text-fg-3"> Nothing is saved until you save.</span>
            </p>
          )}
          {caps && (
            <p className="mx-3 mb-3 text-[12px] text-fg-3">
              Real funds: this server caps every policy at <span className="num">{usd(caps.quoteSizeUsd)}</span> per side, <span className="num">{usd(caps.maxInventoryUsd)}</span> per market and a <span className="num">{usd(caps.maxDailyLossUsd)}</span> daily loss.
            </p>
          )}
          {children && <div className="grid gap-2 border-t border-line p-3">{children}</div>}
        </Panel>
      </div>
    </div>
  );
}

const num = (v: number) => (Number.isFinite(v) ? String(v) : '');

const SEG = 'flex h-9 min-w-0 overflow-hidden rounded-sm border border-line-2';

/** One option of a segmented control: a real radio or checkbox under the label, so keyboards and screen readers get the native behaviour. */
function Chip({ type, name, checked, disabled, onChange, children }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; disabled?: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className={cx('num flex min-w-0 flex-1 items-center justify-center border-l border-line-2 px-2 text-[12.5px] first:border-l-0 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2', checked ? 'bg-accent/12 font-semibold text-accent' : 'text-fg-2', disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer', !checked && !disabled && 'hover:bg-raised-2 hover:text-fg')}>
      <input type={type} name={name} className="sr-only" checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}

function Choices({ legend, note, error, children }: { legend: string; note: ReactNode; error?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[12.5px] font-medium">{legend}</legend>
      <div className={SEG}>{children}</div>
      <p className={cx('mt-2 text-[12px]', error ? 'text-ask-fg' : 'text-fg-3')}>{error ?? note}</p>
    </fieldset>
  );
}

function Row({ id, label, value, note, error, className, children }: { id: string; label: string; value?: string; note: ReactNode; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[12.5px] font-medium">{label}</label>
        {value && <span className="num text-[13px] font-semibold text-accent">{value}</span>}
      </div>
      {children}
      <p id={`${id}-note`} className={cx('text-[12px]', error ? 'text-ask-fg' : 'text-fg-3')}>{error ?? note}</p>
    </div>
  );
}

/** Leverage marks that stay readable on a linear scale: the common steps, dropped where they would crowd, and the cap. */
function levTicks(max: number): number[] {
  const out: number[] = [];
  for (const x of [1, 2, 3, 5, 10, 20, 25, 50, max]) {
    if (x > max || out.includes(x)) continue;
    if (out.length && (x - out[out.length - 1]) / (max - 1) < 0.09) {
      if (x !== max) continue;
      out.pop();
    }
    out.push(x);
  }
  return out;
}

/** A native range input (keyboard and screen readers for free) with the filled track and clickable marks under it. */
function Slider({ id, min, max, step, value, unit, ticks = [], onChange }: { id: string; min: number; max: number; step: number; value: number; unit: string; ticks?: number[]; onChange: (v: number) => void }) {
  const v = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const at = (x: number) => (max > min ? (x - min) / (max - min) : 0);
  return (
    <div className="grid gap-1 pt-1">
      <input id={id} type="range" min={min} max={max} step={step} value={v} aria-valuetext={`${v}${unit}`} aria-describedby={`${id}-note`} onChange={(e) => onChange(Number(e.target.value))} className="range w-full" style={{ '--p': at(v) } as CSSProperties} />
      {ticks.length > 0 && (
        <div className="relative h-4">
          {ticks.map((t) => (
            // The slider itself is the keyboard control; the marks are a shortcut for the pointer.
            <button key={t} type="button" tabIndex={-1} onClick={() => onChange(t)} style={{ left: `calc(7px + (100% - 14px) * ${at(t)})` }} className={cx('num absolute -translate-x-1/2 text-[11px] leading-4', t === value ? 'font-semibold text-accent' : 'text-fg-3 hover:text-fg')}>
              {t}{unit}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tread's preset picker: a button that names the template in use and opens the list, each with what it sets. Fills the form only. */
function TemplateMenu({ current, options, onPick }: { current: string; options: { id: string; label: string; note: string; detail: string; on: boolean; short: string | null }[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-controls="template-menu" onClick={() => setOpen((o) => !o)} className={cx('flex h-6 items-center gap-1.5 rounded-sm border bg-raised pl-1.5 pr-1 text-[12px] transition-colors', open ? 'border-accent' : 'border-line-2 hover:border-fg-3')}>
        <SlidersHorizontalIcon size={13} className="text-accent" />
        <span className="text-fg-3">Template</span>
        <span className="font-medium text-fg">{current}</span>
        <CaretDownIcon size={11} className={cx('text-fg-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id="template-menu" className="absolute right-0 top-full z-20 mt-1.5 w-[18.5rem] rounded-md border border-line-2 bg-raised p-1 shadow-[0_16px_40px_rgb(0_0_0/0.45)]">
          <p className="px-2 pb-1.5 pt-1 text-[11.5px] text-fg-3">Fills the form. Nothing changes until you save.</p>
          {options.map((o) => (
            <button
              key={o.id} type="button" disabled={!!o.short} onClick={() => { onPick(o.id); setOpen(false); }}
              className={cx('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-sm px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40', o.on ? 'bg-accent/12 shadow-[inset_2px_0_0_var(--accent)]' : 'not-disabled:hover:bg-raised-2')}
            >
              <span className={cx('text-[12.5px] font-medium', o.on ? 'text-accent' : 'text-fg')}>{o.label}</span>
              <span className="num text-[11.5px] text-fg-2">{o.detail}</span>
              <span className="text-[11.5px] text-fg-3">{o.short ?? o.note}</span>
              {o.on ? <CheckIcon size={12} weight="bold" className="justify-self-end text-accent" /> : <span />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Money({ id, value, invalid, onChange }: { id: string; value: string; invalid: boolean; onChange: (s: string) => void }) {
  return (
    <div className="relative min-w-0">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-fg-3">$</span>
      <input id={id} type="number" inputMode="decimal" min={0} step="any" value={value} aria-invalid={invalid || undefined} aria-describedby={`${id}-note`} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, 'num pl-6', invalid && 'border-ask')} />
    </div>
  );
}

function Line({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <>
      <dt className="text-fg-3">{k}</dt>
      <dd className={cx('num text-right', tone)}>{v}</dd>
    </>
  );
}

/** What gets sent to PUT /api/policy. */
export const toBody = (d: PolicyDraft) => ({ preset: d.preset, markets: d.markets, ...(d.preset === 'custom' ? { limits: d.limits } : {}) });
