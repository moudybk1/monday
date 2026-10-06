import { HandPalmIcon, KeyIcon, SealCheckIcon, SignOutIcon } from '@phosphor-icons/react/dist/ssr';
import { PRESETS, usd } from '@monday/core';
import { EvidenceTeaser, HeroTerminal, Story } from '@/components/landing';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { ButtonLink } from '@/components/ui';

const WRAP = 'mx-auto max-w-[1320px] px-4 sm:px-8';
const H2 = 'display text-3xl md:text-[2.75rem]';

const LOOPS = [
  {
    name: 'Engine', cadence: 'every second', marks: 'dense',
    text: 'Computes fair price, spread and skew, then changes only the quotes that moved enough to matter. Pure functions, unit tested.',
  },
  {
    name: 'Reflex', cadence: 'next tick after a burst', marks: 'burst',
    text: 'Pulls or widens the threatened side for five minutes. No model in the loop, so a burst never waits for one.',
  },
  {
    name: 'Governor', cadence: 'every 15 minutes', marks: 'sparse',
    text: 'An LLM picks a regime inside hard bounds and explains it. If it fails or answers out of range, rules take over.',
  },
] as const;

const CUSTODY = [
  { icon: KeyIcon, title: 'A key that can only trade', text: 'Monday holds a trade-scoped Perpl API key. Perpl never lets any API key withdraw or transfer funds, whatever its scope.' },
  { icon: HandPalmIcon, title: 'Pause and kill, one click each', text: 'Pause cancels every order and keeps your position. Kill cancels, then closes positions with reduce-only orders.' },
  { icon: SignOutIcon, title: 'Leave without asking', text: 'Withdraw on Perpl from your own wallet. Revoke the key there and Monday loses access at once, notices, and stops.' },
  { icon: SealCheckIcon, title: 'Limits you sign, decisions you can check', text: 'Your wallet publishes the policy to a registry on Monad. The agent logs a hash of every decision and its evidence there.' },
];

type Preset = (typeof PRESETS)['balanced'];
const PRESET_ROWS: [string, (p: Preset) => string][] = [
  ['Offers to buy and to sell', (p) => `${usd(p.quoteSizeUsd)} each side`],
  ['Largest position it may hold', (p) => usd(p.maxInventoryUsd)],
  ['Closest it quotes to fair price', (p) => `${p.minHalfSpreadBps} bps`],
  ['Stops for the day after losing', (p) => usd(p.maxDailyLossUsd)],
  ['Leverage cap', (p) => `${p.maxLeverage}x`],
];

