'use client';

import { ArrowsLeftRightIcon, CrosshairIcon, HourglassIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { PlanView } from '@monday/core';
import { Button, ButtonLink, Notice, Tag } from '@/components/ui';
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
      text: 'Quotes both sides of the book in the markets you choose and earns the spread. The LLM reviews its spread and size every 15 minutes, inside limits your wallet signs on Monad.',
      facts: ['Runs until you stop it', 'Daily loss limit you sign', 'Every decision hashed and logged'],
      // Like the other two: a tag only while it runs, and a button that starts one (a saved policy opens prefilled).
      status: me.status === 'quoting' ? <Tag tone="bid">Running</Tag> : null,
      cta: me.status === 'quoting' ? 'Manage' : 'New Market Maker', href: maker ? '/app/policy' : '/app/onboarding',
    },
    {
      id: 'trade', icon: CrosshairIcon, title: 'Agentic Trade',
      text: 'Your bias, scalped: long or short on one market. Monday reads D1 and H4, then scalps that side on a short timeframe, again and again, until your stop loss or take profit on the margin.',
      facts: ['Trades with D1 and H4, waits against them', 'Every scalp protected on Perpl itself', 'Stops at your stop loss or take profit'],
      status: trades ? <Tag tone="accent">{trades} running</Tag> : null,
      cta: 'New Trade', href: '/app/setup/trade',
    },
    {
      id: 'twap', icon: HourglassIcon, title: 'TWAP',
      text: 'Builds a position in slices over minutes or hours, as maker orders where it can, so one large order does not move a thin book.',
      facts: ['Passive, balanced or aggressive', 'A price it must not pass', 'Protected from the first fill'],
      status: twaps ? <Tag tone="accent">{twaps} running</Tag> : null,
      cta: 'New TWAP', href: '/app/setup/twap',
    },
  ];

  // Without a Perpl key every mode starts in Account Settings, and comes back to its own setup once the key is in.
  if (!me.hasKey) for (const c of cards) c.href = `/app/account?next=${encodeURIComponent(c.href)}`;

  return (
    // Centred in the window below the 56px header; taller content (a phone's stacked cards) simply scrolls.
    <div className="grid min-h-[calc(100dvh-3.5rem)] content-center gap-8 py-10 md:py-14">
      <header className="text-center">
        <h1 className="display text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Setup</h1>
        <p className="mx-auto mt-3 max-w-[62ch] text-fg-2">Choose how Monday trades for you. They can run side by side, each in markets of its own, all inside your own Perpl account.</p>
        {!me.hasKey && (
          <div className="mx-auto mt-5 max-w-[46rem] text-left">
            <Notice action={<ButtonLink href="/app/account?next=%2Fapp%2Fsetup" size="xs" variant="ghost">Account Settings</ButtonLink>}>Connect your Perpl account first: add a trade-only API key in Account Settings.</Notice>
          </div>
        )}
      </header>
      <div className="grid gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <section
            key={c.id} aria-labelledby={`${c.id}-title`}
            className="group flex flex-col rounded-2xl bg-raised p-6 shadow-[inset_0_0_0_1px_var(--line)] transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent),0_16px_40px_-20px_rgb(0_0_0/0.7)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-raised-2 text-accent shadow-[inset_0_0_0_1px_var(--line-2)] transition-colors duration-200 group-hover:bg-accent/10"><c.icon size={20} /></span>
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
              ? <Button size="lg" variant="ghost" disabled className="mt-auto w-full">Not Live Yet</Button>
              : <ButtonLink href={c.href} size="lg" className="mt-auto w-full">{c.cta}</ButtonLink>}
          </section>
        ))}
      </div>
    </div>
  );
}
