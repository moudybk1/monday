// Perpl event indexer for the public stats: new accounts, deposits and withdrawals, fills joined with the position
// change they caused, and liquidations. Its own SQLite file, separate from Monday's trading database.
//
// The Exchange emits each account's position event immediately before that account's fill, so a fill is paired with
// the position event just before it: the maker fill names its account, the taker fill inherits the taker's.
//
// Envio HyperSync (ENVIO_API_TOKEN) backfills from genesis in minutes. Without a token the indexer follows the chain
// over RPC from a few hours back, because Monad's public RPC serves eth_getLogs 100 blocks at a time.
//
// Every batch is stored together with the block range it scanned (px_ranges), so the history knows its own holes: a
// restart, a switch between RPC and HyperSync, or an RPC jump to the head leaves a hole that HyperSync fills later,
// and the stats say "partial" for any span not scanned yet instead of showing a missing day as a quiet one.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeEventLog, toEventSelector, toHex, type Hex } from 'viem';
import { holesOf, type BlockRange } from '@monday/core';
import { config } from '../config';
import { EXCHANGE_ABI } from './exchange-abi';
import { client, meta, statsNet, type Meta } from './perpl';

mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
export const sdb = new DatabaseSync(resolve(process.cwd(), `data/perpl-stats-${statsNet.network}.sqlite`));
sdb.exec(`
pragma journal_mode = wal;
pragma synchronous = normal;
pragma busy_timeout = 10000;
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
create table if not exists px_ranges (lo integer primary key, hi integer not null);
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
const selRanges = sdb.prepare('select lo, hi from px_ranges order by lo');
const selTouching = sdb.prepare('select lo, hi from px_ranges where lo <= ? and hi >= ?');
const delRange = sdb.prepare('delete from px_ranges where lo = ?');
const insRange = sdb.prepare('insert into px_ranges (lo, hi) values (?, ?)');

/** Mark blocks [lo, hi) as scanned, merged with every range it touches. Runs inside the caller's transaction. */
function cover(lo: number, hi: number) {
  if (!(hi > lo)) return;
  for (const r of selTouching.all(hi, lo) as unknown as BlockRange[]) {
    lo = Math.min(lo, r.lo);
    hi = Math.max(hi, r.hi);
    delRange.run(r.lo);
  }
  insRange.run(lo, hi);
}

/** Block ranges below the live cursor that were never scanned, oldest first. */
export const scanHoles = (): BlockRange[] => holesOf(selRanges.all() as unknown as BlockRange[], Number(getMeta('cursor') ?? 0));

interface RawLog { block: number; idx: number; ts: number; data: Hex; topics: Hex[] }
interface Pending { perp: number; account: number; kind: (typeof KINDS)[number]; long: boolean; pnl: number; funding: number }

/**
 * Progress, also stored in px_meta: a server whose indexer runs in its own process (npm run indexer) reads it from there.
 * `at`: last progress. `seen`: last report of any kind, errors included.
 */
const status = { source: 'off' as 'hypersync' | 'rpc' | 'off', block: 0, head: 0, error: null as string | null, at: 0, seen: 0 };
let local = false;
/** Progress is a report, never a reason to stop: a write that still finds the database busy is skipped, not thrown. */
const saveStatus = (ok: boolean) => {
  status.seen = Date.now();
  if (ok) Object.assign(status, { at: status.seen, error: null });
  try {
    setMeta.run('status', JSON.stringify(status));
  } catch (e) {
    logError('status_not_saved', e instanceof Error ? e.message : String(e));
  }
};

/**
 * The indexer as it last reported, from this process or another. Silent for 6 minutes means it is not running: that is
 * longer than HyperSync's longest back-off (5 min), so a throttled indexer reads as behind, not off.
 */
export function indexerStatus(now = Date.now()): typeof status {
  const s: typeof status = local ? status : { ...status, ...JSON.parse(getMeta('status') ?? '{}') };
  return now - s.seen > 360_000 ? { ...s, source: 'off' } : s;
}

/** Store one batch and mark blocks [lo, hi) scanned in the same transaction: a block never counts as scanned without its rows. */
function ingest(logs: RawLog[], m: Meta, lo: number, hi: number) {
  logs.sort((a, b) => a.block - b.block || a.idx - b.idx);
  const usd = (v: bigint) => Number(v) / m.usd;
  // A position event and its fill share a transaction, hence a block, and a batch always holds whole blocks.
  let pending: Pending | null = null;
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
    cover(lo, hi);
    sdb.exec('commit');
  } catch (e) {
    sdb.exec('rollback');
    throw e;
  }
}

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let logged = { error: '', at: 0 };
/** One line per distinct error, repeated at most every 10 minutes: a throttled indexer must not flood the terminal. */
function logError(event: string, error: string, extra: Record<string, unknown> = {}) {
  if (error === logged.error && Date.now() - logged.at < 600_000) return;
  logged = { error, at: Date.now() };
  console.error(JSON.stringify({ service: 'stats', event, error, ...extra }));
}

const SEED_GAP_BLOCKS = 20_000; // about two hours of Monad blocks without a single fill

/**
 * Once, for a database indexed before scanned ranges were recorded: everything up to the cursor counts as scanned, from
 * block 0 if a HyperSync run started at genesis, except stretches of more than SEED_GAP_BLOCKS without a fill. Those go
 * back to the backfill queue; scanning a truly quiet stretch again costs little and turns it into verified coverage.
 * The scan reads every fill once (about 15 s for 19M fills) and only ever runs on an empty px_ranges.
 */
function seedRanges() {
  const cursor = Number(getMeta('cursor') ?? 0);
  if (!cursor || (sdb.prepare('select count(*) n from px_ranges').get() as { n: number }).n) return;
  const first = (sdb.prepare('select min(block) b from px_trades').get() as { b: number | null }).b;
  if (first == null) return;
  const stretches = sdb.prepare('select prev, block from (select block, lag(block) over (order by block) prev from px_trades) where block - prev > ?')
    .all(SEED_GAP_BLOCKS) as { prev: number; block: number }[];
  let lo = getMeta('genesis') === '1' ? 0 : first;
  sdb.exec('begin');
  try {
    for (const s of stretches) {
      cover(lo, s.prev + 1);
      lo = s.block;
    }
    cover(lo, cursor);
    sdb.exec('commit');
  } catch (e) {
    sdb.exec('rollback');
    throw e;
  }
  console.log(JSON.stringify({ service: 'stats', event: 'ranges_seeded', holes: scanHoles().length }));
}

type Batch = { logs: RawLog[]; next: number; height: number };

/** One HyperSync request for the Exchange's logs in [from, to). It may stop early: `next` is where to continue. */
async function hsQuery(token: string, from: number, to?: number): Promise<Batch> {
  const res = await fetch(`${statsNet.hypersync}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      from_block: from,
      ...(to != null && { to_block: to }),
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
      const t = ts.get(block);
      if (!t) throw new Error(`HyperSync returned block ${block} without its timestamp`); // never store a fill at 1970
      logs.push({ block, idx: num(l.log_index), ts: t, data: l.data as Hex, topics: [l.topic0, l.topic1, l.topic2, l.topic3].filter(Boolean) as Hex[] });
    }
  }
  return { logs, next: j.next_block, height: j.archive_height };
}

