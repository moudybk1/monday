# Monday

Monday is a trading terminal for [Perpl](https://perpl.xyz), the on-chain order book on Monad. It runs from your own Perpl account through a trade-only API key, so your funds never move. You pick a mode and a loss you can live with; the code does the trading and Kimi acts as the risk governor. Next to it there is a public analytics site for all of Perpl.

It is live on Monad mainnet with real money: the terminal at [app.mondaytrade.xyz](https://app.mondaytrade.xyz), the analytics at [analytics.mondaytrade.xyz](https://analytics.mondaytrade.xyz), and a long-form explanation of every part at [mondaytrade.xyz/system](https://mondaytrade.xyz/system). It was built for Monad Metropolis (Track 01), Perpl's analytics bounty and the Kimi bounty, and the analytics index Perpl's history through Envio HyperSync.

[![CI](https://github.com/moudybk1/monday/actions/workflows/ci.yml/badge.svg)](https://github.com/moudybk1/monday/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[![The Monday site](docs/landing.jpg)](https://mondaytrade.xyz)

## Three modes

The market maker quotes both sides of the book in the markets you choose and earns the spread. It runs until you stop it. Every 15 minutes Kimi reviews how wide and how big it should quote, inside bounds the code enforces; it never places an order itself. You give it a margin and a daily stop loss; when the loss is hit it cancels its orders and closes what it holds.

Agentic Trade is a scalping session on one market. You say long or short, Monday reads the daily and 4-hour charts, and then scalps your side on a 1, 5 or 15 minute timeframe, one position at a time, until the session's stop loss or take profit (both a share of its margin) or its time is up. Each scalp's stop and target rest on Perpl as real orders from the moment it fills.

TWAP builds a position in slices, as maker orders where it can, so a big order does not move a thin book. It takes up to a day to build and then holds the position under a stop loss (and an optional target) that also rest on Perpl. You can give it a price it must not pass.

All three can run at the same time, each in its own markets, and Kimi writes a short read of the market before you start any of them.

Custody is simple. Your collateral stays in your Perpl account; only your wallet can withdraw. Monday holds a Perpl API key with trade scope, stored encrypted, and Perpl does not let any API key withdraw or transfer. Stop and Kill are one click, and revoking the key on Perpl cuts Monday off at once. Signing in is a signed message from your wallet, no gas.

## How the market maker works

Three loops on three clocks. The fast ones are plain code, so nothing urgent waits on a model.

The engine runs every second. It prices both quotes from Perpl's book, blended toward the reference market where these perps are priced first (Perpl follows it), with a spread from recent volatility and the floor you set, skew from the position and from the shape of the book, and a size capped at a slice of an hour's volume. It opens one position at a time and then only works the exit, in profit or at breakeven after ten minutes. Orders are post-only and never cross the book. All of this is pure functions with unit tests.

The reflex runs on the next tick after something happens: a burst of trading by Smart Traders (wallets with a consistent profit record, from Nansen's labels), a move in the reference market that Perpl's book has not caught up with, or a fill on Monday's own quote. It pulls or widens the side that is about to get run over, for a short while.

The governor is Kimi, every 15 minutes per market. It gets a snapshot (flow, volatility, funding, the position, today's result and fill quality, your limits, and what the fixed rules would choose) and answers with spread and size multipliers, a position cap, whether to quote at all, and a reason in plain words. The code validates and clamps every number, hashes the decision together with its evidence, and publishes it at `/decisions/<id>`. If Kimi is slow or down, the rules take over.

Every order also passes a risk gate: a 1% band around the oracle, position and account caps, a leverage check, your daily stop loss (a warning at 70%, kill and flatten at 100%), a margin floor so the kill fires before Perpl's maintenance margin, a kill when market data stops for 30 seconds, and a kill after three failed orders in a row.

## Perpl analytics

[![Perpl analytics](docs/analytics.jpg)](https://analytics.mondaytrade.xyz)

Every Perpl trade since launch, for all 11 markets, refreshed every few seconds and open to anyone.

The overview has volume, open interest, TVL, fees and active traders over 24h, 7d, 30d and all time, daily series, collateral flows, funding and long/short per market, a liquidation map with the positions closest to it, the largest positions, who makes money, retention cohorts and when Perpl trades. The Flow tab shows what the top traders, the consistent winners and the whales hold and how they moved over the last hours, plus a live tape of their orders. Any wallet can be opened by address or account number: equity, open positions with liquidation prices, the trade history with realised PnL, win rate, profit factor, drawdown, streaks, hold time, best and worst markets, and where it ranks among active accounts. Up to four wallets can be compared side by side, and a screener with presets (winners, streaks, whales, makers, takers, liquidated, losers) and leaderboards for 1 to 90 days sits next to it.

Ask Monday is the chat on those pages. Common questions are answered by rules straight away. For free-form questions Kimi turns the text into a structured query that the code answers with real numbers, and it writes the plain-words wallet summaries from a sheet of live facts; an answer that quotes a number not on that sheet is thrown away.

The data comes from Perpl's Exchange contract events (fills with fees, positions, liquidations, deposits, withdrawals) through Envio HyperSync, with the chain head followed over RPC while HyperSync is rate-limited, plus Perpl's API and contract reads for live funding, the book and open positions.

## Running it

You need Node 22.13 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without a `.env` everything is simulated, including the market, so there is nothing to set up first. The landing page shows the house account quoting; "Launch app" and then "Use a demo account" takes you through the real onboarding (any token and secret pass the key step), and the terminal has buttons that fire a Smart Trader burst so you can watch the reflex react.

Paper mode uses Perpl's real book, tape, candles and the real Smart Trader feed, but simulates the orders. They fill the way a real order at that price would, queue position included.

```bash
VENUE=paper NETWORK=mainnet npm run dev
```

To go live, copy `.env.example` to `.env`. Each block there switches one piece from simulated to real, and they are independent of each other:

| Piece | Switched on by |
| --- | --- |
| Smart Trader data | `NANSEN_API_KEY` (the first boot backfills 7 days) |
| Real orders | `VENUE=perpl` and `MONDAY_MASTER_KEY`; testnet unless `NETWORK=mainnet` |
| Kimi (governor, Ask Monday) | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| Full Perpl history | `ENVIO_API_TOKEN` |
| Policies and decisions on Monad | `MONDAY_REGISTRY_ADDRESS` and `AGENT_LOGGER_PRIVATE_KEY` |
| Telegram alerts | `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` |

Simulated signals never drive real orders: with a live venue and no Nansen key there is simply no Smart Trader signal, and the regime comes from volatility alone.

Before anyone can trade on Perpl through Monday they need a Perpl account (deposit AUSD on Perpl), One-Click Trading switched on in Perpl's settings, and an API key with trade scope from Perpl's `/apikeys` page.

### Real money

`NETWORK=mainnet` with `VENUE=perpl` places real orders with real collateral. The server will not start that way until `ALLOW_REAL_FUNDS=yes` is set. It checks the RPC's chain id at boot, and it only accepts a policy whose margin covers the full inventory at its leverage plus the whole daily loss, so the loss kill always comes before Perpl's maintenance margin. `CAP_QUOTE_USD`, `CAP_INVENTORY_USD` and `CAP_DAILY_LOSS_USD` can cap every user's policy, and Agentic Trade and TWAP need `PLANS_LIVE=yes`.

Monday has been trading real money on mainnet since 2026-10-08. Test changes in paper mode first. Perpl blocks some countries, so host the server somewhere Perpl serves users.

## Deploying

One machine runs the trading server, a separate stats process (the indexer and the public `/api/stats`, kept apart so heavy queries never stall trading), the web app and Caddy for TLS.

```bash
git clone https://github.com/moudybk1/monday.git && cd monday
cp .env.example .env   # DOMAIN, WEB_ORIGIN (https://app.<DOMAIN>), API_PUBLIC_URL, SITE_URL, APP_URL, ANALYTICS_URL, SESSION_SECRET, MONDAY_MASTER_KEY
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

Point A records for `DOMAIN`, `app.DOMAIN` and `analytics.DOMAIN` at the machine and Caddy gets the certificates. If the host already runs Caddy, add `infra/docker-compose.host-caddy.yml` and use `infra/host-caddy.caddy`. The databases live in `apps/server/data` on the host; `scripts/backup-db.sh` backs up the account database. Never run two Mondays on the same Perpl account.

## Layout

```
apps/web         Next.js: site, terminal, setup, analytics, decision records
apps/server      one Node process: REST and WebSocket API, Smart Trader collector, per-user runners, plans, governor
  src/venue      the seam between Monday and the exchange: sim.ts, paper.ts and the live perpl/ adapter
  src/stats      the stats process: Perpl indexer (HyperSync and RPC) and /api/stats
packages/core    pure strategy math and shared types: quoting model, reflexes, scalper, plans, analytics
contracts        MondayRegistry (Solidity, Foundry): user limits and decision hashes on Monad
infra            Dockerfiles, docker-compose, Caddyfile
```

The browser only ever talks to its own origin (`/api` is proxied), so the session cookie is httpOnly and SameSite=Strict and the live stream uses a one-time ticket. Perpl keys are sealed with AES-256-GCM and only decrypted in memory when a session opens. Each order goes through one risk gate and one scheduler (risk work first), and is written down with the market it saw, so any fill can be traced back to the quote, the signal and the decision behind it.

## Tests

```bash
npm test                 # strategy, runner, plans, paper venue, collector, governor, analytics, replayed Perpl frames
npm run typecheck
npm run build            # production build of the web app
cd contracts && forge test
cd apps/server && npx tsx src/venue/perpl/smoke.ts    # against live Perpl: context, book, candles, account lookup
```

CI runs the typecheck and the tests on every push and pull request.

## What to know before using it

Market making can lose money. The exits in profit and the reference-market guard helped on the fills we have, but fees and adverse fills still make round trips lose, and nothing here promises a profit. Smart Trader signals can be wrong or late; Monday only steps aside on them, it never predicts with them. The registry contract has its Foundry tests but is not deployed in the live setup, so decisions are hashed and published by the app rather than anchored on-chain. Kill is the emergency stop: it closes every position on the account, including ones you opened yourself.

The Perpl adapter was written from Perpl's public API docs. Claude Code was used as a pair programmer throughout, with the author directing and reviewing the work.

## License

MIT
