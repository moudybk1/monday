'use client';

import { ArrowUpIcon, ChatCircleDotsIcon, CircleNotchIcon, SparkleIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AskIntent } from '@monday/core';
import { Tag, cx } from './ui';
import { api } from '@/lib/api';
import { at } from '@/lib/hosts';

/** What the stats server answers (apps/server/src/stats/answer.ts). */
interface ChatAnswer {
  text: string;
  table?: { cols: string[]; rows: { cells: string[]; href?: string }[] };
  actions: { label: string; href: string }[];
  source: string;
  by: 'rules' | 'kimi';
  dropped?: string;
  intent?: AskIntent;
  wallet?: string;
  explainNow?: boolean;
}
type Msg = { id: number; q: string; a?: ChatAnswer; error?: string; at: number; explain?: { text?: string; error?: string; fromFacts?: boolean } };

/** Suggestions for the page the reader is on; every one answers from the quick rules, at once. */
function suggestions(path: string): string[] {
  if (path.startsWith('/analytics/wallet/')) return ['Explain this wallet', 'Is this wallet a market maker?', 'Top 5 traders this week', 'What is profit factor?'];
  if (path.startsWith('/analytics/screener')) return ['Consistent winners 30D', 'Who is on a streak this week', 'Market makers with volume over $1M', 'Biggest losers today'];
  if (path.startsWith('/analytics/compare')) return ['Compare the top 3 this week', 'Compare the top 4 by volume this month', 'Whales liquidated this month'];
  return ['Perpl volume, last 24h', 'Funding across markets', 'Long/short by market', 'Top 5 traders this week', 'Whales liquidated this month', 'What is open interest?'];
}

/**
 * Ask Monday: a chat in the corner of every analytics page. Each answer carries the figures (from the same data as the
 * pages), at most a small table, and links to see more. Kimi reads the questions the quick rules cannot and writes the
 * open answers and wallet summaries, from the figures only. Cmd/Ctrl+K opens it.
 */
export function AskChat() {
  const path = usePathname();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const next = useRef(1);
  const busy = msgs.some((m) => !m.a && !m.error);
  const wallet = /^\/analytics\/wallet\/([^/?#]+)/.exec(path)?.[1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' }); }, [msgs, reduce]);
  // The thinking clock: Kimi takes 5 to 15 s on a full sentence, and a counter reads better than a frozen spinner.
  useEffect(() => {
    if (!busy && !msgs.some((m) => m.explain && !m.explain.text && !m.explain.error)) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy, msgs]);

  const patch = (id: number, p: Partial<Msg>) => setMsgs((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const explain = async (id: number, w: string) => {
    patch(id, { explain: {} });
    try {
      const r = await api<{ available: boolean; text?: string; source?: 'model' | 'facts' }>(`/stats/wallet/${encodeURIComponent(w)}/explain`);
      patch(id, { explain: r.text ? { text: r.text, fromFacts: r.source === 'facts' } : { error: 'Plain-words summaries are off on this server.' } });
    } catch (e) {
      patch(id, { explain: { error: e instanceof Error ? e.message : 'Kimi did not answer.' } });
    }
  };
  const send = async (text: string) => {
    const v = text.trim();
    if (!v || busy) return;
    const id = next.current++;
    const last = [...msgs].reverse().find((m) => m.a?.intent)?.a?.intent;
    setMsgs((ms) => [...ms, { id, q: v, at: Date.now() }]);
    setQ('');
    try {
      const a = await api<ChatAnswer>('/stats/chat', { method: 'POST', body: { q: v, wallet, last } });
      patch(id, { a });
      if (a.wallet && a.explainNow) void explain(id, a.wallet);
    } catch (e) {
      patch(id, { error: e instanceof Error ? e.message : 'Could not reach Monday.' });
    }
  };

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab" type="button" onClick={() => setOpen(true)} aria-label="Ask Monday"
            initial={reduce ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.18 }}
            className="fixed right-4 bottom-4 z-40 flex h-11 items-center gap-2 rounded-full bg-accent pr-4 pl-3.5 text-[14px] font-semibold text-accent-fg shadow-[0_8px_28px_rgb(0_0_0/0.35)] hover:brightness-110"
          >
            <ChatCircleDotsIcon size={18} weight="fill" /> Ask Monday
            <kbd className="num hidden rounded-[3px] bg-black/15 px-1 text-[12px] font-medium sm:inline">⌘K</kbd>
          </motion.button>
        )}
        {open && (
          <motion.section
            key="panel" role="dialog" aria-label="Ask Monday"
            initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2 }}
            className="fixed right-2 bottom-2 z-40 flex h-[min(38rem,calc(100dvh-4.5rem))] w-[min(27rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-line-2 bg-raised shadow-[0_16px_48px_rgb(0_0_0/0.45)] sm:right-4 sm:bottom-4"
          >
            <header className="flex h-11 flex-none items-center gap-2 border-b border-line px-3">
              <SparkleIcon size={14} weight="fill" className="text-accent" />
              <span className="text-[14px] font-semibold">Ask Monday</span>
              <Tag tone="accent">Powered by Kimi</Tag>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto grid size-7 place-items-center rounded-sm text-fg-3 hover:bg-raised-2 hover:text-fg"><XIcon size={14} /></button>
            </header>

            <div className="scroll min-h-0 flex-1 px-3 py-3 text-[13px]">
              {msgs.length === 0 && (
                <div>
                  <p className="text-fg-2">Ask about Perpl: volume, funding, long/short, who is winning, any wallet or market. Every answer comes with the figures and where they are from.</p>
                </div>
              )}
              <div className="grid gap-3">
                {msgs.map((m) => (
                  <div key={m.id} className="grid gap-1.5">
                    <p className="ml-8 justify-self-end rounded-md bg-accent/12 px-2.5 py-1.5 text-fg">{m.q}</p>
                    {m.error ? <p className="mr-6 rounded-md border border-warn/40 px-2.5 py-1.5 text-warn">{m.error}</p>
                      : !m.a ? (
                        <p className="mr-6 flex items-center gap-2 text-fg-3"><CircleNotchIcon size={12} className="animate-spin text-accent" />
                          {now - m.at < 4_000 ? 'Monday is thinking…' : `Kimi is reading the question… ${Math.round((now - m.at) / 1000)}s`}
                        </p>
                      ) : <Answer m={m} onExplain={explain} />}
                  </div>
                ))}
              </div>
              <div ref={end} />
            </div>

            <div className="flex-none border-t border-line p-2">
              {!busy && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {suggestions(path).map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)} className="flex-none rounded-full border border-line-2 px-2.5 py-1 text-[13px] whitespace-nowrap text-fg-2 hover:border-accent/45 hover:text-fg">{s}</button>
                  ))}
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); void send(q); }} className="flex items-center gap-1.5 rounded-md border border-line-2 bg-canvas pr-1 pl-2.5 focus-within:border-accent">
                <input
                  ref={input} value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} spellCheck={false} maxLength={300}
                  placeholder={wallet ? 'Ask about this wallet, or anything on Perpl' : 'Ask about Perpl, a wallet or a market'}
                  className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-3 focus:outline-none disabled:opacity-60"
                />
                <button type="submit" disabled={busy || !q.trim()} aria-label="Send" className="grid size-7 place-items-center rounded-sm bg-accent text-accent-fg disabled:opacity-40"><ArrowUpIcon size={13} weight="bold" /></button>
              </form>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

