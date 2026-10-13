'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { safeReturnPath } from '@monday/core';
import { AccountStep, KeyStep, type PerplAccount } from '@/components/perpl-connect';
import { Notice } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtUsd } from '@/lib/format';
import { useAppConfig, useMe } from '@/lib/wallet';

/**
 * Right after the wallet: the Perpl account and a trade-only key, once. Everything after (the market maker, Agentic Trade,
 * TWAP) trades through this key, so Setup never asks for it again.
 */
export default function Connect() {
  const me = useMe().data!;
  const cfg = useAppConfig().data;
  const qc = useQueryClient();
  const router = useRouter();
  // Poll while the user is off depositing on Perpl, so the page moves on without a click.
  const account = useQuery({ queryKey: ['perpl-account'], queryFn: () => api<PerplAccount>('/perpl/account'), refetchInterval: (q) => (q.state.data?.exists ? false : 8_000) });
  const onward = () => router.replace(safeReturnPath(new URLSearchParams(location.search).get('next')) ?? '/app/setup');
  useEffect(() => {
    if (me.hasKey) onward();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.hasKey]);

  const found = account.data?.exists;
  return (
    <div className="mx-auto grid max-w-[46rem] gap-6 py-10 md:py-16">
      <p className="num text-[12px] uppercase tracking-[0.06em] text-fg-3">Connect Perpl, step {found ? 2 : 1} of 2</p>
      {!found ? (
        <AccountStep wallet={me.demo ? null : me.wallet} account={account.data} loading={account.isLoading} error={account.error} retry={() => void account.refetch()} next={() => void account.refetch()} />
      ) : (
        <>
          <Notice>Perpl account {account.data!.accountId} found, with {fmtUsd(account.data!.balanceUsd ?? 0)} of collateral. It stays in your account the whole time.</Notice>
          <KeyStep
            sim={Boolean(cfg?.sim || cfg?.paper)} paper={Boolean(cfg?.paper)} perplUrl={cfg?.perplAppUrl ?? ''} hasKey={me.hasKey} revoked={me.keyStatus === 'revoked'}
            next={async () => {
              await qc.invalidateQueries({ queryKey: ['me'] });
              onward();
            }}
          />
        </>
      )}
    </div>
  );
}
