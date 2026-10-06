// Perpl REST: the public context (the single source of decimals, fees, leverage
// and TTLs) and a GET helper. Everything on the wire is a scaled integer; the
// `px` / `sz` / `usd` factors below are the only place scaling is defined.

import { MARKETS, type MarketSpec, type MarketSym } from '@monday/core';
import { z } from 'zod';
import type { PerplConfig } from './index';

export interface PerplMarket {
  spec: MarketSpec;
  id: number;
  px: number; // 10^price_decimals: human price * px = wire price
  sz: number; // 10^size_decimals: base units * sz = wire size
  ttlBlocks: number; // order_ttl_blocks: lb ceiling is head + ttlBlocks
}

export interface PerplContext {
  markets: Partial<Record<MarketSym, PerplMarket>>;
  byId: Map<number, PerplMarket>;
  usd: number; // 10^collateral decimals: wire Amount / usd = USD
  minDepositUsd: number;
}

const Context = z.object({
  chain: z.object({ chain_id: z.number() }),
  instances: z.array(z.object({ id: z.number(), address: z.string(), collateral_token_id: z.number(), min_account_open_amount: z.coerce.number() })),
  tokens: z.array(z.object({ id: z.number().optional(), decimals: z.number().int().min(0) })),
  markets: z.array(z.object({
    id: z.number(),
    instance_id: z.number(),
    symbol: z.string(),
    name: z.string().optional(),
    order_ttl_blocks: z.number().positive(),
    config: z.object({
      price_decimals: z.number().int().min(0),
      size_decimals: z.number().int().min(0),
      initial_margin: z.number().positive(),
      maker_fee: z.number(),
      taker_fee: z.number(),
    }),
  })),
});

/** GET with the documented retry rule: 429 (edge rate limit) and 503 (service warming up) back off and retry. */
export async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) return res.json();
    if ((res.status !== 429 && res.status !== 503) || attempt === 3) throw new Error(`Perpl GET ${new URL(url).pathname} -> ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

export async function loadContext(cfg: PerplConfig): Promise<PerplContext> {
  const c = Context.parse(await getJson(`${cfg.apiUrl}/v1/pub/context`));
  if (c.chain.chain_id !== cfg.chainId) throw new Error(`Perpl context is for chain ${c.chain.chain_id}, config says ${cfg.chainId}`);
  const inst = c.instances.find((i) => i.address.toLowerCase() === cfg.exchangeAddress.toLowerCase());
  if (!inst) throw new Error(`Perpl context has no exchange instance at ${cfg.exchangeAddress}`);
  const token = c.tokens.find((t) => t.id === inst.collateral_token_id);
  if (!token) throw new Error(`Perpl context has no collateral token ${inst.collateral_token_id}`);

  const usd = 10 ** token.decimals;
  const ctx: PerplContext = { markets: {}, byId: new Map(), usd, minDepositUsd: inst.min_account_open_amount / usd };
  for (const m of c.markets) {
    // Mainnet's context leaves `symbol` empty for BTC and MON and puts the ticker in `name`
    // ("BTC"); testnet fills both ("BTC", "BTC Perp"). Read whichever is present.
    const ticker = (m.symbol || (m.name ?? '').split(/\s/)[0]).toUpperCase();
    if (m.instance_id !== inst.id || !(MARKETS as readonly string[]).includes(ticker)) continue;
    const sym = ticker as MarketSym;
    const px = 10 ** m.config.price_decimals;
    const sz = 10 ** m.config.size_decimals;
    const market: PerplMarket = {
      id: m.id,
      px,
      sz,
      ttlBlocks: m.order_ttl_blocks,
      spec: {
        sym,
        marketId: m.id,
        priceTick: 1 / px,
        sizeStep: 1 / sz,
        // Fees are micros (1e-6): 45 -> 0.45 bps. Base tier; Account.ft indexes maker_fees[] for discounts.
        makerFeeBps: m.config.maker_fee / 100,
        takerFeeBps: m.config.taker_fee / 100,
        // initial_margin is in the same hundredths unit as an order's `lv`: 1500 -> 15x (6.67% margin).
        // Confirmed on-chain: getMarginFractions returns init 1500 / maint 2500, and maint < init only holds this way.
        maxLeverage: m.config.initial_margin / 100,
      },
    };
    ctx.markets[sym] = market;
    ctx.byId.set(m.id, market);
  }
  return ctx;
}
