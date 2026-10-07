// System of record. SQLite through node:sqlite keeps the hackathon deploy to one
// process and one file; table names follow PRD section 14.
// Single-writer SQLite. Move to Postgres when runners span more than one process.

import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';
import type { SimStore } from './venue/sim';

if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
export const db = new DatabaseSync(config.databasePath);

db.exec(`
pragma journal_mode = wal;
pragma busy_timeout = 2000;
create table if not exists users (
  id integer primary key, wallet text unique not null, created_at integer not null
);
create table if not exists perpl_credentials (
  user_id integer primary key references users(id), chain_id integer not null, account_id integer not null,
  enc blob not null, iv blob not null, tag blob not null, status text not null default 'active', created_at integer not null
);
create table if not exists policies (
  user_id integer primary key references users(id), version integer not null, json text,
  policy_hash text, onchain_tx text, pending_json text, pending_hash text, updated_at integer not null
);
create table if not exists agents (
  user_id integer primary key references users(id), status text not null, kill_reason text, started_at integer
);
create table if not exists nansen_trades (
  hash text not null, sym text not null, action text not null, amount real not null, side text, value_usd real,
  price_usd real, type text, trader text not null, label text, ts integer not null, fetched_at integer not null,
  primary key (hash, sym, action, amount)
);
create index if not exists nansen_trades_sym_ts on nansen_trades (sym, ts desc);
create table if not exists decisions (
  id integer primary key autoincrement, user_id integer not null, at integer not null, market text not null,
  source text not null, regime text not null, params text not null, evidence text not null, params_hash text not null,
  evidence_hash text not null, reason text, llm_model text, onchain_id integer, tx_hash text
);
create index if not exists decisions_user on decisions (user_id, id desc);
create table if not exists fills (
  id text primary key, user_id integer not null, sym text not null, side text not null, price real not null,
  size real not null, fee real not null, is_maker integer not null, ts integer not null, regime text,
  markout_1m real, markout_5m real, realized real
);
create index if not exists fills_user on fills (user_id, ts desc);
create table if not exists pnl_snapshots (
  user_id integer not null, ts integer not null, equity real, realized real, unrealized real, fees real,
  primary key (user_id, ts)
);
create table if not exists agent_events (
  id integer primary key autoincrement, user_id integer, kind text not null, detail text, created_at integer not null
);
-- Account journal: money moving in or out and anything that changes what the account holds without a fill of Monday's
-- (deposit, withdrawal, funding, reconcile), plus session start and stop. Fills have their own table.
create table if not exists journal (
  id integer primary key autoincrement, user_id integer not null, at integer not null, kind text not null,
  sym text, amount real, detail text
);
create index if not exists journal_user on journal (user_id, at);
-- Simulated accounts (sim and paper venues): balance and positions, written in the same transaction as each fill.
create table if not exists paper_accounts (
  key text primary key, balance real not null, positions text not null, updated_at integer not null
);
-- Every order request Monday sends: what, why, the market it saw, and when the venue confirmed it.
create table if not exists quote_events (
  id integer primary key autoincrement, user_id integer not null, sym text not null, side text not null, action text not null,
  prio integer, price real, size real, reason text, data_at integer, sent_at integer not null, done_at integer, ok integer,
  error text, ctx text
);
create index if not exists quote_events_user on quote_events (user_id, sent_at);
-- One row per runner, market and minute, fills or not: where the market went and where Monday's quotes stood.
create table if not exists market_minutes (
  user_id integer not null, sym text not null, minute integer not null, mid_o real, mid_h real, mid_l real, mid_c real,
  tape_hi real, tape_lo real, tape_usd real, hl real, spread_bps real, bid_bps real, ask_bps real, bid_s integer, ask_s integer,
  both_s integer, ticks integer, pos_usd real, regime text, stage text, why text,
  primary key (user_id, sym, minute)
);
-- Monad anchoring jobs: pending -> submitted -> confirmed, or failed. Survives restarts; the tx hash is stored as soon
-- as it is known so a retry checks the first send before sending again.
create table if not exists chain_jobs (
  id integer primary key autoincrement, decision_id integer, kind text not null, payload text not null, status text not null,
  tx_hash text, attempts integer not null default 0, error text, created_at integer not null, updated_at integer not null
);
create index if not exists chain_jobs_status on chain_jobs (status, id);
`);
// Columns added after the first deploy. SQLite has no "add column if not exists".
const added = [
  ['fills', 'markout_1s', 'real'], ['fills', 'markout_5s', 'real'], ['fills', 'markout_10s', 'real'], ['fills', 'half_bps', 'real'],
  ['fills', 'external', 'integer'], ['fills', 'quote_event_id', 'integer'], ['fills', 'ctx', 'text'],
  ['agents', 'session_sl', 'real'], ['agents', 'session_tp', 'real'], ['agents', 'session_equity', 'real'], ['agents', 'owed', 'text'],
  ['decisions', 'llm_ms', 'real'], ['decisions', 'llm_cost', 'real'], ['pnl_snapshots', 'balance', 'real'],
];
for (const [table, col, type] of added) {
  try {
    db.exec(`alter table ${table} add column ${col} ${type}`);
  } catch {
    // already there
  }
}

/** Run `fn` in one transaction: every write lands, or none does. */
export function atomically<T>(fn: () => T): T {
  db.exec('begin');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

export function journal(userId: number, kind: string, sym: string | null, amount: number | null, detail: unknown = {}) {
  db.prepare('insert into journal (user_id, at, kind, sym, amount, detail) values (?,?,?,?,?,?)').run(userId, Date.now(), kind, sym, amount, JSON.stringify(detail));
}

// ---- credentials vault: AES-256-GCM, fresh IV per record (PRD 17.2) ----
const key = Buffer.from(config.masterKey, 'base64');
if (key.length !== 32) throw new Error('MONDAY_MASTER_KEY must be 32 bytes, base64 encoded. Generate one with: openssl rand -base64 32');

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { enc, iv, tag: c.getAuthTag() };
}
export function unseal(row: { enc: Uint8Array; iv: Uint8Array; tag: Uint8Array }): string {
  const d = createDecipheriv('aes-256-gcm', key, row.iv);
  d.setAuthTag(row.tag);
  return Buffer.concat([d.update(row.enc), d.final()]).toString('utf8');
}

export function event(userId: number | null, kind: string, detail: unknown = {}) {
  db.prepare('insert into agent_events (user_id, kind, detail, created_at) values (?, ?, ?, ?)').run(userId, kind, JSON.stringify(detail), Date.now());
}

export function upsertUser(wallet: string): number {
  const w = wallet.toLowerCase();
  db.prepare('insert or ignore into users (wallet, created_at) values (?, ?)').run(w, Date.now());
  return (db.prepare('select id from users where wallet = ?').get(w) as { id: number }).id;
}

/** Simulated accounts (sim and paper) in SQLite, so a restart keeps their balance and positions. */
export const simStore: SimStore = {
  load(wallet) {
    const r = db.prepare('select balance, positions from paper_accounts where key = ?').get(wallet.toLowerCase()) as { balance: number; positions: string } | undefined;
    return r ? { balance: r.balance, positions: JSON.parse(r.positions) } : null;
  },
  save(wallet, balance, positions) {
    db.prepare('insert into paper_accounts (key, balance, positions, updated_at) values (?,?,?,?) on conflict(key) do update set balance = excluded.balance, positions = excluded.positions, updated_at = excluded.updated_at')
      .run(wallet.toLowerCase(), balance, JSON.stringify(positions), Date.now());
  },
};
