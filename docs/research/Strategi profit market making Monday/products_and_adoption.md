# On-chain market-making / trading-agent products: adoption, returns, implications for Monday (as of 2026-10-06)

Method note: ~17 tool calls, mostly search snippets plus a few page fetches. Several primary pages returned 403/timeouts (Monad hackathon page, dYdX foundation blog, CoinDesk-type sources, Elixir/Drift coverage); those claims rest on search-result summaries and are marked "snippet only".

## 1. Returns, drawdowns and risks of protocol vaults / MM products

### Takeaway
Protocol-owned MM vaults (HLP above all) earn mid-teens to ~30% APR in good periods but only ~7% trailing in Aug 2026, with recurring single-event losses ($4M-$12M) from manipulation of illiquid markets and whale liquidations. Vault returns are lumpy and depend on liquidation/trader-loss flow, not just spread. Third-party vaults (Elixir, Drift) failed mostly through counterparty/key/collateral risk, not trading.

### Cited Findings
- HLP, Aug 2026: TVL ~$184M (peak $603.9M Sep 2025), cumulative profit ~$136.9M since May 2023 launch, trailing-month APR ~7%, historical 15-30% APR per quarter with 5-12% drawdowns, 0% performance fee, 4-day lockup, USDC only. Income: market making, backstop liquidations, ~5% on idle USDC via earn lending, ~1% of perp+spot trading revenue. Cumulative PnL "never negative". — [Datawallet](https://www.datawallet.com/crypto/hyperliquid-hlp-explained) (aggregator; figures are the site's, not Hyperliquid's own)
- HLP loss events listed: 12 Mar 2025 ETH whale ~$4M; 12 Nov 2025 POPCAT attack ~$4.9M bad debt; 9 Apr 2026 FARTCOIN coordinated liquidation ~$1.5M realized — [Datawallet](https://www.datawallet.com/crypto/hyperliquid-hlp-explained)
- 12 Mar 2025: whale (0xf3F) with 50x ETH long >$300M notional withdrew collateral to move liquidation price; slippage on closing cost HLP ~$4M — [Arkham](https://info.arkm.com/research/hyperliquid-whale-passes-4m-loss-to-hlp-vault), [CoinDesk](https://www.coindesk.com/markets/2025/03/12/hyperliquid-loses-usd4m-after-whale-s-over-usd200m-ether-trade-unwinds)
- 26 Mar 2025 JELLY: trader shorted JELLY, pumped spot to force self-liquidation, leaving HLP with the short; unrealized loss peaked ~$12-13.5M until validators delisted and settled at $0.0095, HLP ended ~$703K profit (a governance/centralized intervention, criticized) — search summary citing [nftevening](https://nftevening.com/recap-price-manipulation-hyperliquid/) (snippet only)
- 31 Jan 2026: HLP reportedly earned ~$15M in a day (~5.8%) from a whale liquidation, showing return is liquidation-driven — [KuCoin news](https://www.kucoin.com/news/articles/maximizing-the-liquidation-alpha-how-hyperliquid-s-hlp-vault-converts-whale-losses-into-liquidity-provider-yield) (low-quality aggregator)
- dYdX MegaVault: yield = vault PnL, funding payments, 50% trading-fee revenue share; APR on UI = trailing 90d return x 365/90; docs explicitly say no guaranteed positive yield, withdrawal slippage possible — [dYdX docs](https://docs.dydx.community/dydx/dydx-features/megavault), [dYdX help](https://help.dydx.trade/en/articles/240151-megavault-faq). I found no reliable dated APR/TVL series; one GitHub dashboard PR reports a tiny "max drawdown -$1,100" from the indexer as of 2 Oct 2026, which is not credible as vault-level data — [PR](https://github.com/alkindilabs/dydx-trading-dashboard/pull/29)
- MegaVault also used as a "flywheel" for instant market listings (vault seeds liquidity for new markets) — [dYdX Foundation](https://www.dydx.foundation/blog/megavault-instant-market-listings) (title only; page 403)
- Paradex: protocol vaults historically ~8% minimum APR; DIME Multistrategy "GigaVTF" +6.3% APR with $3.6M AUM; Gigavault (MM + liquidator strategies) capped at $12M (Jan 2025) — [CryptoWinRate review](https://www.cryptowinrate.com/paradex-review), [Paradex on X](https://x.com/paradex/status/1876960784456278040). Caps indicate capacity is limited by strategy, not demand.
- Drift: vaults are pooled strategies run by third-party managers (Circuit, Supercharger); JIT auction lets pro MMs (Wintermute, Amber, GSR, Flow Traders) fill taker flow without resting orders — [eco.com](https://eco.com/support/en/articles/14801189-drift-protocol-perps-architecture-explained). 1 Apr 2026: Drift lost ~$285M (fake collateral, oracle manipulation, compromised admin key; >$500M TVL at the time; likely DPRK per TRM); recovery claims opened ~1 cent per dollar — [TRM](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist), [CryptoSlate](https://cryptoslate.com/drift-hack-recovery-opened-near-one-cent-per-dollar-lost) (snippet only)
- Elixir: deUSD synthetic dollar fell >97% (~$0.025) after Stream Finance loss; Elixir wound deUSD down. Before that Elixir marketed itself as liquidity layer integrated with 30+ DEXs (Vertex, RabbitX, Bluefin, Apex, Orderly) — [BeInCrypto](https://beincrypto.com/elixir-deusd-stablecoin-collapse-stream-finance-loss/) (snippet only; date not captured, ~Nov 2025)
- Ethena sUSDe yield is delta-neutral funding harvesting, not MM — [eco.com](https://eco.com/support/en/articles/14798653-susde-explained-ethena-s-yield-bearing-stablecoin)

### Inferences
- Honest benchmark for Monday: 7-30% APR on capital for a flow-backed MM vault with episodic 5-12% drawdowns; anything materially higher over a long window should be treated as suspect or as tail risk not yet realized.
- HLP's edge is structural (it is the liquidator/backstop and fee beneficiary); a third-party agent without that role earns spread only and is exposed to the same adverse-selection events.
- Biggest vault destroyers were non-trading (key compromise, collateral/stablecoin, oracle), so Monday's guards and custody story matter more to trust than strategy sophistication.

### Gaps
- No primary-source dated APR series for HLP (use Hyperliquid stats/Dune), MegaVault, Drift vaults, Vertex, Aevo, GMX/Jupiter JLP. GLP/JLP returns not researched.
- Elixir/Drift/Paradex pages mostly snippet-level; exact dates and user loss shares unverified.

## 2. What brought users and partner projects

### Takeaway
Evidence supports transparency (public vault PnL, depositors, positions), 0% performance fee, simple one-asset deposit and the host exchange's distribution as the adoption drivers; points/tokens and brand trust drove TVL for Elixir-type products until collateral failures. I found little hard data separating these factors.

### Cited Findings
- HLP positions, trades, PnL and depositor list are all publicly visible; users can verify before depositing — [OneKey](https://onekey.so/blog/ecosystem/hyperliquid-vault-deposit-guide/), [Datawallet](https://www.datawallet.com/crypto/hyperliquid-hlp-explained)
- Tread bot is non-custodial (user's own exchange API keys), supports Hyperliquid, Extended, Nado, Pacifica, charges 2 bps builder fee plus venue fees, has stop-loss and pause-on-imbalance; no return claims — [Tread docs](https://docs.tread.fi/bots/market-maker-bot)
- Hummingbot liquidity mining: marketplace where exchanges/token issuers pay rewards to anyone running MM; claimed exchanges/issuers spend ~$1.2B/yr on MM (fees, rebates, lent inventory) and that individuals could earn 10-50% annually, 5-10x cheaper than hedge-fund MMs (Hummingbot's own, 2019-20 era, projection not result; stale) — [Hummingbot](https://hummingbot.org/blog/introducing-liquidity-mining-a-marketplace-for-market-makers/)
- Hyperliquid maker rebates -0.001% to -0.003% by 14-day maker volume share; HIP-3 deployers stake 500k HYPE and get 50% of fees; growth mode cuts fees 90% on new markets — [Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees), [CoinDesk](https://www.coindesk.com/markets/2025/11/19/hyperliquid-unveils-hip-3-growth-mode-slashing-fees-by-90-to-boost-new-markets)
- A community volume-farming MM bot already exists for Perpl on Monad (points-weighted volume at lowest cost, tuned on mainnet) — [GitHub](https://github.com/ElenaStamatelou/perpl) (competition/precedent for Monday)

### Inferences
- Partners adopt when MM is cheaper than hiring a firm and when the product also brings volume/points-eligible flow; "volume farming" is what small bots currently supply.

### Gaps
- No data on what share of TVL came from points vs yield; no named MM-as-a-service deal terms found.

## 3. Exchange compensation of market makers; is LaaS for new Monad perp DEXs viable?

### Takeaway
Standard compensation is maker rebates, token loans/options and retainers; the retainer/volume-wash side of the industry was heavily prosecuted. Viability for Monday depends on getting paid in rebates/points/fee share for real, non-wash liquidity, which is a sound but small business; no evidence found of scaled MM-as-a-service revenue.

### Cited Findings
- Exchanges and issuers pay MMs via fees, rebates and cost of lent inventory (est. $1.2B/yr, Hummingbot's estimate) — [Hummingbot](https://hummingbot.org/blog/introducing-liquidity-mining-a-marketplace-for-market-makers/)
- Gotbit and three other MM firms charged by US DOJ; clients paid ~$5,000/month for artificial volume; Gotbit CEO sentenced to 8 months, forfeited ~$22.8M, firm ceased operation March 2025 — [Decrypt](https://decrypt.co/310816/gotbit-founder-forfeits-23m-crypto-market-manipulation-plea-deal), [TRM](https://www.trmlabs.com/resources/blog/ten-fraudsters-from-four-financial-services-firms-charged-in-different-cryptocurrency-market-manipulation-schemes-out-of-northern-district-of-california)
- Drift JIT: pro MMs compete for taker flow without committing resting capital — [eco.com](https://eco.com/support/en/articles/14801189-drift-protocol-perps-architecture-explained)

### Inferences
- Pitch to Perpl-like venues should be measurable depth/spread uptime on-chain, never "volume". Wash-style volume is legally and reputationally toxic.
- Perpl-specific incentive terms (rebates, points) not researched here; check Perpl docs.

### Gaps
- No source on token-loan/call-option deal terms with figures; no data on retainers for perp DEXs specifically.

## 4. AI trading agents: proving performance, and red flags

### Takeaway
Credible proof is on-chain live capital with public trades and reasoning (Nof1 Alpha Arena model); credibility collapses with unverifiable claims, manual operation behind "AI", token-led hype and guaranteed returns.

### Cited Findings
- Alpha Arena (Nof1): six frontier models trade $10,000 each live on Hyperliquid with identical prompts; trades, positions and reasoning public; outcomes ranged from ~+40% to worse than -25% in the summary I found (season/date unspecified, treat as approximate) — [Datawallet search summary](https://www.datawallet.com/crypto/alpha-arena-nof1-ai-explained), [Bitcoin.com](https://news.bitcoin.com/6-bots-with-real-money-hyperliquid-hosts-first-ever-ai-trading-showdown/)
- ai16z/ElizaOS class action alleges the "AI agent" was operated manually and generated no revenue; ~3,945 wallets reportedly lost in the collapse (allegations, unproven) — [CryptoRank](https://cryptorank.io/news/feed/0d429-ai16z-elizaos-creators-sued-fake-ai-hype), [ClaimDepot](https://www.claimdepot.com/cases/ai16z-class-action-alleges-founders-faked-ai-agent-misled-investors-in-26b-crypto-scheme)
- Virtuals: of 16,000+ agents "maybe a few hundred" show genuine autonomy (one blog's opinion) — [openaitoolshub](https://www.openaitoolshub.org/en/blog/ai-agent-crypto-tokens-guide)
- SEC and CFTC warn that AI-trading profit claims and guaranteed returns are fraud markers — [InvestmentNews](https://www.investmentnews.com/regulation-legal-compliance/sec-charges-unregistered-adviser-with-fraud-over-fake-credentials-false-ai-trading-claims/264923), [CFTC](https://www.cftc.gov/PressRoom/PressReleases/8854-24)

### Inferences
- Monday's strongest credibility levers: realized on-chain PnL per wallet, verifiable decision log tied to tx hashes, honest sample length, paper-mode results labeled separately, and reporting drawdown/inventory risk next to APR.
- Backtests or paper PnL presented as returns would be exactly the red flag users distrust.

### Gaps
- Alpha Arena season-level numbers and dates not verified from a primary source.

## 5. Monad Metropolis hackathon (Track 01) and judging

### Takeaway
Track 01 is "Onchain Finance & Trading", $30k pool; judging 14-27 Oct 2026, winners 3 Nov 2026. I could not find Track 01 scoring criteria or prior winners; only submission rules.

### Cited Findings
- Six weeks, 4 tracks, >$250K total prizes; submissions end 13 Oct — [Monad on X](https://x.com/monad/status/2094826883049205806)
- Track pool $30,000, grand champion bonus $25,000, sponsor bounties (Chainlink, Nansen and others); build from 1 Sep, submit by 13 Oct, judging 14-27 Oct, winners 3 Nov 2026 — [Risein](https://www.risein.com/monad/monad-metropolis-hackathon) (Monad page timed out), [Monad](https://monad.xyz/developers/hackathons/metropolis)
- Per search summary: submissions must be open source under an OSI-approved license; demo video max 3 minutes and must show the product operating plus Monad interactions — [Monad](https://monad.xyz/developers/hackathons/metropolis) (snippet only; verify on page)
- Monad Blitz events are peer-judged one-day hackathons ($10K pools) — [Monad events](https://monad.xyz/events)

### Inferences
- Rules emphasize working demo and on-chain activity; a live mainnet product with verifiable results fits. Nansen is a sponsor, so Nansen-data use may earn a bounty (check bounty text).
- Note: user's memory says Perpl bounty due 14 Oct 10:59 WIB, consistent with 13 Oct deadline in UTC-ish terms.

### Gaps
- No judging rubric, judge list or previous winners (Mission/Blitz) found; recommend fetching the Metropolis page in a browser and the Perpl bounty text directly.
