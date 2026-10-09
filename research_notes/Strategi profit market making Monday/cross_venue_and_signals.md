# Cross-venue edges for a maker on a thin on-chain perp venue (Perpl on Monad): lead-lag, hedging, funding, smart-money signals

Research as of 2026-10-06. About 15 tool calls; several primary sources returned 403/402 (SSRN, MDPI, X), so those findings come from search-result summaries and are flagged as such.

## 1. Lead-lag: how strongly do Binance/Hyperliquid lead smaller venues, at what horizons?

### Takeaway
Binance leads Hyperliquid in every recent study found, by roughly 0.7 s (one study) and at the 2-10 s horizon (another). A venue like Perpl, with ~400 ms blocks, can't be quoted safely from its own book without a fast external reference. No Perpl-specific lead-lag measurement was found.

### Cited Findings
- Arrakis Finance (16 days to 2026-02-26, 29 assets, Hayashi-Yoshida estimator): Binance leads Hyperliquid by ~700 ms and Lighter by ~100 ms. Lighter leads Hyperliquid by ~600 ms. Binance led Hyperliquid in all 29 assets. — [ChainCatcher summary](https://chaincatcher.com/en/article/2269446) (secondary, original is an X post: [Arrakis](https://x.com/ArrakisFinance/status/2062564031140159668), not fetchable)
- The same source attributes Hyperliquid's lag to ~200 ms block finality plus a maker/taker round trip of roughly 500 ms more, while Binance and Lighter match in memory. — [ChainCatcher](https://chaincatcher.com/en/article/2269446)
- Lim (SSRN, posted 2026-06-25; BTC perps, 2026-05-25 to 2026-06-22): Binance leads Hyperliquid in every price-discovery window (cross-correlations, Hasbrouck information shares). The "informed" Hyperliquid wallet cohort also follows Binance on average at 2, 5 and 10 s horizons. A minority of wallets anticipate Binance moves, and this persists in split-sample tests. — [SSRN 6993378](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6993378) (abstract via search summary; page returned 403)
- Granger-causality on funding rates (Binance vs Hyperliquid): Hyperliquid Granger-causes Binance in 25% of windows, the reverse in 13%. Reported only via a search summary, no original found. — [search summary via SSRN/other, unverified](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6993378)
- Price Discovery in Cryptocurrency Markets (2024 ETH/BTC data): centralized markets typically lead in ETH price discovery versus Uniswap v2. In futures, high-volatility periods give mixed outcomes. — [arXiv 2506.08718](https://arxiv.org/abs/2506.08718)
- Makarov & Schoar (JFE 2020, 135(2), 293-319) document large, recurrent cross-exchange arbitrage gaps, mostly across countries (older data, 2017-18 era). — [MIT Sloan CFI](https://mitsloan.mit.edu/cfi/trading-and-arbitrage-cryptocurrency-markets)

### Inferences
- If Binance leads even Hyperliquid by 0.7 s, a thin venue with a 400 ms block cadence is a follower. Stale-quote risk is the main cost of quoting off Perpl's own mid. Pricing off Binance (and Hyperliquid as a secondary check) is justified.
- The lead is longer than Monad's block time (~0.4 s), so a maker who cancels or reprices on a Binance move has a window, but only if the quote-update path is fast. That path is the binding constraint.

### Gaps
- No published measurement of Binance/HL leading a small Monad perp DEX like Perpl; Brauneis et al. and Alexander & Heck were not retrieved; no ms-to-minutes table by asset beyond the two above; lead-lag figures are for majors (BTC/ETH), not long-tail pairs.

## 2. Cross-exchange market making (XEMM) mechanics, required spread, PnL drivers, failure modes

### Takeaway
XEMM = quote passively on the thin venue, hedge each fill immediately as taker on the deep venue; the quoted edge must exceed taker fee plus slippage plus latency drift. Hummingbot's implementation exposes exactly these knobs.

### Cited Findings
- Hummingbot XEMM: make a market on the maker exchange while hedging filled trades on a taker exchange; the maker spread is set wider than the taker spread by `min_profitability`. — [Hummingbot docs](https://hummingbot.org/strategies/v1-strategies/cross-exchange-market-making/)
- Parameters include `min_profitability`, `slippage_buffer`, `top_depth_tolerance`, `cancel_order_threshold` (profitability floor that triggers cancel), and order-size caps tied to taker volume/balance. Higher `min_profitability` means fewer fills but more profit per fill. — [Hummingbot docs](https://hummingbot.org/strategies/v1-strategies/cross-exchange-market-making/); [Hummingbot blog](https://hummingbot.org/blog/what-is-cross-exchange-market-making/)
- The strategy "always immediately hedge[s]" maker fills. Hummingbot notes DEX legs add gas-fee variability and need retry mechanisms. — [Hummingbot docs](https://hummingbot.org/strategies/v1-strategies/cross-exchange-market-making/)
- Hyperliquid base perp fees: taker 0.045%, maker 0.015%. At tier 4 ($500M+ 14d weighted volume) taker is 0.028%, maker 0%; tier 6 ($7B+) taker 0.024%. Staking HYPE gives a further 5-40% discount. — [hyperliquidguide.com](https://hyperliquidguide.com/guides/fees/fees-explained) and [fee tiers via eco.com summary](https://eco.com/support/en/articles/15191998-hyperliquid-fees-explained-maker-taker-funding-and-withdrawal-in-2026) (third-party aggregators; check Hyperliquid docs)
- Tread.fi describes itself as a multi-venue OEMS (CEX, perp DEXs, on-chain), with a Market Maker algo that uses only limit orders, and a delta-neutral two-leg funding-arb product. Its docs found do not describe a pure XEMM hedge setup. — [Tread docs](https://docs.tread.fi/strategies/market-maker)

### Inferences
- Arithmetic from the fees above: a Binance or HL taker hedge costs roughly 2.4-4.5 bps (HL tiers) plus half-spread and slippage. The Perpl quote therefore needs several bps of edge versus the reference mid, plus a buffer for the 0.1-1 s information lag, before a fill is +EV. Binance fees were not retrieved, so the Binance-hedge number is a gap.
- Main PnL drivers: edge captured per fill minus taker cost, adverse selection from reference moves between quote and cancel, and inventory/funding carry while a hedge is open. Failure modes: stale quotes during fast moves, hedge slippage in size, hedge-venue API/rate limits, and funding mismatches.

### Gaps
- No published realized-PnL or Sharpe figures for XEMM on perp DEXs; no professional-desk (Wintermute/GSR etc.) disclosures; Binance fee schedule not retrieved; Hyperliquid hedge slippage by size not measured.

## 3. Funding-rate and basis capture between venues

### Takeaway
Funding differs structurally across venues, so cross-venue capture exists, but persistence is not guaranteed and the evidence found is practitioner-level. Perpl funding specifics were not researched.

### Cited Findings
- Hyperliquid pays funding hourly (1/8 of the 8h rate); Binance every 8 h. A persistent Hyperliquid-minus-Binance spread is the basis for a short-HL/long-Binance (or reverse) delta-neutral trade. The spread can shrink or invert before the next payment. — [OneKey guide](https://onekey.so/blog/ecosystem/hyperliquid-binance-funding-arbitrage/)
- Premium formulas differ: Hyperliquid uses an impact-price (liquidity-aware) premium, Binance top of book. — [OneKey guide](https://onekey.so/blog/ecosystem/hyperliquid-binance-funding-arbitrage-20260429/)

### Inferences
- A maker hedged on another venue holds a cross-venue position whose carry equals the funding difference. Skewing quotes to hold inventory on the side that earns funding is plausible, but this is not supported by any quantitative study found.

### Gaps
- No peer-reviewed or measured data on Perpl vs Hyperliquid funding spreads, persistence, or net-of-cost yields; whether skewing inventory for funding beats the adverse-selection cost is untested in the sources.

## 4. Smart-money / informed-flow signals: short-term predictive power, decay, toxicity

### Takeaway
Wallet-labelled flow is informative for a minority of wallets, but evidence for a profitable short-horizon signal from public labels is weak; the strongest evidence (Lim 2026) shows the informed signal is seconds-scale, which a 120 s poll would miss. Treat Nansen flow as a slow risk/skew input, not a quote-protection trigger.

### Cited Findings
- Lim 2026: a minority of Hyperliquid wallets trade before Binance moves (anticipatory), persistent out-of-sample; the aggregate informed cohort follows Binance at 2/5/10 s. — [SSRN 6993378](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6993378) (abstract only)
- Copy-trading evidence: in a 90-day, three-exchange study (>100k copier outcomes), 97% of leaders were profitable but only about 44% produced positive PnL for copiers (vendor blog, methodology not verified). — [Bitsgap](https://bitsgap.com/blog/why-copying-on-chain-whale-trades-usually-backfires)
- A Medium simulation of whale trades on Hyperliquid reports following whales with account value >= $50M gave 98.6% win rate and +12% over 77 days. Self-published, small sample, not credible as a predictive-power estimate. — [Medium](https://medium.com/@gwrx2005/combining-simulation-and-machine-learning-analysis-of-whale-trading-on-hyperliquid-93f10d96941b)
- Visible leverage, entry and PnL on-chain, but not total bankroll, horizon or hedges elsewhere, limiting what a label implies. — [Bitsgap](https://bitsgap.com/blog/why-copying-on-chain-whale-trades-usually-backfires)
- Makers use toxicity metrics (VPIN, markouts) to widen spreads, shrink size, or refuse flow; a trader whose 1 h markout is random but 7-day markout is positive is not seen as toxic by a maker who can offload within an hour. — [QuestDB glossary](https://questdb.com/glossary/order-flow-toxicity/); [Multicoin](https://multicoin.capital/2026/02/17/adverse-selection-rules-everything-around-me/)
- Multicoin lists mitigation options: delay execution, flow segmentation (tag retail addresses), dynamic pricing, refusing flow. It names CEX traders front-running DEX arbitrage as informed flow. No quantification of informed share. — [Multicoin](https://multicoin.capital/2026/02/17/adverse-selection-rules-everything-around-me/)
- Trade toxicity is reported as ~3.88x higher in DeFi than CeFi (single search-summary claim, original not located). — [QuestDB/search summary](https://questdb.com/glossary/order-flow-toxicity/)

### Inferences
- Cross-venue informed flow reaching Perpl is most likely from fast traders watching Binance, not from labelled Hyperliquid whales. The quote-protection signal is the Binance/HL reference move itself, not wallet labels.
- Nansen "Smart HL Perps Trader" is a backward-looking profitability label, so it selects past winners, which copy-trading evidence suggests overstates forward edge.

### Gaps
- No peer-reviewed study measuring forward returns after labelled-wallet trades on Hyperliquid at 1 s to 1 h horizons; decay curve for Nansen-labelled flow not found; no Perpl-specific toxicity data. Monday could measure this itself with its own markouts.

## 5. Latency facts and the 120 s Nansen polling question

### Takeaway
Nansen documents delivery "within seconds" but gives no hard SLA for Smart Money perp trades; a 120 s poll adds up to 120 s staleness, far longer than the seconds-scale horizons where informed signals showed up.

### Cited Findings
- Nansen perp-trades endpoint: `/api/v1/smart-money/perp-trades`, Hyperliquid only, trailing 7 days queryable, `lookback_hours` 1-168, max 1000 records/page, fields include `block_timestamp`, `value_usd`, `side`, `action`; filters include label (Fund, Smart Trader, 30/90/180D Smart Trader, Smart HL Perps Trader). It is described as "real-time". — [Nansen docs](https://docs.nansen.ai/api/smart-money/perp-trades)
- Nansen FAQ: data typically arrives "within seconds, depending on the chain"; refresh intervals vary by endpoint; pricing is credit-based rather than fixed rate limits. — [Nansen FAQ](https://docs.nansen.ai/guides/faq)
- Hyperliquid: median block finality ~0.2 s (one source says ~0.07 s normal conditions, p99 < 0.5 s; sources differ). — [Chainstack](https://chainstack.com/what-is-hyperliquid/); [cleansky](https://cleansky.io/blog/hyperliquid-architecture-hypercore-hyperevm-2026/)
- Monad: ~400 ms blocks, ~800 ms deterministic finality (speculative finality at ~400 ms). — [Monad blog](https://blog.monad.xyz/blog/contextualizing-blockchain-performance); [CoinGecko](https://www.coingecko.com/learn/what-is-monad-crypto)

### Inferences
- With 120 s polling, effective signal age is 120 s plus Nansen processing delay. Against Lim's 2-10 s follow horizons and Arrakis's 0.7 s lead, the signal is stale by one to two orders of magnitude for quote protection. It can still inform slow inventory skew (minutes to hours) or a per-coin "crowding" regime flag, but a free Hyperliquid websocket trade/user feed is the right tool for fast flow.
- Because the endpoint exposes only 7 days and no date range, Monday would need to log its own history for any backtest.

### Gaps
- No measured end-to-end Nansen delay between a Hyperliquid fill and its appearance in the API; no Hyperliquid API round-trip latency numbers for order placement from a given region; Binance API latency not covered.
