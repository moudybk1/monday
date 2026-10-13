# Internal diagnosis: why Monday's market-making strategy loses money (code + own data, 2026-10-06)

Source convention: [file:line](path) = repo file under /Users/yoga/Projects/mondaynad. "Scratch" = analysis scripts and raw outputs in /private/tmp/claude-501/-Users-yoga-Projects-mondaynad/4c2b4b68-9c26-4a57-9a09-3368c329d9f1/scratchpad (lib.ts, run2.out, run3.ts, run5.out, run6.ts, run7.ts). No repo file was edited; DBs opened read-only.

IMPORTANT data limits discovered up front (they shape every answer below):
- The testnet DB has 0 fills/decisions/pnl rows, mainnet DB 0 fills; only monday-paper-mainnet.sqlite has 24 fill rows (20 unique after removing the 4 duplicated by concurrent paper users), 1211 decisions, 2h-8h of snapshots (2026-10-06 05:54-14:00 UTC). The "6-day testnet replay" is computed in memory by evidence.ts from live Perpl candles and is NOT stored, so it cannot be re-run offline.
- No Perpl or Hyperliquid price series exists locally for the Nansen window (2026-09-30..10-06). The only price data are (a) perpl-stats-mainnet.sqlite px_trades (on-chain fill tape: dense for BTC perp 1 and ETH perp 20 from 2026-03/04 to 2026-06-16, then a gap, then only 2026-10-06 10:29-13:12; SOL tape does not exist for the old period) and (b) price_usd on each Nansen trade (Hyperliquid execution price, sparse). So I ran the evidence replay logic (copied, unchanged policy functions imported from packages/core) on the Apr-Jun 2026 mainnet BTC/ETH tape with flows = 0 (i.e. Nansen-free), and ran the event study separately on Nansen's own trade prices.

## 1. How exactly are quotes priced, and what does the fee model assume?

### Takeaway
Quote = reference price skewed by inventory/Nansen/book/bias, then pushed out by half-spread h = max(minHalfSpread, a*sigma1m)*spread_mult + makerFee (all in bps), rounded outward to the tick; size is $100*size_mult shrunk on the inventory-growing side. Maker fee is assumed 0.45 bps (matches mainnet Oct 2026 tape: 0.49 bps avg), so the fee is a minor cost; the dominant fact is that on mainnet BTC the book is 1 tick (~0.01 bp) wide while Monday quotes 4.45-10.5 bps away.

