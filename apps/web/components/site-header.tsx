import Link from 'next/link';
import { NetworkNote } from './network-note';
import { SiteMenu } from './site-menu';
import { ThemeToggle } from './theme-toggle';
import { ButtonLink, Wordmark } from './ui';

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#custody', label: 'Custody' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/evidence', label: 'Evidence' },
];

/** Header for the public pages. One line, 56px. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-void/90 backdrop-blur-md">
      {/* Wide screens: three columns, the page links centred between the wordmark and the actions. */}
      <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-2 px-4 sm:px-8 md:grid md:grid-cols-[1fr_auto_1fr] md:justify-items-start md:gap-6">
        <Wordmark />
        {/* Phones get every link in the menu instead of a row that cannot fit them. */}
        <nav className="hidden items-center gap-1 text-[13px] md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-sm px-3 py-1.5 text-fg-2 hover:bg-raised hover:text-fg">{l.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 md:justify-self-end">
          <span className="hidden md:contents"><ThemeToggle /></span>
          <ButtonLink href="/app" size="sm" className="ml-1 h-8 px-3 text-[12.5px] md:ml-2 md:px-3.5">Launch app</ButtonLink>
          <SiteMenu links={LINKS} />
        </div>
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
          <p className="mt-3 max-w-[38ch]">Built for Monad Metropolis. Trades on Perpl, a perpetuals exchange on Monad, and reads smart money from Nansen.</p>
        </div>
        <ul className="grid gap-x-10 gap-y-2 sm:grid-cols-2">
          <li><NetworkNote /></li>
          <li>Market making can lose money. Monday reports results and does not promise profit.</li>
          <li>Smart-money signals can be wrong or late.</li>
          <li>You keep control: stop, kill, revoke, and withdraw directly on Perpl.</li>
        </ul>
      </div>
    </footer>
  );
}