export default function Landing() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero: the claim, then the product itself running live. */}
        <section className={`${WRAP} pb-16 pt-12 md:pt-16`}>
          <h1 className="display rise text-[2.1rem] sm:text-[clamp(2.75rem,5.4vw,4.75rem)]">
            Quotes both sides. <br className="hidden sm:block" />
            <span className="text-accent">Steps aside</span> for smart money.
          </h1>
          <div className="rise mt-6 flex flex-col gap-5 md:flex-row md:items-end md:justify-between" style={{ '--i': 1 } as React.CSSProperties}>
            <p className="max-w-[44ch] text-[16px] text-fg-2">
              An AI agent that market-makes on Perpl from your own account and pulls its quotes when smart money moves.
            </p>
            <div className="flex flex-none flex-wrap gap-2.5">
              <ButtonLink href="/app" size="lg">Launch app</ButtonLink>
              <ButtonLink href="/evidence" size="lg" variant="ghost">See the evidence</ButtonLink>
            </div>
          </div>
          <div className="rise mt-9" style={{ '--i': 2 } as React.CSSProperties}>
            <HeroTerminal />
          </div>
        </section>

        {/* The burst: a tabbed walk-through. */}
        <section id="how" className="scroll-mt-14 border-t border-line">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 className={`${H2} max-w-[20ch]`}>What happens when smart money moves</h2>
            <p className="mt-4 max-w-[60ch] text-[15px] text-fg-2">
              Makers earn the spread on every fill and lose whenever the other side knows where price is going. Monday reads who the informed traders are, and gets out of their way.
            </p>
            <div className="mt-10">
              <Story />
            </div>
          </div>
        </section>

        {/* Three loops: cadence drawn as rhythm. */}
        <section className="border-t border-line bg-canvas">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 className={`${H2} max-w-[24ch]`}>Code moves the quotes. The LLM only turns the dials.</h2>
            <ol className="mt-12 border-t border-line-2">
              {LOOPS.map((l) => (
                <li key={l.name} className="grid gap-x-10 gap-y-3 border-b border-line-2 py-6 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,26rem)] md:items-center">
                  <div>
                    <p className="text-xl font-semibold tracking-tight">{l.name}</p>
                    <p className="num mt-1 text-[12px] text-fg-3">{l.cadence}</p>
                  </div>
                  <Rhythm kind={l.marks} />
                  <p className="text-[14px] text-fg-2">{l.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Custody: one statement, four facts. */}
        <section id="custody" className="scroll-mt-14 border-t border-line">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 className="display max-w-[17ch] text-4xl md:text-6xl">
              Your funds <span className="text-accent">never leave</span> your Perpl account.
            </h2>
            <dl className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
              {CUSTODY.map((c) => (
                <div key={c.title} className="grid grid-cols-[2.25rem_1fr] bg-canvas p-5">
                  <c.icon size={20} weight="regular" aria-hidden className="mt-0.5 text-accent" />
                  <div>
                    <dt className="text-[15px] font-semibold">{c.title}</dt>
                    <dd className="mt-1.5 max-w-[52ch] text-[14px] text-fg-2">{c.text}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Presets: the real numbers, in a table. */}
        <section className="border-t border-line">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 className={`${H2} max-w-[20ch]`}>You set the limits. Monday stays inside them.</h2>
            <p className="mt-4 max-w-[52ch] text-[15px] text-fg-2">Pick a preset or set each number yourself. The agent and the LLM are both clamped to it on every order.</p>
            {/* Staggered: the table hangs off the right two thirds, under the heading. */}
            <div className="panel mt-10 lg:ml-[34%]">
              <div className="scroll">
                <table className="w-full min-w-[520px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="label px-4 py-3 font-normal">Per market</th>
                      <th className="px-3 py-3 font-semibold">Conservative</th>
                      <th className="px-3 py-3 font-semibold text-accent shadow-[inset_0_2px_0_var(--accent)]">Balanced</th>
                      <th className="px-3 py-3 font-semibold">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRESET_ROWS.map(([label, f]) => (
                      <tr key={label} className="border-b border-line last:border-b-0">
                        <th scope="row" className="px-4 py-2.5 font-normal text-fg-2">{label}</th>
                        <td className="num px-3 text-fg-2">{f(PRESETS.conservative)}</td>
                        <td className="num bg-raised px-3 font-medium">{f(PRESETS.balanced)}</td>
                        <td className="num px-3 text-fg-2">{f(PRESETS.active)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-2 text-[12px] text-fg-3 lg:ml-[34%]">Starting defaults. 1 bp is 0.01%.</p>
          </div>
        </section>

        {/* Evidence: figures first, chart under them. */}
        <section className="border-t border-line bg-canvas">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 className={`${H2} max-w-[20ch]`}>The edge is measured, not claimed.</h2>
            <p className="mt-4 max-w-[60ch] text-[15px] text-fg-2">
              An event study checks whether smart-money flow leads price. A replay runs a naive maker and Monday over the same minutes. Both publish their assumptions next to the numbers.
            </p>
            <div className="mt-10">
              <EvidenceTeaser />
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className={`${WRAP} flex flex-col items-start gap-8 py-20 md:flex-row md:items-end md:justify-between md:py-28`}>
            <h2 className="display max-w-[18ch] text-4xl md:text-6xl">Put idle collateral to work without betting on direction.</h2>
            <ButtonLink href="/app" size="lg">Launch app</ButtonLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Cadence as rhythm: how often each loop acts. The marks are the row's time axis, not decoration. */
function Rhythm({ kind }: { kind: 'dense' | 'burst' | 'sparse' }) {
  const marks = kind === 'dense' ? Array.from({ length: 60 }, (_, i) => i / 59) : kind === 'burst' ? [0.34, 0.345, 0.36, 0.375, 0.38, 0.4, 0.86, 0.87, 0.885] : [0.02, 0.5, 0.98];
  return (
    <div className="relative h-7 min-w-0" aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      {marks.map((x) => (
        <span key={x} className={kind === 'sparse' ? 'absolute top-0 h-full w-1 bg-accent' : kind === 'burst' ? 'absolute top-1 bottom-1 w-0.5 bg-ask' : 'absolute top-2 bottom-2 w-px bg-fg-2'} style={{ left: `${x * 100}%` }} />
      ))}
    </div>
  );
}