### Cited Findings
- Reference: mark, or book mid if within 5 bps of mark; then `ref = local + blend*(hlMid - local)` with blend 0.5 if the Hyperliquid mid is within 50 bps; no HL mid = Perpl only — [strategy.ts:98-100](packages/core/src/strategy.ts), constants [strategy.ts:25-41](packages/core/src/strategy.ts).
- Half-spread `h = max(minHalfSpreadBps, a*sigma1mBps) * spread_mult + makerFeeBps`, a=1.0 — [strategy.ts:103](packages/core/src/strategy.ts). Balanced preset minHalfSpreadBps=4, quote $100, max inventory $500, 3x; Conservative 6 bps; Active 3 bps; High = Balanced at 10x — [types.ts:30-34](packages/core/src/types.ts). sigma1m = sqrt(EWMA variance of 1-minute log returns, half-life 15 min) in bps — [strategy.ts:51-55](packages/core/src/strategy.ts).
- Inventory skew `skewInv = -gamma*q*h`, q = position/min(policyMaxInv, gov max_inv) clamped to [-1,1], gamma=1 — [strategy.ts:106-108](packages/core/src/strategy.ts). Nansen skew `k*clamp(S,-3,3)` with k=1.5 bps/unit (max +-4.5 bps) — [strategy.ts:111](packages/core/src/strategy.ts); book skew kBook=2 bps*imbalance; governor bias clamp +-10 bps — [strategy.ts:112-114](packages/core/src/strategy.ts). `center = ref*(1+(skewInv+skewNan+skewBook+bias)/1e4)`; bid = floorTo(center*(1-h*widen/1e4), tick), ask = ceilTo(...) — [strategy.ts:117-120](packages/core/src/strategy.ts); PostOnly clamp to one tick behind opposite best — [strategy.ts:123-124](packages/core/src/strategy.ts).
- Size: `usd = min(participationCap, quoteSizeUsd*size_mult*(growsInventory ? 1-|q| : 1))`, cap = 5% of average hourly volume — [strategy.ts:127-131](packages/core/src/strategy.ts); volume from 24h of candles/24 — [runner.ts:255-265](apps/server/src/runner.ts). Requote only when the target moved > max(tick, 0.3*h) or size changed >20% — [strategy.ts:145-151](packages/core/src/strategy.ts); 1.5 s minimum between requotes per side — [runner.ts:21,458](apps/server/src/runner.ts).
- Fee model: makerFeeBps 0.45 / takerFeeBps 3.45 for all markets in the simulator/paper spec ([sim.ts:14-16](apps/server/src/venue/sim.ts)); the live Perpl adapter reads `maker_fee/100` ("45 -> 0.45 bps, base tier", [rest.ts:82-83](apps/server/src/venue/perpl/rest.ts)). Paper/sim charges fee on every fill incl. closes at 0.45 bps maker — [sim.ts:364-365](apps/server/src/venue/sim.ts). Positive maker rebate is NOT modelled (and there is none at base tier).
- Observed on-chain maker fee (volume-weighted, maker rows, BTC+ETH): 1.27-1.29 bps Mar-Apr 2026, 1.70 May, 2.81 Jun (builder/tier effects), 0.49 bps in Oct 2026; taker 2.5-4.0 bps (Oct 2.76) — perpl-stats-mainnet.sqlite px_trades (my query; fee bps by kind is erratic, e.g. 0.5-0.6 for open/close, 1.9 for increase/decrease, so treat as a range).
- Mainnet book (paper sampler, 121 one-minute samples 05:59-07:59 UTC, [samples.jsonl](apps/server/data/papertest/samples.jsonl)): BTC book spread p50 0.01 bps (1 tick), p90 0.99; ETH p50 2.19 bps; SOL p50 9.19 bps. Monday's quoted half-spread was 10.45 bps in BTC/ETH (storm regime 65% / 45% of samples) and 5.44 bps in SOL; BTC quotes sat a median 8.4 bps (bid) / 11.7 bps (ask) behind best, ETH 8.3 / 9.9, SOL ~1.1 / 1.4 (inside or at touch).
- Fee floor arithmetic: joining the BTC touch earns ~0.01 bp of spread and costs 0.45 bps fee per side (0.9 bps round trip): impossible to profit from spread on BTC at the touch; any edge must come from being quoted further away and being right about who trades.

### Inferences
- Because h adds the fee symmetrically, every filled quote has +fee-adjusted edge of (h-0.45) vs ref at placement, but fills only occur when price travels h bps through the quote, so "edge vs ref at placement" is not captured spread (see Q3).
- Participation cap (5% of hourly volume) is not binding at $100 quotes (BTC maker-side volume $0.4-1.8M/day on tape = >$15k/h => cap > $750). It affects nothing in current presets.
- The inventory skew is tiny in practice: typical |q| ~0.23 (inventory std ~$110 of $500), so skewInv ~ 1 bp; it matters only near the cap, where the reducing quote sits at ref with zero edge.

### Gaps
- Actual Perpl fee tier of the Monday account on mainnet is unknown (no live fills); tape fees for others vary with account tier/builder code.
- HL mid blend contribution (blendBps) is not recorded in samples.jsonl or decisions, so its realised effect is unmeasurable here.

## 2. How does the replay/evidence code simulate fills, and is it realistic?

### Takeaway
The replay (evidence.ts) is a 1-minute candle model: quote priced off the candle OPEN, held fixed for the whole minute, and filled in full (both sides, at the quote price) if the minute's low/high touched it. It ignores queue, partial fills, latency, requote throttle, HL blend, book skew, size cap, pre-trade checks, funding and kill rules. It is biased in both directions; the net bias is unclear but the paper venue is clearly pessimistic in fill count and exclusively captures the toxic tail.

