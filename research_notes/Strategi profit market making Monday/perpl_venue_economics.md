# Perpl venue economics for a small automated market maker (as of 2026-10-06)

Method note: the live context endpoint was fetched read-only on 2026-10-06 ~20:59 UTC (block 111056097) from https://app.perpl.xyz/api/v1/pub/context (the path in the brief, /api/pub/context, is not the documented one; /v1/pub/context works). Numbers below marked "live" come from that snapshot. Docs were read via https://docs.perpl.xyz (llms.txt index, .md pages).

## Fee schedule (maker/taker, rebates, tiers, referral/builder)

### Takeaway
Base tier is 0.45 bps maker / 3.45 bps taker; maker fee falls to 0 at >=$100M 14d volume and goes negative (rebate, paid off-chain) only at >=$250M (-0.01 bps), >=$500M (-0.1 bps), >=$1B (-0.5 bps). A small MM pays a positive maker fee, so edge must come from spread/funding, not rebates.

### Cited Findings
- Fee tiers by 14-day volume: T1 <$5M 0.45/3.45 bps; T2 >=$5M 0.25/3.00; T3 >=$25M 0.15/2.50; T4 >=$100M 0/2.10; T5 >=$250M -0.01/1.75; VIP1 >=$500M -0.1/1.50; VIP2 >=$1B -0.5/1.25 (maker/taker) — [Perpl docs: Fees](https://docs.perpl.xyz/exchange/fees)
- "Negative maker rates (on Tier 5, VIP 1 and VIP 2) are rebates"; payouts about every two weeks, processed off-chain — [Perpl docs: Fees](https://docs.perpl.xyz/exchange/fees)
- Live config matches: maker_fees on-chain [45,25,15,0,0,0,0,0], taker_fees [345,300,250,210,175,150,125,0] (units of 1e-6, i.e. 45 = 0.45 bps); the rebates for upper tiers are not in on-chain config, consistent with off-chain payout. Identical for all 11 markets — [live context](https://app.perpl.xyz/api/v1/pub/context)
- recycle_fee (charged on orders with expiry blocks, refunded if filled/self-canceled) is 0 on mainnet; trading fee configurable up to 10% per perp by protocol; liquidations/deleveraging are not charged trading fees — [Perpl docs: Fees](https://docs.perpl.xyz/exchange/fees), [api-docs repo](https://github.com/PerplFoundation/api-docs)
- Fee is charged on fills that change position size (opening), per the API docs; one aggregator says users pay only to open, not close — [api-docs repo](https://github.com/PerplFoundation/api-docs), [Messari-linked search summary](https://messari.io/project/perpl/profile)
- Referrals: referrer gets 10% of 1st-degree and 5% of 2nd-degree referrals' trading fees; biweekly payouts; live config referrer_1st_reward_share_bps 1000 / 2nd 500 — [Perpl docs: Referrals](https://docs.perpl.xyz/exchange/referrals), [live context](https://app.perpl.xyz/api/v1/pub/context)
- Builder codes exist (docs page "Builder Codes" in index; application form linked in context features.builderApplyUrl). Fee-share terms for builders not read — [docs index](https://docs.perpl.xyz/llms.txt)
- Conflicting/stale: third-party reviews cite 8.8 bps taker / 5 bps maker — [Orbit review](https://orbitperpscreener.com/blog/perpl-review), [arbuzdao](https://arbuzdao.com/projects/perpl); contradicted by official docs and live config above (use 0.45/3.45).

### Inferences
- Round-trip as pure maker at T1 costs about 0.45 bps per side on opening fills; with BTC quoted spread sometimes ~0.01 bps (live) vs 16-22 bps on small caps, fee drag is material only on BTC/ETH.
- A small MM will stay in T1/T2 for a long time; reaching rebate tiers needs >=$250M per 14 days (platform total 24h volume is only ~$13M, so unrealistic).

### Gaps
- Whether the tier discount applies to the fee on opening only, and exact builder-code fee-share percentages: not confirmed.

## Incentive programs (points, mPoints, tournaments, grants, MM programs)

### Takeaway
Points are live and rewards "organic" volume; the mPoints campaign (up to $1M MON) explicitly excludes institutional market makers. No documented MM rebate/depth/uptime program found; PLP vaults and tournaments are the other avenues.

### Cited Findings
- Season 1 points since June 10, 2026; 50,000 points per week pool; weekly Wednesday snapshot, distribution within 48h; earn from organic trading, PLP participation (listed as coming soon), referrals (+5% both sides), tournaments/codes; wash trading may reduce multipliers; Perpl may change criteria anytime — [Perpl docs: Points](https://docs.perpl.xyz/exchange/points)
- Orbit review says points are earned through volume and liquidity provision; pre-TGE, no token or confirmed airdrop — [Orbit review](https://orbitperpscreener.com/blog/perpl-review)
- mPoints "Purple Summer": 16 weeks, pool up to $1,000,000 in MON ($500k guaranteed + up to $500k volume-based), 50,000 mPoints/week for trading + 200,000 for builder codes/tournaments/bonuses; "Institutional Market Makers will be excluded"; only organic activity — [Perpl docs: mPoints](https://docs.perpl.xyz/exchange/mpoints). Live config: mpoints_num_epochs 16, mpoints_pool_size 1,000,000, epoch start 1783526400000 ms (= 2026-07-08 UTC) — [live context](https://app.perpl.xyz/api/v1/pub/context)
- Tournaments in live config: "Trading Tournament #1" (pool 50,000 AUSD-denominated units "50000000000"/1e6 = 50,000; min volume $100k; volume and ROI leaderboards, top-10 payouts), and "Monad Cards Invitational" (mc-cup, Aug 2026 window ms 1784221200000-1786640400000, pool 100,000, min volume $250k, volume + "psv" leaderboard top-20). Both flagged results_finalized true, so none appears active as of 2026-10-06 — [live context](https://app.perpl.xyz/api/v1/pub/context). Pool currency units are my reading of the 6-decimal scale; unconfirmed.
- Perpl Foundation advertises a Quantitative Trader role for delta-neutral market making across orderbook and vault system — [Monad ecosystem jobs](https://eco-jobs.monad.xyz/companies/perpl-xyz/jobs/55149701-quantitative-trader-at-perpl-foundation)
- Funding: raised $9.25M led by Dragonfly — [cryptonews](https://cryptonews.net/news/market/30940406/)
- Geo-block list: BY, CU, GB, IR, KP, RU, SY, UA, US — [live context](https://app.perpl.xyz/api/v1/pub/context)

### Inferences
- Whether a small non-institutional bot qualifies for mPoints is ambiguous; "institutional" is undefined. Heavy two-sided self-matching would risk wash-trading penalties.
- Points have unknown monetary value (no token); treat as upside, not income.

### Gaps
- Maker vs taker weighting in the points formula not published in pages read. No dedicated MM/grant/depth-uptime program found; Monad-side MM grants not found.

## Liquidity, volume, OI, competition, vaults

### Takeaway
Perpl is small: about $13M 24h volume and about $1.5M OI across 11 markets, and nearly all of it in BTC/ETH/MON. Books are thin and spreads on non-majors are 13-22 bps, which is where a small MM could earn spread, but flow is limited.

### Cited Findings
- Live snapshot (24h volume USD / OI USD at mid / quoted spread, top of book): BTC $8.57M / $0.68M / 0.01 bps; MON $1.99M / $0.10M / 16.6 bps; ETH $1.02M / $0.49M / 2.4 bps; HYPE $0.33M / $0.05M / 14.8 bps; SOL $0.30M / $0.11M / 7.8 bps; UNI $0.45M / $0.02M / 14.5 bps; LIT $0.27M / $0.01M / 13.4 bps; NEAR $0.26M / $0.01M / 16.2 bps; VVV $0.19M / $0.01M / 16.6 bps; PUMP $0.14M / $0.04M / 17.7 bps; ZEC $0.08M / $0.05M / 21.6 bps. Totals about $13.7M volume, about $1.6M OI — computed from [live context](https://app.perpl.xyz/api/v1/pub/context) (dva = 24h volume, oi, bid/ask, 6-decimal scaling). Orbit review independently reports $13.3M 24h volume and $1.6M OI — [Orbit review](https://orbitperpscreener.com/blog/perpl-review)
- Conflicting: a DefiLlama search snippet shows 24h volume $50.68M, OI $12.2M, 30d volume $1.856B, cumulative $5.333B, TVL $3.79M, dominant perp DEX on Monad — [DefiLlama Perpl](https://defillama.com/protocol/perpl) (direct fetch returned 403; snippet via search, date unknown, could be an earlier or higher-volume day or differ in methodology). The live snapshot is contemporaneous and primary.
- Markets: BTC(1), MON(10), ETH(20), SOL(31), HYPE(40), ZEC(50) per docs; live context adds LIT, VVV, PUMP, NEAR, UNI — [Networks & Configuration](https://docs.perpl.xyz/resources/for-developers/networks-and-configuration), [live context](https://app.perpl.xyz/api/v1/pub/context)
- Liquidity bootstrapped by "independently operated vaults" (HLP-like); PLP vault: ERC-4626, AUSD collateral, 7-day withdrawal wait, weekly fee/reward distribution, curators may run strategies on- or off-chain and hedge on CEXs; operator identity, TVL, returns not stated — [Docs introduction](https://docs.perpl.xyz), [Docs: PLP](https://docs.perpl.xyz/exchange/vaults-plp)
- Collateral is AUSD; first deposit minimum $10; max account equity cap 1,000,000 AUSD (live max_account_equity 1e12 /1e6) — [live context](https://app.perpl.xyz/api/v1/pub/context)
- Docs pitch the venue to MMs: post+cancel under 100k gas; "every GWEI of gas matters" — [Docs introduction](https://docs.perpl.xyz)

### Inferences
- With BTC at ~0.01 bps spread in the snapshot, someone (likely the foundation/PLP vault or a pro MM) is already quoting BTC at the tick; a small bot cannot win BTC on price. Wide books on MON/HYPE/SOL/ZEC/small caps are where quotes could rest inside the spread, but volume is $0.1-2M/day per market, so gross spread revenue is small (e.g. $1M/day at 1 bps captured on a 25% share is about $25/day).
- OI is tiny relative to volume (volume/OI turns about 8x/day), suggesting mostly intraday/bot flow.

### Gaps
- Book depth by price level, existing MM identities and wallet addresses, and PLP vault TVL/returns: not obtained (would need WebSocket market-data stream or on-chain reads). No public MM profitability or case study found.

## Market mechanics: funding, oracle, margin, liquidation, sizes, TTL, rate limits, latency

### Takeaway
Funding settles every 8,571 blocks (about 43 min, not 1h); mark price is a median clamped to +-0.25% of Chainlink; isolated margin only; orders carry a 20-block TTL (about 6 s); market makers should amend orders in place with Change to avoid book gaps. Real block time is about 0.30 s, not 0.42 s.

### Cited Findings
- Funding: applied after every 8,571 blocks; docs say "approximately once per hour" assuming 0.42 s block time; live config funding_interval_sec = 2580 (43 min); rate = sum of impact-price differences divided by oracle price over samples; clamped by per-market absFundingClampPctPer100k (0-15%); funding price referenced to spot (Chainlink) not mark — [Docs: Funding](https://docs.perpl.xyz/exchange/funding), [live context](https://app.perpl.xyz/api/v1/pub/context). Orbit review: avg funding APR -11.12% — [Orbit review](https://orbitperpscreener.com/blog/perpl-review)
- My measurement: block 110980778 at t=1791272342000 ms and block 111056097 at t=1791295162000 ms (both in live context) give 75,319 blocks / 22,820 s = about 0.303 s per block.
- Oracle/mark: spot index from Chainlink Data Streams (updates on 0.1% move or staleness); mark = median of external venue prices (Binance, Hyperliquid, OKX, Bybit), basis-adjusted fair value, impact mid, and book price, computed every block, clamped within 0.25% of the Chainlink index, published on 0.05% moves — [Docs: Price Indices](https://docs.perpl.xyz/exchange/price-indices)
- Margin: isolated only; MR = notional / margin fraction; collateral withdrawal needs approval within 120 s and is blocked at 85%+ OI capacity — [Docs: Margin](https://docs.perpl.xyz/exchange/margin). Live config initial_margin/maintenance_margin are margin fractions (BTC 1500/2500 which maps to 6.67% IM and 4% MM, matching the docs "BTC 4%"): BTC 15x max, ETH/SOL 12x (MM 5%), MON/HYPE/ZEC 10x (MM 5%/5%/5.6%), PUMP 5x and LIT/VVV/NEAR/UNI 3x (MM 10%) — [live context](https://app.perpl.xyz/api/v1/pub/context); interpretation of the scale is mine, verified only against BTC 4% and ETH/SOL 5% in the docs.
- Liquidation: at maintenance margin; remaining margin split 80% to trader, 10% insurance fund, 10% protocol; insurance fund and ADL exist — [Docs: Liquidation](https://docs.perpl.xyz/exchange/liquidation)
- Order types: market (IOC limit at slippage bound), limit, stop market/limit, take profit, TWAP upcoming; GTC/IOC/FOK, reduce-only, post-only, max matches, threshold price, expiry block, min size — [Docs: Order Types](https://docs.perpl.xyz/exchange/order-types)
- Live: order_ttl_blocks 20 (about 6 s), order_retry_blocks 22, order_max_market_slippage_bps 100, max account trigger orders 16 — [live context](https://app.perpl.xyz/api/v1/pub/context)
- Min order sizes: BTC 0.00001, ETH 0.001, SOL 0.001, MON 1, HYPE 0.01, ZEC 0.0001; min order value $0 (disabled); live price/size decimals: BTC 1/5, ETH 2/3, SOL 3/3, MON 6/0, HYPE 4/2, ZEC 2/4 (tick = 10^-price_decimals, e.g. BTC $0.1, ETH $0.01, SOL $0.001) — [Docs: Minimum Orders](https://docs.perpl.xyz/exchange/minimum-orders), [live context](https://app.perpl.xyz/api/v1/pub/context)
- MM best practice: amend in place with Change (keeps order ID, no gap; reducing size keeps queue priority, increasing size or changing price re-queues); batch cancel+post about 2x gas; avoid separate cancel then post; production makers run Change:Place ratios from below 1:1 to over 1000:1 — [Docs: Best Practices](https://docs.perpl.xyz/resources/for-developers/best-practices)
- Rate limits: WS trading 120 req/min mainnet (60 testnet), 4 connections per wallet; WS market-data 10 req/min per connection, 16 subscriptions; REST public about 100/min, authenticated about 60/min, 429 means backoff — [api-docs repo](https://github.com/PerplFoundation/api-docs), [Docs: REST](https://docs.perpl.xyz/resources/for-developers/api/rest)
- Gas: live base gas price 100 gwei (p50 about 102, max 130 gwei) — [live context](https://app.perpl.xyz/api/v1/pub/context)
- Mainnet: chain 143, REST https://app.perpl.xyz/api, WS wss://app.perpl.xyz, RPC https://rpc.monad.xyz, exchange contract 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F, AUSD 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a — [Networks & Configuration](https://docs.perpl.xyz/resources/for-developers/networks-and-configuration)

### Inferences
- 120 WS requests/min is about 2 per second across all markets; at 0.3 s blocks a bot cannot re-quote every block. Requote on threshold moves; batch bids and asks in one request if the API allows (unconfirmed).
- 20-block TTL (about 6 s) means resting quotes expire unless refreshed, so expiry itself acts as a stale-quote safety net; refresh costs rate-limit budget.
- Funding is only 43 min and mark is anchored to CEX prices, so inventory carry is small but nonzero; HYPE/ZEC/VVV/UNI/NEAR funding in the snapshot is non-zero (units of rate field undocumented here).

### Gaps
- Funding rate field units in the context (rate, ppl) not confirmed; typical funding levels beyond one snapshot and the Orbit -11% APR average. Exact cap values per market and ADL specifics not read. Whether a single WS message can batch multiple orders not confirmed.

## Public data on maker profitability, vault returns, case studies

### Takeaway
None found.

### Cited Findings
- Perpl publishes a Dune dashboard (https://dune.com/perpl/perpl-dex per context features.duneDashboardUrl) that may hold volume/user data — [live context](https://app.perpl.xyz/api/v1/pub/context). Content not read.

### Inferences
- Profitability must be inferred from volume, spreads and fee schedule above, or measured via paper trading.

### Gaps
- No PLP return figures, no MM case studies, no maker PnL data located in public sources reviewed.
