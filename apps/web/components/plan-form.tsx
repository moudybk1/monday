'use client';

// The setup for Agentic Trade and TWAP: connect Perpl if needed, pick a side, size the trade and its risk, review and
// place. The numbers and the checks are core's planNumbers and planProblems, the same ones the server runs.

import { CheckIcon, ShieldCheckIcon, TrendDownIcon, TrendUpIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BIAS_LABEL, ENTRY_LABEL, PLAN_DEFAULTS, PLAN_RULES, STYLE_LABEL, planNumbers, planProblems, twapSlicesFor,
  type Bias, type DashboardState, type EntryKind, type MarketSpec, type MarketSym, type PlanField, type PlanInput, type PlanView, type TwapStyle,
} from '@monday/core';
import { AccountStep, Heading, KeyStep, type PerplAccount } from './perpl-connect';
import { Chip, Choices, Line, Money, Row, SEG, Slider, levTicks, money, parse } from './policy-form';
import { Button, INPUT, Notice, Panel, Skeleton, cx } from './ui';
import { api } from '@/lib/api';
import { fmtPrice } from '@/lib/format';
import { useAppConfig, useMe } from '@/lib/wallet';

type Kind = PlanInput['kind'];

interface Draft {
  bias: Bias | null;
  sym: MarketSym | null;
  margin: string;
  leverage: number;
  entry: EntryKind;
  entryPrice: string;
  expiryHours: number;
  sl: string;
  /** Empty: no take profit. */
  tp: string;
  durationMin: number;
  /** Empty: about one slice a minute. */
  slices: string;
  style: TwapStyle;
  limit: string;
}

const blank = (kind: Kind): Draft => ({
  bias: null, sym: null, margin: '', leverage: PLAN_DEFAULTS.trade.leverage, entry: 'market', entryPrice: '', expiryHours: PLAN_DEFAULTS.trade.expiryHours,
  sl: String(PLAN_DEFAULTS.trade.stopLossPct), tp: kind === 'trade' ? String(PLAN_DEFAULTS.trade.takeProfitPct) : '',
  durationMin: PLAN_DEFAULTS.twap.durationMin, slices: '', style: PLAN_DEFAULTS.twap.style, limit: '',
});

const opt = (s: string) => (s.trim() === '' ? null : parse(s));

function toInput(kind: Kind, d: Draft): PlanInput | null {
  if (!d.bias || !d.sym) return null;
  const common = { sym: d.sym, bias: d.bias, marginUsd: parse(d.margin), leverage: d.leverage, stopLossPct: parse(d.sl), takeProfitPct: opt(d.tp) };
  if (kind === 'trade') return { kind, ...common, entry: d.entry, entryPrice: d.entry === 'market' ? null : parse(d.entryPrice), expiryHours: d.expiryHours };
  return { kind, ...common, durationMin: d.durationMin, slices: opt(d.slices) ?? twapSlicesFor(d.durationMin), style: d.style, limitPrice: opt(d.limit) };
}

const COPY = {
  trade: {
    steps: ['Wallet', 'Perpl account', 'Trade key', 'Direction', 'Size and risk', 'Review'],
    title: 'Agentic Trade',
  },
  twap: {
    steps: ['Wallet', 'Perpl account', 'Trade key', 'Direction', 'Order', 'Review'],
    title: 'TWAP',
  },
};
const [ACCOUNT, KEY, DIRECTION, SETTINGS, REVIEW] = [1, 2, 3, 4, 5];

const ENTRY_NOTE: Record<EntryKind, (b: Bias) => string> = {
  market: () => 'Enters now at the best price on the book, within 0.5% of the mark.',
  limit: (b) => `Waits for the price to come to yours and ${b === 'long' ? 'buys' : 'sells'} there as a maker order: a pullback entry.`,
  stop: (b) => `Enters once the mark breaks ${b === 'long' ? 'above' : 'below'} the level: a breakout entry, at market.`,
};
const STYLE_NOTE: Record<TwapStyle, string> = {
  passive: 'Maker orders only, at the best price on the book. The cheapest, but a slice the market never reaches stays unfilled.',
  balanced: 'Each slice rests as a maker order first; what is left at its end is taken at market. Finishes on time.',
  aggressive: 'Takes every slice at market. Certain and quick, and pays the taker fee each time.',
};
const DURATIONS = [15, 30, 60, 120, 240];

