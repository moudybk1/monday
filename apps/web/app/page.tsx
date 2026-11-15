import { ArrowLeftIcon, ArrowRightIcon, ArrowsLeftRightIcon, BrainIcon, BroadcastIcon, ChartBarIcon, CheckCircleIcon, CheckIcon, GaugeIcon, GlobeHemisphereWestIcon, LightningIcon, PlusIcon, PowerIcon, SealCheckIcon, SlidersHorizontalIcon, StackIcon, VaultIcon, WalletIcon, XIcon } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { MARKETS, PRESETS, balanceNeededUsd, usd, usdCompact, type AppConfig, type DashboardState, type MarketSym, type Policy, type PxOverview } from '@monday/core';
import { LimitsExplorer, LiveProvider, ModePrompt, PartsTabs, PerplStats, Reveal, Story, WindowBar, type LimitsView } from '@/components/landing';
import { GlassBubbles, LiquidPearl } from '@/components/scene-3d';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { Mark, cx } from '@/components/ui';
import { at } from '@/lib/hosts';

/*
  The landing, after Imagica (2026-11-15), on the Dusk palette: a pearl with Monday's mark resting in dark liquid that
  ripples with every BTC price move on Perpl (the pearl is the Launch app button), smoked-glass windows with the product inside, dark spheres floating behind, the
  custody promise beside Monday's API key and what it may do, and the close among glass bubbles holding market coins.
*/

const WRAP = 'mx-auto max-w-[1200px] px-4 sm:px-8';
const H2 = 'ink text-balance text-[2.1rem] font-semibold leading-[1.06] tracking-[-0.04em] md:text-[3rem]';
const LEAD = 'mt-5 text-pretty text-[17px] leading-relaxed text-fg-2 md:text-[18px]';
const INK = 'group inline-flex h-12 items-center gap-2 rounded-lg bg-fg px-6 text-[15px] font-medium text-canvas transition-[opacity,transform] duration-200 hover:opacity-90 active:translate-y-px';
const BEAD = 'bead inline-flex h-12 items-center gap-2 rounded-lg px-6 text-[15px] font-medium text-fg transition-[background-color,transform] duration-200 hover:bg-raised active:translate-y-px';
const arrow = <ArrowRightIcon size={15} weight="bold" className="nudge" />;

/** What the market maker reads, every second. */
const INPUTS = [
  { icon: ChartBarIcon, name: 'Perpl', sub: 'Book, trades, mark and funding' },
  { icon: GlobeHemisphereWestIcon, name: 'Reference Market', sub: 'Where these perps price first' },
  { icon: SlidersHorizontalIcon, name: 'Your Limits', sub: 'Markets, margin, leverage, stop loss' },
] as const;

/** What Perpl lets Monday's API key do: trade, never move money. */
const SCOPES = [['Place Orders', true], ['Cancel Orders', true], ['Withdraw Funds', false], ['Transfer Funds', false]] as const;

// Answers follow what the code does today (runner, stale-data limits, cleanup); keep them in step with it.
const questions = (onchain: boolean) => [
  { q: 'What do I need to use Monday?', a: 'A wallet to sign in with, a Perpl account with collateral, and a Perpl API key that can trade. The app walks you through each step before anything trades.' },
  { q: 'Which mode should I start with?', a: 'The market maker if you want the spread without a view on direction; Agentic Trade if you have a view and want it worked entry by entry; TWAP to get into a large position without moving a thin book. They can run side by side, each in markets of its own.' },
  { q: 'Where are my funds held?', a: 'In your own Perpl account. Monday trades with an API key that Perpl never lets withdraw or transfer funds, and you withdraw on Perpl yourself.' },
  { q: 'Can Monday lose money?', a: 'Yes, in every mode. Market making carries inventory risk, a scalp or a TWAP entry can move against you, signals can be wrong or late, and fees count against every fill. The stop loss you set ends the trading, but a fast market can overshoot it.' },
  { q: 'What is the difference between Stop and Kill?', a: 'Stop cancels Monday\'s orders and leaves open positions for you to manage. Kill cancels every order in the account and closes positions. Closing can take time, and waits if Perpl is unreachable.' },
  { q: 'What happens if the data or the connection fails?', a: 'If market data is more than 5 seconds old Monday pulls its quotes, and after 30 seconds it stops and closes positions. Any cancel or close it still owes is retried until Perpl confirms it. You can always act on Perpl directly.' },
  {
    q: 'What is recorded on Monad?',
    a: onchain
      ? 'Your wallet publishes your limits to the MondayRegistry contract on Monad, and the agent logs a hash of every decision and its evidence there for anyone to check.'
      : 'Perpl itself runs on Monad, so every order and fill settles there. Monday can also publish your limits and log a hash of each decision to a registry contract on Monad; that registry is not switched on for this server yet, so decisions are kept with their hashes in Monday\'s own log for now.',
  },
];

