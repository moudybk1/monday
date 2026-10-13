import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { Toc } from '@/components/toc';
import { ButtonLink, Tag, cx } from '@/components/ui';
import { at } from '@/lib/hosts';

export const metadata: Metadata = {
  title: 'System',
  description: 'How Monday works: the engine, the reflexes, Kimi as the risk governor, the risk controls, the Perpl analytics and Ask Monday.',
};

// One centred column pair: the contents on the left, the article beside it, nothing left empty on the right.
const WRAP = 'mx-auto max-w-[63rem] px-4 sm:px-8 lg:box-content';
const P = 'mt-4 text-[15.5px] leading-relaxed text-fg-2';
const H3 = 'mt-10 text-[19px] font-semibold tracking-tight';

const TOC = [
  { id: 'overview', label: 'Overview' },
  { id: 'custody', label: 'Custody and keys' },
  { id: 'engine', label: 'The engine' },
  { id: 'reflexes', label: 'Reflexes' },
  { id: 'kimi', label: 'Kimi, the risk governor' },
  { id: 'risk', label: 'Risk controls' },
  { id: 'analytics', label: 'Perpl analytics' },
  { id: 'ask', label: 'Ask Monday' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'limits', label: 'Honest limits' },
];

// Measured on the live decision log (Monad mainnet, kimi-k3, 10 Oct 18:59 to 12 Oct 06:17 UTC). Fixed here on purpose:
// the page is a written account of what happened, and it must load the same whatever the servers are doing.
const KIMI = { decisions: 167, differed: 120, wider: 114, smaller: 106, capLower: 70, looser: 0, clamped: 0, avgSec: 51 };

// Four Kimi decisions as they were recorded, each with its public record (hashes of the parameters and the evidence). The
// last agreed with the rules: Kimi departs from them when the data says to, not by habit.
const EXAMPLES = [
  { id: 1967, when: '11 Oct 18:04 UTC', set: 'spread 2x, size 0.3x, position cap $75', reason: 'Smart Traders sold about $575k net over the past hour, though the last 15 minutes were quiet. With 79% of the daily loss limit used, Monday is keeping quotes wider and cutting size and inventory to protect the account.' },
  { id: 1903, when: '11 Oct 17:44 UTC', set: 'spread 3x, size 0.3x, position cap $200', reason: 'Smart Traders sold about $576k net over the past 15 minutes, mostly closing longs, and Monday has been losing a little on fills. Quotes stay wide and small with a lower inventory cap until the selling cools.' },
  { id: 1815, when: '11 Oct 17:09 UTC', set: 'spread 2x, size 0.6x', reason: 'Smart Traders were quiet recently, with only about $26k of net buying over the past hour. Volatility is running above normal and 43% of the daily loss limit is used, so Monday is quoting wider and smaller.' },
  { id: 1500, when: '11 Oct 08:26 UTC', set: 'spread 1x, size 1x, position cap $225, the same as the rules', reason: 'Smart Traders placed no trades in the past hour, so there is no one sided flow to defend against. Monday keeps its usual $22 quotes at the normal spread with inventory capped at $225.' },
];

const LOOPS = [
  { name: 'Engine', when: 'every second', who: 'code', text: 'Prices both quotes from the book, the reference market and the position, and changes only what moved enough to matter.' },
  { name: 'Reflexes', when: 'within seconds', who: 'code', text: 'Widen or pull the side that is about to be run over: a Smart Trader burst, a move in the reference market, a fill.' },
  { name: 'Governor', when: 'every 15 minutes', who: 'Kimi', text: 'Reads the whole situation and sets how carefully Monday quotes, with a reason in plain words. Never places an order.' },
];

