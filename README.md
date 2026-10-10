# Monday

An AI trading agent that market-makes on [Perpl](https://perpl.xyz)'s on-chain order book from the user's own account, and steps aside when Nansen-labelled smart money moves on Hyperliquid. Funds stay in the user's Perpl account; the agent holds a trade-scoped API key that can never withdraw.

Built for Monad Metropolis, Track 01.

## Run it

Requires Node 22.13 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no `.env` the whole thing runs on a simulated market, so there is nothing to configure first.

- **Landing page** shows the house account quoting live.
- **Launch app, then "Use a demo account"** walks the real onboarding: account check, trade key, limits, start.
- **On the key step**, any token and secret work. A token starting with `read` or a secret starting with `bad` shows the error states.
- **On the dashboard**, "Buy burst / Sell burst" fires a smart-money burst so you can watch the reflex pull a quote.

To try it on Perpl's real prices without trading, run paper mode. Candles, the order book, the tape and Nansen trades are real; Monday's orders are simulated and never reach Perpl. They fill the way a real order at that price would: an order joins behind whatever rests at its price, prints at that price work through that queue first, and a print beyond its price fills it outright. Demo accounts work here too.

```bash
VENUE=paper NETWORK=mainnet npm run dev
```

## What is simulated, and how to make it real

Copy `.env.example` to `.env`. Each block switches one piece to live; they are independent.

| Piece | Default | Goes live when | Then |
| --- | --- | --- | --- |
| Smart-money data | Simulated trades | `NANSEN_API_KEY` is set | Real Smart Money Perp Trades drive the signal. The first boot backfills 7 days in the background; later boots fetch only the gap. |
| Execution venue | Simulated book and fills | `VENUE=perpl` and `MONDAY_MASTER_KEY` set | Real Perpl book, real orders from each user's own key. Testnet unless `NETWORK=mainnet`. |
| Governor | Rule-based regimes | `LLM_API_KEY` is set | An LLM proposes bounded parameters; rules remain the fallback. |
| Decision log | Hashed, not anchored | `MONDAY_REGISTRY_ADDRESS` and `AGENT_LOGGER_PRIVATE_KEY` set | Policies are signed by the user's wallet; every decision hash is written to Monad. |
| Alerts | Off | `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set | Kill, loss warning and long disconnects go to Telegram. |

Live orders are never driven by simulated signals. With `VENUE=perpl` or `VENUE=paper` and no Nansen key there is no smart-money signal at all: no reflex and no lean. The regime then comes from volatility alone (calm, active, storm) and Monday quotes at the best price in a calm market; the order-book reflex, the risk gate and every limit still apply. Only a Nansen source that stops answering counts as stale.

### Before a user can trade on Perpl

1. Deposit AUSD on Perpl to open an exchange account (testnet: https://testnet.perpl.xyz, minimum $100 of test AUSD; mainnet: https://app.perpl.xyz, minimum $10).
2. Turn on **One-Click Trading** in Perpl settings. Without it Perpl refuses to forward API orders.
3. Create a key with **trade** scope on Perpl's `/apikeys` page and paste the token and secret into Monday.

### Deploying the registry

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge test
forge script script/Deploy.s.sol --rpc-url monad_testnet --account <keystore-name> --broadcast   # or monad_mainnet
```

Put the address in `MONDAY_REGISTRY_ADDRESS`, fund the logging wallet with test MON, restart. See `contracts/README.md`.

## Mainnet: real funds

`NETWORK=mainnet` switches the chain (143), the RPC default, the explorer and every Perpl address together. With `VENUE=perpl` that means live orders with real collateral.

**Read this first.** The order path (sign-in, place, change, cancel, flatten) was written from Perpl's docs and has never placed a real order. Run it on testnet with a real key before mainnet: it is free and it is the same code.

Guards that apply on real funds:

| Guard | What it does |
| --- | --- |
| `ALLOW_REAL_FUNDS=yes` | The server refuses to start on mainnet with the live venue until this is set. |
| RPC check | At boot the server asks `MONAD_RPC_URL` for its chain id and stops if it is not the network you named. |
| Policy caps | `CAP_QUOTE_USD`, `CAP_INVENTORY_USD`, `CAP_DAILY_LOSS_USD` bound every user's policy. Defaults: $50, $250, $25. |
| Acknowledgement | A user must tick "this trades real funds" before the first start. The header shows "Mainnet: real funds" at all times. |
| No simulated signals | Without a Nansen key there is no smart-money signal: the regime rests on volatility alone, and nothing simulated ever drives a live order. |
| Collateral rule | A policy needs the margin for its full inventory at its leverage plus the whole daily loss limit. The High leverage preset (10x) and the margin x leverage sizer obey it, so the loss kill fires before Perpl's maintenance margin. |
| Margin floor | Equity below the margin the policy needs kills and flattens, so losses carried across days cannot walk into a liquidation. |
| Existing limits | Price band of 1% around the oracle, inventory and leverage checks on every order, daily loss kill, stale-data kill, three-failures kill. |

Suggested order:

1. Testnet with a real key until quoting, a fill, pause and kill all work.
2. Mainnet with your own wallet only, default caps, one market, and you watching. Check the first orders on Perpl's own UI.
3. Raise caps and add markets once fills, markouts and the kill switch have behaved for a few days.

Things specific to mainnet:

- **Geo-blocking.** Perpl's mainnet context lists blocked countries (at the time of writing: BY, CU, GB, IR, KP, RU, SY, UA, US). Host the server outside them, and do not offer the product to users in them.
- **Book width.** Mainnet BTC was one tick wide (0.01 bps) when checked. Joining that touch would earn less than the maker fee on every fill, so on BTC Monday stops at the fee floor, 0.45 bps from fair price, and fills on sweeps only. ETH (about 3 bps) and SOL (about 8 bps) were wide enough for Monday to sit one tick inside the best price, first in line; that is where the fills come from.
- **No taker bot.** The demo taker belongs to testnet only. Trading against your own quotes on mainnet is wash trading.
- **Other people's money.** Running this for anyone but yourself may bring licensing or regulatory duties where you operate. Get advice before opening it up.
- **Keys.** `AGENT_LOGGER_PRIVATE_KEY` should be a separate wallet holding only a little MON for gas. `MONDAY_MASTER_KEY` and `SESSION_SECRET` must be unique, long and never committed.

## How it is built

```
apps/web        Next.js 16: landing, onboarding, dashboard, policy, evidence, decision records
apps/server     One Node process: REST + WebSocket API, Nansen collector, per-user runners, governor, chain log
  src/venue     The seam. sim.ts is the simulator; perpl/ is the live adapter. Nothing above it knows which.
packages/core   Pure strategy math and shared types: quoting model, reflex, regimes, signal, statistics
contracts       MondayRegistry (Solidity 0.8.24, Foundry)
infra           Dockerfile, docker-compose, Caddyfile
```

Three layers, as in PRD section 10:

- **Engine**, every second. Fair price (Perpl blended halfway toward Hyperliquid's mid, ignored past a 50 bps gap), spread, inventory skew, smart-money skew, order-book skew, quote size capped at 5% of an average hour's volume, PostOnly safety. In the calm and active regimes each quote then joins the best price, or betters it by one tick when the spread has room for both sides to, never closer to fair price than the maker fee (0.45 bps). A quote at the front keeps its place in line until it is 0.5 bps behind the best or more than $3,000 rests ahead of it, because every requote goes to the back of the queue. Deterministic and unit tested.
- **Reflex**, next tick after a burst. Pulls or widens the threatened side for five minutes. Two cheaper guards run under it. A move in the reference price (Hyperliquid's mid, which Perpl follows: 1.5 bps in 3 seconds widens, 3 bps pulls) steps the side the move runs into aside for 6 seconds, before Perpl's book catches up. A trend in the mark over the last five minutes (past 4 bps) leans the centre with it and keeps the side that would add against it off the touch, because in a slide the bids are the fills that keep losing. When smart money is quiet, a lopsided Perpl book (top 5 levels, nine tenths one side) widens the threatened side for 60 seconds; it never pulls it.
- **Governor**, every 15 minutes. Sets bounded parameters and a plain-language reason. LLM output is schema-validated and clamped; on any failure the rules answer.

The web app only ever talks to its own origin (`/api` is proxied), so the session cookie is httpOnly and SameSite=Strict. The live stream uses a one-time ticket.

## Design

The interface is a trading terminal, built after measuring live ones (Hyperliquid, Perpl, Lighter, dYdX) rather than from a template:

- **Dark first**, four close surface steps, never pure black. A light theme is one click away.
- **12px workhorse text.** Hierarchy comes from tone and weight, not size. Mona Sans for sentences, JetBrains Mono for every number so columns align.
- **Colour is rationed.** Teal and vermilion mean bid and ask (checked for colour-blind separation; pink-red against green fails it). Amber means "this is Monday's". Everything else is grey.
- **Fixed-viewport panel grid** on desktop: market strip, chart, order book, agent column, tabbed log, status bar. Each panel scrolls inside itself.

Tokens live in `apps/web/app/globals.css`.

## Checks

```bash
npm test                 # strategy, runner, paper venue, collector, governor, and a replay of Perpl trading frames
npm run typecheck
npm run build            # production build of the web app
cd contracts && forge test                                   # 25 tests incl. fuzz and invariants
cd apps/server && npx tsx src/venue/perpl/smoke.ts           # live Perpl testnet: context, book, candles, account lookup
```

## What has and has not been exercised

| Area | Status |
| --- | --- |
| Strategy math, signal engine, statistics | Unit tested. |
| Full flow on the simulator: onboarding, quoting, fills, markouts, reflex, pause, kill, policy change, evidence | Run end to end in a browser. |
| Paper mode on mainnet data: best-price quoting, queue position, fills | Run live (2026-10-09): 12 fills in two minutes across BTC, ETH and SOL with no Nansen key. |
| `MondayRegistry` | 25 Foundry tests pass. Not deployed. |
| Perpl market data, candles, account lookup | Run against live testnet. Market data and specs also loaded read-only from mainnet. |
| Perpl trading (sign-in, orders, fills, flatten) | Written from the official docs and replayed offline against documented frames. Key validation (trading sign-in) has succeeded live on mainnet. No order has been placed yet. Expect to debug orders on first use. |
| Nansen client | Run live with a real key: 7-day backfill and polling. |
| LLM governor | Run live through an OpenAI-compatible API (b.ai) and through Claude Code headless (`LLM_PROVIDER=claude-code`, Opus 5.5) in multi-hour paper runs. The Anthropic SDK path has not been called with a key. |
| On-chain log queue and wallet-signed policy | Written against the contract ABI. Never run against a deployed registry. |

## Where this differs from the PRD

- **One server process and SQLite** instead of three services and Postgres. Table names follow PRD section 14, so moving is mechanical. Simulated mode keeps the database in memory.
- **npm workspaces** instead of pnpm.
- **Fees.** Perpl's docs charge the fee on every fill, closes included. PRD 11.8 says reducing fills are free.
- **Leverage caps** are 15x BTC, 12x ETH, 10x SOL per the live context.
- **Collateral token.** Live testnet reports AUSD `0xa9012a055bd4e0edff8ce09f960291c09d5322dc`, not the address in PRD 11.1.
- **One-Click Trading** is a third prerequisite the PRD does not list.
- **Policy changes** take effect only after the wallet-signed `setPolicy` is visible on Monad, when a registry is configured (PRD 17.4).
- **Nansen lean** (`k`) is switched on per market by the event study's own decision rule, and is zero until the study supports it.
- **Not built:** Follow mode, Ask Monday chat, in-app key enrollment, pooled vault, x402. All are P1 or P2 in the PRD.

## Deploy

One machine runs everything: the trading server (API and agents), the stats process (Perpl indexer and the public
`/api/stats` API, kept apart so heavy analytics never stalls trading), the web app, and Caddy for TLS.
Host it where Perpl serves users (not the US or the UK, for example; Singapore or Tokyo work).

```bash
git clone https://github.com/moudybk1/monday.git && cd monday
cp .env.example .env     # fill it in: DOMAIN, WEB_ORIGIN and API_PUBLIC_URL (https://<DOMAIN>), SESSION_SECRET, MONDAY_MASTER_KEY
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

Point A records for both `DOMAIN` and `analytics.DOMAIN` at the machine and open ports 80 and 443; Caddy fetches the
certificates. `analytics.DOMAIN` serves the public analytics; sign-in and the trading app stay on `DOMAIN`. Data lives in
`apps/server/data` on the host, so a rebuild keeps it.

Moving a running Monday (a laptop, say): stop it there first, then copy `apps/server/data/monday-<network>.sqlite` to
the same path here and keep the same `MONDAY_MASTER_KEY`, or the stored Perpl keys cannot be decrypted. Never run two
Mondays on the same Perpl account.

## Disclosures

- Simulated or testnet by default, with no real funds. On mainnet it trades real funds and the app says so on every screen.
- Market making can lose money. Monday reports results and does not promise profit.
- Smart-money signals can be wrong or late.
- The evidence page runs on simulated data until Nansen and Perpl are configured, and says so.
- The Perpl adapter was written from Perpl's public API docs; no Perpl example code or PerplBot code was copied.
- AI assistance: the code, tests and docs were written with Claude Code (Anthropic's Claude Opus), directed and reviewed by the author. Commits it helped with carry a `Co-Authored-By: Claude` trailer. At runtime the governor itself is an LLM (see above).

## License

MIT