### Cited Findings
- Fill rule: skip a side unless `c.l <= bid` / `c.h >= ask`; fill whole `t.size` at the quote; no queue position ("ignored in both arms") — [evidence.ts:115-119](apps/server/src/evidence.ts). Quotes computed with `mark=c.o, mid=null, bestBid/Ask=null` so none of the book/clamp logic applies — [evidence.ts:110-113](apps/server/src/evidence.ts). Governor = FALLBACK regime table re-evaluated every GOVERNOR_INTERVAL_MIN=15 or on storm entry — [evidence.ts:101-105](apps/server/src/evidence.ts), table [strategy.ts:210-215](packages/core/src/strategy.ts). Policy hard-coded to Balanced — [evidence.ts:17](apps/server/src/evidence.ts).
- Markouts = fill price vs next-minute close (1m) and +5th close (5m), averaged per FILL, not notional-weighted — [evidence.ts:130-133,146](apps/server/src/evidence.ts). Gaps in candles are carried forward (zero-range minutes) — [evidence.ts:169-180](apps/server/src/evidence.ts). Equity marks to candle close. Funding is ignored. No daily loss kill / max-inventory preTradeReject in the loop.
- Naive arm = same quoting with S=0, k=0, calm params, no reflex; Monday arm = same code + regimes from S + reflex pull/widen + k only if the event study said so — [evidence.ts:107-113,186](apps/server/src/evidence.ts). So if k=0 the only differences are regime widening (spread x1.5-2.5, size x0.4-0.7) and reflex pulls: i.e. Monday simply quotes less.
- Paper venue fill rule: a resting bid fills only when the real best ask <= bid price (ask fills when best bid >= ask); whole remaining size; code comment calls it "conservative on purpose" — [paper.ts:19-30](apps/server/src/venue/paper.ts). The fill() then books the fee and clears the quote — [sim.ts:357-385](apps/server/src/venue/sim.ts). A quote sitting inside a wide book (SOL, 9 bps wide, Monday ~1 bp behind best) can only fill after the market moves a full spread through it; observed 0 SOL paper fills in ~3 h with SOL quoted at touch (paper DB fills).
- Rejected assumption check: a trade-through fill on distant quotes (4-12 bps behind a 1-tick book) is near-certain once a print crosses the level, so queue position is a second-order issue for Monday's wide quotes; it matters only for at-touch quoting.

### Inferences
- Pessimistic biases: (a) stale-quote assumption: real Monday re-centres every >=1.5 s whenever mid moves >0.3h, so intraminute drift does not fill it in the real system the way a fixed minute quote does; fill counts in the replay are therefore too high but they are exactly the toxic fills; (b) forward-filled flat candles in thin ETH/SOL minutes shrink ranges and miss fills; (c) paper venue misses all fills except full-cross events.
- Optimistic biases: full-size fills with no partials, no latency/cancel race (live cancel takes request budget, tokens, 1.5 s throttle), no kill/stale-data logic, no taker-fee exits (flatten pays 3.45 bps + 2 bps slippage, [sim.ts:57-64](apps/server/src/venue/sim.ts)), no fee-tier variance.
- Because fills only occur when price runs through the quote, "edge vs placement ref" (6-9 bps in my replay output) is mostly an illusion; true captured spread vs mid at fill time ~0 and the whole PnL equals (post-fill markout - fee).
- The "Monday loses less than naive" result is explained by quoting less, not by signal alpha (see Q4/Q5): a random fillProb of 30% gives the same-sized improvement.

### Gaps
- No tick-level book history, so a latency/requote-accurate replay is impossible; no HL mid history to test the blend; I only have a print-chain approximation (below).

## 3. PnL decomposition: where PnL comes from and where it leaks (replay numbers + paper)

### Takeaway
On 4.5 months of real Perpl mainnet BTC and ETH tape, Monday's Balanced quoting (Nansen disabled) loses in 5 of 6 month-windows; PnL per notional is roughly the post-fill markout (-1 to -4 bps at 1 min) minus 0.45 bps fee. Fees are only ~10-20% of the loss; adverse selection on sweep fills is 80-90%. Inventory MTM and funding are negligible.

