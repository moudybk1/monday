import { ArrowLeftIcon, ArrowsLeftRightIcon, CaretDownIcon, HandPalmIcon, KeyIcon, SealCheckIcon, SignOutIcon, VaultIcon, WalletIcon } from '@phosphor-icons/react/dist/ssr';
import type { AppConfig } from '@monday/core';
import { EvidenceTeaser, LiveMarket, Reveal, Story } from '@/components/landing';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { ButtonLink, Mark, Tag, cx } from '@/components/ui';

const WRAP = 'mx-auto max-w-[1320px] px-4 sm:px-8';
const H2 = 'display text-[2.25rem] md:text-5xl';
const LEAD = 'mt-5 max-w-[58ch] text-[16px] text-fg-2 md:text-[17px]';

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

/** Who holds what. Monday never touches the money: it only ever reaches the account through a key that cannot move funds. */
const NODES = [
  { icon: WalletIcon, title: 'You', text: 'Your wallet signs in, deposits and withdraws on Perpl, and can stop, kill or revoke at any time.' },
  { icon: VaultIcon, title: 'Your Perpl account', text: 'Holds the collateral. Every order and fill settles here, on Monad.', funds: true },
  { icon: Mark, title: 'Monday', text: 'Quotes through a trade-scoped API key. Perpl never lets any API key withdraw or transfer funds.' },
] as const;

const custody = (onchain: boolean) => [
  { icon: KeyIcon, title: 'A key that can only trade', text: 'Monday holds a trade-scoped Perpl API key. Perpl never lets any API key withdraw or transfer funds, whatever its scope.' },
  { icon: HandPalmIcon, title: 'Stop and kill, one click each', text: 'Stop cancels Monday\'s orders and leaves your position and your own orders to you. Kill cancels every order, then closes positions with reduce-only orders.' },
  { icon: SignOutIcon, title: 'Leave without asking', text: 'Withdraw on Perpl from your own wallet. Revoke the key there and Monday loses access at once, notices, and stops.' },
  // Only claim the Monad registry while one is configured on this server.
  onchain
    ? { icon: SealCheckIcon, title: 'Limits you sign, decisions you can check', text: 'Your wallet publishes the policy to a registry on Monad. The agent logs a hash of every decision and its evidence there.' }
    : { icon: SealCheckIcon, title: 'Decisions you can check', text: 'Every decision is stored with its reason in plain words and a hash of the data behind it, so it can be checked later.' },
];

const CONTROLS = [
  { k: 'Position limit', v: 'The most Monday may hold in each market. Margin and leverage set it, or you type it.' },
  { k: 'Stop loss', v: 'A share of your margin: at this loss Monday stops quoting and closes positions for the day. Each position also closes 20 bps under its entry. Fast markets can overshoot both.' },
  { k: 'Stop and kill', v: 'Stop pulls Monday\'s orders. Kill also closes positions. Both are one click in the terminal.' },
];

// Answers follow what the code does today (runner, stale-data limits, cleanup); keep them in step with it.
const faq = (onchain: boolean) => [
  { q: 'What do I need to use Monday?', a: 'A wallet to sign in with, a Perpl account with collateral, and a Perpl API key that can trade. The app walks you through each step before anything is quoted.' },
  { q: 'Where are my funds held?', a: 'In your own Perpl account. Monday trades with an API key that Perpl never lets withdraw or transfer funds, and you withdraw on Perpl yourself.' },
  { q: 'Can Monday lose money?', a: 'Yes. Market making carries inventory and execution risk, smart-money signals can be wrong or late, and fees count against every fill. The stop loss halts Monday for the day and each position closes 20 bps under its entry, but a fast market can overshoot both.' },
  { q: 'What is the difference between Stop and Kill?', a: 'Stop cancels Monday\'s orders and leaves open positions for you to manage. Kill cancels every order in the account and closes positions. Closing can take time, and waits if Perpl is unreachable.' },
  { q: 'What happens if the data or the connection fails?', a: 'If market data is more than 5 seconds old Monday pulls its quotes, and after 30 seconds it stops and closes positions. Any cancel or close it still owes is retried until Perpl confirms it. You can always act on Perpl directly.' },
  {
    q: 'What is recorded on Monad?',
    a: onchain
      ? 'Your wallet publishes your limits to the MondayRegistry contract on Monad, and the agent logs a hash of every decision and its evidence there for anyone to check.'
      : 'Perpl itself runs on Monad, so every order and fill settles there. Monday can also publish your limits and log a hash of each decision to a registry contract on Monad; that registry is not switched on for this server yet, so decisions are kept with their hashes in Monday\'s own log for now.',
  },
];