export function PlanWizard({ kind }: { kind: Kind }) {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const qc = useQueryClient();
  const router = useRouter();
  const account = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<PerplAccount>('/perpl/account'), refetchInterval: (q) => (q.state.data?.exists ? 30_000 : 8_000) });
  // Prices for every market: the public preview carries them without a running agent.
  const market = useQuery({ queryKey: ['preview'], queryFn: () => api<DashboardState | null>('/public/preview'), refetchInterval: 3_000 });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanView[]>('/plans'), enabled: me.hasKey, refetchInterval: 10_000 });

  const [draft, setDraft] = useState<Draft>(() => blank(kind));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const [step, setStep] = useState(DIRECTION);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const specs = cfg?.specs ?? {};
  const running = (plans.data ?? []).filter((p) => p.status !== 'done');
  const makerMarkets = me.policy?.markets ?? [];
  const planMarkets = running.map((p) => p.input.sym);
  const balance = account.data?.balanceUsd ?? null;
  const input = toInput(kind, draft);
  const spec = draft.sym ? specs[draft.sym] : undefined;
  const mark = draft.sym ? market.data?.markets[draft.sym]?.mark ?? null : null;
  const problems: Partial<Record<PlanField, string>> = input ? planProblems(input, spec, { mark, balanceUsd: balance, makerMarkets, planMarkets, activePlans: running.length }) : {};
  const ok = Boolean(input) && Object.keys(problems).length === 0;

  const reachable = !account.data?.exists ? ACCOUNT : !me.hasKey ? KEY : !draft.bias ? DIRECTION : !ok ? SETTINGS : REVIEW;
  useEffect(() => {
    if (account.data) setStep((s) => Math.min(Math.max(s, me.hasKey ? DIRECTION : ACCOUNT), reachable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.data?.exists, me.hasKey]);
  const current = Math.min(step, reachable);

  const place = async () => {
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api<PlanView>('/plans', { method: 'POST', body: input });
      await qc.invalidateQueries({ queryKey: ['plans'] });
      router.push(`/app?m=${v.input.sym}&tab=plans`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place it.');
      setBusy(false);
    }
  };

  const steps = COPY[kind].steps;
  return (
    <div className="grid gap-10 py-10 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10 md:py-14">
      <nav aria-label={`${COPY[kind].title} steps`}>
        <p className="mb-3 hidden text-[12px] font-medium uppercase tracking-[0.06em] text-fg-3 md:block">{COPY[kind].title}</p>
        <ol className="flex gap-1 overflow-x-auto md:block md:space-y-1">
          {steps.map((label, i) => {
            const done = i < current || i === 0;
            const active = i === current;
            return (
              <li key={label} className="shrink-0">
                <button
                  type="button" disabled={i === 0 || i > reachable || (i < DIRECTION && me.hasKey && Boolean(account.data?.exists))} onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                  className={cx('flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm disabled:cursor-default', active ? 'bg-raised font-semibold' : 'text-fg-2', i <= reachable && i > 0 && !active && 'hover:bg-raised')}
                >
                  <span className={cx('num grid size-6 shrink-0 place-items-center rounded-sm border text-[12px]', done && !active ? 'border-fg bg-fg text-canvas' : active ? 'border-transparent bg-accent text-accent-fg' : 'border-line-2 text-fg-3')}>
                    {done && !active ? <CheckIcon size={12} weight="bold" /> : i + 1}
                  </span>
                  <span className={cx('whitespace-nowrap', !active && 'hidden md:inline')}>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={cx('min-w-0', current !== SETTINGS && 'max-w-[46rem]')}>
        {current === ACCOUNT && <AccountStep wallet={me.demo ? null : me.wallet} account={account.data} loading={account.isLoading} error={account.error} retry={() => void account.refetch()} next={() => setStep(KEY)} />}
        {current === KEY && (
          <KeyStep
            sim={Boolean(cfg?.sim || cfg?.paper)} paper={Boolean(cfg?.paper)} perplUrl={cfg?.perplAppUrl ?? ''} hasKey={me.hasKey} revoked={me.keyStatus === 'revoked'}
            next={async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), account.refetch()]); setStep(DIRECTION); }}
          />
        )}
        {current === DIRECTION && <DirectionStep kind={kind} value={draft.bias} onPick={(bias) => { set({ bias }); setStep(SETTINGS); }} />}
        {current === SETTINGS && (
          <SettingsStep
            kind={kind} draft={draft} set={set} problems={problems} input={input} specs={specs} prices={market.data?.markets ?? {}} balance={balance}
            blocked={(s) => (makerMarkets.includes(s) ? 'market maker' : planMarkets.includes(s) ? 'plan running' : null)}
            sim={Boolean(cfg?.sim || cfg?.paper)} ok={ok} next={() => setStep(REVIEW)}
          />
        )}
        {current === REVIEW && input && spec && mark && (
          <ReviewStep
            input={input} spec={spec} mark={mark} balance={balance} realFunds={Boolean(cfg?.realFunds)} networkName={cfg?.networkName ?? ''} sim={Boolean(cfg?.sim || cfg?.paper)}
            accepted={accepted} onAccept={setAccepted} busy={busy} error={error} onPlace={place} onEdit={() => setStep(SETTINGS)}
          />
        )}
        {current === REVIEW && !mark && <Skeleton className="h-64" />}
      </div>
    </div>
  );
}

function DirectionStep({ kind, value, onPick }: { kind: Kind; value: Bias | null; onPick: (b: Bias) => void }) {
  return (
    <div>
      <Heading title={kind === 'trade' ? 'Long or short?' : 'Buy or sell?'}>
        {kind === 'trade'
          ? 'Pick the side you expect to win. Monday enters for you and keeps the position protected by a stop loss on Perpl from the first fill.'
          : 'A TWAP opens a position in slices over time, so one large order does not move a thin book. Pick the side to build.'}
      </Heading>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {(['long', 'short'] as const).map((b) => {
          const on = value === b;
          const long = b === 'long';
          return (
            <button
              key={b} type="button" aria-pressed={on} onClick={() => onPick(b)}
              className={cx('flex flex-col items-start gap-3 rounded-sm border p-5 text-left transition-colors', on ? (long ? 'border-bid bg-bid/10' : 'border-ask bg-ask/12') : 'border-line-2 hover:bg-raised')}
            >
              <span className={cx('grid size-9 place-items-center rounded-sm', long ? 'bg-bid/15 text-bid-fg' : 'bg-ask/15 text-ask-fg')}>{long ? <TrendUpIcon size={18} /> : <TrendDownIcon size={18} />}</span>
              <span className="text-[17px] font-semibold">{kind === 'twap' ? (long ? 'Buy (long)' : 'Sell (short)') : BIAS_LABEL[b]}</span>
              <span className="text-[13px] text-fg-2">{long ? 'Profits when the price rises.' : 'Profits when the price falls.'} {long ? 'Buys to open, sells to close.' : 'Sells to open, buys back to close.'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const roundTick = (v: number, tick: number) => Number((Math.round(v / tick) * tick).toPrecision(12));

function SettingsStep({ kind, draft, set, problems, input, specs, prices, balance, blocked, sim, ok, next }: {
  kind: Kind; draft: Draft; set: (p: Partial<Draft>) => void; problems: Partial<Record<PlanField, string>>; input: PlanInput | null;
  specs: Partial<Record<MarketSym, MarketSpec>>; prices: DashboardState['markets']; balance: number | null;
  blocked: (s: MarketSym) => string | null; sim: boolean; ok: boolean; next: () => void;
}) {
  const sym = draft.sym;
  const spec = sym ? specs[sym] : undefined;
  const m = sym ? prices[sym] : undefined;
  const mark = m?.mark ?? null;
  const long = draft.bias === 'long';
  const maxLev = spec?.maxLeverage ?? 10;
  const symbols = (Object.keys(specs) as MarketSym[]);
  const n = input && spec && mark && !problems.marginUsd && !problems.leverage && !problems.entryPrice ? planNumbers(input, spec, mark) : null;
  const px = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? fmtPrice(v, spec) : '-');
  const suggest = (e: EntryKind) => {
    if (!mark || !spec || e === 'market') return '';
    const away = (e === 'limit') === long ? -0.005 : 0.005; // a limit waits on the better side, a stop beyond the price
    return String(roundTick(mark * (1 + away), spec.priceTick));
  };
  const pick = (s: MarketSym) => {
    const sp = specs[s]!;
    set({ sym: s, leverage: Math.min(draft.leverage, sp.maxLeverage), entryPrice: '' });
  };

  return (
    <div className="@container">
      <div className="mb-6">
        <h1 className="display text-3xl md:text-4xl">{kind === 'trade' ? 'Size and risk' : 'The order'}</h1>
        <p className="mt-3 max-w-[60ch] text-fg-2">
          {kind === 'trade'
            ? `One market, one ${long ? 'long' : 'short'}. Margin times leverage is the position; the stop loss decides what it can lose.`
            : `How much to ${long ? 'buy' : 'sell'}, over how long, and the price it must not pass.`}
        </p>
      </div>
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:items-start">
        <Panel title="Settings" aside={<span className={cx('num font-medium', long ? 'text-bid-fg' : 'text-ask-fg')}>{kind === 'twap' ? (long ? 'Buy' : 'Sell') : BIAS_LABEL[draft.bias ?? 'long']}{sym ? ` ${sym}` : ''}</span>}>
          <div className="grid gap-x-5 gap-y-5 p-4 @2xl:grid-cols-2">
            <Choices legend="Market" note={sym && m ? <span className="num">{sym} {px(m.mark)}{m.day.changePct != null && <span className={m.day.changePct >= 0 ? 'text-bid-fg' : 'text-ask-fg'}> {m.day.changePct >= 0 ? '+' : ''}{m.day.changePct.toFixed(2)}% 24h</span>}</span> : 'One market per plan. Markets the market maker quotes, or another plan trades, are taken.'} error={problems.sym} grid wide>
              {symbols.map((s) => {
                const why = blocked(s);
                return <Chip key={s} type="radio" name="market" boxed checked={sym === s} disabled={why !== null} onChange={() => pick(s)}><span title={why ? `Taken: ${why}` : undefined}>{s}</span></Chip>;
              })}
            </Choices>

            <Row id="margin" label="Margin" note={balance != null ? `Collateral the position takes. Your Perpl balance is ${money(balance, 2)}.` : 'Collateral the position takes from your Perpl balance.'} error={problems.marginUsd}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Money id="margin" value={draft.margin} invalid={!!problems.marginUsd} onChange={(margin) => set({ margin })} />
                <div role="group" aria-label="Margin as a share of the balance" className={SEG}>
                  {[0.1, 0.25, 0.5].map((f) => {
                    const v = balance != null ? Math.floor(balance * f * 100) / 100 : NaN;
                    return <Chip key={f} type="radio" name="margin-share" checked={parse(draft.margin) === v} disabled={!(v >= PLAN_RULES.minMarginUsd)} onChange={() => set({ margin: String(v) })}>{f * 100}%</Chip>;
                  })}
                </div>
              </div>
            </Row>
            <Row id="leverage" label="Leverage" value={`${draft.leverage}x`} note={`Up to ${maxLev}x on ${sym ?? 'this market'}. The position is ${n ? money(n.notionalUsd, 2) : 'margin times leverage'}.`} error={problems.leverage}>
              <Slider id="leverage" min={1} max={maxLev} step={1} value={draft.leverage} unit="x" ticks={levTicks(maxLev)} onChange={(leverage) => set({ leverage })} />
            </Row>

            {kind === 'trade' ? (
              <>
                <Choices legend="Entry" note={ENTRY_NOTE[draft.entry](draft.bias ?? 'long')}>
                  {(['market', 'limit', 'stop'] as const).map((e) => (
                    <Chip key={e} type="radio" name="entry" checked={draft.entry === e} onChange={() => set({ entry: e, entryPrice: suggest(e) })}>{ENTRY_LABEL[e]}</Chip>
                  ))}
                </Choices>
                {draft.entry !== 'market' ? (
                  <Row id="entry-price" label={draft.entry === 'limit' ? 'Limit price' : 'Breakout level'} note={mark ? `Mark ${px(mark)}.` : ' '} error={problems.entryPrice}>
                    <Num id="entry-price" value={draft.entryPrice} invalid={!!problems.entryPrice} onChange={(entryPrice) => set({ entryPrice })} />
                  </Row>
                ) : <div className="max-@2xl:hidden" />}
                {draft.entry !== 'market' && (
                  <Choices legend="Waits for" note="If it has not entered by then, Monday gives the entry up." error={problems.expiryHours}>
                    {[4, 24, 72, 168].map((h) => <Chip key={h} type="radio" name="expiry" checked={draft.expiryHours === h} onChange={() => set({ expiryHours: h })}>{h < 24 ? `${h} h` : `${h / 24} d`}</Chip>)}
                  </Choices>
                )}
              </>
            ) : (
              <>
                <Choices legend="Duration" note={`${input?.kind === 'twap' ? input.slices : twapSlicesFor(draft.durationMin)} slices, one every ${n?.twap ? Math.round(n.twap.intervalSec) : '-'} s, about ${n?.twap ? money(n.twap.sliceUsd, 2) : '-'} each.`} error={problems.durationMin}>
                  {DURATIONS.map((d) => <Chip key={d} type="radio" name="duration" checked={draft.durationMin === d} onChange={() => set({ durationMin: d })}>{d < 60 ? `${d} m` : `${d / 60} h`}</Chip>)}
                </Choices>
                <Row id="slices" label="Slices" note="Empty: about one a minute. Each slice is given or taken a fifth so the pattern is not exact." error={problems.slices}>
                  <Num id="slices" value={draft.slices} placeholder={`Auto (${twapSlicesFor(draft.durationMin)})`} invalid={!!problems.slices} onChange={(slices) => set({ slices })} step={1} />
                </Row>
                <Choices legend="Execution" note={STYLE_NOTE[draft.style]} wide>
                  {(['passive', 'balanced', 'aggressive'] as const).map((s) => <Chip key={s} type="radio" name="style" checked={draft.style === s} onChange={() => set({ style: s })}>{STYLE_LABEL[s]}</Chip>)}
                </Choices>
                <Row id="limit" label={long ? 'Highest price' : 'Lowest price'} note={`No slice ${long ? 'buys above' : 'sells below'} this; slices wait or are skipped instead. Empty: no limit.`} error={problems.limitPrice}>
                  <Num id="limit" value={draft.limit} placeholder="No limit" invalid={!!problems.limitPrice} onChange={(limit) => set({ limit })} />
                </Row>
              </>
            )}

            <Row id="sl" label="Stop loss" value={n ? px(n.slPrice) : undefined} note={n ? `Loses about ${money(n.lossUsd, 2)}, ${n.lossOfMarginPct.toFixed(0)}% of the margin. Liquidation is about ${n.liqPct.toFixed(2)}% away.` : 'Required: how far the price may move against you.'} error={problems.stopLossPct}>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                <div role="group" aria-label="Stop loss presets" className={SEG}>
                  {[1, 2, 3, 5].map((pct) => <Chip key={pct} type="radio" name="sl" checked={parse(draft.sl) === pct} onChange={() => set({ sl: String(pct) })}>{pct}%</Chip>)}
                </div>
                <Pct id="sl" value={draft.sl} invalid={!!problems.stopLossPct} onChange={(sl) => set({ sl })} />
              </div>
            </Row>
            <Row id="tp" label="Take profit" value={n?.tpPrice ? px(n.tpPrice) : undefined} note={n?.profitUsd != null ? `Makes about ${money(n.profitUsd, 2)} after fees.` : 'Off: the position stays open until the stop loss, or until you close it.'} error={problems.takeProfitPct}>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                <div role="group" aria-label="Take profit presets" className={SEG}>
                  {[null, 2, 4, 8].map((pct) => <Chip key={pct ?? 'off'} type="radio" name="tp" checked={opt(draft.tp) === pct} onChange={() => set({ tp: pct == null ? '' : String(pct) })}>{pct == null ? 'Off' : `${pct}%`}</Chip>)}
                </div>
                <Pct id="tp" value={draft.tp} placeholder="Off" invalid={!!problems.takeProfitPct} onChange={(tp) => set({ tp })} />
              </div>
            </Row>
          </div>
        </Panel>

        <Panel title="Pre-trade summary" aside={sym ?? ''}>
          <Summary kind={kind} input={input} n={n} spec={spec} mark={mark} balance={balance} sim={sim} />
          <div className="grid gap-2 border-t border-line p-3">
            <Button size="lg" className="w-full" onClick={next} disabled={!ok}>Review</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Summary({ kind, input, n, spec, mark, balance, sim }: { kind: Kind; input: PlanInput | null; n: ReturnType<typeof planNumbers> | null; spec?: MarketSpec; mark: number | null; balance: number | null; sim: boolean }) {
  const px = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? fmtPrice(v, spec) : '-');
  const entry = !input ? '-' : input.kind === 'twap' ? `${input.slices} slices, ${STYLE_LABEL[input.style].toLowerCase()}`
    : input.entry === 'market' ? `Market, about ${px(mark)}` : `${ENTRY_LABEL[input.entry]} at ${px(input.entryPrice)}`;
  return (
    <>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 p-3 text-[12.5px]">
        <Line k="Balance on Perpl" v={balance == null ? '-' : money(balance, 2)} />
        <Line k="Margin" v={input ? money(input.marginUsd, 2) : '-'} />
        <Line k="Position" v={n ? `${n.size} ${input?.sym}, ${money(n.notionalUsd, 2)}` : '-'} />
        <Line k={kind === 'twap' ? 'Execution' : 'Entry'} v={entry} />
        <Line k="Liquidation" v={n ? `about ${px(n.liqPrice)}` : '-'} />
        <Line k="Stop loss" v={n ? `${px(n.slPrice)}, -${money(n.lossUsd, 2)}` : '-'} tone="text-ask-fg" />
        <Line k="Take profit" v={n?.tpPrice ? `${px(n.tpPrice)}, +${money(n.profitUsd ?? 0, 2)}` : 'Off'} tone={n?.tpPrice ? 'text-bid-fg' : undefined} />
        <Line k="Reward to risk" v={n?.rr != null ? n.rr.toFixed(2) : '-'} />
        <Line k="Fees in and out" v={n ? money(n.feesUsd, 2) : '-'} />
      </dl>
      <p className="flex gap-2 border-t border-line px-3 py-2.5 text-[12px] text-fg-3">
        <ShieldCheckIcon size={15} className="mt-px flex-none text-accent" />
        <span>
          The stop loss{input?.takeProfitPct ? ' and take profit' : ''} {sim ? 'rest on the exchange' : 'rest on Perpl itself'} from the first fill{kind === 'twap' ? ', priced from where the TWAP starts' : ''}, so they hold even while Monday is offline. A fast market can fill past them.
        </span>
      </p>
    </>
  );
}

function ReviewStep({ input, spec, mark, balance, realFunds, networkName, sim, accepted, onAccept, busy, error, onPlace, onEdit }: {
  input: PlanInput; spec: MarketSpec; mark: number; balance: number | null; realFunds: boolean; networkName: string; sim: boolean;
  accepted: boolean; onAccept: (v: boolean) => void; busy: boolean; error: string | null; onPlace: () => void; onEdit: () => void;
}) {
  const n = planNumbers(input, spec, mark);
  const px = (v: number | null) => (v != null ? fmtPrice(v, spec) : '-');
  const long = input.bias === 'long';
  const rows: [string, ReactNode][] = [
    ['Market', `${input.sym}, ${input.kind === 'twap' ? (long ? 'buy' : 'sell') : input.bias}`],
    ['Margin and leverage', `${money(input.marginUsd, 2)} at ${input.leverage}x`],
    ['Position', `${n.size} ${input.sym} (${money(n.notionalUsd, 2)})`],
    input.kind === 'trade'
      ? ['Entry', input.entry === 'market' ? 'Market, now' : `${ENTRY_LABEL[input.entry]} at ${px(input.entryPrice)}, waits ${input.expiryHours < 24 ? `${input.expiryHours} h` : `${input.expiryHours / 24} d`}`]
      : ['Execution', `${input.slices} slices over ${input.durationMin < 60 ? `${input.durationMin} min` : `${input.durationMin / 60} h`}, ${STYLE_LABEL[input.style].toLowerCase()}${input.limitPrice ? `, ${long ? 'at most' : 'at least'} ${px(input.limitPrice)}` : ''}`],
    ['Stop loss', `${px(n.slPrice)} (${input.stopLossPct}%), about -${money(n.lossUsd, 2)}`],
    ['Take profit', n.tpPrice ? `${px(n.tpPrice)} (${input.takeProfitPct}%), about +${money(n.profitUsd ?? 0, 2)}` : 'Off'],
    ['Liquidation', `about ${px(n.liqPrice)}`],
  ];
  return (
    <div>
      <Heading title="Review and place">
        {input.kind === 'trade'
          ? `Monday ${input.entry === 'market' ? 'enters now' : input.entry === 'limit' ? 'waits for your price' : 'waits for the breakout'}, then rests the stop loss${input.takeProfitPct ? ' and take profit' : ''} on ${sim ? 'the exchange' : 'Perpl'}. You can cancel or close it from the terminal at any time.`
          : `Monday ${long ? 'buys' : 'sells'} in ${input.slices} slices over ${input.durationMin} minutes and protects the position from the first fill. You can stop it from the terminal at any time.`}
      </Heading>
      <dl className="mt-8 grid border-t border-line-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="border-b border-line py-3 sm:odd:pr-5 sm:even:border-l sm:even:pl-5">
            <dt className="text-[12px] text-fg-3">{k}</dt>
            <dd className="num mt-0.5 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {balance != null && input.marginUsd > balance * 0.9 && <div className="mt-6"><Notice tone="warn">This uses most of your balance. A position this size leaves little room for the market maker or another plan.</Notice></div>}
      {error && <p role="alert" className="mt-6 text-[13px] text-ask-fg">{error}</p>}
      {realFunds && (
        <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-sm border border-ask/60 bg-ask/8 p-3.5 text-[13px]">
          <input type="checkbox" checked={accepted} onChange={(e) => onAccept(e.target.checked)} className="mt-0.5 size-4 flex-none accent-[var(--ask)]" />
          <span>
            <strong>This trades real funds on {networkName}.</strong> Monday will open this position in your Perpl account. The stop loss limits the loss in a normal market, not in a gap, and leverage multiplies both ways. I accept that risk.
          </span>
        </label>
      )}
      <div className="mt-8 flex flex-wrap gap-2.5">
        <Button size="lg" onClick={onPlace} disabled={busy || (realFunds && !accepted)}>{busy ? 'Placing' : input.kind === 'trade' ? (input.entry === 'market' ? 'Place trade' : 'Place and wait') : 'Start TWAP'}</Button>
        <Button size="lg" variant="ghost" onClick={onEdit} disabled={busy}>Edit</Button>
      </div>
    </div>
  );
}

/** A plain number field, for prices and counts. */
function Num({ id, value, invalid, onChange, placeholder, step = 'any' }: { id: string; value: string; invalid: boolean; onChange: (s: string) => void; placeholder?: string; step?: number | 'any' }) {
  return <input id={id} type="number" inputMode="decimal" min={0} step={step} value={value} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={`${id}-note`} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, 'num', invalid && 'border-ask')} />;
}

function Pct({ id, value, invalid, onChange, placeholder }: { id: string; value: string; invalid: boolean; onChange: (s: string) => void; placeholder?: string }) {
  return (
    <div className="relative min-w-0">
      <input id={id} type="number" inputMode="decimal" min={0} step="any" value={value} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={`${id}-note`} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, 'num pr-6', invalid && 'border-ask')} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-fg-3">%</span>
    </div>
  );
}