### Cited Findings
Method: scratch/lib.ts `replay()` = evidence.ts replay logic (same computeQuotes/ewmaVar/fallbackParams/regimeOf/nextReflex), candles built from maker-fill prints of px_trades (perp 1=BTC price ~86k, perp 20=ETH ~2.7k), Balanced policy, k=0. Windows: A Apr-2026 (BTC +11.9%), B May-2026 (BTC -3.5%), C Jun 1-16 (BTC -10%). Scratch/run2.out has all 20 variants x 6 windows.

Balanced as-is (min 4 bps, a=1, gamma=1, fallback regimes), per-window, $:
| market/window | PnL | gross (before fee) | fees | fills | notional | m1 bps (notional-wtd) | m5 | m15 | max DD |
|---|---|---|---|---|---|---|---|---|---|
| BTC A | -66.5 | -54.0 | 12.4 | 2951 | 276k | -3.16 | -1.14 | -1.18 | 70 |
| BTC B | +21.3 | +50.7 | 29.4 | 7058 | 654k | +0.30 | +0.87 | +0.81 | 12 |
| BTC C | -69.0 | -61.9 | 7.2 | 1703 | 159k | -3.97 | -2.90 | -3.11 | 71 |
| ETH A | -91.7 | -81.9 | 9.9 | 2348 | 219k | -4.09 | -2.43 | -2.49 | 93 |
| ETH B | -59.2 | -49.0 | 10.3 | 2467 | 228k | -2.88 | -2.12 | -1.61 | 62 |
| ETH C | -84.0 | -76.4 | 7.8 | 1848 | 174k | -5.19 | -3.22 | -3.39 | 86 |
Totals over three windows: BTC -114.3 on 1.09M notional (-1.05 bps/notional), ETH -234.8 on 0.62M (-3.78 bps). Final MTM of open inventory ~$0 (replay ends nearly flat; invStd ~$105-117 vs $500 cap). Fees/loss: 12-30 / 66-114 (BTC), 8-10 / 59-92 (ETH).
- Interpretation of the decomposition (per notional): spread captured vs mid at fill time ~0 (fill requires price to travel to the quote); adverse selection/markout -1 to -5 bps at 1 min; fee -0.45 bps. Realized gross PnL per notional (BTC A) -1.95 bps vs m1 -3.16, m5 -1.14: consistent with 1-5 min markout.
- Markouts get worse as the quote gets wider in the 4-20 bps range (BTC A: min4 m1 -3.2, min8 -4.5, min12 -6.4, min20 -10.7): wider sweeps = more informed/momentum flow. Loss falls only because fills fall (fees and fill count drop faster than markout worsens).
- Regime dependence: the same code is +$21 in the chop month (B, drift -3.5%) and -$66 in the trending months. Trend windows have m1 -3 to -4 bps; chop +0.3.
- Print-chain replay (scratch/run5.ts, quote priced off the previous print, i.e. ideal continuous requoting, 1 s timestamps): still negative everywhere: BTC Apr -294 (min4), May -263, Jun -205; ETH Apr -331, May -368, Jun -278 (min4); min12 reduces losses to -145/-202/-136 BTC and -147/-239/-217 ETH. Markouts -0.3 to -3 bps (BTC), -2 to -3 bps (ETH). It is a crude bound (staleness = previous print up to minutes old) but it shows the sign does not depend on the 1-minute-quote artifact.
- Paper-mainnet fills (monday-paper-mainnet.sqlite, 24 rows / 20 unique, 3 concurrent paper users, 2026-10-06 06:10-12:53 UTC): BTC 9, ETH 11, SOL 0; notional $1,438; fees $0.065; realized $0.28; notional-weighted markout 1m -1.54 bps, 5m -1.94 bps (BTC -0.59/-1.65, ETH -2.35/-2.19); by side bid -2.87/-3.94, ask -0.47/-0.34; calm regime fills -2.70/-4.51 (13 fills), active +1.07/+3.82 (7 fills); 1s/5s/10s markouts for the 12:17 ETH bid cluster -2.0 to -3.5 bps, 1m -5.4 to -7.6, 5m -7.9 to -9.1 (bids filled into a dump); half_bps recorded only for those fills (4.45 and 7.3). Session PnL on $1000 about -$0.5 (unrealised -0.50, realized -0.05 to +0.30, fees 0.01-0.04). n is far too small to conclude anything; and the paper fill rule biases to full-cross (toxic) fills.
- Governor activity (paper decisions): 1211 decisions, 849 of them 'reflex' events (BTC 254, ETH 286, SOL 309), governor/fallback outputs mostly spread_mult 1.5-3.5 and size_mult 0.2-0.8 in active/storm/stale; SOL regime mostly 'calm' mult 1-2.
- Funding: decision-time funding rates in [-0.00004, +0.00004] (~0.4 bp), irrelevant for $500 inventory over hours.

