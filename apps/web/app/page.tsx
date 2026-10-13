import { ArrowRightIcon, ArrowsLeftRightIcon, CrosshairIcon, HourglassIcon, PlusIcon, VaultIcon, WalletIcon } from '@phosphor-icons/react/dist/ssr';
import { MARKETS, PRESETS, balanceNeededUsd, usd, type AppConfig, type DashboardState, type MarketSym, type Policy } from '@monday/core';
import { AgentDiagram } from '@/components/agent-diagram';
import { CloseField, CountUp, LiveProvider, PerplStats, Reveal, Spotlight, Story } from '@/components/landing';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { ButtonLink, Mark, Tag, cx } from '@/components/ui';
import { at } from '@/lib/hosts';

const WRAP = 'mx-auto max-w-[1320px] px-4 sm:px-8';
const H2 = 'display text-[2.25rem] md:text-[3.25rem]';
const LEAD = 'mt-5 max-w-[54ch] text-[16px] leading-relaxed text-fg-2 md:text-[17px]';

// Measured on the live decision log (Monad mainnet, kimi-k3, 10 to 12 Oct). The System page carries the whole account.
const KIMI = { decisions: 167, looser: 0 };

// The three modes, one answer per row so they read across. Same facts as Setup and the plan forms; keep them in step.
const MODE_ROWS = ['What it does', 'Use it for', 'Runs', 'Kimi\'s part', 'Protection'] as const;
const MODES = [
  {
    name: 'Agentic Market Maker', icon: ArrowsLeftRightIcon, href: '/app/onboarding', cta: 'Set up the market maker',
    rows: ['Quotes both sides of the book in the markets you choose and earns the spread.', 'Earning the spread without a view on direction.', 'Until you stop it.', 'Reviews spread and size every 15 minutes, inside hard bounds. Never places an order.', 'A daily stop loss on the margin. At it, Monday cancels its orders and closes the positions.'],
  },
  {
    name: 'Agentic Trade', icon: CrosshairIcon, href: '/app/setup/trade', cta: 'Start a trade',
    rows: ['Scalps your long or short bias on one market, again and again, on a short timeframe.', 'A view on direction you want worked, entry by entry.', 'Up to a week, or until the stop loss or take profit on its margin.', 'Sums up D1, H4 and H1 before you start. Code reads the trend and picks every entry.', 'Every scalp\'s stop and target rest on Perpl from its fill.'],
  },
  {
    name: 'TWAP', icon: HourglassIcon, href: '/app/setup/twap', cta: 'Start a TWAP',
    rows: ['Builds a position in slices, as maker orders where it can, so one large order does not move a thin book.', 'A large entry, spread over minutes or hours.', 'Up to 24 hours to build, then held until its stop, its target or you close it.', 'Sums up D1, H4 and H1 before you start. Code places every slice.', 'A price it must not pass while building, and a stop loss on Perpl from the first fill.'],
  },
] as const;

// The market maker's loops, with what feeds them and what comes out. Same facts as the System page, one line each.
const INPUTS = [
  ['Perpl', 'Order book, trades, mark and funding, over the market-data socket.'],
  ['Reference market', 'Mid prices and the trade tape of the market where these perps are priced first, which Perpl follows.'],
  ['Smart Traders', 'Trades by wallets with a consistent profit record.'],
  ['Your limits', 'Markets, margin, leverage and a daily stop loss, set in Setup.'],
] as const;
const LOOPS = [
  { name: 'Engine', when: 'every second', who: 'code', text: 'Prices both quotes from the book, the reference market and the position, and changes only what moved enough to matter.' },
  { name: 'Reflex', when: 'the next tick', who: 'code', text: 'Pulls or widens the side about to be run over: a Smart Trader burst, a move in the reference market, a fill on its own quote.' },
  { name: 'Governor', when: 'every 15 minutes', who: 'Kimi', text: 'Reads the whole situation, sets how carefully Monday quotes inside hard bounds, and says why in plain words. Never places an order.' },
] as const;
const outputs = (onchain: boolean) => [
  ['Maker orders', 'Post-only, on your own Perpl account. They never cross the book.'],
  ['A public record', onchain ? 'Every decision with its reason, and a hash of it and its evidence logged on Monad.' : 'Every decision with its reason, and a hash of the data behind it, open to anyone.'],
];