export default function SystemPage() {
  return (
    <>
      <SiteHeader />
      {/* How far through the page the reader is, filled by the scroll position itself. */}
      <div aria-hidden className="progress fixed inset-x-0 top-12 z-30 h-0.5 bg-accent" />
      <main className="page-in overflow-x-clip">
        <header className={`${WRAP} pt-14 md:pt-20`}>
          <div className="lg:ml-[17rem]">
          <p className="label">System</p>
          <h1 className="display mt-3 max-w-[20ch] text-[2.5rem] font-medium sm:text-5xl lg:text-[3.5rem]">How Monday works, part by part.</h1>
          <p className="mt-6 max-w-[62ch] text-[17px] leading-relaxed text-fg-2 md:text-[18px]">
            Monday is an AI agent that market-makes on Perpl, the on-chain order book on Monad, from the user&apos;s own account. Code quotes and protects; Kimi, Moonshot AI&apos;s model, decides how carefully to quote and says why. Alongside it runs a public analytics dashboard for all of Perpl, with a chat that answers from real on-chain data.
          </p>
          </div>
        </header>

        <div className={`${WRAP} mt-14 grid gap-12 pb-24 lg:mt-20 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16`}>
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-20">
              <p className="label mb-3">On this page</p>
              <Toc items={TOC} />
            </div>
          </nav>

          <article className="min-w-0 max-w-[48rem]">
            <Section id="overview" title="Overview">
              <p className={P}>
                Three loops run at three speeds. The fast ones are plain code, so nothing urgent ever waits for a model. The slow one is where judgement pays: it weighs many signals at once and turns them into a few bounded settings.
              </p>
              <ol className="mt-8 grid gap-3 md:grid-cols-3">
                {LOOPS.map((l) => (
                  <li key={l.name} className={cx('panel p-5', l.who === 'Kimi' && 'border-accent/50')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[17px] font-semibold tracking-tight">{l.name}</p>
                      <Tag tone={l.who === 'Kimi' ? 'accent' : 'neutral'}>{l.who}</Tag>
                    </div>
                    <p className="num mt-1 text-[12px] text-fg-3">{l.when}</p>
                    <p className="mt-3 text-[14px] text-fg-2">{l.text}</p>
                  </li>
                ))}
              </ol>
              <p className={P}>
                What goes in: Perpl&apos;s order book, trades, mark and funding over its market-data socket; the account&apos;s orders, fills and positions over its trading socket; the reference market&apos;s mid prices and trade tape, because Perpl follows it; trades by wallets labelled as consistently profitable (Smart Traders); and the limits the user set. What comes out: maker orders on the user&apos;s Perpl account, and a public record of every decision.
              </p>
            </Section>

            <Section id="custody" title="Custody and keys">
              <p className={P}>
                Funds never leave the user&apos;s Perpl account. Monday trades through a Perpl API key with trade scope, and Perpl never lets any API key withdraw or transfer funds. The key is stored encrypted on the server. Users sign in with their wallet (a signed message, no gas, no funds moved).
              </p>
              <p className={P}>
                <b className="text-fg">Stop</b> cancels Monday&apos;s orders and leaves positions and the user&apos;s own orders alone. <b className="text-fg">Kill</b> cancels every order on the account and closes every position with reduce-only market orders, retrying until Perpl confirms. Revoking the key on Perpl cuts Monday off at once.
              </p>
            </Section>

            <Section id="engine" title="The engine">
              <p className={P}>Every second, for each market the user picked:</p>
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Fair price">Perpl&apos;s mid, blended toward the reference market&apos;s by the user&apos;s reference mode (none, halfway, or a chosen weight), and ignored past a 50 bps gap.</Item>
                <Item k="Spread">The larger of the user&apos;s minimum and 1.5 times the one-minute volatility, times the governor&apos;s spread multiple, plus the maker fee.</Item>
                <Item k="Skew">Leans with the position (to shed it), the order book, the five-minute trend, and Smart Trader flow when the study allows leaning.</Item>
                <Item k="Placement">In calm and active markets it joins the best price, never closer to fair than the maker fee. A quote at the front keeps its place until it is clearly behind.</Item>
                <Item k="Size">The user&apos;s quote size times the governor&apos;s size multiple, capped at 1, 5 or 10% of an average hour&apos;s volume. Post-only: it never crosses the book.</Item>
              </ul>
              <h3 className={H3}>Exits</h3>
              <p className={P}>
                One entry per position. Once a position is open, Monday only quotes its exit, never adds to it. The exit rests at the entry plus both maker fees and 1 bp; after 10 minutes it drops to the entry plus fees, out at breakeven rather than waiting. New entries stay at least 3 bps on the safe side of the reference price, since a quote Perpl is about to move through is the one that loses. Exits are never held back by that rule.
              </p>
            </Section>

            <Section id="reflexes" title="Reflexes">
              <p className={P}>Plain code, no model in the loop:</p>
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Smart Trader burst">An unusual five-minute flow widens the side it runs into for five minutes; a stronger one, or a single $250k trade, pulls it.</Item>
                <Item k="Reference first">A 1.5 bps move in three seconds widens the side it runs into, 3 bps pulls it, for six seconds: before Perpl&apos;s book catches up.</Item>
                <Item k="After a fill">A fill widens that side for 30 seconds; two in a minute pull it. The taker who hit it is often still working.</Item>
                <Item k="Lopsided book">Nine tenths of the depth on one side widens the threatened side for a minute.</Item>
              </ul>
            </Section>

            <Section id="kimi" title="Kimi, the risk governor">
              <p className={P}>
                A market maker&apos;s hardest call is not the price, it is <i>how carefully</i> to quote right now. Fixed rules weigh one signal at a time. Kimi reads the whole situation every 15 minutes per market (sooner when something changes) and answers with a few bounded settings and a reason a non-trader can read.
              </p>

              <h3 className={H3}>What Kimi sees</h3>
              <p className={P}>
                A JSON snapshot of one market: Smart Trader flow over 5, 15 and 60 minutes (net, gross, imbalance and how unusual it is), the largest recent trades and who made them, price, one-minute volatility against its normal, funding; Monday&apos;s own position, PnL today, fees, fill quality and fills over the last hour, how long the position is open and what stage it is in; data freshness and order latency; whether the evidence allows leaning; the user&apos;s limits; and what the fixed rules would set.
              </p>

              <h3 className={H3}>What Kimi decides</h3>
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Spread">1 to 4 times normal.</Item>
                <Item k="Size">0 to 1.5 times normal.</Item>
                <Item k="Position cap">Any amount up to the user&apos;s own limit, never above it.</Item>
                <Item k="Lean">Up to 10 bps, only when the study supports leaning with Smart Trader flow; otherwise zero, whatever is proposed.</Item>
                <Item k="Quote or not">Whether quoting at all looks safe, and for how long the settings hold.</Item>
                <Item k="Reason">One or two plain sentences with the figures behind the call, shown to the user.</Item>
              </ul>

              <h3 className={H3}>Guardrails</h3>
              <p className={P}>
                Kimi never places an order. Its answer is validated against a schema, every number is clamped to the bounds and the user&apos;s policy, and loosening is limited to one step per decision so a single odd answer cannot swing the book. An answer for the wrong market, a late one or a failed call is dropped and the rules answer instead, so the account is always covered. Trader labels inside the snapshot are third-party text, and the prompt tells Kimi to treat them as data, never as instructions. Every decision is stored with keccak256 hashes of its parameters and its evidence, and published.
              </p>

              <h3 className={H3}>What it did on mainnet</h3>
              <dl className="mt-6 grid gap-1 rounded-lg border border-line bg-void p-1 sm:grid-cols-3">
                <Stat k="Kimi decisions" v={String(KIMI.decisions)} sub="real funds, kimi-k3, 10 to 12 Oct" />
                <Stat k="Different from the rules" v={`${Math.round((KIMI.differed / KIMI.decisions) * 100)}%`} sub={`${KIMI.differed} of ${KIMI.decisions}, every one more careful`} />
                <Stat k="Looser than the rules" v={String(KIMI.looser)} sub={`and ${KIMI.clamped} answers needed clamping`} />
              </dl>
              <p className={P}>
                Where Kimi departed from the rules it quoted wider {KIMI.wider} times, smaller {KIMI.smaller} times and lowered the position cap {KIMI.capLower} times. It never quoted tighter or bigger than the rules would have, and none of its {KIMI.decisions} answers fell outside the bounds. It reacted to things the rules do not weigh together: how much of the day&apos;s loss limit was already used, whether recent fills had been costly, selling that had stopped but might not be over.
              </p>
              <ul className="mt-6 grid gap-3">
                {EXAMPLES.map((e) => (
                  <li key={e.id} className="panel p-4">
                    <p className="text-[14.5px] text-fg">&ldquo;{e.reason}&rdquo;</p>
                    <p className="num mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
                      <span>BTC, {e.when}</span><span>{e.set}</span>
                      <Link href={at(`/decisions/${e.id}`)} className="text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-fg">record #{e.id}</Link>
                    </p>
                  </li>
                ))}
              </ul>

              <h3 className={H3}>How it is called</h3>
              <p className={P}>
                Through an OpenAI-compatible API with JSON output. The governor runs kimi-k3 with its reasoning on for the scheduled review: about {KIMI.avgSec} seconds an answer, which a 15-minute loop absorbs while the rules hold the book. An early review, when a burst or stale data calls for one, runs with reasoning off and answers in seconds, at most every 10 minutes. Ask Monday runs the same model with reasoning off, about 4 seconds an answer, because a person is waiting.
              </p>

              <h3 className={H3}>What Kimi brings</h3>
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Judgement">It combines flow, volatility, fill quality, the position and the loss limit into one call, which rules can only do signal by signal.</Item>
                <Item k="Safety">Its departures from the rules all went toward caution, and it stayed inside the bounds every time.</Item>
                <Item k="Explanation">Every setting comes with a reason in plain words, so a user who is not a trader can see why their bot is quoting the way it is, and check it later.</Item>
              </ul>
            </Section>

            <Section id="risk" title="Risk controls">
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Stop loss">The user&apos;s daily limit: reached, Monday stops, cancels and closes positions for the day. It reads cash that fills explain, so Perpl sending cash and position updates seconds apart cannot fire it falsely.</Item>
                <Item k="Urgent exits">Once a position&apos;s open loss reaches a quarter of the stop loss, after an hour, or far past its limit, Monday stops waiting for a profit and works the exit at the best price.</Item>
                <Item k="Every order">A 1% band around the oracle price, and position, account and leverage checks before anything is sent.</Item>
                <Item k="Margin floor">Equity below what the limits need stops Monday before Perpl&apos;s maintenance margin.</Item>
                <Item k="Bad data">Quotes are pulled when market data is five seconds old; at 30 seconds Monday stops and closes positions. Three failed orders in a row stop it too.</Item>
                <Item k="Restarts">Monday picks its own resting quotes back up and leaves the user&apos;s orders alone; any cancel or close it owes is retried until Perpl confirms.</Item>
              </ul>
            </Section>

            <Section id="analytics" title="Perpl analytics">
              <p className={P}>
                A public dashboard for all of Perpl, no wallet needed. Every trade since launch is indexed from the Exchange contract&apos;s events through Envio HyperSync: fills with their fees, position changes, liquidations, deposits and withdrawals. Perpl&apos;s own API and contract reads add live funding, the book and every open position.
              </p>
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Protocol">Volume, open interest, TVL, fees and traders over 24 hours, 7 and 30 days and all time; daily series; collateral flows; funding and long/short per market; a liquidation map and the positions closest to it; who makes money; when Perpl trades.</Item>
                <Item k="Wallets">Search by address or account: equity, open positions with liquidation price, trade history with realised PnL, win rate, profit factor, drawdown, streaks, hold time, best and worst markets, rank. Compare up to four side by side.</Item>
                <Item k="Screener">Presets for winners, streaks, whales, makers, takers, liquidated and losers, thresholds, a watchlist, and leaderboards for 1, 7, 30 and 90 days.</Item>
              </ul>
            </Section>

            <Section id="ask" title="Ask Monday">
              <p className={P}>
                The chat on the analytics pages, and the second place Kimi works. Common questions get an answer from rules in a fraction of a second. For anything else, Kimi turns the question into a structured query (a metric, a market, a screen, a comparison, a wallet) and the code answers it from the live figures, with a table and links. Open questions get an answer Kimi writes from a sheet of live figures only: a reply that quotes a dollar or percent figure not on the sheet is thrown away. On a wallet page, Kimi writes the &ldquo;explain in plain words&rdquo; summary from that wallet&apos;s numbers.
              </p>
            </Section>

            <Section id="infrastructure" title="Infrastructure">
              <p className={P}>
                One server runs four parts: the trading server (an agent per user, sockets to Perpl and the reference market, the API), the analytics process (indexer and public API, kept apart so heavy queries never stall trading), the web app, and Caddy for TLS. Three sites: mondaytrade.xyz, app.mondaytrade.xyz for the agent, analytics.mondaytrade.xyz for the dashboard. The terminal streams its state over a compressed WebSocket. Code is TypeScript end to end, with the strategy in pure, unit-tested functions.
              </p>
            </Section>

            <Section id="limits" title="Honest limits">
              <ul className="mt-3 grid gap-2.5 text-[15px] text-fg-2">
                <Item k="Profit is not promised">Market making at retail size and full maker fees is hard on Perpl, and earlier versions of Monday lost small amounts. The exit rules of 12 October have done better so far, on a day of data.</Item>
                <Item k="Kimi manages risk">It decides how carefully to quote. It does not create an edge on its own, and the record above covers two days.</Item>
                <Item k="The signal defends">The study finds Smart Trader flow leading the next move only on SOL so far, and weakly, so elsewhere Monday uses it to step aside, not to lean.</Item>
                <Item k="Without Kimi">If Kimi is unavailable the rules set every parameter, and the record says so.</Item>
              </ul>
              <div className="mt-10 flex flex-wrap gap-2.5">
                <ButtonLink href={at('/app')} size="lg" className="px-6">Launch app</ButtonLink>
                <ButtonLink href={at('/analytics')} size="lg" variant="ghost">Open the analytics</ButtonLink>
              </div>
            </Section>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10 pb-12 first:border-t-0 first:pt-0">
      <h2 className="display text-[1.9rem] md:text-[2.4rem]">{title}</h2>
      {children}
    </section>
  );
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-1 border-l-2 border-line-2 pl-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <span className="font-semibold text-fg">{k}</span>
      <span>{children}</span>
    </li>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="panel px-3.5 py-3">
      <dt className="text-[12px] text-fg-3">{k}</dt>
      <dd className="num mt-1.5 text-[28px] font-medium leading-none tracking-tight">{v}</dd>
      <dd className="num mt-2 text-[11.5px] text-fg-3">{sub}</dd>
    </div>
  );
}