### Inferences
- The leak is adverse selection on the sweep-only fills, not fees or inventory. Anything that reduces fills in the 4-12 bps zone reduces loss mechanically; to be profitable the strategy needs either (i) fills where markout > 0.45 bps, or (ii) the rare extremely wide quotes (see Q5 a>=3) whose fills mean-revert.
- Calm-regime fills are not safer than active ones in paper (-2.7 vs +1.07 bps, tiny n) and calmOnly gating in replay changes nothing (-68 vs -66), because the volatility regime from `regimeOf` is nearly always calm when S=0.

### Gaps
- No spread/markout decomposition for SOL (no tape). No Nansen-aware replay (no price tape in the Nansen window). No live-venue fills at all.

## 4. Does the Nansen smart-money signal predict price on 1-15 minutes? What does the evidence code conclude (nansenK)?

### Takeaway
No measurable predictive power in the stored 6.3 days; ETH shows a statistically significant NEGATIVE (contrarian) relation. The signal machinery also produces absurd z-scores (|S| p99 ~50 on BTC/ETH, up to 46,000 on SOL), putting BTC/ETH/SOL in "storm" 15%/29%/8% of minutes. nansenK would be 0 for BTC, ETH, SOL under the PRD rule, so Nansen contributes only through regimes and reflex.

### Cited Findings
- nansenK(sym) = k=1.5 only if `rho(z15, fwd15m) > 0 && CI low > 0`, else 0 — [evidence.ts:22,67](apps/server/src/evidence.ts). Single hypothesis test, no multiple-testing correction; study uses non-overlapping samples and a day-boundary rolling baseline — [evidence.ts:24-74](apps/server/src/evidence.ts).
- Data: nansen_trades union of the 3 DBs: BTC 778 trades ($95M gross), ETH 722 ($87M), SOL 1693 ($52M), 2026-09-30 05:10 to 2026-10-06 ~14:00 UTC; 87%+ labelled "HL Perps Whale"/referral-code labels; BTC activity in only 324 of 9171 minutes; buy share by value 44% BTC, 41% ETH, 52% SOL; median trade $20k BTC / $12k ETH / $8k SOL, p90 ~$300k, max $4.7M. Live polling lag median ~100-125 s (n=43-49 live samples; most rows were backfilled, whose lag is days).
- Price proxy used: Nansen's own `price_usd` (Hyperliquid execution price) carried forward per minute (scratch/run3.ts); this is a sparse series, so returns are noisy and often 0. Evidence-style Spearman, non-overlapping, bootstrap CI:
  - BTC: z5->5m rho 0.016 [-0.05,0.09] n=1545; z5->15m -0.015 [-0.11,0.09]; z15->15m 0.051 [-0.04,0.14] n=515; z60->60m 0.026 [-0.19,0.17].
  - ETH: z5->15m -0.149 [-0.26,-0.03] n=506; z15->5m -0.154 [-0.28,-0.03]; z15->15m -0.089 [-0.19,0.01]; z60->5m -0.355 [-0.46,-0.21] n=127; z60->15m -0.275 [-0.44,-0.07]. 
  - SOL: z5->15m 0.022 [-0.09,0.13]; z15->15m -0.006 [-0.10,0.09]; z60->5m -0.169 [-0.31,-0.03].
  - |z5|>2.5 events (overlapping, n=61 BTC/61 ETH/35 SOL): mean signed forward return BTC +1.9 bps @5m, +1.3 @15m; ETH -2.0 / -4.0; SOL -1.8 / -3.6 bps. (My hit-rate numbers are not usable: zero-return minutes count as misses.)
