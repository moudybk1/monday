import type { PxWallet } from '@monday/core';

// What stands out about a wallet, in plain sentences, from its own numbers. Rules, not a model: every line can be
// checked against the figures on the page. ponytail: eleven rules; a language model over the same facts if judges want more.

export interface Insight { tone: 'good' | 'bad' | 'neutral' | 'warn'; text: string }

const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function walletInsights(w: PxWallet): Insight[] {
  const p = w.performance;
  const out: Insight[] = [];
  if (p.closes < 5) {
    out.push({ tone: 'neutral', text: p.trades ? `Only ${p.closes} closing fill${p.closes === 1 ? '' : 's'} so far: too few to judge a style.` : 'No indexed fills yet.' });
    return out;
  }
  const maker = p.volumeUsd ? p.makerVolumeUsd / p.volumeUsd : 0;
  if (maker >= 0.7) out.push({ tone: 'neutral', text: `Trades like a market maker: ${pct(maker)} of volume was made, not taken, across ${p.trades.toLocaleString('en-US')} fills.` });
  else if (maker <= 0.2) out.push({ tone: 'neutral', text: `Takes liquidity: ${pct(1 - maker)} of volume crossed the spread and paid taker fees.` });

  const wr = p.winRate ?? 0;
  if (p.profitFactor != null && p.avgWinUsd != null && p.avgLossUsd != null) {
    if (wr >= 0.5 && p.profitFactor < 1) out.push({ tone: 'bad', text: `Wins ${pct(wr)} of closes but still loses money: the average loss (${usd(p.avgLossUsd)}) is ${(p.avgLossUsd / Math.max(p.avgWinUsd, 1e-9)).toFixed(1)}x the average win (${usd(p.avgWinUsd)}).` });
    else if (wr < 0.5 && p.profitFactor > 1) out.push({ tone: 'good', text: `Wins only ${pct(wr)} of closes yet comes out ahead: winners average ${usd(p.avgWinUsd)} against ${usd(p.avgLossUsd)} per loser.` });
    else if (p.profitFactor >= 1.5) out.push({ tone: 'good', text: `Profit factor ${p.profitFactor.toFixed(2)}: ${usd(p.grossWinUsd)} won for every ${usd(p.grossLossUsd)} lost.` });
    else if (p.profitFactor < 0.8) out.push({ tone: 'bad', text: `Profit factor ${p.profitFactor.toFixed(2)}: losses outweigh wins by ${usd(p.grossLossUsd - p.grossWinUsd)} over the indexed fills.` });
  }

  if (p.largestLossUsd > 0 && p.grossLossUsd > 0 && p.largestLossUsd / p.grossLossUsd >= 0.25) out.push({ tone: 'warn', text: `One fill lost ${usd(p.largestLossUsd)}, ${pct(p.largestLossUsd / p.grossLossUsd)} of everything lost: a single bad position drove the result.` });
  if (p.feesUsd > 0 && p.grossWinUsd > 0 && p.feesUsd / p.grossWinUsd >= 0.3) out.push({ tone: 'warn', text: `Fees took ${usd(p.feesUsd)}, ${pct(p.feesUsd / p.grossWinUsd)} of gross wins.` });
  if (Math.abs(p.fundingUsd) >= 0.1 * Math.max(1, Math.abs(p.pnlUsd))) out.push({ tone: p.fundingUsd >= 0 ? 'good' : 'bad', text: `Funding ${p.fundingUsd >= 0 ? 'earned' : 'cost'} ${usd(p.fundingUsd)}, large next to ${usd(p.pnlUsd)} of price PnL.` });

  const { long, short } = p.sides;
  if (long.closes >= 5 && short.closes >= 5) {
    const better = long.netUsd >= short.netUsd ? 'long' : 'short';
    const worse = better === 'long' ? short : long;
    if (worse.netUsd < 0 && (better === 'long' ? long : short).netUsd > 0) out.push({ tone: 'neutral', text: `Makes money ${better} (${usd(better === 'long' ? long.netUsd : short.netUsd)}) and loses it ${better === 'long' ? 'short' : 'long'} (${usd(worse.netUsd)}).` });
  } else if (long.closes + short.closes >= 5 && (long.closes === 0 || short.closes === 0)) out.push({ tone: 'neutral', text: `Only ever ${long.closes ? 'long' : 'short'}.` });

  const best = p.byMarket[0], worst = p.byMarket.at(-1);
  if (best && worst && best.sym !== worst.sym && best.netUsd > 0 && worst.netUsd < 0) out.push({ tone: 'neutral', text: `Best market ${best.sym} (${usd(best.netUsd)} over ${best.trades.toLocaleString('en-US')} fills), worst ${worst.sym} (${usd(worst.netUsd)}).` });

  if (p.longestLoss >= 8) out.push({ tone: 'warn', text: `Longest losing streak: ${p.longestLoss} closes in a row.` });
  if (p.maxDrawdownUsd > 0 && p.netUsd > 0 && p.maxDrawdownUsd >= p.netUsd) out.push({ tone: 'warn', text: `The deepest drawdown (${usd(p.maxDrawdownUsd)}) was larger than the total gain (${usd(p.netUsd)}): the path was rougher than the result.` });

  const total = p.hours.reduce((a, b) => a + b, 0);
  if (total >= 50) {
    const peak = p.hours.indexOf(Math.max(...p.hours));
    const window = [peak - 1, peak, peak + 1].map((h) => p.hours[(h + 24) % 24]).reduce((a, b) => a + b, 0);
    if (window / total >= 0.35) out.push({ tone: 'neutral', text: `${pct(window / total)} of fills happen between ${String((peak + 23) % 24).padStart(2, '0')}:00 and ${String((peak + 2) % 24).padStart(2, '0')}:00 UTC.` });
  }

  if (w.rank.pnlPct != null && w.rank.pnlPct <= 0.05) out.push({ tone: 'good', text: `Top ${Math.max(1, Math.ceil(w.rank.pnlPct * 100))}% by realised PnL among the ${w.rank.accounts.toLocaleString('en-US')} accounts active in the last ${w.rank.days} days.` });
  else if (w.rank.volumePct != null && w.rank.volumePct <= 0.05) out.push({ tone: 'neutral', text: `Among the ${Math.max(1, Math.ceil(w.rank.volumePct * 100))}% most active accounts of the last ${w.rank.days} days.` });

  const near = w.positions.filter((x) => x.liqDistancePct != null && x.liqDistancePct < 5);
  if (near.length) out.push({ tone: 'bad', text: `${near.length} open position${near.length === 1 ? ' is' : 's are'} within 5% of liquidation: ${near.map((x) => `${x.sym} ${x.liqDistancePct!.toFixed(1)}%`).join(', ')}.` });

  const deposits = w.flows.reduce((s, f) => s + (f.kind === 'deposit' ? f.usd : -f.usd), 0);
  if (deposits > 0 && w.flows.length < 200) {
    const roi = (w.equityUsd - deposits) / deposits;
    if (Math.abs(roi) >= 0.05) out.push({ tone: roi >= 0 ? 'good' : 'bad', text: `Equity is ${roi >= 0 ? 'up' : 'down'} ${pct(Math.abs(roi))} on ${usd(deposits)} net deposited.` });
  }
  return out.slice(0, 6);
}