/** Whether this server has a Monad registry, read once a minute so the page stays static. Unreachable: claim nothing. */
async function registryOn(): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3001'}/api/config`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(2_000) });
    return Boolean(((await res.json()) as AppConfig).registry);
  } catch {
    return false;
  }
}

export default async function Landing() {
  const onchain = await registryOn();
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero: the claim, then the product itself on the live market. */}
        <section className={`${WRAP} pt-14 md:pt-20`}>
          <h1 className="display rise text-[2.6rem] sm:text-5xl lg:text-6xl xl:text-[5rem]">
            Quotes both sides.<br />
            <span className="text-accent">Steps aside</span> for smart money.
          </h1>
          <div className="mt-7 flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10">
            <p className="rise max-w-[46ch] text-[17px] text-fg-2 md:text-[19px]" style={{ '--i': 1 } as React.CSSProperties}>
              An AI agent that market-makes on Perpl from your own account and pulls its quotes when smart money moves.
            </p>
            <div className="rise flex flex-none flex-wrap gap-2.5" style={{ '--i': 2 } as React.CSSProperties}>
              <ButtonLink href="/app" size="lg" className="px-6">Launch app</ButtonLink>
              <ButtonLink href="#how" size="lg" variant="ghost">How it works</ButtonLink>
            </div>
          </div>
          <div className="relative mt-12 md:mt-16">
            {/* Amber light behind the terminal: the one place the page glows. */}
            <div aria-hidden className="pointer-events-none absolute -inset-x-24 -top-[22rem] h-[24rem] bg-[radial-gradient(55%_75%_at_50%_100%,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_72%)]" />
            <div className="rise relative" style={{ '--i': 3 } as React.CSSProperties}>
              <LiveMarket />
            </div>
          </div>
        </section>

        {/* How it works: one burst played step by step, then the three loops behind it. */}
        <section id="how" className="mt-14 scroll-mt-14 border-t border-line bg-canvas md:mt-20">
          <div className={`${WRAP} py-20 md:py-28`}>
            <Reveal>
              <h2 className={`${H2} max-w-[22ch]`}>Code moves the quotes. The LLM only turns the dials.</h2>
              <p className={LEAD}>Watch one smart-money burst from the first quote to the written reason, on the same panels the terminal uses.</p>
            </Reveal>
            <div className="mt-12">
              <Story onchain={onchain} />
            </div>
            <Reveal className="mt-20 md:mt-24">
              <h3 className="text-[22px] font-semibold tracking-tight">Three loops, three clocks</h3>
              <ol className="mt-6 border-t border-line-2">
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
            </Reveal>
          </div>
        </section>

        {/* Custody: one statement, the picture of who holds what, four facts. */}
        <section id="custody" className="scroll-mt-14 border-t border-line">
          <div className={`${WRAP} py-20 md:py-28`}>
            <Reveal>
              <h2 className="display max-w-[17ch] text-4xl md:text-6xl">
                Your funds <span className="text-accent">never leave</span> your Perpl account.
              </h2>
            </Reveal>
            <Reveal className="mt-12" delay={0.1}>
              <Custody />
            </Reveal>
            <dl className="mt-14 grid gap-x-12 gap-y-9 md:grid-cols-2">
              {custody(onchain).map((c) => (
                <div key={c.title} className="grid grid-cols-[2.25rem_1fr]">
                  <c.icon size={22} weight="regular" aria-hidden className="mt-0.5 text-accent" />
                  <div>
                    <dt className="text-[17px] font-semibold tracking-tight">{c.title}</dt>
                    <dd className="mt-1.5 max-w-[52ch] text-[14px] text-fg-2">{c.text}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Limits: what each control does, in the words the app uses. */}
        <section className="border-t border-line bg-canvas">
          <div className={`${WRAP} py-20 md:py-28`}>
            <Reveal>
              <h2 className={`${H2} max-w-[18ch]`}>You set the limits. Monday stops when one is hit.</h2>
              <p className={LEAD}>Pick a margin and a leverage in Bot settings and Monday sizes the rest. The agent and the LLM are both held to these numbers on every order.</p>
            </Reveal>
            <dl className="mt-12 grid gap-8 md:grid-cols-3 md:gap-10">
              {CONTROLS.map((c) => (
                <div key={c.k} className="border-t border-line-2 pt-5">
                  <dt className="text-[17px] font-semibold tracking-tight">{c.k}</dt>
                  <dd className="mt-2 text-[14px] text-fg-2">{c.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Evidence: figures first, chart under them. */}
        <section className="border-t border-line">
          <div className={`${WRAP} py-20 md:py-28`}>
            <Reveal>
              <h2 className={`${H2} max-w-[20ch]`}>The edge is measured, not claimed.</h2>
              <p className={LEAD}>
                An event study checks whether smart-money flow leads price. A replay runs a naive maker and Monday over the same minutes. Both publish their assumptions next to the numbers.
              </p>
            </Reveal>
            <div className="mt-10">
              <EvidenceTeaser />
            </div>
          </div>
        </section>

        {/* Questions: native disclosures, readable without JavaScript. */}
        <section className="border-t border-line bg-canvas">
          <div className={`${WRAP} grid gap-10 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14`}>
            <h2 className={`${H2} max-w-[14ch]`}>Questions before you start</h2>
            <div className="border-t border-line-2">
              {faq(onchain).map((f) => (
                <details key={f.q} className="group border-b border-line-2">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <CaretDownIcon size={16} aria-hidden className="flex-none text-fg-3 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="max-w-[62ch] pb-5 text-[14px] text-fg-2">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className={`${WRAP} flex flex-col items-start gap-8 py-24 md:flex-row md:items-end md:justify-between md:py-36`}>
            <Reveal>
              <h2 className="display max-w-[16ch] text-4xl md:text-6xl xl:text-7xl">Quote both sides without betting on direction.</h2>
            </Reveal>
            <ButtonLink href="/app" size="lg" className="px-6">Launch app</ButtonLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Who holds what: you, your Perpl account in the middle with the money, Monday reaching it through a key that cannot move funds. */
function Custody() {
  // Left to right on wide screens, top to bottom on phones: the arrows turn with the layout.
  const links = [
    { icon: ArrowsLeftRightIcon, text: 'deposit, withdraw, revoke' },
    { icon: ArrowLeftIcon, text: 'trade-only key' },
  ];
  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-0">
      {NODES.map((n, i) => (
        <div key={n.title} className="contents">
          {i > 0 && (
            <div className="flex items-center justify-center gap-2 py-1 text-fg-3 lg:w-44 lg:flex-col lg:px-3">
              {(() => { const Arrow = links[i - 1].icon; return <Arrow size={18} aria-hidden className="rotate-90 lg:rotate-0" />; })()}
              <span className="label text-center">{links[i - 1].text}</span>
            </div>
          )}
          <div className={cx('panel p-5 md:p-6', 'funds' in n && 'border-accent/50')}>
            <div className="flex items-center justify-between gap-3">
              <n.icon size={26} weight="regular" aria-hidden className={'funds' in n ? 'text-accent' : 'text-fg-2'} />
              {'funds' in n && <Tag tone="accent">funds stay here</Tag>}
            </div>
            <p className="mt-5 text-[19px] font-semibold tracking-tight">{n.title}</p>
            <p className="mt-1.5 text-[14px] text-fg-2">{n.text}</p>
          </div>
        </div>
      ))}
    </div>
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