- Signal regime frequencies, recomputed with the evidence/collector rules on the real flows (scratch/run3.ts, after 1-day warm-up): |S|>=2.5 "storm" BTC 15.2%, ETH 28.8%, SOL 8.2% of minutes; 1<=|S|<2.5 "active" 9.2/7.5/1.1%; z5>2.5 (pull trigger) 3.9/4.0/2.5% and widen band 0.8/1.7/0.1%; |S| p90 5.2/10.3/0.7, p99 50/54/1854, max 99/153/46,150. In the live paper sampler (2h), BTC |S| p50 12.1, p90 24.3; regime = storm in 79 of 121 BTC samples and 54 of 121 ETH samples; reflex active in 30 BTC samples (25%).
- Cause: robustScale falls back to 1.2533*mean-absolute-deviation when MAD=0 (sparse flow, 7-day baseline mostly zeros) — [signal.ts:35-43](packages/core/src/signal.ts); one $2-5M trade is ~30-50 "sigma"; z60 window keeps S large for an hour. regimeOf and the 'storm' trigger use the UNCLAMPED S (`a >= cfg.z2`) while only the skew clamps S to +-3 — [strategy.ts:201-207,111](packages/core/src/strategy.ts); compositeS weights 0.5/0.3/0.2 — [signal.ts:58](packages/core/src/signal.ts).
- tradeSign mapping (the Oct-6 fix) is logically right: Open/Add Long = buy, Open/Add Short = sell, Reduce/Close Long = sell, Reduce/Close Short = buy — [signal.ts:12-18](packages/core/src/signal.ts). Mixed 'Reduce Long' dominance (1115+ of 3079 testnet rows) means flows are mostly position unwinds by whales, not new directional bets.

### Inferences
- With ETH's significantly negative relation, "lean with the flow" (k>0) would lose on ETH; the evidence gate (needs rho>0 and lo>0) correctly keeps k=0 on all three. Reflex 'pull ask after smart-money BUY' is a protective rule, and my data cannot show it protects (pull events carry +1.9 BTC and -2 to -4 bps ETH/SOL "signed" 5-15m returns, mostly noise).
- Regime/reflex logic is driven by an inflated, heavy-tailed S, so Monday sits in 2.5x-wide, 0.4x-size mode for 15-29% of the time (and in sampled hours >50%) with no demonstrated information content; it reduces losses only by trading less.

### Gaps
- No Perpl or HL tick/1-min series for the Nansen window; the proxy series is sparse (BTC trades in 3.5% of minutes) so power is limited (n=127-515 non-overlapping samples). The evidence page itself (computed live, not stored) could not be rerun offline.

## 5. Which parameter changes would most plausibly improve PnL, and what did a quick replay sweep show?

### Takeaway
Within this model the only change that flips the sign is a much larger volatility multiplier a (half-spread = 3-8x EWMA sigma1m, i.e. ~10-30 bps) — which cuts fills by 85-95% and leaves a few dollars per quarter. Tighter spreads and larger size lose more; stronger inventory skew loses more; calm-only gating does nothing; momentum guards help modestly.