function Answer({ m, onExplain }: { m: Msg; onExplain: (id: number, w: string) => void }) {
  const a = m.a!;
  return (
    <div className="mr-6 grid gap-2 rounded-md border border-line bg-canvas px-2.5 py-2">
      <p className="leading-snug text-fg">{a.text}</p>
      {a.table && (
        <table className="w-full text-[13px]">
          {a.table.cols.some(Boolean) && (
            <thead><tr className="label text-left [&>th]:font-normal">{a.table.cols.map((c, i) => <th key={i} className={cx('pb-1', i > 0 && 'text-right')}>{c}</th>)}</tr></thead>
          )}
          <tbody className="num">
            {a.table.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.cells.map((c, j) => (
                  <td key={j} className={cx('py-1', j > 0 && 'text-right', j === 0 && 'font-sans text-fg-2')}>
                    {j === 0 && r.href ? <Link href={at(r.href)} className="text-fg underline-offset-2 hover:text-accent hover:underline">{c}</Link> : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {a.dropped && <p className="text-[12px] text-warn">Not applied: {a.dropped}</p>}
      {m.explain && (
        <div className="rounded-sm border border-accent/30 bg-accent/6 px-2 py-1.5">
          {m.explain.text ? <p className="leading-snug">{m.explain.text}</p>
            : m.explain.error ? <p className="text-warn">{m.explain.error}</p>
            : <p className="flex items-center gap-2 text-fg-3"><CircleNotchIcon size={12} className="animate-spin text-accent" /> Kimi is writing the summary…</p>}
          {m.explain.text && <p className="mt-1 text-[12px] text-fg-3">{m.explain.fromFacts ? 'Kimi was slow, so these are the wallet\'s own figures.' : 'Written by Kimi from this wallet\'s figures only.'}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {a.actions.map((x) => (
          <Link key={x.href} href={at(x.href)} className="rounded-sm border border-accent/45 bg-accent/12 px-2 py-1 text-[13px] text-accent hover:bg-accent/20">{x.label}</Link>
        ))}
        {a.wallet && !m.explain && (
          <button type="button" onClick={() => onExplain(m.id, a.wallet!)} className="inline-flex items-center gap-1 rounded-sm border border-line-2 px-2 py-1 text-[13px] text-fg-2 hover:text-fg"><SparkleIcon size={11} weight="fill" className="text-accent" /> Explain in plain words</button>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[12px] text-fg-3">
        {a.by === 'kimi' && <span className="rounded-[3px] border border-accent/40 px-1 text-accent">Kimi</span>}
        <span>{a.source}</span>
      </p>
    </div>
  );
}
