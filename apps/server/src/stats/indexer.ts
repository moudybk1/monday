// Perpl event indexer for the public stats: new accounts, deposits and withdrawals, fills joined with the position
// change they caused, and liquidations. Its own SQLite file, separate from Monday's trading database.
//
// The Exchange emits each account's position event immediately before that account's fill, so a fill is paired with
// the position event just before it: the maker fill names its account, the taker fill inherits the taker's.
//
// Envio HyperSync (ENVIO_API_TOKEN) backfills from genesis in minutes. Without a token the indexer follows the chain
// over RPC from a few hours back, because Monad's public RPC serves eth_getLogs 100 blocks at a time.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeEventLog, toEventSelector, toHex, type Hex } from 'viem';
import { config } from '../config';
import { EXCHANGE_ABI } from './exchange-abi';
import { client, meta, statsNet, type Meta } from './perpl';

mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
export const sdb = new DatabaseSync(resolve(process.cwd(), `data/perpl-stats-${statsNet.network}.sqlite`));
sdb.exec(`
pragma journal_mode = wal;
pragma synchronous = normal;
create table if not exists px_meta (key text primary key, value text);
create table if not exists px_accounts (id integer primary key, address text not null, ts integer);
create index if not exists px_accounts_addr on px_accounts (address);
create table if not exists px_flows (block integer, idx integer, ts integer, account integer, deposit integer, usd real, primary key (block, idx));
create index if not exists px_flows_ts on px_flows (ts);
create index if not exists px_flows_acct on px_flows (account, ts);
create table if not exists px_trades (
  block integer, idx integer, ts integer, perp integer, account integer, taker integer, kind integer, long integer,
  price real, size real, fee real, pnl real, funding real, primary key (block, idx)
);
create index if not exists px_trades_acct on px_trades (account, block);
create table if not exists px_liqs (block integer, idx integer, ts integer, perp integer, account integer, long integer, size real, mark real, pnl real, primary key (block, idx));
create index if not exists px_liqs_ts on px_liqs (ts);
create table if not exists px_day (day integer, account integer, volume real, net real, fees real, trades integer, primary key (day, account));
`);

export const KINDS = ['open', 'increase', 'decrease', 'close', 'invert', 'liquidation', 'fill'] as const;
const kindId = (k: (typeof KINDS)[number]) => KINDS.indexOf(k);

const EVENTS = EXCHANGE_ABI.filter((x) => x.type === 'event');
const TOPICS = EVENTS.map((e) => toEventSelector(e));

