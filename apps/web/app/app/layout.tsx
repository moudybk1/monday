'use client';

import { GearSixIcon, SignOutIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { AppHeader } from '@/components/app-header';
import { Button, Notice, Skeleton, Tag, cx } from '@/components/ui';
import { shortAddr } from '@/lib/format';
import { safeReturnPath } from '@monday/core';
import { showAccount } from '@/lib/api';
import { analyticsOn, at } from '@/lib/hosts';
import { Providers, chain, useAppConfig, useMe, useSession, walletConnectReady } from '@/lib/wallet';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const cfg = useAppConfig();
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  // A key is all the terminal needs: it shows the market maker when one is set up, and Agentic Trade and TWAP plans either way.
  // Signing in needs only the wallet; the key is added in Account Settings, and each trading page asks for it until then.
  const onboarded = Boolean(me.data?.hasKey);
  // A page that sent the user here to sign in (`?next=`): returned to as soon as the wallet is signed in. Read after mount:
  // during a client navigation the new page renders before the address bar changes.
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => setNext(safeReturnPath(new URLSearchParams(location.search).get('next'))), []);
  const terminal = (pathname === '/app' || pathname === '/app/trade') && onboarded;

  // Every change this tab asks for names the account it shows (see lib/api).
  const wallet = me.data?.wallet ?? null;
  useEffect(() => showAccount(wallet), [wallet]);

  useEffect(() => {
    if (me.data && next && pathname === '/app') router.replace(next);
  }, [me.data, next, pathname, router]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader nav={Boolean(me.data)}>
        {/* Always say which network the orders go to. A live mainnet is never hidden, even on a phone. */}
        {cfg.data?.realFunds ? (
          <>
            <span className="hidden items-center gap-1.5 text-[12px] text-fg-3 md:flex"><span aria-hidden className="live-dot size-1.5 rounded-full bg-bid" />live</span>
            <Tag tone="bid">{cfg.data.networkName}</Tag>
          </>
        ) : cfg.data &&<span><Tag tone={cfg.data.sim || cfg.data.paper ? 'warn' : 'neutral'}>{cfg.data.sim ? 'Simulated market' : cfg.data.paper ? 'Paper trading' : cfg.data.networkName}</Tag></span>}
        {me.data && (
          <span className="flex h-7 items-center rounded-sm border border-line-2">
            <Link href="/app/account" title="Account Settings" aria-current={pathname === '/app/account' ? 'page' : undefined} className={cx('flex h-full items-center gap-1.5 pl-2.5 pr-2 text-[13px] text-fg-2 hover:bg-raised hover:text-fg aria-[current=page]:text-fg', !me.data.demo && 'font-mono')}>
              {!onboarded && <span aria-label="Perpl not connected" className="size-1.5 rounded-full bg-warn" />}
              <span className="hidden whitespace-nowrap sm:inline">{me.data.demo ? 'Demo Account' : shortAddr(me.data.wallet)}</span>
              <GearSixIcon size={14} className="sm:hidden" />
            </Link>
            <button type="button" onClick={() => void session.signOut()} aria-label="Sign out" title="Sign Out" className="grid h-full w-7 place-items-center border-l border-line-2 text-fg-2 hover:bg-raised hover:text-fg">
              <SignOutIcon size={14} />
            </button>
          </span>
        )}
      </AppHeader>
      <main className={cx('w-full flex-1', !terminal && 'mx-auto max-w-[1180px] px-4 sm:px-6')}>
        {me.isLoading ? (
          <div className="grid gap-3 p-6">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-64" />
          </div>
        ) : me.isError ? (
          <div className="grid max-w-[46rem] gap-3 py-16" role="status">
            <h1 className="display text-2xl">Connecting to Monday</h1>
            <p className="text-fg-2">Monday&apos;s server is not answering right now. This page keeps trying and connects by itself as soon as it can. Your bot and your funds on Perpl are not affected by this page.</p>
            <Skeleton className="mt-2 h-1.5 w-56" />
            {process.env.NODE_ENV === 'development' && <p className="mt-4 text-[13px] text-fg-3">Still here after a minute? Check that the server is running (<code className="num">npm run dev</code>).</p>}
          </div>
        ) : cfg.data && !cfg.data.sim && cfg.data.chainId !== chain.id ? (
          <div className="py-16">
            <Notice tone="warn">
              The web app is built for {chain.name} (chain {chain.id}) but the server runs on {cfg.data.networkName} (chain {cfg.data.chainId}). Set the same NETWORK for both and restart.
            </Notice>
          </div>
        ) : !me.data ? (
          <Connect sim={Boolean(cfg.data?.sim || cfg.data?.paper)} realFunds={Boolean(cfg.data?.realFunds)} />
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** This page's address when no wallet can connect from this browser (none installed, no WalletConnect for a phone). */
function useNoWallet(): string | null {
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    if (!walletConnectReady && !(window as { ethereum?: unknown }).ethereum) setHere(`${location.host}${location.pathname}${location.search}`);
  }, []);
  return here;
}

/** Say what works instead of a wallet button that would wait forever for an extension that is not there. */
function NoWallet({ here }: { here: string }) {
  const link = 'underline underline-offset-2 hover:text-fg';
  return (
    <div className="mt-6 max-w-[52ch]">
      <Notice>
        No wallet found in this browser. Install a browser wallet such as MetaMask or Rabby and reload this page, or open it in your wallet app&apos;s own browser: <a className={link} href={`https://metamask.app.link/dapp/${here}`}>open in MetaMask</a>.{analyticsOn && <> The <a className={link} href={at('/analytics')}>Perpl analytics</a> need no wallet.</>}
      </Notice>
    </div>
  );
}

function Connect({ sim, realFunds }: { sim: boolean; realFunds: boolean }) {
  const session = useSession();
  const noWallet = useNoWallet();
  const account = useAccount();
  // Connected on another network: the wallet has been asked to switch (lib/wallet.tsx); on a phone that request waits in the
  // wallet app. Signing works on the networks the app lists (account.chain set), not on any other.
  const wrongChain = account.isConnected && account.chainId !== undefined && account.chainId !== chain.id;
  const canSignHere = account.chain !== undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demo = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.demo();
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    // Centred both ways in the space under the 56px header: one compact block, not two columns pushed to the edges.
    <div className="page-in mx-auto grid min-h-[calc(100dvh-3.5rem-1px)] max-w-[60rem] content-center items-center gap-10 py-12 md:grid-cols-2 md:gap-14">
      <div>
        <h1 className="display text-4xl font-semibold tracking-[-0.045em] md:text-5xl">Connect Your Wallet</h1>
        <p className="mt-4 max-w-[52ch] text-[16px] text-fg-2">
          Monday signs you in with a message from your wallet on {chain.name}. It costs no gas and moves no funds. Your wallet key never leaves your browser.
          {realFunds && ' This server trades real funds.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Button size="lg" onClick={session.signIn} disabled={busy || noWallet !== null}>Connect Wallet</Button>
          {sim && <Button size="lg" variant="ghost" onClick={demo} disabled={busy}>{busy ? 'Opening' : 'Use a Demo Account'}</Button>}
        </div>
        {error && <p role="alert" className="mt-3 text-[13px] text-ask-fg">{error}</p>}
        {wrongChain && (
          <div className="mt-4">
            <Notice tone="warn">
              {canSignHere
                ? <>Your wallet is on another network. If your wallet app asks to switch to {chain.name}, approve it; signing in works either way, so you can also just sign the message.</>
                : <>Your wallet is on a network Monday cannot sign in on. Open your wallet app and switch to {chain.name} (or Ethereum), then sign the message.</>}
            </Notice>
          </div>
        )}
        {noWallet && <NoWallet here={noWallet} />}
      </div>
      <dl className="frost text-[14px]"><div className="frost-in divide-y divide-line">
        {[
          ['Funds Stay Put','Your collateral stays in your own Perpl account. Monday never holds it.'],
          ['Trade-Only Key','The key you give Monday can place and cancel orders. Perpl never lets an API key withdraw.'],
          ['One Click to Stop','Stop cancels Monday\'s orders. Kill cancels every order and closes positions. Revoking the key on Perpl cuts access at once.'],
        ].map(([t, d]) => (
          <div key={t} className="px-5 py-4">
            <dt className="font-semibold">{t}</dt>
            <dd className="mt-1 text-fg-2">{d}</dd>
          </div>
        ))}
      </div></dl>
    </div>
  );
}
