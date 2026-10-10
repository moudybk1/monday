'use client';

import { ArrowUpRightIcon, CheckIcon, XIcon } from '@phosphor-icons/react';
import { use, useEffect, useState } from 'react';
import { keccak256, toHex } from 'viem';
import { canonicalJson, type AppConfig, type DecisionRecord } from '@monday/core';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { Button, Notice, Skeleton, Tag } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { shortAddr } from '@/lib/format';

const SOURCE = { governor: 'LLM governor', fallback: 'Rule-based governor', reflex: 'Reflex', kill: 'Kill switch' } as const;

/** The public record a decision's on-chain uri points to (PRD 10.4, US-10). */
export default function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<DecisionRecord | null | 'missing' | 'error'>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [check, setCheck] = useState<{ params: boolean; evidence: boolean } | null>(null);

  useEffect(() => {
    document.title = `Decision ${id} - Monday`;
    api<DecisionRecord>(`/decisions/${id}`).then(setD).catch((e) => setD(e instanceof ApiError && e.status === 404 ? 'missing' : 'error'));
    api<AppConfig>('/config').then(setCfg).catch(() => {});
  }, [id]);

  // Recompute both hashes in the browser from the record as served. Nothing is trusted from the server here.
  const verify = (r: DecisionRecord) => setCheck({ params: keccak256(toHex(canonicalJson(r.params))) === r.paramsHash, evidence: keccak256(toHex(canonicalJson(r.evidence))) === r.evidenceHash });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[960px] px-4 pb-24 pt-12 sm:px-8">
        {d === null ? (
          <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>
        ) : d === 'missing' ? (
          <Notice tone="warn">No decision with id {id} exists on this server.</Notice>
        ) : d === 'error' ? (
          <Notice tone="warn">Could not reach the Monday server to load decision {id}. Reload the page to try again.</Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
              <Tag>{d.market}</Tag>
              <Tag tone={d.source === 'reflex' || d.source === 'kill' ? 'ask' : 'neutral'}>{SOURCE[d.source]}</Tag>
              <Tag tone={d.regime === 'storm' ? 'accent' : 'neutral'}>{d.regime}</Tag>
              <span className="num">{new Date(d.at).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
            </div>
            <h1 className="display mt-4 text-3xl md:text-4xl">Decision {d.id}</h1>
            <p className="mt-4 max-w-[62ch] text-xl leading-snug">{d.reason}</p>
            <p className="mt-3 text-[13px] text-fg-3">
              For account owner <span className="num">{shortAddr(d.wallet)}</span>{d.llmModel ? <>, written by <span className="num">{d.llmModel}</span></> : ', written by deterministic rules'}.
            </p>

            <section className="mt-10 border-t border-line-2 pt-6">
              <h2 className="font-semibold">Verify</h2>
              <p className="mt-1 max-w-[66ch] text-[15px] text-fg-2">
                The agent hashes the parameters and the evidence with keccak256 over canonical JSON and writes both hashes to MondayRegistry on Monad. Recompute them here, then compare with the transaction.
              </p>
              <dl className="mt-5 grid gap-4 text-sm">
                {([['Parameters hash', d.paramsHash, check?.params], ['Evidence hash', d.evidenceHash, check?.evidence]] as const).map(([k, v, ok]) => (
                  <div key={k}>
                    <dt className="flex items-center gap-2 text-[12.5px] text-fg-3">
                      {k}
                      {ok === true && <Tag tone="bid"><CheckIcon size={11} weight="bold" className="mr-1" />matches</Tag>}
                      {ok === false && <Tag tone="ask"><XIcon size={11} weight="bold" className="mr-1" />does not match</Tag>}
                    </dt>
                    <dd className="num mt-1 break-all">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-[12.5px] text-fg-3">On Monad</dt>
                  <dd className="mt-1">
                    {d.txHash ? (
                      <a href={cfg ? `${cfg.explorerUrl}/tx/${d.txHash}` : undefined} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 break-all underline underline-offset-2">
                        {d.txHash} <ArrowUpRightIcon size={12} />
                      </a>
                    ) : (
                      <span className="text-fg-2">{{
                        pending: 'Waiting for Monad. The hashes are queued and stay queued through restarts until a receipt confirms them.',
                        failed: 'Not anchored: the transaction failed after several attempts. The record and its hashes are still here to check.',
                        confirmed: 'Anchored.',
                        off: cfg?.registry ? 'Not anchored: the account owner has not authorised the agent in the registry.' : 'This server has no registry configured, so decisions are hashed but not written on-chain.',
                      }[d.anchor]}</span>
                    )}
                    {d.onchainId != null && <span className="ml-2 text-fg-3">registry decision <span className="num">{d.onchainId}</span></span>}
                  </dd>
                </div>
              </dl>
              <Button variant="ghost" className="mt-5" onClick={() => verify(d)}>Recompute hashes in this browser</Button>
            </section>

            <section className="mt-10 grid gap-8 border-t border-line-2 pt-6 md:grid-cols-2">
              <div className="min-w-0">
                <h2 className="font-semibold">Parameters</h2>
                <pre className="num mt-3 overflow-x-auto rounded-sm bg-raised p-4 text-[12.5px] leading-relaxed">{JSON.stringify(d.params, null, 2)}</pre>
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold">Evidence</h2>
                <p className="mt-1 text-[13px] text-fg-3">Signal values, the market snapshot, and the hashes of the Smart Trader trades in the window.</p>
                <pre className="num mt-3 max-h-[28rem] overflow-auto rounded-sm bg-raised p-4 text-[12.5px] leading-relaxed">{JSON.stringify(d.evidence, null, 2)}</pre>
              </div>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
