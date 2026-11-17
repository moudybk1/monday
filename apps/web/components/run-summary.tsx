'use client';

import { CheckIcon, CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XLogoIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { KIND_LABEL, OUTCOME_LABEL, STYLE_LABEL, planPnl, type Analytics, type DashboardState, type KillReason, type MarketSpec, type MarketSym, type PlanView } from '@monday/core';
import { tone } from '@/components/agent';
import { Button, Mark, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtPrice, fmtSigned, fmtSize, fmtUsd } from '@/lib/format';

const SEEN = 'monday.run.seen';
const SHOW_USD = 'monday.share.usd';
/** A run that ended longer ago than this (a reload hours later) does not pop up. */
const FRESH_MS = 30 * 60_000;
/** Take profit ends the run before its flatten lands: count fills this long after the end too. */
const GRACE_MS = 60_000;

const KILL: Record<KillReason, string> = {
  manual: 'Killed by you',
  loss_limit: 'Daily loss limit reached',
  stale_data: 'Killed: market data stopped',
  order_failures: 'Killed: orders kept failing',
  key_error: 'Killed: Perpl rejected the API key',
  session_loss: 'Session stop loss reached',
  margin: 'Killed: margin too low',
};
const whyText = (why: string) =>
  why === 'pause' ? 'Stopped' : why === 'take_profit' ? 'Take profit' : why.startsWith('kill:') ? KILL[why.slice(5) as KillReason] ?? 'Killed' : why;

function duration(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 1 ? `${Math.max(1, Math.round(ms / 1000))}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const pctText = (x: number) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x).toFixed(2)}%`;
const dir = (x: number) => (x >= 0.00005 ? '1' : x <= -0.00005 ? '0' : '');

/** What the share card shows; the route draws it (app/card/run). */
interface Card {
  t: string; sym?: string; side?: 'long' | 'short'; tag: string; big: string; sub?: string; up: string; st: [string, string][]; foot: string; paper: boolean;
}
const cardUrl = (c: Card) => {
  const q = new URLSearchParams({ t: c.t, tag: c.tag, big: c.big, up: c.up, foot: c.foot });
  if (c.sym) q.set('sym', c.sym);
  if (c.side) q.set('side', c.side);
  if (c.sub) q.set('sub', c.sub);
  if (c.paper) q.set('paper', '1');
  for (const [k, v] of c.st) q.append('st', `${k}|${v}`);
  return `/card/run?${q}`;
};

type Row = [string, string, string?];

/** The card image and what can be done with it: the same PNG everywhere. */
function ShareCard({ card, text, name }: { card: Card; text: string; name: string }) {
  const src = cardUrl(card);
  // Keyed by the URL: a cached image can finish loading before any effect runs.
  const [loadedSrc, setLoadedSrc] = useState('');
  const loaded = loadedSrc === src;
  const [done, setDone] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 2000);
    return () => clearTimeout(t);
  }, [done]);

  const blob = async () => {
    const r = await fetch(src);
    if (!r.ok) throw new Error('The card could not be drawn.');
    return r.blob();
  };
  const run = (what: string, f: () => Promise<void>) => async () => {
    setFail(null);
    try {
      await f();
      setDone(what);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // the share sheet was dismissed
      setFail(e instanceof Error ? e.message : 'That did not work.');
    }
  };
  const download = run('download', async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await blob());
    a.download = `${name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const copy = run('copy', async () => {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('This browser cannot copy images. Download it instead.');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]);
  });
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    try {
      setCanShare(!!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
    } catch {}
  }, []);
  const share = run('share', async () => {
    await navigator.share({ files: [new File([await blob()], `${name}.png`, { type: 'image/png' })], text });
  });
  // X takes text from a link, not an image: copy the card first, then paste it into the post.
  const post = run('post', async () => {
    try {
      await navigator.clipboard?.write([new ClipboardItem({ 'image/png': blob() })]);
    } catch {}
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  });

  return (
    <div>
      <div className="relative aspect-[1200/675] overflow-hidden rounded-md border border-line-2 bg-raised">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-raised-2" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={text} onLoad={() => setLoadedSrc(src)} className={cx('size-full transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={download}>{done === 'download' ? <CheckIcon size={14} /> : <DownloadSimpleIcon size={14} />} Download</Button>
        <Button size="sm" variant="ghost" onClick={copy}>{done === 'copy' ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {done === 'copy' ? 'Copied' : 'Copy Image'}</Button>
        {canShare
          ? <Button size="sm" variant="ghost" onClick={share}><ShareNetworkIcon size={14} /> Share</Button>
          : <Button size="sm" variant="ghost" onClick={post} title="Opens a post on X; the card is copied, paste it in"><XLogoIcon size={14} /> Post</Button>}
        {done === 'post' && <span className="text-[12px] text-fg-3">Card copied: paste it into the post.</span>}
      </div>
      {fail && <p className="mt-1.5 text-[12px] text-warn">{fail}</p>}
    </div>
  );
}

function Details({ rows }: { rows: Row[] }) {
  return (
    <details className="group mt-3 rounded-sm border border-line">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-[12px] text-fg-3 hover:text-fg [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> Details
      </summary>
      <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[13px]">
        {rows.map(([k, v, c]) => (
          <div key={k} className="contents">
            <dt className="text-fg-2">{k}</dt>
            <dd className={cx('text-right', c ?? 'text-fg')}>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The market maker's run: PnL from its own fills, the rest from those fills in the window. */
function MakerSummary({ run, state, usd }: { run: NonNullable<DashboardState['lastRun']>; state: DashboardState; usd: boolean }) {
  const settled = state.closing === null;
  // Refetched once the kill's flatten has landed, so its closing fills count.
  const q = useQuery({
    queryKey: ['run-summary', run.endedAt, settled],
    queryFn: () => api<Analytics>(`/analytics?from=${run.startedAt}&to=${Math.min(Date.now(), run.endedAt + GRACE_MS)}`),
    retry: false,
  });
  const a = q.data?.summary;
  const bps = a && a.fills ? `${a.netBps > 0 ? '+' : ''}${a.netBps.toFixed(1)} bps` : null;
  const { policy } = state;
  const card: Card = {
    t: 'Market Maker', tag: `${policy.markets.join(' · ')} · ${policy.maxLeverage}x`,
    big: usd ? fmtSigned(run.pnlUsd) : bps ?? '0 bps', sub: usd ? (bps ? `${bps} per $ traded` : undefined) : 'net per $ traded',
    up: dir(run.pnlUsd), paper: state.sim || state.paper, foot: `${whyText(run.why)} · ${day(run.endedAt)}`,
    st: [
      ['Duration', duration(run.endedAt - run.startedAt)],
      ...(a ? [['Fills', String(a.fills)] as [string, string]] : []),
      ...(a && usd ? [['Volume', fmtUsd(a.volumeUsd, 0)] as [string, string]] : []),
      ...(a && a.fills ? [['Maker', `${Math.round(a.makerPct * 100)}%`] as [string, string]] : []),
    ],
  };
  const rows: Row[] = a
    ? [
        ['PnL', fmtSigned(run.pnlUsd), tone(run.pnlUsd)],
        ['Fills', String(a.fills)],
        ['Volume', fmtUsd(a.volumeUsd)],
        ['Realized', fmtSigned(a.realizedUsd), tone(a.realizedUsd)],
        ['Fees', fmtSigned(-a.feesUsd), tone(-a.feesUsd)],
        ['Net per $ traded', bps ?? '–'],
        ['Maker share', a.fills ? `${Math.round(a.makerPct * 100)}%` : '–'],
        ['Win rate', a.winRate == null ? '–' : `${Math.round(a.winRate * 100)}% of ${a.closes} closes`],
        ...a.fills && q.data!.byMarket.length > 1 ? q.data!.byMarket.map((b) => [`${b.key} net`, fmtSigned(b.netUsd), tone(b.netUsd)] as Row) : [],
      ]
    : [];
  return (
    <section>
      {q.isPending ? <div className="aspect-[1200/675] animate-pulse rounded-md bg-raised-2" /> : <ShareCard card={card} name={`monday-market-maker-${run.endedAt}`} text={`My market maker on Perpl: ${card.big}${usd && bps ? ` (${bps})` : ''} in ${duration(run.endedAt - run.startedAt)}, run by Monday, the AI trading terminal for Perpl. mondaytrade.xyz`} />}
      {q.isError && <p className="mt-2 text-[12px] text-warn">Could not load the fills: {q.error.message}</p>}
      {!settled && <p className="mt-2 text-[12px] text-warn">Positions are still closing; the numbers update when they are closed.</p>}
      {a && <Details rows={rows} />}
    </section>
  );
}

/** An Agentic Trade or TWAP that ended: everything comes from the plan itself. */
function PlanSummary({ p, spec, paper, usd }: { p: PlanView; spec?: MarketSpec; paper: boolean; usd: boolean }) {
  const pnl = planPnl(p);
  const roi = p.input.marginUsd ? (pnl / p.input.marginUsd) * 100 : 0;
  const sc = p.scalp;
  const end = p.endedAt ?? Date.now();
  const pct = p.targetSize ? Math.round((p.filledSize / p.targetSize) * 100) : 0;
  const card: Card = {
    t: p.input.sym, sym: p.input.sym, side: p.input.bias, paper,
    tag: `${p.input.kind === 'twap' ? `TWAP · ${STYLE_LABEL[p.input.style]}` : KIND_LABEL[p.input.kind]} · ${p.input.leverage}x`,
    big: pctText(roi), sub: usd ? `${fmtSigned(pnl)} PnL` : 'return on margin', up: dir(pnl),
    foot: `${p.outcome ? OUTCOME_LABEL[p.outcome] : 'Ended'} · ${day(end)}`,
    st: [
      sc ? ['Scalps', `${sc.wins}/${sc.scalps} won`] : ['Avg Entry', p.avgEntry == null ? '–' : fmtPrice(p.avgEntry, spec)],
      ...(!sc ? [['Filled', `${pct}%`] as [string, string]] : []),
      ['Duration', duration(end - p.createdAt)],
      ...(p.twap?.makerPct != null ? [['Maker', `${Math.round(p.twap.makerPct)}%`] as [string, string]] : usd ? [['Margin', fmtUsd(p.input.marginUsd, 0)] as [string, string]] : []),
    ],
  };
  const rows: Row[] = [
    ['PnL', fmtSigned(pnl), tone(pnl)],
    ['Return on margin', pctText(roi), tone(pnl)],
    sc ? ['Scalps', `${sc.scalps}${sc.scalps ? `, ${sc.wins} won` : ''}`] : ['Filled', `${fmtSize(p.filledSize, spec)} of ${fmtSize(p.targetSize, spec)} (${pct}%)`],
    ['Avg entry', p.avgEntry == null ? '–' : fmtPrice(p.avgEntry, spec)],
    ['Margin', fmtUsd(p.input.marginUsd)],
    ['Realized', fmtSigned(p.realizedUsd), tone(p.realizedUsd)],
    ['Fees', fmtSigned(-p.feesUsd), tone(-p.feesUsd)],
    ...(Math.abs(p.unrealizedUsd) >= 0.00005 ? [['Still open', fmtSigned(p.unrealizedUsd), tone(p.unrealizedUsd)] as Row] : []),
  ];
  const side = p.input.bias === 'long' ? 'Long' : 'Short';
  return (
    <section>
      <ShareCard
        card={card} name={`monday-${p.input.sym.toLowerCase()}-${p.input.kind}-${p.id}`}
        text={`${p.input.sym} ${side} ${KIND_LABEL[p.input.kind]} at ${p.input.leverage}x: ${pctText(roi)} on margin, run by Monday, the AI trading terminal for Perpl. mondaytrade.xyz`}
      />
      {p.note && <p className="mt-2 text-[12px] text-fg-3">{p.note}</p>}
      <Details rows={rows} />
    </section>
  );
}

/**
 * The result of whatever just ended, shown once as a card made to share: the market maker (Stop, Kill for any reason,
 * take profit) and every Agentic Trade or TWAP. A kill that ends several at once shows them together.
 */
export function RunSummary({ state, specs }: { state: DashboardState; specs: Partial<Record<MarketSym, MarketSpec>> }) {
  const run = state.lastRun;
  const ended = state.plans.filter((p) => p.status === 'done' && p.endedAt != null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Everything that ended after this moment is in the popup.
  const [since, setSince] = useState(Infinity);
  // Dollar amounts on the card are the user's call; percentages are always there. Remembered per browser.
  const [usd, setUsd] = useState(true);
  useEffect(() => {
    try {
      setUsd(localStorage.getItem(SHOW_USD) !== '0');
    } catch {}
  }, []);
  const toggleUsd = () => {
    setUsd(!usd);
    try {
      localStorage.setItem(SHOW_USD, usd ? '0' : '1');
    } catch {}
  };

  const latest = Math.max(0, run?.endedAt ?? 0, ...ended.map((p) => p.endedAt!));
  useEffect(() => {
    if (!latest || Date.now() - latest > FRESH_MS) return;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(SEEN)) || 0;
    } catch {}
    if (latest <= seen) return;
    try {
      localStorage.setItem(SEEN, String(latest));
    } catch {}
    // Open already: what ends meanwhile joins the list. Closed: the list starts after what was last shown, and never
    // reaches further back than the freshness window.
    if (!open) setSince(Math.max(seen, Date.now() - FRESH_MS));
    setOpen(true);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMaker = run != null && run.endedAt > since;
  const plans = ended.filter((p) => p.endedAt! > since).sort((a, b) => b.endedAt! - a.endedAt!);
  const total = (showMaker ? run.pnlUsd : 0) + plans.reduce((a, p) => a + planPnl(p), 0);
  const parts = (showMaker ? 1 : 0) + plans.length;
  const paper = state.sim || state.paper;

  return (
    <dialog
      ref={dialog} onClose={() => { setOpen(false); setSince(Infinity); }}
      className="m-auto max-h-[92dvh] w-[min(94vw,40rem)] overflow-y-auto rounded-lg border border-line-2 bg-canvas p-0 text-fg backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      {open && parts > 0 && (
        <>
          <header className="sticky top-0 z-[1] flex items-center justify-between gap-3 border-b border-line bg-canvas/95 px-5 py-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <Mark size={18} />
              <h2 className="text-[16px] font-semibold tracking-tight">{parts > 1 ? `${parts} Runs Ended` : 'Run Complete'}</h2>
              {parts > 1 && <span className={cx('num text-[13px]', tone(total))}>{fmtSigned(total)} total</span>}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-fg-2" title="Show or hide dollar amounts on the card you share">
              <input type="checkbox" checked={usd} onChange={toggleUsd} className="accent-[var(--accent)]" />
              Show $ on card
            </label>
          </header>
          <div className="grid gap-6 px-5 py-4 [&>section+section]:border-t [&>section+section]:border-line [&>section+section]:pt-5">
            {showMaker && <MakerSummary run={run} state={state} usd={usd} />}
            {plans.map((p) => <PlanSummary key={p.id} p={p} spec={specs[p.input.sym]} paper={paper} usd={usd} />)}
          </div>
          <form method="dialog" className="flex justify-end border-t border-line px-5 py-3">
            <Button type="submit">Done</Button>
          </form>
        </>
      )}
    </dialog>
  );
}