const getMeta = (k: string) => (sdb.prepare('select value from px_meta where key = ?').get(k) as { value: string } | undefined)?.value ?? null;
const setMeta = sdb.prepare('insert into px_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value');
const insAccount = sdb.prepare('insert or ignore into px_accounts (id, address, ts) values (?, ?, ?)');
const insFlow = sdb.prepare('insert or ignore into px_flows (block, idx, ts, account, deposit, usd) values (?, ?, ?, ?, ?, ?)');
const insTrade = sdb.prepare('insert or ignore into px_trades (block, idx, ts, perp, account, taker, kind, long, price, size, fee, pnl, funding) values (?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insLiq = sdb.prepare('insert or ignore into px_liqs (block, idx, ts, perp, account, long, size, mark, pnl) values (?,?,?,?,?,?,?,?,?)');
const upDay = sdb.prepare(`insert into px_day (day, account, volume, net, fees, trades) values (?, ?, ?, ?, ?, 1)
  on conflict (day, account) do update set volume = volume + excluded.volume, net = net + excluded.net, fees = fees + excluded.fees, trades = trades + 1`);

interface RawLog { block: number; idx: number; ts: number; data: Hex; topics: Hex[] }
interface Pending { perp: number; account: number; kind: (typeof KINDS)[number]; long: boolean; pnl: number; funding: number }

export const status = { source: 'off' as 'hypersync' | 'rpc' | 'off', block: 0, head: 0, error: null as string | null };
let pending: Pending | null = null;

function ingest(logs: RawLog[], m: Meta) {
  logs.sort((a, b) => a.block - b.block || a.idx - b.idx);
  const usd = (v: bigint) => Number(v) / m.usd;
  sdb.exec('begin');
  try {
    for (const l of logs) {
      let ev: { eventName: string; args: Record<string, unknown> };
      try {
        ev = decodeEventLog({ abi: EXCHANGE_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] }) as never;
      } catch {
        continue;
      }
      const a = ev.args as Record<string, bigint & number & boolean & string>;
      switch (ev.eventName) {
        case 'AccountCreated':
          insAccount.run(Number(a.id), String(a.account).toLowerCase(), l.ts);
          break;
        case 'CollateralDeposit':
        case 'CollateralWithdrawal':
          insFlow.run(l.block, l.idx, l.ts, Number(a.accountId), ev.eventName === 'CollateralDeposit' ? 1 : 0, usd(a.amountCNS));
          break;
        case 'PositionOpened': case 'PositionOpenedV2':
        case 'PositionIncreased': case 'PositionIncreasedV2':
        case 'PositionDecreased': case 'PositionClosed': case 'PositionInverted': {
          const kind = ev.eventName.startsWith('PositionOpened') ? 'open' : ev.eventName.startsWith('PositionIncreased') ? 'increase'
            : ev.eventName === 'PositionDecreased' ? 'decrease' : ev.eventName === 'PositionClosed' ? 'close' : 'invert';
          pending = { perp: Number(a.perpId), account: Number(a.accountId), kind, long: a.positionType === 0, pnl: a.deltaPnlCNS != null ? usd(a.deltaPnlCNS) : 0, funding: a.fundingCNS != null ? usd(a.fundingCNS) : 0 };
          break;
        }
        case 'PositionLiquidated': {
          const mk = m.markets.get(Number(a.perpId));
          if (!mk) break;
          const long = a.positionType === 0;
          insLiq.run(l.block, l.idx, l.ts, mk.id, Number(a.posAccountId), long ? 1 : 0, Number(a.liqLotLNS) / mk.sz, Number(a.markPricePNS) / mk.px, usd(a.deltaPnlCNS) + usd(a.fundingCNS));
          pending = { perp: mk.id, account: Number(a.posAccountId), kind: 'liquidation', long, pnl: usd(a.deltaPnlCNS), funding: usd(a.fundingCNS) };
          break;
        }
        case 'MakerOrderFilled': case 'MakerOrderFilledV2':
        case 'TakerOrderFilled': case 'TakerOrderFilledV2': {
          const maker = ev.eventName.startsWith('Maker');
          const pos = pending && (!maker || (pending.account === Number(a.accountId) && pending.perp === Number(a.perpId))) ? pending : null;
          pending = null;
          const perp = maker ? Number(a.perpId) : pos?.perp ?? 0;
          const account = maker ? Number(a.accountId) : pos?.account ?? 0;
          const mk = m.markets.get(perp);
          const fee = usd(a.feeCNS) + (a.builderFeeCNS != null ? usd(a.builderFeeCNS) : 0);
          const price = mk ? Number(maker ? a.pricePNS : a.entryPricePNS) / mk.px : 0;
          const size = mk ? Number(a.lotLNS) / mk.sz : 0;
          const pnl = pos?.pnl ?? 0, fund = pos?.funding ?? 0;
          // Ranges can be read twice (restarts, switching RPC to HyperSync): only a new fill moves the daily totals.
          const added = insTrade.run(l.block, l.idx, l.ts, perp, account, maker ? 0 : 1, kindId(pos?.kind ?? 'fill'), pos?.long ? 1 : 0, price, size, fee, pnl, fund).changes;
          if (added) upDay.run(Math.floor(l.ts / 86_400_000), account, price * size, pnl + fund - fee, fee);
          break;
        }
      }
    }
    sdb.exec('commit');
  } catch (e) {
    sdb.exec('rollback');
    throw e;
  }
}

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hypersync(token: string) {
  status.source = 'hypersync';
  // The first HyperSync run starts from block 0 even if RPC indexed recent hours before; rows already stored are skipped.
  if (getMeta('genesis') !== '1') {
    setMeta.run('cursor', '0');
    setMeta.run('genesis', '1');
  }
  let from = Number(getMeta('cursor') ?? 0);
  let wait = 5_000;
  for (;;) {
    try {
      const res = await fetch(`${statsNet.hypersync}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          from_block: from,
          logs: [{ address: [statsNet.exchange], topics: [TOPICS] }],
          field_selection: { block: ['number', 'timestamp'], log: ['block_number', 'log_index', 'data', 'topic0', 'topic1', 'topic2', 'topic3'] },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HyperSync ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { data: unknown; next_block: number; archive_height: number };
      const batches = (Array.isArray(j.data) ? j.data : [j.data]) as { blocks?: { number: unknown; timestamp: unknown }[]; logs?: Record<string, unknown>[] }[];
      const ts = new Map<number, number>();
      const logs: RawLog[] = [];
      for (const b of batches) for (const blk of b.blocks ?? []) ts.set(num(blk.number), num(blk.timestamp) * 1000);
      for (const b of batches) {
        for (const l of b.logs ?? []) {
          const block = num(l.block_number);
          logs.push({ block, idx: num(l.log_index), ts: ts.get(block) ?? 0, data: l.data as Hex, topics: [l.topic0, l.topic1, l.topic2, l.topic3].filter(Boolean) as Hex[] });
        }
      }
      if (logs.length) ingest(logs, await meta());
      from = j.next_block;
      setMeta.run('cursor', String(from));
      Object.assign(status, { block: from, head: j.archive_height, error: null });
      wait = 5_000;
      if (from >= j.archive_height) await sleep(1_000); // caught up: wait for new blocks
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (error !== status.error) console.error(JSON.stringify({ service: 'stats', event: 'hypersync_failed', error, retryInS: wait / 1000 })); // once per streak
      status.error = error;
      await sleep(wait);
      wait = Math.min(wait * 2, 300_000); // a 429 is Envio's quota: retrying every 5 s only keeps it exhausted
    }
  }
}

const RPC_START_BLOCKS = 30_000; // about three hours of Monad blocks

async function rpc() {
  status.source = 'rpc';
  let from = Number(getMeta('cursor') ?? 0);
  for (;;) {
    try {
      const head = Number(await client.getBlockNumber());
      if (!from || head - from > 5 * RPC_START_BLOCKS) from = head - RPC_START_BLOCKS; // too far behind to catch up over RPC
      status.head = head;
      if (from > head) {
        await sleep(1_000);
        continue;
      }
      const to = Math.min(head, from + 99);
      const raw = (await client.request({
        method: 'eth_getLogs',
        params: [{ address: statsNet.exchange, fromBlock: toHex(from), toBlock: toHex(to), topics: [TOPICS] }],
      })) as { blockNumber: Hex; logIndex: Hex; blockTimestamp?: Hex; data: Hex; topics: Hex[] }[];
      if (raw.length) ingest(raw.map((l) => ({ block: Number(l.blockNumber), idx: Number(l.logIndex), ts: Number(l.blockTimestamp ?? 0) * 1000, data: l.data, topics: l.topics })), await meta());
      from = to + 1;
      setMeta.run('cursor', String(from));
      Object.assign(status, { block: from, error: null });
    } catch (e) {
      status.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
      await sleep(3_000);
    }
  }
}

export function startIndexer() {
  void (config.stats.envioToken ? hypersync(config.stats.envioToken) : rpc());
}

/** History is complete once a HyperSync run that started from block 0 has caught up. */
export const historyComplete = () => status.source === 'hypersync' && getMeta('genesis') === '1' && status.head > 0 && status.head - status.block < 50;