### Cited Findings
All below: scratch/run2.out, run6.ts, run7.ts; replay on real mainnet tape Apr 1-Jun 16 2026 (3 windows), Balanced base, Nansen off. $ PnL, $100 quotes / $500 cap.
- Spread floor (BTC window A/B/C): min2 -73/+18/n.a.; min4 -66.5/+21.3/-69.0; min8 -44.2/+28.7/-53.0; min12 -39.7/+25.1/-46.9; min20 -21.2/+38.1/-20.8. ETH min4/-8/-12/-20 window A: -91.7/-70.2/-57.1/-40.5; B -59.2/-50.8/-46.6/-31.9; C -84.0/-65.2/-61.9/-40.8. Wider is monotonically less bad but never clearly positive on ETH.
- Volatility multiplier a (half-spread = max(minHalf, a*sigma)): total over 3 windows, BTC: a1 -114.3 (11.7k fills, 1.09M notional); a3 +26.1 (1386 fills, 131k, m1 +0.8 bps); a4 +39.2 (826 fills, 77k, +5.1 bps/notional, m1 +4.5); a6 +52.3 (423 fills, 39k, m1 +13.5); a8 +60.6 (282 fills, 26k, m1 +24). ETH: a1 -234.8; a3 -11.5; a4 +9.5; a6 -5.4; a8 +3.0; a4 with gamma 0 +55.8 (noisy). Positive in 3/3 BTC windows for a>=4 (A +0.9, B +31.7, C +6.7), mixed on ETH. Fills at large distances mean-revert (liquidation overshoots) while fills at 4-12 bps continue (momentum).
- Inventory skew gamma: BTC A gamma0 -56.7, gamma1 -66.5, gamma2 -78.4, gamma3 -85.5; ETH B gamma0 -28.0, gamma1 -59.2, gamma2 -65.1. Stronger skew shrinks invStd ($195 -> $68) but raises fills and loss; weaker skew is better in the replay (note the cap still bounds risk).
- Size: size25 cuts BTC A loss from -66.5 to -18.4 and ETH A from -91.7 to -27.1 (loss scales with size; per-notional unchanged); size300/inv1500 loses -199 in BTC A. Size is linear leverage on a negative edge.
- calmOnly (skip non-calm regimes): -68.2 vs -66.5 (BTC A): no effect without Nansen.
- Fill-realism haircuts: through 1 bp -73.5 (BTC A) / -28.5 (B) (queue/latency proxy, loss up); fillProb 30% random: BTC -10.7/-6.0/-6.1, ETH -33.3/-7.1/-26.3: a random 70% blackout removes ~80% of the loss — evidence that regime/reflex gating wins by trading less, not by timing.
- Momentum guard (no bid when trailing 5m return < -g bps, no ask when > +g): BTC total -114.3 -> -92.7 (g=3, 5m) to -109.9 (g=10); ETH -234.8 -> -176.6 (g=3, 15m). Modest, consistent across g, loses beyond g=20. With min8 + 5m guard 6: BTC -60.7, ETH -143.9 (totals).
- Not testable (no data): fair value from Hyperliquid mid (blend 0.5 is already the default but unvalidated), book-imbalance reflex, size cap, quoting one market. Single-market argument from numbers: ETH loses 2-3x BTC per notional (-3.8 vs -1.05 bps), so drop ETH/SOL first; SOL has no data.

### Inferences (code-level hypotheses to flip PnL positive, ranked)
1. Re-parameterise the vol term: set `a` in [strategy.ts:103](packages/core/src/strategy.ts) to ~3-4 (or an absolute floor ~12-20 bps) for BTC/ETH on Perpl, i.e. only get filled when a move is large; expect ~5-10 fills/day/market and +1-5 bps/notional, i.e. cents to a couple dollars per day at $100 quotes. Positive but not material; validate on paper with HL data first.
2. Do not quote through trending moves: add the momentum guard into computeQuotes input (needs `ret5m`), test g=3-6 bps; trend months account for all losses (A, C vs B).
3. Quote at the touch only with a real rebate; with 0.45 bps maker fee and a 1-tick BTC book the structural edge is negative (0.9 bps round trip vs 0.01 bps spread); inside-the-spread quoting is only viable on SOL (9 bps book) where Monday already sits ~1 bp behind best.
4. Reduce size/leverage until edge is shown: loss scales with quoteSizeUsd, so High 10x preset multiplies fees and sweep losses ([types.ts:34](packages/core/src/types.ts)).
5. Remove or downweight the Nansen S-driven regimes until z-scores are bounded (clamp |z| <= 5, or require a trade-count/value floor); they currently add a ~1/4-1/2-of-the-time widen with no evidence of value. Use time-of-day/vol regimes instead (calm-vs-trend splits from replay).
6. Collect and store 1 s HL mid + Perpl book to test the blend/lead-lag (the one mechanism that could avoid sweep losses); the existing Perpl tape shows fills are dominated by informed sweeps.

### Gaps
- Replay dollar edges are small relative to noise: single month windows swing sign (BTC B +21 vs A -66). a>=4 results rest on 80-800 fills per 3 months; no out-of-sample split. Tape covers Perpl's earlier, thinner market, not the Oct 2026 microstructure; do not extrapolate magnitudes.

## 6. Bugs and modelling errors that could by themselves cause losses