const BACKFILL_BLOCKS = 500_000; // per backfill request: about two days of Monad blocks

/**
 * Follow the head first. Whenever it is caught up, fill the newest hole in the scanned history instead of idling, so the
 * recent windows (7D, 30D) are complete first and the oldest days last. Starting on an empty database, the "head" pass
 * is itself the scan from genesis.
 */
async function hypersync(token: string) {
  status.source = 'hypersync';
  let from = Number(getMeta('cursor') ?? 0);
  let wait = 5_000;
  for (;;) {
    try {
      const tip = await hsQuery(token, from);
      const m = await meta();
      ingest(tip.logs, m, from, tip.next);
      from = tip.next;
      setMeta.run('cursor', String(from));
      Object.assign(status, { block: from, head: tip.height });
      if (from >= tip.height) {
        const hole = scanHoles().at(-1);
        if (hole) {
          const lo = Math.max(hole.lo, hole.hi - BACKFILL_BLOCKS);
          const b = await hsQuery(token, lo, hole.hi);
          ingest(b.logs, m, lo, Math.min(b.next, hole.hi));
        } else await sleep(1_000); // caught up and complete: wait for new blocks
      }
      saveStatus(true);
      wait = 5_000;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logError('hypersync_failed', error, { retryInS: wait / 1000 });
      status.error = error;
      saveStatus(false);
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
      // Too far behind to catch up over RPC: jump near the head. What it skips stays a hole for HyperSync to fill.
      if (!from || head - from > 5 * RPC_START_BLOCKS) from = head - RPC_START_BLOCKS;
      status.head = head;
      if (from > head) {
        saveStatus(true); // caught up: still a heartbeat
        await sleep(1_000);
        continue;
      }
      const to = Math.min(head, from + 99);
      const raw = (await client.request({
        method: 'eth_getLogs',
        params: [{ address: statsNet.exchange, fromBlock: toHex(from), toBlock: toHex(to), topics: [TOPICS] }],
      })) as { blockNumber: Hex; logIndex: Hex; blockTimestamp?: Hex; data: Hex; topics: Hex[] }[];
      const logs = raw.map((l) => {
        if (!l.blockTimestamp) throw new Error('eth_getLogs returned a log without blockTimestamp'); // never store a fill at 1970
        return { block: Number(l.blockNumber), idx: Number(l.logIndex), ts: Number(l.blockTimestamp) * 1000, data: l.data, topics: l.topics };
      });
      ingest(logs, await meta(), from, to + 1);
      from = to + 1;
      setMeta.run('cursor', String(from));
      status.block = from;
      saveStatus(true);
    } catch (e) {
      status.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
      logError('rpc_failed', status.error);
      saveStatus(false);
      await sleep(3_000);
    }
  }
}

export function startIndexer() {
  local = true;
  seedRanges();
  void (config.stats.envioToken ? hypersync(config.stats.envioToken) : rpc());
}

/** Every block from genesis to the head is scanned, and the indexer is running. */
export function historyComplete(): boolean {
  const s = indexerStatus();
  return s.source !== 'off' && s.head > 0 && s.head - s.block < 50 && scanHoles().length === 0;
}