const API = process.env.API_URL ?? 'http://localhost:3001';
const STATS = process.env.STATS_URL ?? 'http://localhost:3002';
/** One fact from a server, read once a minute so the page stays static. Unreachable: claim nothing. */
async function read<T>(path: string, base = API): Promise<T | null> {
  try {
    const res = await fetch(`${base}${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(2_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const big = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : usdCompact(v));

export default async function Landing() {
  const [config, preview, perpl] = await Promise.all([read<AppConfig>('/api/config'), read<DashboardState>('/api/public/preview'), read<PxOverview>('/api/stats/overview', STATS)]);
  const onchain = Boolean(config?.registry);
  const policy = preview?.policy ?? null;
  // Every market Perpl lists, busiest first when the indexer answers; otherwise the list Monday ships with.
  const markets = perpl?.markets.length
    ? [...perpl.markets].sort((a, b) => b.volume24hUsd - a.volume24hUsd).map((m) => ({ sym: m.sym, mark: m.mark, change: m.change24hPct }))
    : (config ? Object.keys(config.specs) : [...MARKETS]).map((sym) => ({ sym, mark: null, change: null }));
  const allTime = perpl?.headline.volumeAllUsd;

  return (
    // The landing is dark whatever the terminal's theme, and soft: near-black, text a step under white.
    <div data-theme="dark" className="bg-canvas text-fg">
      <SiteHeader />
      {/* How far down the page the reader is: a hairline on the right edge that fills as it scrolls. */}
      <div aria-hidden className="pointer-events-none fixed right-6 top-1/2 z-20 hidden h-40 w-px -translate-y-1/2 bg-[rgb(132_139_155/0.25)] lg:block">
        <span className="progress-y block size-full bg-[rgb(132_139_155)]" />
      </div>
      <main className="overflow-x-clip">
        <LiveProvider>
          <Hero />

          {/* The modes as a prompt: the request types itself, the chips pick the mode, the window shows it at work. */}
          <section id="modes" className="relative scroll-mt-20 py-24 md:py-36">
            <span aria-hidden className="orb float absolute -right-56 top-0 size-[30rem] opacity-90 blur-[2px]" />
            <div className={cx(WRAP, 'relative max-w-[1040px]')}>
              <Reveal><h2 className="text-[22px] font-medium tracking-[-0.02em] text-fg-3 md:text-[28px]">What should Monday do?</h2></Reveal>
              <Reveal className="mt-3" delay={0.08}><ModePrompt /></Reveal>
            </div>
          </section>

          {/* What the market maker reads, drawn as wires running into Monday, in a frosted window between two spheres. */}
          <section className="relative overflow-hidden py-24 md:py-36">
            <span aria-hidden className="orb float absolute -left-52 bottom-[-6rem] size-[34rem] blur-[3px] [--d:-3s]" />
            <span aria-hidden className="orb float absolute -right-20 top-28 size-[17rem] [--d:-6s]" />
            <div className={cx(WRAP, 'relative text-center')}>
              <Reveal>
                <h2 className={H2}>Reads the market every second</h2>
                <p className={cx(LEAD, 'mx-auto max-w-[46ch]')}>The market maker prices both quotes from three sources, and a reflex acts on the very next tick.</p>
              </Reveal>
              <Reveal delay={0.1} className="frost mx-auto mt-14 max-w-[62rem] text-left">
                <div className="frost-in">
                  <WindowBar>The Market Maker, One Second</WindowBar>
                  <Flow />
                </div>
              </Reveal>
            </div>
          </section>

          {/* The market maker part by part: the list on the left, the part drawn in a window on the right. */}
          <section className="relative py-24 md:py-36">
            <div className={WRAP}>
              <Reveal className="text-center">
                <h2 className={H2}>The market maker, part by part</h2>
                <p className={cx(LEAD, 'mx-auto max-w-[50ch]')}>The fast loops are plain code, so nothing urgent waits for a model. The slow one is where judgement pays.</p>
              </Reveal>
              <Reveal delay={0.1} className="mt-14">
                <PartsTabs
                  parts={[
                    { title: 'Engine', when: 'every second', icon: <GaugeIcon size={17} />, glyph: <TickGlyph />, text: 'Prices both quotes from the book, the reference market and the position, and moves only what changed enough to matter.' },
                    { title: 'Reflex', when: 'the next tick', icon: <LightningIcon size={17} />, glyph: <ReflexGlyph />, text: 'Pulls or widens the side about to be run over: a jump in the reference market, a fill, a lopsided book.' },
                    { title: 'Governor', when: 'every 15 minutes', icon: <BrainIcon size={17} />, glyph: <DialsGlyph />, text: 'Kimi reads the whole situation and sets how carefully Monday quotes, inside hard bounds. It never places an order.' },
                    { title: 'Maker Orders', when: 'post-only', icon: <StackIcon size={17} />, glyph: <LadderGlyph />, text: 'Placed on your own Perpl account, they rest on the book and never cross it.' },
                    { title: 'A Public Record', when: onchain ? 'logged on Monad' : 'open to anyone', icon: <SealCheckIcon size={17} />, glyph: <RecordGlyph />, text: onchain ? 'Every decision with its reason, and a hash of it and its evidence logged on Monad.' : 'Every decision with its reason, and a hash of the data behind it.' },
                    { title: 'Stop and Kill', when: 'one click each', icon: <PowerIcon size={17} />, glyph: <SwitchGlyph />, text: 'Stop pulls Monday\'s orders and leaves positions to you. Kill also closes them.' },
                  ]}
                />
              </Reveal>
              <Reveal className="mt-12 flex justify-center">
                <Link href={at('/system')} className={cx(BEAD, 'group')}>Read the System Page{arrow}</Link>
              </Reveal>
            </div>
          </section>

          {/* Every market Perpl lists: the claim on the left, the markets as glass tiles tilted in space on the right. */}
          <section className="relative overflow-hidden py-24 md:py-36">
            <div className={cx(WRAP, 'grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
              <Reveal>
                <h2 className="text-balance text-[2.1rem] font-semibold leading-[1.06] tracking-[-0.04em] md:text-[3rem]">Every market Perpl lists</h2>
                <p className="mt-2 text-[1.6rem] font-light leading-[1.15] tracking-[-0.03em] text-fg-2 md:text-[2.4rem]">{markets.length} markets, one account</p>
                <p className={cx(LEAD, 'max-w-[40ch]')}>From the deepest book to the newest listing. Each mode trades any of them, in markets of its own.</p>
              </Reveal>
              <div className="lg:[perspective:1600px]">
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 lg:[transform:rotateX(14deg)_rotateY(-18deg)_rotateZ(3deg)] lg:[transform-style:preserve-3d]">
                  {markets.map((m, i) => (
                    <li key={m.sym} className="lg:[transform-style:preserve-3d]">
                      <Reveal delay={Math.min(i, 10) * 0.04}>
                        <div
                          className="flex aspect-square flex-col justify-between rounded-[22px] bg-[linear-gradient(150deg,var(--raised),var(--raised-2))] p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.07),inset_0_-8px_18px_rgb(0_0_0/0.35),0_30px_40px_-26px_rgb(0_0_0/0.45)] transition-transform duration-500 hover:-translate-y-1.5 sm:p-4"
                          style={{ transform: `translateZ(${(i * 37) % 60}px)` }}
                        >
                          <span className="flex items-center gap-2 sm:gap-2.5">
                            <CoinBadge sym={m.sym} />
                            <span className="text-[15px] font-bold tracking-tight sm:text-[19px]">{m.sym}</span>
                          </span>
                          <span>
                            <span className="num block text-[13px] font-medium text-fg-2">{m.mark != null ? m.mark.toLocaleString('en-US', { maximumSignificantDigits: 6 }) : 'Perpl'}</span>
                            {m.change != null && <span className={cx('num block text-[13px]', m.change >= 0 ? 'text-bid-fg' : 'text-ask-fg')}>{m.change >= 0 ? '+' : ''}{m.change.toFixed(2)}%</span>}
                          </span>
                        </div>
                      </Reveal>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* How the market maker works: one jump in the reference market, played step by step on the terminal's own panels, in a window. */}
          <section id="how" className="relative scroll-mt-20 overflow-hidden py-24 md:py-36">
            <span aria-hidden className="orb float absolute -right-40 top-10 size-[24rem] blur-[2px] [--d:-4s]" />
            <div className={cx(WRAP, 'relative')}>
              <Reveal className="text-center">
                <h2 className={H2}>Watch the market maker step aside</h2>
                <p className={cx(LEAD, 'mx-auto max-w-[44ch]')}>One jump in the reference market, from the first quote to the written reason.</p>
              </Reveal>
              <Reveal delay={0.1} className="frost mt-14">
                <div className="frost-in p-4 md:p-8"><Story onchain={onchain} /></div>
              </Reveal>
            </div>
          </section>

          {/* Analytics, split like a spread: the claim on white, the live figures in a window on a pale panel. */}
          <section className="grid bg-raised lg:min-h-[44rem] lg:grid-cols-2">
            <div className="flex items-center px-4 py-24 sm:px-8 lg:justify-end lg:pr-16">
              <Reveal className="max-w-[31rem]">
                <h2 className={H2}>Every Perpl trade since launch, indexed</h2>
                <p className={LEAD}>Volume, open interest, funding, liquidations and who makes money, for all of Perpl. Open to anyone, no wallet needed.</p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link href={at('/analytics')} className={INK}>Open the Analytics{arrow}</Link>
                  <Link href={at('/analytics/screener')} className={cx(BEAD, '!bg-canvas hover:!bg-void')}>Screener</Link>
                </div>
              </Reveal>
            </div>
            <div className="relative flex items-center overflow-hidden bg-void px-4 py-20 sm:px-8 lg:pl-16">
              <span aria-hidden className="orb float absolute -right-24 -top-24 size-[22rem] [--d:-2s]" />
              <span aria-hidden className="orb float absolute -bottom-40 left-10 size-[26rem] blur-[3px] [--d:-5s]" />
              <Reveal delay={0.1} className="frost relative w-full max-w-[38rem]">
                <div className="frost-in">
                  <WindowBar>Perpl Analytics{allTime ? ` · ${big(allTime)} Indexed` : ''}</WindowBar>
                  <div className="p-2"><PerplStats table={false} /></div>
                </div>
              </Reveal>
            </div>
          </section>

          {/* Custody: the promise on the left; on the right, what Monday's key may and may not do, and where the money sits. */}
          <section id="custody" className="relative scroll-mt-20 overflow-hidden py-24 md:py-36">
            <span aria-hidden className="orb float absolute -left-52 top-1/4 size-[26rem] blur-[2px] [--d:-3s]" />
            <div className={cx(WRAP, 'relative grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20')}>
              <Reveal>
                <h2 className={H2}>Your funds stay in your account</h2>
                <p className={cx(LEAD, 'max-w-[44ch]')}>
                  Monday trades through a Perpl API key that cannot withdraw or transfer, and you can revoke it at any time. You deposit and withdraw on Perpl yourself.
                </p>
              </Reveal>
              <Reveal delay={0.1}><KeyCard /></Reveal>
            </div>
          </section>

          {/* Limits: the claim and the controls on the left, the house account's numbers in a window on the right. */}
          <section id="limits" className="relative scroll-mt-20 overflow-hidden py-24 md:py-36">
            <span aria-hidden className="orb float absolute -left-44 top-1/3 size-[22rem] blur-[2px] [--d:-7s]" />
            <div className={cx(WRAP, 'relative')}>
              <Reveal>
                <LimitsExplorer view={limitsView(policy)}>
                  <h2 className={H2}>You set the limits</h2>
                  <p className={cx(LEAD, 'max-w-[42ch]')}>Monday stops when one is hit. The agent and the LLM are held to these numbers on every order.</p>
                </LimitsExplorer>
              </Reveal>
            </div>
          </section>

          {/* Questions, centred under one heading. Native disclosures, readable without JavaScript. */}
          <section id="faq" className="scroll-mt-20 pb-24 md:pb-36">
            <div className="mx-auto max-w-[48rem] px-4 sm:px-8">
              <Reveal className="text-center">
                <h2 className={H2}>Questions before you start</h2>
                <p className={LEAD}>
                  Anything not here is on the <Link href={at('/system')} className="font-medium text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-accent">System</Link> page, part by part.
                </p>
              </Reveal>
              <div className="mt-12 grid gap-2">
                {questions(onchain).map((f) => (
                  <details key={f.q} className="smooth group rounded-2xl bg-raised/55 transition-[background-color,box-shadow] duration-300 open:bg-raised open:shadow-[0_14px_34px_-18px_rgb(0_0_0/0.3)] hover:bg-raised/85">
                    <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 px-5 py-4 text-[16px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <PlusIcon size={18} aria-hidden className="flex-none text-fg-3 transition-transform duration-300 group-open:rotate-45" />
                    </summary>
                    <p className="max-w-[62ch] px-5 pb-6 text-[16px] leading-relaxed text-fg-2">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* The close, dark among glass bubbles: one line, one sentence, one button. */}
          <section data-theme="dark" className="relative isolate overflow-hidden bg-void text-fg">
            <GlassBubbles className="absolute inset-0 -z-10" />
            <div className={cx(WRAP, 'flex min-h-[40rem] items-end py-20 md:min-h-[46rem] md:items-center')}>
              <Reveal className="max-w-[33rem]">
                <h2 className="ink text-balance text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.045em] md:text-[3.25rem]">Pick a mode. Monday keeps to your limits.</h2>
                <p className="mt-5 max-w-[44ch] text-[17px] leading-relaxed text-fg-2">Sign in with your wallet, connect a Perpl key that can trade and set your limits. Nothing trades until you start it.</p>
                <Link href={at('/app')} className="group mt-9 inline-flex h-12 items-center gap-2 rounded-lg bg-fg px-6 text-[15px] font-medium text-canvas transition-[opacity,transform] hover:opacity-90 active:translate-y-px">Launch App{arrow}</Link>
              </Reveal>
            </div>
          </section>
        </LiveProvider>
      </main>
      <div data-theme="dark" className="bg-void text-fg"><SiteFooter /></div>
    </div>
  );
}

/** The first screen: the claim over the liquid and the pearl that opens the app. */
function Hero() {
  return (
    <section className="relative isolate h-[max(40rem,calc(100svh-4rem))]">
      <LiquidPearl className="absolute inset-0" href={at('/app')} />
      {/* Clicks pass through the words to the liquid behind them. */}
      <div className={cx(WRAP, 'pointer-events-none relative pt-[10vh] text-center md:pt-[12vh]')}>
        <p className="enter text-[13px] font-semibold uppercase tracking-[0.12em] text-fg-3 [--d:40ms] md:text-[14px]">Trades from your own Perpl account</p>
        {/* The gradient is on each moving line, not on the h1: a line animated onto a layer of its own does not receive a
            text gradient painted by its parent, and vanished on scroll (2026-11-15). */}
        <h1 className="mt-5 text-[clamp(2.1rem,11vw,5rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
          <span className="line"><span className="ink" style={{ '--d': '120ms' } as React.CSSProperties}>The AI trading</span></span>
          <span className="line"><span className="ink" style={{ '--d': '220ms' } as React.CSSProperties}>terminal for Perpl</span></span>
        </h1>
        <p className="enter mx-auto mt-5 max-w-[40ch] text-[16px] leading-relaxed text-fg-2 [--d:360ms] md:text-[18px]">Make markets, scalp a bias or build a position in slices, inside limits you set.</p>
      </div>
    </section>
  );
}

/**
 * Monday's API key as a card: what Perpl lets it do (trade) and not (move money), then the three parties with the funds
 * held in the middle. A slight turn in space on a wide screen; flat on a phone.
 */
function KeyCard() {
  return (
    <div className="frost lg:[transform:perspective(1600px)_rotateY(-9deg)_rotateX(4deg)]">
      <div className="frost-in">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-raised-2 shadow-[inset_0_0_0_1px_var(--line-2)]"><Mark size={22} /></span>
            <span>
              <span className="block text-[15px] font-semibold tracking-tight">Monday&apos;s API Key</span>
              <span className="block text-[13px] text-fg-3">on your Perpl account</span>
            </span>
          </span>
          <span className="rounded-md bg-accent/12 px-2.5 py-1 text-[13px] font-medium text-accent">Trade Scope</span>
        </div>
        <ul aria-label="What the key can do" className="grid gap-px bg-line sm:grid-cols-2">
          {SCOPES.map(([k, ok]) => (
            <li key={k} className="flex items-center gap-3 bg-raised px-5 py-4">
              <span className={cx('grid size-7 flex-none place-items-center rounded-md', ok ? 'bg-bid/15 text-bid-fg' : 'bg-ask/15 text-ask-fg')}>
                {ok ? <CheckIcon size={15} weight="bold" /> : <XIcon size={15} weight="bold" />}
              </span>
              <span className={cx('text-[15px]', ok ? 'text-fg' : 'text-fg-3 line-through decoration-ask/60')}>{k}</span>
              <span className="sr-only">{ok ? 'allowed' : 'not allowed'}</span>
            </li>
          ))}
        </ul>
        {/* Where the money sits: you move it in and out on Perpl; Monday only sends orders to it. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)_auto_minmax(0,1fr)] items-start gap-1.5 border-t border-line px-4 py-6 text-center sm:gap-3 sm:px-6">
          <Party icon={<WalletIcon size={20} />} title="You" sub="deposit, withdraw" />
          <Wire icon={<ArrowsLeftRightIcon size={15} />} label="funds" />
          <Party icon={<VaultIcon size={20} />} title="Perpl Account" sub="funds stay here" hot />
          <Wire icon={<ArrowLeftIcon size={15} />} label="orders" />
          <Party icon={<Mark size={20} />} title="Monday" sub="trade-only" />
        </div>
        <p className="border-t border-line px-5 py-3.5 text-[13px] text-fg-3">Revoke the key on Perpl and Monday is cut off at once.</p>
      </div>
    </div>
  );
}

function Party({ icon, title, sub, hot }: { icon: React.ReactNode; title: string; sub: string; hot?: boolean }) {
  return (
    <span className="flex flex-col items-center gap-2">
      <span className={cx('grid size-11 place-items-center rounded-lg', hot ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)]' : 'bg-raised-2 text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)]')}>{icon}</span>
      <span className="text-[13px] font-semibold leading-tight">{title}</span>
      <span className="text-[12px] leading-tight text-fg-3">{sub}</span>
    </span>
  );
}

function Wire({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span aria-hidden className="mt-3 flex flex-col items-center gap-1 text-fg-3">
      {icon}
      <span className="text-[12px]">{label}</span>
    </span>
  );
}

/**
 * Each market's coin in public/landing/coins: web3icons (MIT) for most, the projects' own logos from CoinGecko for LIT
 * (Lighter), VVV (Venice), PUMP (Pump.fun) and HYPE (added at the user's request), each checked against Perpl's price
 * on 2026-11-15. VVV's logo has no ground of its own, so it sits on a white disc like the others.
 */
const COIN_ICONS: Record<string, string> = {
  BTC: 'btc.svg', ETH: 'eth.svg', MON: 'mon.svg', SOL: 'sol.svg', ZEC: 'zec.svg', UNI: 'uni.svg', NEAR: 'near.svg',
  LIT: 'lit.png', VVV: 'vvv.png', PUMP: 'pump.png', HYPE: 'hype.png',
};

/** A market's coin beside its name on the tiles; a market added later without a logo gets a plain initial badge. */
function CoinBadge({ sym }: { sym: string }) {
  const file = COIN_ICONS[sym];
  return file
    ? <img src={`/landing/coins/${file}`} alt="" className={cx('size-6 flex-none rounded-full sm:size-8', sym === 'VVV' && 'bg-white p-0.5')} />
    : <span aria-hidden className="grid size-6 flex-none place-items-center rounded-full bg-raised-2 text-[12px] font-bold text-fg-2 shadow-[inset_0_0_0_1px_var(--line-2)] sm:size-8 sm:text-[13px]">{sym[0]}</span>;
}

/** The three inputs wired into Monday, and the two quotes it sends to Perpl. Wires run toward Monday. */
function Flow() {
  // Where each input's wire leaves, in the drawing's 0-100 height: the middles of three 4.5rem rows with 0.5rem gaps.
  const ys = [15.5, 50, 84.5];
  return (
    <div className="grid items-center gap-6 p-5 md:p-8 lg:grid-cols-[minmax(0,1fr)_5rem_auto_4rem_minmax(0,0.9fr)] lg:gap-0">
      <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
        {INPUTS.map((x) => (
          <li key={x.name} className="flex items-center gap-3 rounded-xl bg-raised px-3.5 py-3 shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_8px_20px_-14px_rgb(0_0_0/0.35)] lg:h-[4.5rem]">
            <span className="grid size-9 flex-none place-items-center rounded-lg bg-canvas text-fg"><x.icon size={18} /></span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold tracking-tight">{x.name}</span>
              <span className="block text-[13px] leading-snug text-fg-3">{x.sub}</span>
            </span>
          </li>
        ))}
      </ul>
      <svg aria-hidden viewBox="0 0 80 100" preserveAspectRatio="none" className="hidden h-[14.5rem] w-full overflow-visible lg:block">
        {ys.map((y) => <path key={y} d={`M0 ${y} C 45 ${y}, 35 50, 80 50`} fill="none" stroke="var(--fg-3)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" className="flowline" />)}
      </svg>
      <div className="flex flex-col items-center gap-3 justify-self-center">
        <span className="grid size-24 place-items-center rounded-full bg-[radial-gradient(circle_at_34%_28%,var(--raised),var(--raised-2)_60%,var(--void))] shadow-[0_24px_40px_-18px_rgb(0_0_0/0.45),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
          <Mark size={34} />
        </span>
        <span className="text-center">
          <span className="block text-[15px] font-semibold tracking-tight">Monday</span>
          <span className="block text-[13px] text-fg-3">prices, every second</span>
        </span>
      </div>
      <svg aria-hidden viewBox="0 0 64 100" preserveAspectRatio="none" className="hidden h-[14.5rem] w-full overflow-visible lg:block">
        <path d="M0 50 L64 50" fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="flowline" />
      </svg>
      <div className="rounded-xl bg-raised p-4 shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_8px_20px_-14px_rgb(0_0_0/0.35)]">
        <p className="text-[15px] font-semibold tracking-tight">Two Maker Quotes</p>
        <p className="mt-0.5 text-[13px] text-fg-3">post-only, on your Perpl account</p>
        <dl className="num mt-4 grid gap-1.5 text-[14px]">
          <div className="flex justify-between rounded-md bg-[color-mix(in_oklab,var(--ask)_9%,var(--raised))] px-2.5 py-1.5"><dt className="text-ask-fg">Ask</dt><dd>85,237.9</dd></div>
          <div className="flex justify-between rounded-md bg-[color-mix(in_oklab,var(--bid)_9%,var(--raised))] px-2.5 py-1.5"><dt className="text-bid-fg">Bid</dt><dd>85,162.1</dd></div>
        </dl>
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-fg-3"><BroadcastIcon size={14} className="text-accent" />Kimi reviews them every 15 minutes</p>
      </div>
    </div>
  );
}

// ---- The drawings in the parts window: the terminal's own marks, at rest. ----

function TickGlyph() {
  return (
    <span className="flex items-end gap-1.5">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className={cx('beat w-1.5 rounded-full bg-line-2', i === 8 ? 'h-10' : 'h-6')} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </span>
  );
}

function ReflexGlyph() {
  return (
    <span className="flex items-end gap-3">
      <span className="flex flex-col items-center gap-1.5"><span className="h-12 w-8 rounded-md bg-accent" /><span className="text-[13px] text-fg-3">Bid</span></span>
      <span className="flex flex-col items-center gap-1.5"><span className="hatch h-6 w-8 rounded-md border border-dashed border-ask/80" /><span className="text-[13px] text-ask-fg">Ask Pulled</span></span>
    </span>
  );
}

function DialsGlyph() {
  return (
    <span className="flex gap-6">
      {[['Spread', 'rotate-[50deg]', '2.5x'], ['Size', '-rotate-[40deg]', '40%']].map(([k, r, v]) => (
        <span key={k} className="flex flex-col items-center gap-2">
          <span className="relative block size-14 rounded-full bg-raised shadow-[inset_0_0_0_2px_rgb(255_255_255/0.12)]">
            <span className={cx('absolute bottom-1/2 left-1/2 h-5 w-0.5 origin-bottom -translate-x-1/2 rounded-full bg-accent', r)} />
          </span>
          <span className="text-[13px] text-fg-3">{k} <span className="num text-fg">{v}</span></span>
        </span>
      ))}
    </span>
  );
}

function LadderGlyph() {
  const rows = [['85,231.1', 0.5, false], ['85,237.9', 0.3, true], ['85,219.8', 0.7, false], ['85,180.4', 0.6, false], ['85,162.1', 0.3, true], ['85,168.9', 0.8, false]] as const;
  return (
    <span className="grid w-48 gap-1">
      {rows.map(([p, w, mine]) => (
        <span key={p} className={cx('num flex items-center justify-between rounded-md px-2 py-0.5 text-[13px]', mine ? 'bg-accent/15 font-semibold text-accent' : 'text-fg-3')}>
          {p}<span className={cx('h-1.5 rounded-full', mine ? 'bg-accent' : 'bg-fg/12')} style={{ width: `${w * 60}px` }} />
        </span>
      ))}
    </span>
  );
}

function RecordGlyph() {
  return (
    <span className="flex items-center gap-3 rounded-xl bg-raised px-4 py-3 shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_10px_24px_-14px_rgb(0_0_0/0.4)]">
      <CheckCircleIcon size={20} weight="fill" className="text-accent" />
      <span className="grid gap-0.5 text-left">
        <span className="text-[13px] font-semibold">Reflex · Ask Pulled</span>
        <span className="font-mono text-[13px] text-fg-3">0x4f3a…c21e</span>
      </span>
    </span>
  );
}

function SwitchGlyph() {
  return (
    <span className="flex gap-2">
      <span className="rounded-md bg-raised px-4 py-2 text-[14px] font-semibold shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">Stop</span>
      <span className="rounded-md bg-ask-deep px-4 py-2 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_var(--ask)]">Kill</span>
    </span>
  );
}

/** The house account's limits as Setup holds them; without a reachable server, the balanced preset Setup starts from. */
function limitsView(policy: Policy | null): LimitsView {
  const p = policy ?? { ...PRESETS.balanced, markets: ['BTC', 'ETH', 'SOL'] as MarketSym[], preset: 'balanced' as const };
  return {
    title: policy ? 'The House Account\'s Limits' : 'The Balanced Preset',
    note: `${p.preset} preset`,
    markets: [...p.markets],
    rows: [
      ['Quote Size', `${usd(p.quoteSizeUsd)} each side`],
      ['Position Limit', `${usd(p.maxInventoryUsd)} per market`],
      ['Stop Loss', `${usd(p.maxDailyLossUsd)} a day`],
      ['Leverage', `${p.maxLeverage}x`],
      ['Minimum Half Spread', `${p.minHalfSpreadBps} bps`],
    ],
    collateral: usd(balanceNeededUsd(p, p.markets.length)),
  };
}
