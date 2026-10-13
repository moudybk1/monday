'use client';

import { ArrowsLeftRightIcon, CrosshairIcon, HourglassIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { PlanView } from '@monday/core';
import { ButtonLink, Tag, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/wallet';

/** Setup starts here: the three ways Monday trades for you. Each can run beside the others, in markets of its own. */
export default function Setup() {
  const me = useMe().data!;
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanView[]>('/plans'), enabled: me.hasKey, refetchInterval: 10_000 });
  const running = (kind: PlanView['input']['kind']) => (plans.data ?? []).filter((p) => p.status !== 'done' && p.input.kind === kind).length;
  const maker = Boolean(me.policy || me.policyPending);
  const trades = running('trade');
  const twaps = running('twap');

  const cards = [
    {
      id: 'maker', icon: ArrowsLeftRightIcon, title: 'Agentic Market Maker',
      text: 'Quotes both sides of the book in the markets you choose and earns the spread. Kimi reviews its spread and size every 15 minutes, inside limits your wallet signs on Monad.',
      facts: ['Runs until you stop it', 'Daily loss limit you sign', 'Every decision hashed and logged'],
      status: me.status === 'quoting' ? <Tag tone="bid">Running</Tag> : maker ? <Tag>Stopped</Tag> : null,
      cta: maker ? 'Open settings' : 'Set up', href: maker ? '/app/policy' : '/app/onboarding',
    },
    {
      id: 'trade', icon: CrosshairIcon, title: 'Agentic Trade',
      text: 'Your call, carried out: long or short, one market, your margin and leverage. Monday enters at market, at your limit or on a breakout, and keeps the position under a stop loss.',
      facts: ['Stop loss and take profit on Perpl itself', 'Entry at market, limit or breakout', 'Cancel or close from the terminal'],
      status: trades ? <Tag tone="accent">{trades} running</Tag> : null,
      cta: 'New trade', href: '/app/setup/trade',
    },
    {
      id: 'twap', icon: HourglassIcon, title: 'TWAP',
      text: 'Builds a position in slices over minutes or hours, as maker orders where it can, so one large order does not move a thin book.',
      facts: ['Passive, balanced or aggressive', 'A price it must not pass', 'Protected from the first fill'],
      status: twaps ? <Tag tone="accent">{twaps} running</Tag> : null,
      cta: 'New TWAP', href: '/app/setup/twap',
    },
  ];

  return (
    <div className="grid gap-8 py-10 md:py-14">
      <header>
        <h1 className="display text-3xl md:text-4xl">Setup</h1>
        <p className="mt-3 max-w-[62ch] text-fg-2">Choose how Monday trades for you. They can run side by side, each in markets of its own, all inside your own Perpl account.</p>
      </header>
      <div className="grid gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <section key={c.id} aria-labelledby={`${c.id}-title`} className="panel flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-sm border border-line-2 bg-raised text-accent"><c.icon size={20} /></span>
              {c.status}
            </div>
            <h2 id={`${c.id}-title`} className="mt-5 text-[18px] font-semibold tracking-tight">{c.title}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{c.text}</p>
            <ul className="mt-5 grid gap-1.5 border-t border-line pt-4 text-[12.5px] text-fg-2">
              {c.facts.map((f) => (
                <li key={f} className="flex items-center gap-2"><span aria-hidden className="size-1 flex-none rounded-full bg-fg-3" />{f}</li>
              ))}
            </ul>
            <ButtonLink href={c.href} size="lg" variant={c.id === 'maker' && maker ? 'ghost' : 'primary'} className={cx('mt-6 w-full')}>{c.cta}</ButtonLink>
          </section>
        ))}
      </div>
      {!me.hasKey && <p className="text-[13px] text-fg-3">Each one first connects your Perpl account with a trade-only API key. It takes about two minutes.</p>}
    </div>
  );
}
