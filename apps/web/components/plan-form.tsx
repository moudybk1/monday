'use client';

// The setup for Agentic Trade and TWAP: read the market, pick a side, size the trade and its risk, review and start. The Perpl key is
// already connected (the app asks for it once, right after the wallet). The numbers and the checks are core's
// planNumbers and planProblems, the same ones the server runs.

import { CheckIcon, ShieldCheckIcon, TrendDownIcon, TrendUpIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BIAS_LABEL, MODE_LABEL, PLAN_DEFAULTS, PLAN_RULES, SCALP_TARGET_ATR, STYLE_LABEL, TREND_LABEL, planNumbers, planProblems, scalpMode, twapSlicesFor,
  type Bias, type DashboardState, type MarketInsight, type MarketRead, type MarketSpec, type MarketSym, type PlanField, type PlanInput, type PlanView, type ScalpFrame, type Trend, type TwapStyle,
} from '@monday/core';
import { InsightCard } from './market-read';
import { Heading, type PerplAccount } from './perpl-connect';
import { Chip, Choices, Line, Money, Row, SEG, Slider, levTicks, money, parse } from './policy-form';
import { Button, INPUT, Notice, Panel, Skeleton, Tag, cx } from './ui';
import { api } from '@/lib/api';
import { fmtPrice } from '@/lib/format';
import { useAppConfig, useMe } from '@/lib/wallet';

type Kind = PlanInput['kind'];
type Read = { d1: Trend; h4: Trend; market: MarketRead };

interface Draft {
  bias: Bias | null;
  sym: MarketSym | null;
  margin: string;
  leverage: number;
  /** Agentic Trade */
  frame: ScalpFrame;
  lossLimit: string;
  /** Empty: no session target. */
  profitTarget: string;
  expiryHours: number;
  /** TWAP */
  durationMin: number;
  /** Empty: about one slice a minute. */
  slices: string;
  style: TwapStyle;
  limit: string;
  sl: string;
  tp: string;
}

const blank = (): Draft => ({
  bias: null, sym: null, margin: '', leverage: PLAN_DEFAULTS.trade.leverage,
  frame: PLAN_DEFAULTS.trade.frame, lossLimit: String(PLAN_DEFAULTS.trade.lossLimitPct), profitTarget: String(PLAN_DEFAULTS.trade.profitTargetPct), expiryHours: PLAN_DEFAULTS.trade.expiryHours,
  durationMin: PLAN_DEFAULTS.twap.durationMin, slices: '', style: PLAN_DEFAULTS.twap.style, limit: '', sl: String(PLAN_DEFAULTS.twap.stopLossPct), tp: '',
});

const opt = (s: string) => (s.trim() === '' ? null : parse(s));

function toInput(kind: Kind, d: Draft): PlanInput | null {
  if (!d.bias || !d.sym) return null;
  const common = { sym: d.sym, bias: d.bias, marginUsd: parse(d.margin), leverage: d.leverage };
  if (kind === 'trade') return { kind, ...common, frame: d.frame, lossLimitPct: parse(d.lossLimit), profitTargetPct: opt(d.profitTarget), expiryHours: d.expiryHours };
  return { kind, ...common, durationMin: d.durationMin, slices: opt(d.slices) ?? twapSlicesFor(d.durationMin), style: d.style, limitPrice: opt(d.limit), stopLossPct: parse(d.sl), takeProfitPct: opt(d.tp) };
}

const STEPS: Record<Kind, string[]> = { trade: ['Market', 'Direction', 'Size and risk', 'Review'], twap: ['Market', 'Direction', 'Order', 'Review'] };
const TITLE: Record<Kind, string> = { trade: 'Agentic Trade', twap: 'TWAP' };
const [MARKET, DIRECTION, SETTINGS, REVIEW] = [0, 1, 2, 3];

const STYLE_NOTE: Record<TwapStyle, string> = {
  passive: 'Maker orders only, at the best price on the book. The cheapest, but a slice the market never reaches stays unfilled.',
  balanced: 'Each slice rests as a maker order first; what is left at its end is taken at market. Finishes on time.',
  aggressive: 'Takes every slice at market. Certain and quick, and pays the taker fee each time.',
};
const DURATIONS = [15, 30, 60, 120, 240];
const SESSIONS = [4, 12, 24, 72];
const hours = (h: number) => (h < 24 ? `${h} h` : `${h / 24} d`);
const hoursLong = (h: number) => (h < 24 ? `${h} hours` : h === 24 ? '1 day' : `${h / 24} days`);

