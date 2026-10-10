'use client';

import { ArrowUpRightIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import type { Decision } from '@monday/core';
import { fmtTime } from '@/lib/format';
import { Tag, cx } from './ui';

const SOURCE: Record<Decision['source'], string> = { governor: 'Governor', fallback: 'Rules', reflex: 'Reflex', kill: 'Kill' };

function summary(d: Decision): string | null {
  const p = d.params as Record<string, number | string | boolean>;
  if (d.source === 'governor' || d.source === 'fallback') {
    const lean = Number(p.skew_bias_bps);
    return `spread ${p.spread_mult}x  size ${Math.round(Number(p.size_mult) * 100)}%  ${lean ? `lean ${lean > 0 ? '+' : ''}${lean}bp` : 'no lean'}`;
  }
  return null;
}

/** Where the decision's hash stands on Monad. Only a receipt counts as anchored; until then it says so. */
export function Chain({ d, explorerUrl }: { d: Pick<Decision, 'txHash' | 'anchor'>; explorerUrl?: string; chainOn?: boolean }) {
  if (d.txHash && d.anchor !== 'failed') {
    if (!explorerUrl) return <span>on Monad</span>; // config still loading: no link rather than a broken one
    return (
      <a href={`${explorerUrl}/tx/${d.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-fg">
        on Monad <ArrowUpRightIcon size={10} />
      </a>
    );
  }
  const text = { off: 'hashed', pending: 'waiting for Monad', confirmed: 'on Monad', failed: 'not anchored' }[d.anchor];
  return <span className={d.anchor === 'failed' ? 'text-warn' : undefined} title={d.anchor === 'pending' ? 'Hashed and queued. It stays queued through restarts until Monad confirms it.' : undefined}>{text}</span>;
}

/**
 * Decision log (FR-DSH-4): what changed, why, and where to verify it.
 * Newest first. A reflex or a kill gets the alert colour on its edge; everything else stays grey.
 */
export function DecisionLog({ decisions, explorerUrl, chainOn, limit = 40 }: { decisions: Decision[]; explorerUrl?: string; chainOn?: boolean; limit?: number }) {
  if (decisions.length === 0) {
    return <p className="px-2.5 py-4 text-[12px] text-fg-3">No decisions yet. The governor writes its first within seconds of starting, then every 15 minutes or when flow changes.</p>;
  }
  return (
    <ol>
      {decisions.slice(0, limit).map((d) => {
        const urgent = d.source === 'kill' || (d.source === 'reflex' && ('pull' in d.params || 'widen' in d.params));
        return (
          <li key={d.id} className={cx('rise grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2 border-b border-line py-1.5 pl-2 pr-2.5 sm:grid-cols-[4.25rem_9.5rem_minmax(0,1fr)_auto]', urgent ? 'border-l-2 border-l-ask' : 'border-l-2 border-l-transparent')}>
            <span className="num pt-px text-[11.5px] text-fg-3">{fmtTime(d.at)}</span>
            <span className="flex flex-wrap items-start gap-1">
              <Tag>{d.market}</Tag>
              <Tag tone={urgent ? 'ask' : 'neutral'}>{SOURCE[d.source]}</Tag>
              {(d.source === 'governor' || d.source === 'fallback') && <Tag tone={d.regime === 'storm' ? 'accent' : 'neutral'}>{d.regime}</Tag>}
            </span>
            <span className="col-span-2 min-w-0 sm:col-span-1">
              <span className="block text-[12.5px] leading-snug text-fg text-pretty">{d.reason}</span>
              {summary(d) && <span className="num block whitespace-pre pt-0.5 text-[11px] text-fg-3">{summary(d)}</span>}
            </span>
            <span className="num col-span-2 flex items-start gap-2.5 pt-px text-[11px] text-fg-3 sm:col-span-1">
              <Chain d={d} explorerUrl={explorerUrl} chainOn={chainOn} />
              <Link href={`/decisions/${d.id}`} className="text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-fg">record</Link>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