### Takeaway
No single arithmetic bug explains the loss; the loss is structural (sweep-only fills). Real defects: unbounded z-scores driving regimes, a 1-minute stale-quote replay, a paper filler that fills only on full cross, and several untested features.

### Cited Findings
- Unbounded/heavy-tailed S feeds regime selection and reflex triggers (z up to 46,150 on SOL; see Q4) — [signal.ts:35-43](packages/core/src/signal.ts), [strategy.ts:204](packages/core/src/strategy.ts). Effect: 15-29% (BTC/ETH) of minutes in 'storm' (spread x2.5, size x0.4) plus a 5 min reflex hold after each trigger ([strategy.ts:154-164,182-199](packages/core/src/strategy.ts)); reflex active in 25% of BTC samples and 849 reflex decisions in 8 h on paper.
- Replay quote staleness (priced at the candle open, fixed for 60 s) while live requotes within 1.5 s — [evidence.ts:110-119](apps/server/src/evidence.ts) vs [runner.ts:21,458](apps/server/src/runner.ts). Fill-count inflation and a 1-minute fill rule on flat-filled candles (BTC median 1m range 0.00 bp on tape-derived candles); markouts are unweighted (1m avg -3 bps per fill vs weighted).
- Evidence replay uses `POLICY = PRESETS.balanced` regardless of the user's preset (High 10x, Conservative) — [evidence.ts:17](apps/server/src/evidence.ts); replay omits preTradeReject, daily-loss kill, max-inventory enforcement (inventory only limited by size shrink), HL blend, book skew, participation cap (strategy.ts additions), session SL/TP — [runner.ts:563-564](apps/server/src/runner.ts). So the shipped "evidence" cannot validate the newer features.
- Paper filler: fills only when the opposite best reaches the quote, whole size, in a 250 ms poll — [paper.ts:19-30](apps/server/src/venue/paper.ts); duplicates in the paper DB are separate users (4 pairs), not a bug. Systematically excludes passive fills (no prints modelled) and over-represents full-spread moves; do not read paper markouts as expected live markouts.
- Single-hypothesis event-study gate (15m/15m, rho>0 and CI>0) with ~500 non-overlapping samples and a nonstandard sparse z; Monday-vs-naive replay compared with no random-gating baseline (fillProb 30% performs similarly) — [evidence.ts:67,107-113](apps/server/src/evidence.ts).
- Fee model flat at 0.45/3.45 bps for every market and account tier — [sim.ts:14-16](apps/server/src/venue/sim.ts); real maker fee on tape averaged 1.3-2.8 bps in Mar-Jun and 0.49 in Oct; emergency flatten pays taker 3.45 bps + 2 bps slippage — [sim.ts:57-64](apps/server/src/venue/sim.ts).
- Sign conventions checked and consistent: tradeSign, markoutBps (positive = good for maker) — [strategy.ts:245-248](packages/core/src/strategy.ts); skewInv sign (long pushes quotes down) correct; reflex pulls the ask on smart-money buys (protective) correct as designed. preTradeReject one-sided ('grows' only) correct — [strategy.ts:259-266](packages/core/src/strategy.ts).
- Inventory-skew design: at |q|=1 the reducing quote sits at ref (zero edge, -0.45 bps fee) and quote size on the growing side goes to 0; the cap is enforced both by size and by preTradeReject, so there is no runaway inventory in replay (invStd ~$110, max DD $60-90 per $100 quotes per month, i.e. ~13-20% of the $500 cap).
- Stale/other data: sigma1m is EWMA of minute log returns (p50 3 bps, p10 0.0 when mark is sticky) so for BTC `a*sigma` rarely exceeds the 4 bps floor; the effective half-spread is mostly the floor times spread_mult.

### Inferences
- The pipeline is internally consistent but its offline evidence cannot detect the main economic problem (fills are mostly informed sweeps) because it counts both fill count and spread edge optimistically and has no random-gating control.
- Biggest practical code defects to fix: clamp/stabilise S, add a gating control (random 30% blackout) to the evidence page, make evidence use the user's preset and a requote-aware fill model, and replace the paper fill rule with print/trade-through logic.

### Gaps
- Could not verify Perpl order-execution latency or cancel races (no live fills). Could not test newer features (HL blend, book imbalance, SL/TP, 10x) for lack of data.