/** What the scalper does with the user's side, in words. */
function modeLine(bias: Bias, read: Read | undefined, frame: ScalpFrame): string {
  if (!read) return 'Reading D1 and H4.';
  const mode = scalpMode(bias, read.market);
  const side = bias === 'long' ? 'long' : 'short';
  if (!mode) return `D1 and H4 do not line up right now: Monday waits until both point the same way, then scalps your ${side}.`;
  return mode === 'follow'
    ? `Your ${side} follows the market: Monday ${bias === 'long' ? 'buys pullbacks' : 'sells rallies'} to the 20 EMA on the ${frame} chart, aiming ${SCALP_TARGET_ATR.follow} bar ranges out.`
    : `Your ${side} goes against the market: Monday only ${bias === 'long' ? 'buys a stretched RSI turning up' : 'sells a stretched RSI turning down'} on the ${frame} chart, aiming ${SCALP_TARGET_ATR.counter} bar range out.`;
}

export function PlanWizard({ kind }: { kind: Kind }) {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const qc = useQueryClient();
  const router = useRouter();
  const account = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<PerplAccount>('/perpl/account'), refetchInterval: 30_000 });
  // Prices for every market: the public preview carries them without a running agent.
  const market = useQuery({ queryKey: ['preview'], queryFn: () => api<DashboardState | null>('/public/preview'), refetchInterval: 3_000 });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanView[]>('/plans'), refetchInterval: 10_000 });

  const [draft, setDraft] = useState<Draft>(blank);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const read = useQuery({
    queryKey: ['plan-read', draft.sym], queryFn: () => api<Read>(`/plans/read?sym=${draft.sym}`), enabled: kind === 'trade' && draft.sym !== null, refetchInterval: 60_000,
  });
  const insight = useQuery({
    queryKey: ['plan-insight', draft.sym], queryFn: () => api<MarketInsight>(`/plans/insight?sym=${draft.sym}`), enabled: draft.sym !== null, staleTime: 5 * 60_000, retry: 1,
  });
  const [step, setStep] = useState(MARKET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const specs = cfg?.specs ?? {};
  const running = (plans.data ?? []).filter((p) => p.status !== 'done');
  const makerMarkets = me.makerMarkets;
  const planMarkets = running.map((p) => p.input.sym);
  const blocked = (s: MarketSym) => (makerMarkets.includes(s) ? 'market maker' : planMarkets.includes(s) ? 'plan running' : null);
  const pickSym = (s: MarketSym) => set({ sym: s, leverage: Math.min(draft.leverage, specs[s]?.maxLeverage ?? draft.leverage) });
  // The first read opens on its own: the market asked for (?m=), else the first one free, BTC first.
  useEffect(() => {
    if (draft.sym || !plans.data || !cfg) return;
    const free = (Object.keys(cfg.specs) as MarketSym[]).filter((s) => !blocked(s));
    const asked = new URLSearchParams(location.search).get('m') as MarketSym | null;
    const first = asked && free.includes(asked) ? asked : free.includes('BTC') ? 'BTC' : free[0];
    if (first) pickSym(first);
  }, [plans.data, cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  // What a new plan may use: the balance less what the market maker and the running plans already hold.
  const balance = account.data?.availableUsd ?? account.data?.balanceUsd ?? null;
  const total = account.data?.balanceUsd ?? null;
  const input = toInput(kind, draft);
  const spec = draft.sym ? specs[draft.sym] : undefined;
  const mark = draft.sym ? market.data?.markets[draft.sym]?.mark ?? null : null;
  const problems: Partial<Record<PlanField, string>> = input ? planProblems(input, spec, { mark, balanceUsd: balance, makerMarkets, planMarkets, activePlans: running.length }) : {};
  const ok = Boolean(input) && Object.keys(problems).length === 0;
  const reachable = !draft.sym ? MARKET : !draft.bias ? DIRECTION : !ok ? SETTINGS : REVIEW;
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
      setError(e instanceof Error ? e.message : 'Could not start it.');
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10 py-10 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10 md:py-14">
      <nav aria-label={`${TITLE[kind]} steps`}>
        <p className="mb-3 hidden text-[12px] font-medium uppercase tracking-[0.06em] text-fg-3 md:block">{TITLE[kind]}</p>
        <ol className="flex gap-1 overflow-x-auto md:block md:space-y-1">
          {STEPS[kind].map((label, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={label} className="shrink-0">
                <button
                  type="button" disabled={i > reachable} onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                  className={cx('flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm disabled:cursor-default', active ? 'bg-raised font-semibold' : 'text-fg-2', i <= reachable && !active && 'hover:bg-raised')}
                >
                  <span className={cx('num grid size-6 shrink-0 place-items-center rounded-sm border text-[12px]', done ? 'border-fg bg-fg text-canvas' : active ? 'border-transparent bg-accent text-accent-fg' : 'border-line-2 text-fg-3')}>
                    {done ? <CheckIcon size={12} weight="bold" /> : i + 1}
                  </span>
                  <span className={cx('whitespace-nowrap', !active && 'hidden md:inline')}>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={cx('min-w-0', current !== SETTINGS && 'max-w-[46rem]')}>
        {current === MARKET && (
          <MarketStep kind={kind} sym={draft.sym} symbols={Object.keys(specs) as MarketSym[]} blocked={blocked} prices={market.data?.markets ?? {}} specs={specs} insight={insight} onPick={pickSym} next={() => setStep(DIRECTION)} />
        )}
        {current === DIRECTION && <DirectionStep kind={kind} value={draft.bias} onPick={(bias) => { set({ bias }); setStep(SETTINGS); }} />}
        {current === SETTINGS && (
          <SettingsStep
            kind={kind} draft={draft} set={set} problems={problems} input={input} specs={specs} prices={market.data?.markets ?? {}} balance={balance} total={total} read={read.data}
            sim={Boolean(cfg?.sim || cfg?.paper)} ok={ok} next={() => setStep(REVIEW)} changeMarket={() => setStep(MARKET)}
          />
        )}
        {current === REVIEW && input && spec && mark && (
          <ReviewStep
            input={input} spec={spec} mark={mark} balance={balance} read={read.data} sim={Boolean(cfg?.sim || cfg?.paper)}
            busy={busy} error={error} onPlace={place} onEdit={() => setStep(SETTINGS)}
          />
        )}
        {current === REVIEW && !mark && <Skeleton className="h-64" />}
      </div>
    </div>
  );
}

/** The first step: a market, and its D1, H4 and H1 read before anything is set up. */
function MarketStep({ kind, sym, symbols, blocked, prices, specs, insight, onPick, next }: {
  kind: Kind; sym: MarketSym | null; symbols: MarketSym[]; blocked: (s: MarketSym) => string | null; prices: DashboardState['markets'];
  specs: Partial<Record<MarketSym, MarketSpec>>; insight: UseQueryResult<MarketInsight>; onPick: (s: MarketSym) => void; next: () => void;
}) {
  return (
    <div>
      <Heading title="Market read">Pick a market. Monday reads its D1, H4 and H1 trends first, then you set up the {kind === 'trade' ? 'trade' : 'TWAP'}.</Heading>
      <div className="mt-8 grid gap-6">
        <Choices legend="Market" note="One market per plan. Markets the market maker quotes, or another plan trades, are taken." grid wide>
          {symbols.map((s) => {
            const why = blocked(s);
            return <Chip key={s} type="radio" name="market" boxed checked={sym === s} disabled={why !== null} onChange={() => onPick(s)}><span title={why ? `Taken: ${why}` : undefined}>{s}</span></Chip>;
          })}
        </Choices>
        {sym && <InsightCard sym={sym} q={insight} m={prices[sym]} spec={specs[sym]} />}
        <div><Button size="lg" onClick={next} disabled={!sym}>Continue</Button></div>
      </div>
    </div>
  );
}

function DirectionStep({ kind, value, onPick }: { kind: Kind; value: Bias | null; onPick: (b: Bias) => void }) {
  return (
    <div>
      <Heading title={kind === 'trade' ? 'Long or short?' : 'Buy or sell?'}>
        {kind === 'trade'
          ? 'Your bias for the session. Monday reads D1 and H4 to see whether it follows the market or goes against it, then scalps that side on a short timeframe, again and again, until your stop loss or take profit.'
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

const trendTone = (t: Trend) => (t === 'bullish' ? 'bid' : t === 'bearish' ? 'ask' : 'neutral');

function SettingsStep({ kind, draft, set, problems, input, specs, prices, balance, total, read, sim, ok, next, changeMarket }: {
  kind: Kind; draft: Draft; set: (p: Partial<Draft>) => void; problems: Partial<Record<PlanField, string>>; input: PlanInput | null;
  specs: Partial<Record<MarketSym, MarketSpec>>; prices: DashboardState['markets']; balance: number | null; total: number | null; read: Read | undefined;
  sim: boolean; ok: boolean; next: () => void; changeMarket: () => void;
}) {
  const sym = draft.sym;
  const spec = sym ? specs[sym] : undefined;
  const m = sym ? prices[sym] : undefined;
  const mark = m?.mark ?? null;
  const long = draft.bias === 'long';
  const maxLev = spec?.maxLeverage ?? 10;
  const n = input && spec && mark && !problems.marginUsd && !problems.leverage ? planNumbers(input, spec, mark) : null;
  const px = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? fmtPrice(v, spec) : '-');
  const marginNum = parse(draft.margin);
  const ofMargin = (pct: string) => (marginNum > 0 && parse(pct) > 0 ? money((marginNum * parse(pct)) / 100, 2) : null);

  return (
    <div className="@container">
      <div className="mb-6">
        <h1 className="display text-3xl md:text-4xl">{kind === 'trade' ? 'Size and risk' : 'The order'}</h1>
        <p className="mt-3 max-w-[62ch] text-fg-2">
          {kind === 'trade'
            ? 'Each scalp trades the margin at your leverage. The stop loss and take profit end the whole session, as shares of that margin.'
            : `How much to ${long ? 'buy' : 'sell'}, over how long, and the price it must not pass.`}
        </p>
      </div>
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:items-start">
        <Panel title="Settings" aside={<span className={cx('num font-medium', long ? 'text-bid-fg' : 'text-ask-fg')}>{kind === 'twap' ? (long ? 'Buy' : 'Sell') : BIAS_LABEL[draft.bias ?? 'long']}{sym ? ` ${sym}` : ''}</span>}>
          <div className="grid gap-x-5 gap-y-5 p-4 @2xl:grid-cols-2">
            {/* Picked, and read, on the first step: here it only shows, with the way back. */}
            <div className="min-w-0 @2xl:col-span-2">
              <p className="mb-2 text-[12.5px] font-medium">Market</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[15px] font-semibold">{sym}</span>
                {m && <span className="num text-[13px] text-fg-2">{px(m.mark)}{m.day.changePct != null && <span className={m.day.changePct >= 0 ? 'text-bid-fg' : 'text-ask-fg'}> {m.day.changePct >= 0 ? '+' : ''}{m.day.changePct.toFixed(2)}% 24h</span>}</span>}
                <Button size="xs" variant="ghost" onClick={changeMarket}>Change</Button>
              </div>
              {problems.sym && <p className="mt-2 text-[12px] text-ask-fg">{problems.sym}</p>}
            </div>

            {kind === 'trade' && sym && (
              <div className="@2xl:col-span-2">
                <MarketReadPanel read={read} bias={draft.bias ?? 'long'} frame={draft.frame} />
              </div>
            )}

            <Row id="margin" label="Margin" note={balance != null ? `Collateral each ${kind === 'trade' ? 'scalp' : 'position'} takes. ${money(balance, 2)} is free${total != null && total - balance >= 0.01 ? ` of your ${money(total, 2)}; the rest backs your market maker and running plans` : ''}.` : 'Collateral the position takes from your Perpl balance.'} error={problems.marginUsd}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Money id="margin" value={draft.margin} invalid={!!problems.marginUsd} onChange={(margin) => set({ margin })} />
                <div role="group" aria-label="Margin as a share of what is free" className={SEG}>
                  {[0.1, 0.25, 0.5].map((f) => {
                    const v = balance != null ? Math.floor(balance * f * 100) / 100 : NaN;
                    return <Chip key={f} type="radio" name="margin-share" checked={parse(draft.margin) === v} disabled={!(v >= PLAN_RULES.minMarginUsd)} onChange={() => set({ margin: String(v) })}>{f * 100}%</Chip>;
                  })}
                </div>
              </div>
            </Row>
            <Row id="leverage" label="Leverage" value={`${draft.leverage}x`} note={`Up to ${maxLev}x on ${sym ?? 'this market'}. ${kind === 'trade' ? 'Each scalp' : 'The position'} is ${n ? money(n.notionalUsd, 2) : 'margin times leverage'}.`} error={problems.leverage}>
              <Slider id="leverage" min={1} max={maxLev} step={1} value={draft.leverage} unit="x" ticks={levTicks(maxLev)} onChange={(leverage) => set({ leverage })} />
            </Row>

            {kind === 'trade' ? (
              <>
                <Choices legend="Trigger timeframe" note="The bars each scalp is triggered and sized on. On 1m the moves are often too small to clear fees, and Monday skips those setups." error={problems.frame}>
                  {(['1m', '5m', '15m'] as const).map((f) => <Chip key={f} type="radio" name="frame" checked={draft.frame === f} onChange={() => set({ frame: f })}>{f}</Chip>)}
                </Choices>
                <Choices legend="Session length" note="When it runs out, Monday closes any open scalp and stops." error={problems.expiryHours}>
                  {SESSIONS.map((h) => <Chip key={h} type="radio" name="session" checked={draft.expiryHours === h} onChange={() => set({ expiryHours: h })}>{hours(h)}</Chip>)}
                </Choices>
                <Row id="loss-limit" label="Stop loss" value={ofMargin(draft.lossLimit) ? `-${ofMargin(draft.lossLimit)}` : undefined} note="Of the margin. Once the session is down this much, Monday closes and stops." error={problems.lossLimitPct}>
                  <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                    <div role="group" aria-label="Stop loss presets" className={SEG}>
                      {[10, 20, 30, 50].map((pct) => <Chip key={pct} type="radio" name="loss-limit" checked={parse(draft.lossLimit) === pct} onChange={() => set({ lossLimit: String(pct) })}>{pct}%</Chip>)}
                    </div>
                    <Pct id="loss-limit" value={draft.lossLimit} invalid={!!problems.lossLimitPct} onChange={(lossLimit) => set({ lossLimit })} />
                  </div>
                </Row>
                <Row id="profit-target" label="Take profit" value={ofMargin(draft.profitTarget) ? `+${ofMargin(draft.profitTarget)}` : undefined} note={opt(draft.profitTarget) == null ? 'Off: the session runs until the stop loss, its time, or you stop it.' : 'Of the margin. Once the session is up this much, Monday closes and stops.'} error={problems.profitTargetPct}>
                  <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                    <div role="group" aria-label="Take profit presets" className={SEG}>
                      {[null, 20, 50, 100].map((pct) => <Chip key={pct ?? 'off'} type="radio" name="profit-target" checked={opt(draft.profitTarget) === pct} onChange={() => set({ profitTarget: pct == null ? '' : String(pct) })}>{pct == null ? 'Off' : `${pct}%`}</Chip>)}
                    </div>
                    <Pct id="profit-target" value={draft.profitTarget} placeholder="Off" invalid={!!problems.profitTargetPct} onChange={(profitTarget) => set({ profitTarget })} />
                  </div>
                </Row>
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
              </>
            )}
          </div>
        </Panel>

        <Panel title="Pre-trade summary" aside={sym ?? ''}>
          <Summary kind={kind} input={input} n={n} spec={spec} mark={mark} balance={balance} read={read} sim={sim} />
          <div className="grid gap-2 border-t border-line p-3">
            <Button size="lg" className="w-full" onClick={next} disabled={!ok}>Review</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** D1 and H4 as the scalper reads them now, and what that means for the user's side. */
function MarketReadPanel({ read, bias, frame }: { read: Read | undefined; bias: Bias; frame: ScalpFrame }) {
  const mode = read ? scalpMode(bias, read.market) : null;
  return (
    <div className="grid gap-2 rounded-sm border border-line-2 bg-raised px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Market read</span>
        {read ? (
          <>
            <Tag tone={trendTone(read.d1)}>D1 {TREND_LABEL[read.d1]}</Tag>
            <Tag tone={trendTone(read.h4)}>H4 {TREND_LABEL[read.h4]}</Tag>
            <Tag tone={mode === 'follow' ? 'accent' : mode === 'counter' ? 'warn' : 'neutral'}>{mode ? MODE_LABEL[mode] : 'Waiting'}</Tag>
          </>
        ) : <Skeleton className="h-4 w-40" />}
      </div>
      <p className="text-fg-2">{modeLine(bias, read, frame)}</p>
    </div>
  );
}

function Summary({ kind, input, n, spec, mark, balance, read, sim }: { kind: Kind; input: PlanInput | null; n: ReturnType<typeof planNumbers> | null; spec?: MarketSpec; mark: number | null; balance: number | null; read: Read | undefined; sim: boolean }) {
  const px = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? fmtPrice(v, spec) : '-');
  const venue = sim ? 'the exchange' : 'Perpl';
  if (kind === 'trade') {
    const t = input?.kind === 'trade' ? input : null;
    const mode = t && read ? scalpMode(t.bias, read.market) : null;
    return (
      <>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 p-3 text-[12.5px]">
          <Line k="Free on Perpl" v={balance == null ? '-' : money(balance, 2)} />
          <Line k="Margin" v={t ? money(t.marginUsd, 2) : '-'} />
          <Line k="Each scalp" v={n && t ? `${n.size} ${t.sym}, ${money(n.notionalUsd, 2)}` : '-'} />
          <Line k="Trigger" v={t ? `${t.frame}, ${mode ? MODE_LABEL[mode].toLowerCase() : 'waiting'}` : '-'} />
          <Line k="Liquidation" v={n ? `about ${n.liqPct.toFixed(1)}% away` : '-'} />
          <Line k="Session stop loss" v={n ? `-${money(n.lossUsd, 2)}` : '-'} tone="text-ask-fg" />
          <Line k="Session take profit" v={!n ? '-' : n.profitUsd != null ? `+${money(n.profitUsd, 2)}` : 'Off'} tone={n?.profitUsd != null ? 'text-bid-fg' : undefined} />
          <Line k="Session length" v={t ? hours(t.expiryHours) : '-'} />
          <Line k="Fees per scalp, at most" v={n ? money(n.feesUsd, 2) : '-'} />
        </dl>
        <p className="flex gap-2 border-t border-line px-3 py-2.5 text-[12px] text-fg-3">
          <ShieldCheckIcon size={15} className="mt-px flex-none text-accent" />
          <span>Each scalp&apos;s stop and target rest on {venue} from its fill, so they hold while Monday is offline. A scalp never risks more than the stop loss left. Entries and targets are maker orders.</span>
        </p>
      </>
    );
  }
  const w = input?.kind === 'twap' ? input : null;
  return (
    <>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 p-3 text-[12.5px]">
        <Line k="Free on Perpl" v={balance == null ? '-' : money(balance, 2)} />
        <Line k="Margin" v={w ? money(w.marginUsd, 2) : '-'} />
        <Line k="Position" v={n && w ? `${n.size} ${w.sym}, ${money(n.notionalUsd, 2)}` : '-'} />
        <Line k="Execution" v={w ? `${w.slices} slices, ${STYLE_LABEL[w.style].toLowerCase()}` : '-'} />
        <Line k="Liquidation" v={n ? `about ${px(n.liqPrice)}` : '-'} />
        <Line k="Stop loss" v={n ? `${px(n.slPrice)}, -${money(n.lossUsd, 2)}` : '-'} tone="text-ask-fg" />
        <Line k="Take profit" v={!n ? '-' : n.tpPrice ? `${px(n.tpPrice)}, +${money(n.profitUsd ?? 0, 2)}` : 'Off'} tone={n?.tpPrice ? 'text-bid-fg' : undefined} />
        <Line k="Reward to risk" v={n?.rr != null ? n.rr.toFixed(2) : '-'} />
        <Line k="Fees in and out" v={n ? money(n.feesUsd, 2) : '-'} />
      </dl>
      <p className="flex gap-2 border-t border-line px-3 py-2.5 text-[12px] text-fg-3">
        <ShieldCheckIcon size={15} className="mt-px flex-none text-accent" />
        <span>The stop loss{w?.takeProfitPct ? ' and take profit' : ''} rest on {venue} from the first fill, priced from where the TWAP starts, so they hold while Monday is offline. A fast market can fill past them.</span>
      </p>
      {mark == null && <p className="px-3 pb-2 text-[12px] text-fg-3">Waiting for a price.</p>}
    </>
  );
}

function ReviewStep({ input, spec, mark, balance, read, sim, busy, error, onPlace, onEdit }: {
  input: PlanInput; spec: MarketSpec; mark: number; balance: number | null; read: Read | undefined; sim: boolean;
  busy: boolean; error: string | null; onPlace: () => void; onEdit: () => void;
}) {
  const n = planNumbers(input, spec, mark);
  const px = (v: number | null) => (v != null ? fmtPrice(v, spec) : '-');
  const long = input.bias === 'long';
  const rows: [string, ReactNode][] = input.kind === 'trade'
    ? [
      ['Market', `${input.sym}, ${input.bias}`],
      ['Margin and leverage', `${money(input.marginUsd, 2)} at ${input.leverage}x`],
      ['Each scalp', `${n.size} ${input.sym} (${money(n.notionalUsd, 2)})`],
      ['Trigger', `${input.frame} bars, ${read ? (scalpMode(input.bias, read.market) ? MODE_LABEL[scalpMode(input.bias, read.market)!].toLowerCase() : 'waiting for D1 and H4 to line up') : 'reading D1 and H4'}`],
      ['Session stop loss', `${input.lossLimitPct}% of the margin, -${money(n.lossUsd, 2)}`],
      ['Session take profit', n.profitUsd != null ? `${input.profitTargetPct}% of the margin, +${money(n.profitUsd, 2)}` : 'Off'],
      ['Session length', hours(input.expiryHours)],
      ['Liquidation', `about ${n.liqPct.toFixed(1)}% from each entry`],
    ]
    : [
      ['Market', `${input.sym}, ${long ? 'buy' : 'sell'}`],
      ['Margin and leverage', `${money(input.marginUsd, 2)} at ${input.leverage}x`],
      ['Position', `${n.size} ${input.sym} (${money(n.notionalUsd, 2)})`],
      ['Execution', `${input.slices} slices over ${input.durationMin < 60 ? `${input.durationMin} min` : `${input.durationMin / 60} h`}, ${STYLE_LABEL[input.style].toLowerCase()}${input.limitPrice ? `, ${long ? 'at most' : 'at least'} ${px(input.limitPrice)}` : ''}`],
      ['Stop loss', `${px(n.slPrice)} (${input.stopLossPct}%), about -${money(n.lossUsd, 2)}`],
      ['Take profit', n.tpPrice ? `${px(n.tpPrice)} (${input.takeProfitPct}%), about +${money(n.profitUsd ?? 0, 2)}` : 'Off'],
      ['Liquidation', `about ${px(n.liqPrice)}`],
    ];
  return (
    <div>
      <Heading title="Review and start">
        {input.kind === 'trade'
          ? `Monday reads D1 and H4, then scalps your ${input.bias} on the ${input.frame} chart, one position at a time, until the session is down ${money(n.lossUsd, 2)}${n.profitUsd != null ? ` or up ${money(n.profitUsd, 2)}` : ''}, or after ${hoursLong(input.expiryHours)}. Each scalp's stop and target rest on ${sim ? 'the exchange' : 'Perpl'}. You can stop it from the terminal at any time.`
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
      {balance != null && input.marginUsd > balance * 0.9 && <div className="mt-6"><Notice tone="warn">This uses most of what is free. It leaves little room for the market maker or another plan.</Notice></div>}
      {error && <p role="alert" className="mt-6 text-[13px] text-ask-fg">{error}</p>}
      <div className="mt-8 flex flex-wrap gap-2.5">
        <Button size="lg" onClick={onPlace} disabled={busy}>{busy ? 'Starting' : input.kind === 'trade' ? 'Start scalping' : 'Start TWAP'}</Button>
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

