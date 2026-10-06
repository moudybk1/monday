'use client';

import { useEffect, useState } from 'react';
import type { AppConfig } from '@monday/core';
import { api } from '@/lib/api';

/** The first disclosure: what kind of money this deployment trades. Read from the server, never assumed. */
export function NetworkNote() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => {
    api<AppConfig>('/config').then(setCfg).catch(() => {});
  }, []);
  if (!cfg) return <>Check the network badge in the app before you start: it says whether funds are real.</>;
  if (cfg.realFunds) return <strong className="font-semibold text-ask-fg">This deployment trades real funds on {cfg.networkName}.</strong>;
  return <>{cfg.sim ? 'This deployment runs on a simulated market.' : cfg.paper ? `This deployment paper-trades on Perpl's real ${cfg.networkName} prices.` : `This deployment runs on ${cfg.networkName}.`} No real funds.</>;
}