/** Who holds what. Monday never touches the money: it reaches the account only through a key that cannot move funds. */
const PARTIES = [
  { icon: WalletIcon, title: 'You', can: 'deposit, withdraw, revoke', lines: ['Sign in with your wallet: a signed message, no gas.', 'Deposit and withdraw on Perpl, from your own wallet.', 'Stop, kill, or revoke the key at any time.'] },
  { icon: VaultIcon, title: 'Your Perpl account', can: 'funds stay here', funds: true, lines: ['Holds the collateral.', 'Every order and fill settles here, on Monad.', 'Only your wallet can withdraw.'] },
  { icon: Mark, title: 'Monday', can: 'trade-only key', lines: ['Trades through a trade-scoped Perpl API key, stored encrypted.', 'Perpl never lets any API key withdraw or transfer funds.', 'Revoke the key and Monday loses access at once, and stops.'] },
];

const CONTROLS = [
  ['Position limit', 'The most Monday may hold in each market. Margin and leverage set it, or you type it.'],
  ['Stop loss', 'Every mode has one, a share of its margin. At it Monday stops and closes the position. Fast markets can overshoot it.'],
  ['Stop and kill', 'Stop pulls Monday\'s orders and leaves positions to you. Kill also closes them. One click each, under Plans in the terminal.'],
];

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
/** One fact from the server, read once a minute so the page stays static. Unreachable: claim nothing. */
async function read<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(2_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function Landing() {
  const [config, preview] = await Promise.all([read<AppConfig>('/api/config'), read<DashboardState>('/api/public/preview')]);
  const onchain = Boolean(config?.registry);
  const marketCount = config ? Object.keys(config.specs).length : MARKETS.length;
  const policy = preview?.policy ?? null;
  return (
    <>
      <SiteHeader />
      {/* Clip, not hidden: the terminal's light reaches past the edges without scrolling the page sideways. */}
      <main className="page-in overflow-x-clip">
        <LiveProvider>
          {/* The claim beside the call to action, then how Monday works, drawn, inside the first screen. */}
          <section>
            <div className={`${WRAP} pt-10 md:pt-12`}>
              <div className="grid items-end gap-x-12 gap-y-7 lg:grid-cols-12">
                <h1 className="display font-medium text-[clamp(2.4rem,9.2vw,3.5rem)] lg:col-span-8 lg:whitespace-nowrap lg:text-[calc((min(100vw,82.5rem)_-_4rem)*0.064)] dark:[text-shadow:0_2px_12px_rgb(0_0_0/0.35)]">
                  <span className="line"><span style={{ '--d': '120ms' } as React.CSSProperties}>The AI trading terminal</span></span>
                  <span className="line"><span style={{ '--d': '240ms' } as React.CSSProperties}>for <span className="text-accent">Perpl</span>.</span></span>
                </h1>
                <div className="lg:col-span-4 lg:pb-1.5">
                  <p className="enter max-w-[40ch] text-[17px] leading-relaxed text-fg-2" style={{ '--d': '420ms' } as React.CSSProperties}>
                    Make markets, scalp a bias, or build a position in slices, from your own Perpl account and inside your limits.
                  </p>
                  <div className="enter mt-6 flex flex-wrap gap-2.5" style={{ '--d': '540ms' } as React.CSSProperties}>
                    <Launch />
                    <ButtonLink href="#modes" size="lg" variant="ghost" className="h-12 px-5 text-[16px]">Compare the modes</ButtonLink>
                  </div>
                </div>
              </div>
              <AgentDiagram onchain={onchain} className="enter mt-14 [--d:640ms] lg:mt-20" />
              <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
                <Fact n={<CountUp value={marketCount} />} k="Perpl markets, every one it lists" />
                <Fact n="1 s" k="engine tick. A reflex acts on the next one" />
                <Fact n={<CountUp value={KIMI.decisions} />} k="Kimi decisions on Monad mainnet, 10 to 12 Oct" href={at('/system#kimi')} />
                <Fact n={String(KIMI.looser)} k="of them looser than the rules would have been" />
              </dl>
            </div>
          </section>

          {/* The three modes side by side: the terminal's range before the market maker's depth. */}
          <section id="modes" className="mt-16 scroll-mt-14 border-t border-line md:mt-20">
            <div className={`${WRAP} py-20 md:py-28`}>
              <Reveal>
                <h2 className={`${H2} max-w-[20ch]`}>Three ways to trade. Run one, or all three.</h2>
                <p className={LEAD}>Each trades from your own Perpl account, in markets of its own, and stops at a loss you set.</p>
              </Reveal>
              <Reveal className="mt-12" delay={0.1}>
                <Modes />
              </Reveal>
            </div>
          </section>

          {/* How the market maker works: one burst, played step by step on the terminal's own panels. */}
          <section id="how" className="scroll-mt-14 border-t border-line bg-canvas">
            <div className={`${WRAP} py-20 md:py-28`}>
              <Reveal>
                <h2 className={`${H2} max-w-[22ch]`}>The market maker: code moves the quotes, the LLM turns the dials.</h2>
                <p className={LEAD}>One Smart Trader burst, from the first quote to the written reason.</p>
              </Reveal>
              <div className="mt-12">
                <Story onchain={onchain} />
              </div>
            </div>
          </section>

          {/* The system: what goes in, the three loops, what comes out. One hairline grid, read left to right. */}
          <section className="border-t border-line">
            <div className={`${WRAP} py-20 md:py-28`}>
              <Reveal>
                <h2 className={`${H2} max-w-[20ch]`}>Three loops, three clocks.</h2>
                <p className={LEAD}>The market maker&apos;s fast loops are plain code, so nothing urgent ever waits for a model. The slow one is where judgement pays.</p>
              </Reveal>
              <Reveal className="mt-12" delay={0.1}>
                <Spotlight className="grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-[minmax(0,3fr)_minmax(0,5fr)_minmax(0,4fr)]">
                  <Column label="In">
                    {INPUTS.map(([k, v]) => (
                      <div key={k} className="spot bg-canvas px-5 py-4">
                        <p className="text-[16px] font-semibold tracking-tight">{k}</p>
                        <p className="mt-1 text-[14px] text-fg-2">{v}</p>
                      </div>
                    ))}
                  </Column>
                  <Column label="Loops">
                    {LOOPS.map((l) => (
                      <div key={l.name} className={cx('spot bg-canvas px-5 py-5', l.who === 'Kimi' && 'shadow-[inset_2px_0_0_var(--accent)]')}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[19px] font-semibold tracking-tight">{l.name}</p>
                          <p className="num text-[13px] text-fg-3">{l.when}</p>
                        </div>
                        <p className="mt-2 max-w-[48ch] text-[15px] text-fg-2">{l.text}</p>
                        <Tag tone={l.who === 'Kimi' ? 'accent' : 'neutral'} className="mt-3">{l.who}</Tag>
                      </div>
                    ))}
                  </Column>
                  <Column label="Out">
                    {outputs(onchain).map(([k, v]) => (
                      <div key={k} className="spot bg-canvas px-5 py-5">
                        <p className="text-[16px] font-semibold tracking-tight">{k}</p>
                        <p className="mt-1 text-[14px] text-fg-2">{v}</p>
                      </div>
                    ))}
                  </Column>
                </Spotlight>
              </Reveal>
              <p className="mt-6 text-[15px] text-fg-2">
                Every part in detail, and what Kimi decided on mainnet: <a href={at('/system')} className="font-medium text-fg underline decoration-line-2 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent">System</a>.
              </p>
            </div>
          </section>

          {/* Custody: one statement, then the three parties side by side with the money in the middle. */}
          <section id="custody" className="scroll-mt-14 border-t border-line bg-canvas">
            <div className={`${WRAP} py-20 md:py-28`}>
              <Reveal>
                <h2 className={`${H2} max-w-[18ch]`}>Your funds <span className="text-accent">never leave</span> your Perpl account.</h2>
              </Reveal>
              <Reveal className="mt-12" delay={0.1}>
                <Spotlight className="grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
                  {PARTIES.map((p) => (
                    <div key={p.title} className={cx('spot p-6 md:p-7', p.funds ? 'bg-raised' : 'bg-void')}>
                      <div className="flex items-center justify-between gap-3">
                        <p.icon size={26} className={p.funds ? 'text-accent' : 'text-fg-2'} />
                        <Tag tone={p.funds ? 'accent' : 'neutral'}>{p.can}</Tag>
                      </div>
                      <p className="mt-6 text-[21px] font-semibold tracking-tight">{p.title}</p>
                      <ul className="mt-3 grid gap-1.5 text-[15px] text-fg-2">
                        {p.lines.map((l) => <li key={l}>{l}</li>)}
                      </ul>
                    </div>
                  ))}
                </Spotlight>
              </Reveal>
            </div>
          </section>

          {/* Limits: what each control does, and the house account's own limits as set in Setup. */}
          <section className="border-t border-line">
            <div className={`${WRAP} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16`}>
              <Reveal>
                <h2 className={`${H2} max-w-[16ch]`}>You set the limits. Monday stops when one is hit.</h2>
                <p className={LEAD}>Pick a margin and a leverage in Setup and Monday sizes the rest. The agent and the LLM are held to these numbers on every order.</p>
                <dl className="mt-10 grid gap-5">
                  {CONTROLS.map(([k, v]) => (
                    <div key={k} className="border-l-2 border-line-2 pl-4">
                      <dt className="text-[16px] font-semibold tracking-tight">{k}</dt>
                      <dd className="mt-1 max-w-[50ch] text-[15px] text-fg-2">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
              <Reveal delay={0.1}>
                <Limits policy={policy} />
              </Reveal>
            </div>
          </section>

          {/* Analytics: the second product, with its live figures. */}
          <section className="border-t border-line bg-canvas">
            <div className={`${WRAP} py-20 md:py-28`}>
              <Reveal>
                <h2 className={`${H2} max-w-[18ch]`}>Every Perpl trade since launch, indexed.</h2>
                <p className={LEAD}>Volume, open interest, funding, liquidations and who makes money, for all of Perpl. Open to anyone, no wallet needed, with a chat that answers from the live figures.</p>
              </Reveal>
              <Reveal className="mt-10" delay={0.1}>
                <PerplStats />
              </Reveal>
              <div className="mt-8">
                <ButtonLink href={at('/analytics')} size="lg" variant="ghost" className="h-12 px-5 text-[16px]">Open the analytics</ButtonLink>
              </div>
            </div>
          </section>

          {/* Questions: the heading holds the left, the answers read down the right. Native disclosures, readable without JavaScript. */}
          <section id="faq" className="scroll-mt-14 border-t border-line">
            <div className={`${WRAP} grid gap-10 py-20 md:py-28 lg:grid-cols-12 lg:gap-12`}>
              <div className="lg:col-span-4">
                <h2 className={`${H2} max-w-[12ch]`}>Questions before you start</h2>
                <p className="mt-5 max-w-[34ch] text-[16px] text-fg-2">
                  Anything not here is on the <a href={at('/system')} className="font-medium text-fg underline decoration-line-2 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent">System</a> page, part by part.
                </p>
              </div>
              <div className="border-t border-line-2 lg:col-span-8">
                {questions(onchain).map((f) => (
                  <details key={f.q} className="smooth group border-b border-line-2">
                    <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 text-[16px] font-semibold tracking-tight transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <PlusIcon size={18} aria-hidden className="flex-none text-fg-3 transition-transform duration-300 group-open:rotate-45" />
                    </summary>
                    <p className="max-w-[64ch] pb-6 text-[16px] leading-relaxed text-fg-2">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* The close, in Monday's own colour, over the live book drawn in the band's ink. */}
          <section className="relative isolate overflow-hidden bg-accent text-accent-fg">
            <CloseField className="absolute inset-x-0 bottom-0 -z-10 h-40 md:h-60" />
            <div className={`${WRAP} flex flex-col items-start gap-8 pb-52 pt-20 md:flex-row md:items-start md:justify-between md:pb-80 md:pt-28`}>
              <Reveal>
                <h2 className="display max-w-[15ch] text-[2.75rem] font-medium md:text-[4.5rem]">Pick a mode. Monday keeps to your limits.</h2>
              </Reveal>
              <Launch inverse />
            </div>
          </section>
        </LiveProvider>
      </main>
      <SiteFooter />
    </>
  );
}

/** The one call to action: a label and an arrow box that nudges forward on hover. */
function Launch({ inverse = false }: { inverse?: boolean }) {
  return (
    <ButtonLink href={at('/app')} size="lg" variant={inverse ? 'inverse' : 'primary'} className="group h-12 gap-5 pl-5 pr-1.5 text-[16px]">
      Launch app
      <span aria-hidden className={cx('grid size-9 place-items-center rounded-xs transition-transform duration-300 ease-out group-hover:translate-x-0.5', inverse ? 'bg-accent text-accent-fg' : 'bg-accent-fg text-accent')}>
        <ArrowRightIcon size={16} weight="bold" />
      </span>
    </ButtonLink>
  );
}

/**
 * The modes side by side. On a wide screen each column is a subgrid, so the same question lines up across all three;
 * on a phone each mode stacks with its own labels.
 */
function Modes() {
  return (
    <Spotlight className="grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-3 lg:grid-rows-[repeat(7,auto)]">
      {MODES.map((m) => (
        <div key={m.name} className="grid gap-px lg:row-span-7 lg:grid-rows-subgrid">
          <div className="spot flex items-center gap-3 bg-canvas px-6 py-5">
            <span className="grid size-10 flex-none place-items-center rounded-sm border border-line-2 bg-raised text-accent"><m.icon size={20} /></span>
            <h3 className="text-[21px] font-semibold tracking-tight">{m.name}</h3>
          </div>
          {m.rows.map((r, i) => (
            <div key={MODE_ROWS[i]} className="spot bg-canvas px-6 py-4">
              <p className="label">{MODE_ROWS[i]}</p>
              <p className="mt-1.5 max-w-[46ch] text-[15px] leading-relaxed text-fg-2">{r}</p>
            </div>
          ))}
          <div className="bg-canvas px-6 py-5">
            <ButtonLink href={at(m.href)} size="lg" variant="ghost" className="h-11 w-full text-[15px]">{m.cta}</ButtonLink>
          </div>
        </div>
      ))}
    </Spotlight>
  );
}

/** One measured figure in the hairline grid under the terminal. */
function Fact({ n, k, href }: { n: React.ReactNode; k: string; href?: string }) {
  return (
    <div className="flex flex-col-reverse bg-void px-5 py-5 md:px-6 md:py-6">
      <dt className="mt-3 max-w-[24ch] text-[14px] text-fg-2">{href ? <a href={href} className="underline decoration-line-2 underline-offset-4 transition-colors hover:text-fg hover:decoration-accent">{k}</a> : k}</dt>
      <dd className="num text-[2.25rem] font-medium leading-none tracking-tight md:text-[2.75rem]">{n}</dd>
    </div>
  );
}

/** A column of the system grid: a head, then its cells; the last cell takes the slack so the hairlines stay even. */
function Column({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-px bg-line [&>*:last-child]:flex-1">
      <p className="label flex h-9 items-center bg-canvas px-5">{label}</p>
      {children}
    </div>
  );
}

/** The house account's limits as Setup holds them; without a reachable server, the balanced preset Setup starts from. */
function Limits({ policy }: { policy: Policy | null }) {
  const p = policy ?? { ...PRESETS.balanced, markets: ['BTC', 'ETH', 'SOL'] as MarketSym[], preset: 'balanced' as const };
  const rows: [string, React.ReactNode][] = [
    ['Markets', <span key="m" className="flex flex-wrap gap-1">{p.markets.map((s) => <Tag key={s} tone="solid">{s}</Tag>)}</span>],
    ['Quote size', `${usd(p.quoteSizeUsd)} each side`],
    ['Position limit', `${usd(p.maxInventoryUsd)} per market`],
    ['Stop loss', `${usd(p.maxDailyLossUsd)} a day`],
    ['Leverage', `${p.maxLeverage}x`],
    ['Minimum half spread', `${p.minHalfSpreadBps} bps`],
  ];
  return (
    <div className="panel rounded-lg">
      <header className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
        <h3 className="text-[14px] font-semibold">{policy ? 'The house account\'s limits' : 'The balanced preset'}</h3>
        <span className="text-[13px] text-fg-3">{policy ? 'as set in Setup' : 'what Setup starts from'}</span>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="bg-canvas px-4 py-4">
            <dt className="label">{k}</dt>
            <dd className="num mt-3 min-h-[22px] text-[20px] font-medium leading-none tracking-tight">{v}</dd>
          </div>
        ))}
      </dl>
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-[13px] text-fg-3">
        <span>Collateral this needs: <span className="num text-fg">{usd(balanceNeededUsd(p, p.markets.length))}</span>, so the stop loss fires while the margin is intact.</span>
        <span className="num">{p.preset} preset</span>
      </footer>
    </div>
  );
}
