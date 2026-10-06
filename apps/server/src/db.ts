// System of record. SQLite through node:sqlite keeps the hackathon deploy to one
// process and one file; table names follow PRD section 14.
// Single-writer SQLite. Move to Postgres when runners span more than one process.

import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';

if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
export const db = new DatabaseSync(config.databasePath);

db.exec(`
pragma journal_mode = wal;
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
`);

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
