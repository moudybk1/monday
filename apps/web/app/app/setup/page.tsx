'use client';

import { ArrowsLeftRightIcon, CrosshairIcon, HourglassIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { PlanView } from '@monday/core';
import { Button, ButtonLink, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { useAppConfig, useMe } from '@/lib/wallet';

/** Setup starts here: the three ways Monday trades for you. Each can run beside the others, in markets of its own. */
export default function Setup() {
  const me = useMe().data!;
  // Off on real funds until the operator turns plans on: the cards say so rather than lead to a form that is refused.
  const plansOff = useAppConfig().data?.plansLive === false;
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
      // Like the other two: a tag only while it runs, and a button that starts one (a saved policy opens prefilled).
      status: me.status === 'quoting' ? <Tag tone="bid">Running</Tag> : null,
      cta: me.status === 'quoting' ? 'Manage' : 'New market maker', href: maker ? '/app/policy' : '/app/onboarding',
    },
    {
      id: 'trade', icon: CrosshairIcon, title: 'Agentic Trade',
      text: 'Your bias, scalped: long or short on one market. Monday reads D1 and H4, then scalps that side on a short timeframe, again and again, until your stop loss or take profit on the margin.',
      facts: ['Follow or counter, read from D1 and H4', 'Every scalp protected on Perpl itself', 'Stops at your stop loss or take profit'],
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
    // Centred in the window below the 48px header; taller content (a phone's stacked cards) simply scrolls.
    <div className="grid min-h-[calc(100dvh-3rem)] content-center gap-8 py-10 md:py-14">
      <header className="text-center">
        <h1 className="display text-3xl md:text-4xl">Setup</h1>
        <p className="mx-auto mt-3 max-w-[62ch] text-fg-2">Choose how Monday trades for you. They can run side by side, each in markets of its own, all inside your own Perpl account.</p>
      </header>
      <div className="grid gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <section
            key={c.id} aria-labelledby={`${c.id}-title`}
            className="panel group flex flex-col p-5 transition-[translate,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-accent/50 hover:shadow-[0_16px_40px_-20px_rgb(0_0_0/0.7)] focus-within:border-accent/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-sm border border-line-2 bg-raised text-accent transition-colors duration-200 group-hover:border-accent/50 group-hover:bg-accent/10"><c.icon size={20} /></span>
              {c.status}
            </div>
            <h2 id={`${c.id}-title`} className="mt-5 text-[18px] font-semibold tracking-tight">{c.title}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{c.text}</p>
            <ul className="mt-5 mb-6 grid gap-1.5 border-t border-line pt-4 text-[13px] text-fg-2">
              {c.facts.map((f) => (
                <li key={f} className="flex items-center gap-2"><span aria-hidden className="size-1 flex-none rounded-full bg-fg-3" />{f}</li>
              ))}
            </ul>
            {plansOff && c.id !== 'maker'
              ? <Button size="lg" variant="ghost" disabled className="mt-auto w-full">Not live yet</Button>
              : <ButtonLink href={c.href} size="lg" className="mt-auto w-full">{c.cta}</ButtonLink>}
          </section>
        ))}
      </div>
    </div>
  );
}
