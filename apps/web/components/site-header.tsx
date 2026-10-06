import Link from 'next/link';
import { NetworkNote } from './network-note';
import { ThemeToggle } from './theme-toggle';
import { ButtonLink, Wordmark } from './ui';

/** Header for the public pages. One line, 56px. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-void/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-6 px-4 sm:px-8">
        <Wordmark />
        <nav className="flex items-center gap-1 text-[13px]" aria-label="Main">
          <Link href="/#how" className="hidden rounded-sm px-3 py-1.5 text-fg-2 hover:bg-raised hover:text-fg md:block">How it works</Link>
          <Link href="/#custody" className="hidden rounded-sm px-3 py-1.5 text-fg-2 hover:bg-raised hover:text-fg md:block">Custody</Link>
          <Link href="/evidence" className="rounded-sm px-3 py-1.5 text-fg-2 hover:bg-raised hover:text-fg">Evidence</Link>
          <ThemeToggle />
          <ButtonLink href="/app" size="sm" className="ml-2 h-8 px-3.5 text-[12.5px]">Launch app</ButtonLink>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 text-[12.5px] text-fg-3 sm:px-8 md:grid-cols-[1fr_2fr]">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-[38ch]">Built for Monad Metropolis. Trades on Perpl, reads smart money from Nansen, logs decisions on Monad.</p>
        </div>
        <ul className="grid gap-x-10 gap-y-2 sm:grid-cols-2">
          <li><NetworkNote /></li>
          <li>Market making can lose money. Monday reports results and does not promise profit.</li>
          <li>Smart-money signals can be wrong or late.</li>
          <li>You keep control: pause, kill, revoke, and withdraw directly on Perpl.</li>
        </ul>
      </div>
    </footer>
  );
}
