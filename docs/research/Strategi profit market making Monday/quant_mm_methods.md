# Quantitative methods for profitable small-scale limit-order-book market making (crypto perps)

Reliability note: several arXiv IDs returned by search (26xx.xxxxx) look future-dated relative to my knowledge; I treat them as "found by search, content only as summarised by fetch". The perp "Optimal Adaptive Market Making" paper (2607.11888) gave only vague summarised results; treat as LOW reliability. Items marked (bg) are from my background knowledge, not verified this session.

## 1. Optimal quoting models (A&S, GLFT, Cartea-Jaimungal) and calibration of gamma, A, k, sigma

### Takeaway
A&S gives reservation price r = s - q*gamma*sigma^2*(T-t) and a spread; GLFT removes the finite horizon and adds hard inventory bounds with closed-form asymptotic quotes, which suits a perpetual bot. Fitting k (and A) is noisy in practice; practitioners simplify to sigma-scaled spread plus a base spread and inventory skew. These models are theory; the only live-trading crypto evidence found shows naive quoting loses money unless adverse selection is handled.

### Cited Findings
- A&S (via Hummingbot): reservation price r(s,q,t,sigma)=s-q*gamma*sigma^2*(T-t); total spread delta_a+delta_b=gamma*sigma^2*(T-t)+(2/gamma)*ln(1+gamma/kappa). — [Hummingbot deep dive](https://hummingbot.org/blog/technical-deep-dive-into-the-avellaneda--stoikov-strategy/)
- Hummingbot parameterises gamma from a user min/max spread: gamma <= (max_spread - min_spread)/(2|q|sigma^2), scaled by an "inventory risk aversion" coefficient in 0-1; kappa is backed out from the desired initial spread; order size shape factor eta = 1/q_decay. When IRA->0 the spread around mid becomes fixed (plain symmetric MM). The original finite T is handled by periodic recalibration for perpetual bots. — [Hummingbot deep dive](https://hummingbot.org/blog/technical-deep-dive-into-the-avellaneda--stoikov-strategy/)
- GLFT assumes exponential arrival intensity lambda(delta)=A*exp(-k*delta) on each side. Quotes: delta_b*(q)=(1/k)ln(v_q/v_{q+1})+(1/gamma)ln(1+gamma/k) (as transcribed by the source; the fetched text wrote 1+gamma*k, which is probably a transcription slip, the original paper uses gamma/k), with v_q solving a linear ODE system. Long-horizon asymptotics: delta_b ~ (1/gamma)ln(1+gamma/k) + (2q+1)/2 * sqrt[sigma^2 gamma k / (2A(1+gamma/k)^{1+k/gamma})]; ask symmetric with -(2q-1)/2. Hard bound Q: no bid at q=Q, no ask at q=-Q; spread widens as |q|->Q. — [GLFT summary](https://grokipedia.com/page/GuantLehalleFernandez-Tapia_model); paper: [Springer](https://link.springer.com/article/10.1007/s11579-012-0087-0). (Grokipedia is a tertiary source; verify constants against the paper before coding. The "2A" inside the sqrt (bg) is in the original; the fetched summary omitted it.)
- Practitioner critique: "fitting kappa is ridiculously noisy"; a simplified scheme r = s - q*sigma, delta = lambda*sigma + B (base spread B read off the book, lambda tightness) is used instead. No backtest given. — [HangukQuant](https://www.research.hangukquant.com/p/dummy-stoikov)
- Cartea-Wang "Market making with alpha signals": the maker uses a short-term alpha (momentum) signal to minimise adverse selection cost, take directional positions and manage inventory. — [World Scientific](https://www.worldscientific.com/doi/10.1142/S0219024920500168). Cartea-Jaimungal-Ricci: limit orders posted while modelling the impact of market orders on short-term drift, updated with order arrivals, inventory and alpha. (search summary only) 
- Directional-bets extension of GLFT-type models is in [arXiv 1206.4810](https://arxiv.org/pdf/1206.4810) (fetch failed to parse; content not verified).
- Perp-specific paper claims Spread = 2*lambda*(sigma^2 + adverse-selection cost), A estimated from bid-ask bounce/flow correlation, vol lookback 60-300 s, Sharpe 1.8-2.3. — [arXiv 2607.11888](https://arxiv.org/pdf/2607.11888) (low reliability, theoretical framework, summary only).

### Inferences
- (bg) Practical calibration of A,k: for each side, bucket distance-from-mid of resting/touched price levels, record the arrival rate of trades that reach that depth per second, regress ln(lambda) on delta -> intercept ln A, slope -k. Re-fit on rolling 15-60 min windows; clamp k to a sane range because the fit is noisy.
- With a 1 s tick, sigma should be a per-second EWMA of mid log-returns (or microprice returns), converted to the horizon used; use GLFT asymptotic (no T) so no schedule/recalibration artefacts.
- Simplest robust rule consistent with sources: half-spread = max(fee-aware floor, c1*sigma + adverse-selection term), reservation = fair - gamma-skew*q. Treat gamma as a tunable inventory-skew gain, not a utility parameter.

### Gaps
- Could not read Cartea-Jaimungal-Penalva book content or the Cartea-Wang results with numbers; no PnL improvement figures for alpha-augmented quoting found.
- No verified published calibration protocol for A,k on crypto perps beyond Hummingbot heuristics.

## 2. Adverse selection control (markout, microprice, OFI, VPIN, when to pull quotes)

### Takeaway
The single strongest crypto-perp evidence found: a live Binance BTC perp experiment where naive resting maker orders lost heavily; fills are negatively correlated with post-fill returns, and back-of-queue fills are 0.7-1.2 bp worse than front-of-queue. Order-book imbalance/OFI are real short-horizon predictors; VPIN is contested and should not be relied on.

### Cited Findings
- Live experiment, Binance BTC perpetual, 12-19 Feb 2024: 232,897 minimum-size maker orders, 127,051 filled (54.6%). Basic MM strategy lost about 60% in 3.2 days (Sharpe -109). 1 s markout of fills was negative in all queue/imbalance states: e.g. -0.058 bp (front queue, favourable imbalance) vs -0.775 bp (back); both queues large -0.296 vs -1.157 bp; adverse imbalance -0.539 vs -0.763 bp. Fill probability model R^2 0.946 on queue sizes and imbalance (30% to 90%+ fill probability). Taker imbalance strategy: ~+1 bp pre-fee, wiped out by 1.5 bp/leg taker fee; maker variants -0.43 to -0.49 bp mean. Profit requires identifying "reversals" where adverse imbalance does not predict the next move. — [Market Maker's Dilemma](https://arxiv.org/html/2502.18625v2)
- Markout definition: fill price vs mid at a later interval; a bid fill is adversely selected if mid then falls. Under zero-fee regimes the binding constraint for makers is adverse selection. — [search summary, arXiv 2608.04373](https://arxiv.org/html/2608.04373v3)
- Cont-Kukanov-Stoikov: over short intervals price changes are mainly driven by order flow imbalance at the best quotes, linear relation with slope inversely proportional to depth (price impact ~ 1/(2D)); robust across stocks and time scales (equity data; R^2 values not retrieved). Useful for the next few seconds, loses linearity at long horizons; top-of-book only; naive profitability reduced since publication. — [arXiv 1011.6402](https://arxiv.org/pdf/1011.6402), [QuantMemo](https://quantmemo.com/writing/paper-cont-kukanov-stoikov-order-flow-imbalance)
- Stoikov micro-price: long-run conditional expectation of the mid given the book state; a martingale, less noisy than weighted mid, empirically a better predictor of short-term prices than mid or weighted mid. — [Quantitative Finance 2018 via Semantic Scholar](https://www.semanticscholar.org/paper/The-micro-price:-a-high-frequency-estimator-of-Stoikov/cda92a8a407841f6e2c56823c8659d0ff56b0308). A BitMEX calibration implementation exists using a Markov chain on book state: [grayvalley/microprice-calibration](https://github.com/grayvalley/microprice-calibration).
- BTC perp study: recent sell pressure relative to best-bid depth predicts lower short-horizon returns and higher passive-buy adverse selection; a flow-adjusted absorption proxy beats raw directional flow. — [SSRN 6693260](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6693260) (abstract-level)
- Binance Futures 1 s data 2022-2025: same order book features show similar predictive importance across assets. — [arXiv 2602.00776](https://arxiv.org/abs/2602.00776)
- VPIN: Andersen-Bondarenko find it is a poor short-run volatility predictor, its content is mostly mechanical relation to trading intensity, and results depend heavily on trade classification. — [Aarhus WP](https://pure.au.dk/ws/files/68359010/rp13_43.pdf); controversy: [Reflecting on the VPIN dispute](https://www.researchgate.net/publication/264003763_Reflecting_on_the_VPIN_dispute)
- Larger-trade markouts: after controlling for size/vol/spread, markouts are flat until the top ventile then 3.11 bp in the top ventile (adverse selection concentrated in large aggressors). — [arXiv 2608.04373](https://arxiv.org/html/2608.04373v3) (search summary)

### Inferences
- (bg) Implementable 1 s features: weighted mid I*Pa+(1-I)*Pb with I=Qb/(Qb+Qa) as cheap fair value, upgraded to micro-price via an empirical g(I,spread) table fitted on stored snapshots; OFI = sum over events of (bid-size increases at best bid or price up) minus (ask equivalents), 1-5 s window, normalised by depth. Shift reservation price by beta*OFI (beta fitted by regression of next-1-5s mid change on OFI/depth).
- Pull/widen a side when: OFI strongly against that side, trade-sign run on the opposite aggressor, realised 1 s markout of recent fills on that side is below -spread/2, or sigma spikes. Calibrate with your own fills' markouts at 1/5/30 s per side; this is the feedback loop most retail bots lack.
- Trade-sign autocorrelation and Kyle lambda: no sources retrieved; (bg) both are cheap to compute from the public trade tape and are better-established than VPIN.
- Evidence of PnL improvement quantified in published form is thin: the only hard number is the queue/imbalance markout table above (differences of ~0.2-1 bp), which is the same order as maker fee/rebate.

### Gaps
- No peer-reviewed numbers on the PnL uplift from microprice-based quoting on crypto perps.
- No crypto-specific VPIN or trade-sign autocorrelation results retrieved.
- OFI regression R^2 values not retrieved.

## 3. Queue position and tick size

### Takeaway
Queue position is worth a large share of the spread on large-tick books and strongly reduces adverse selection; on small-tick books priority is bought by improving the price by one tick instead. Evidence for crypto perps: queue front vs back differs by ~0.7-1.2 bp in markout.

### Cited Findings
- Moallemi-Yuan: when tick size is small relative to price, traders obtain priority by slightly improving price; when ticks are economically significant, queue position matters and traders prefer to wait. For some large-tick stocks queue value is the same order as the bid-ask spread. Good queue position lowers adverse selection because back-of-queue orders fill mainly against large trades, front orders against the next trade of any size. — [Moallemi slides](http://market-microstructure.institutlouisbachelier.org/uploads/91_7%20MOALLEMI%202014-12-paris-mm-queue-value.pdf), [paper](https://moallemi.com/ciamac/papers/queue-value-2016.pdf)
- Binance BTC perp: back-of-queue fills 0.7-1.2 bp worse than front-of-queue, with up to 2.2 bp vs 0.8 bp std dev; fill probability driven by queue sizes and imbalance. — [Market Maker's Dilemma](https://arxiv.org/html/2502.18625v2)
- Microprice: when ticks are large relative to the local price scale, depth asymmetry maps more directly into the next price change. — [search summary of SSRN/arXiv items](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6693260)
- Limit order placement with adverse selection and latency role: [arXiv 1610.00261](https://arxiv.org/pdf/1610.00261) (not read in detail).

### Inferences
- A 1 s bot cannot win queue priority races; its edge is not cancelling/re-posting at the front (losing queue priority is costly), so re-quote only when fair value moves by more than a threshold (hysteresis of ~0.5-1 tick) rather than every tick. This also saves the ~40 orders/min budget.
- On a one-tick-wide book: join the touch only when imbalance/OFI favourable and queue ahead is small; otherwise rest 1 tick behind (accept lower fill probability). Improving by a tick on a one-tick spread would cross.
- Cost of losing the queue = (queue value) ~ fraction of spread; do not cancel for tiny signal changes.

### Gaps
- No Perpl-specific tick-size/queue data (out of scope for sources found). No numeric estimate of queue value in bp for crypto perps beyond the 0.7-1.2 bp markout gap.

## 4. Inventory management

### Takeaway
Skew reservation price and sizes by inventory, enforce hard bounds (GLFT Q), and treat inventory as the main source of variance. I found no rigorous published quantification of PnL-variance/drawdown reduction on crypto perps.

### Cited Findings
- Hummingbot lists tools: inventory skew (smaller orders on the heavy side), filled-order delay, hanging orders, ping-pong (only quote opposite side after fill), asymmetric spreads; no numeric thresholds. Inventory risk is greatest in trending markets (buys fill while asset falls). — [Hummingbot inventory risk](https://hummingbot.org/blog/what-is-inventory-risk/), [skew config](https://hummingbot.org/strategies/v1-strategies/strategy-configs/inventory-skew/)
- GLFT: hard inventory bound with quote blocking at +/-Q and spread widening near the bound. — [GLFT summary](https://grokipedia.com/page/GuantLehalleFernandez-Tapia_model)
- Practitioner survey claim: on a retail bot, balanced fills occur ~30-40% of time, 30-40% one-sided (accumulating inventory at wrong prices), 20-40% no fills; (low-grade blog, unverified). — [search snippet, Poly Syncer / Medium](https://www.polysyncer.com/blog/polymarket-market-making-bot)

### Inferences
- On a perp the inventory is a position: hedging on another venue is impractical for a single-venue bot, so the hedge is the reduce-only unwind: widen/skew the reducing side, and cross the spread only when |q| hits a hard limit or a stop-loss. Funding cost on held inventory is a further reason to target q=0 (bg).
- Skew shift per unit inventory should be of order sigma-scaled (gamma*sigma^2*horizon); for a 1 s bot choose horizon ~ 30-120 s so a full-limit position shifts quotes by about one half-spread.

### Gaps
- No empirical study found quantifying variance/drawdown reduction from skew vs none, or cross-venue hedging on crypto.

## 5. Spread/size selection, regime filters, time in market

### Takeaway
Quote only when expected capture (half-spread + rebate) exceeds expected adverse selection plus fees; rebates of 1-3 bp can decide the sign. Hard published numbers on professional time-in-market were not found.

### Cited Findings
- On rebate campaigns maker rebates add 1-3 bp on filled notional; expected rebates should enter quote economics. — [search snippet, Poly Syncer](https://www.polysyncer.com/blog/polymarket-market-making-bot) (weak source)
- Per-fill adverse selection decomposes into an informed component (P(informed)*impact) and a latency component (latency-arb intensity x vol x cancel latency). — [search snippet, arXiv 2607.11888](https://arxiv.org/pdf/2607.11888) (low reliability)
- Hummingbot A&S: vol_to_spread_multiplier recalibration for rapid crypto volatility swings; min_spread/max_spread bounds. — [Hummingbot deep dive](https://hummingbot.org/blog/technical-deep-dive-into-the-avellaneda--stoikov-strategy/)
- Taker-fee context: 1.5 bp/leg on Binance futures experiment erased a +1 bp signal; maker markouts were -0.4 to -0.5 bp net. — [Market Maker's Dilemma](https://arxiv.org/html/2502.18625v2)

### Inferences
- Quote condition per side: E[capture] = half_spread + rebate - fee; E[AS] = fitted from own 1-5 s markouts conditional on (imbalance bucket, sigma bucket, queue position). Quote iff E[capture] - E[AS] > threshold; size proportional to margin. Implementable as a lookup table updated online.
- Regime filters: realised-vol percentile, trade-intensity spikes, spread blowouts, funding/news windows, stale data feed or latency (stop quoting if tick latency > X). Fraction of time quoted by professionals: no source found; do not assume.

### Gaps
- No source for what fraction of time professional makers quote; no news/trend filter evidence for crypto.

## 6. Why small retail/open-source MM bots lose, and fixes

### Takeaway
Evidence points to: back-of-queue adverse fills, static spreads and symmetric quotes, no markout feedback, fees larger than edge, inventory build in trends. Fixes are the items above.

### Cited Findings
- Naive Binance BTC perp maker lost ~60% in 3.2 days; fill likelihood is negatively correlated with post-fill returns (you get filled when you are wrong). — [Market Maker's Dilemma](https://arxiv.org/html/2502.18625v2)
- Hummingbot: market makers lose to informed traders and recoup by spread; inventory risk is the main risk; mitigations listed in section 4. — [Hummingbot PMM](https://hummingbot.org/strategies/v1-strategies/pure-market-making/), [inventory risk](https://hummingbot.org/blog/what-is-inventory-risk/)
- Parameter noise: kappa fitting unreliable; practitioners hand-set base spread. — [HangukQuant](https://www.research.hangukquant.com/p/dummy-stoikov)
- A&S in Hummingbot assumes finite horizon and needs recurring recalibration; static spreads ignore volatility swings. — [Hummingbot deep dive](https://hummingbot.org/blog/technical-deep-dive-into-the-avellaneda--stoikov-strategy/)

### Inferences
- Prioritised fix list for a 1 s Node bot: (1) log every fill with 1/5/30 s markouts and fit AS per state; (2) fair value = micro/weighted mid, not mid; (3) skew by inventory with hard cap and widen near cap; (4) only re-quote on threshold moves to keep queue and the 40 req/min budget; (5) per-side pull on adverse OFI/vol spikes; (6) quote only when capture exceeds AS + fee; (7) paper-trade with queue-aware fill simulation before mainnet (user memory: mainnet real funds).
- Caveat: backtests that assume mid-price fills overstate PnL; fills must be simulated with queue position.

### Gaps
- No academic study of retail MM bot performance (Hummingbot users) found; only blogs. Hummingbot publishes no aggregate PnL stats in sources retrieved.
