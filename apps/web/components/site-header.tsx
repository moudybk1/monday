import Link from 'next/link';
import { NetworkNote } from './network-note';
import { SiteMenu, SiteNav } from './site-menu';
import { ThemeToggle } from './theme-toggle';
import { at } from '@/lib/hosts';
import { ButtonLink, Wordmark } from './ui';

const LINKS = [
  { href: at('/#how'), label: 'How it works' },
  { href: at('/system'), label: 'System' },
  { href: at('/analytics'), label: 'Analytics' },
];

/**
 * Header for the public pages. 48px like the app header, aligned to the page's own column so the wordmark sits over the
 * content's left edge. Clear over the top of the page, solid once it scrolls (.site-header in globals.css).
 */
export function SiteHeader() {
  return (
    <header className="site-header sticky top-0 z-30 h-12 border-b backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1320px] items-center justify-between gap-2 px-4 sm:px-8 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-6">
        <Wordmark />
        {/* Phones get every link in the menu instead of a row that cannot fit them. */}
        <SiteNav links={LINKS} />
        <div className="flex items-center gap-1 md:justify-self-end">
          <span className="hidden md:contents"><ThemeToggle /></span>
          <ButtonLink href={at('/app')} size="sm" className="ml-1 h-8 px-3.5 text-[12.5px] md:ml-2">Launch app</ButtonLink>
          <SiteMenu links={LINKS} />
        </div>
      </div>
    </header>
  );
}

const COLUMNS = [
  { title: 'Product', links: [{ href: at('/app'), label: 'Launch app' }, { href: at('/analytics'), label: 'Perpl analytics' }, { href: at('/analytics/screener'), label: 'Screener' }, { href: at('/analytics/flow'), label: 'Flow' }] },
  { title: 'Learn', links: [{ href: at('/#how'), label: 'How it works' }, { href: at('/system'), label: 'System' }, { href: at('/system#kimi'), label: 'Kimi, the risk governor' }, { href: at('/#faq'), label: 'Questions' }] },
  { title: 'Built on', links: [{ href: 'https://perpl.xyz', label: 'Perpl', external: true }, { href: 'https://www.monad.xyz', label: 'Monad', external: true }] },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
        <div className="grid gap-12 py-16 md:grid-cols-12">
          <div className="md:col-span-5">
            <Wordmark size={22} />
            <p className="mt-5 max-w-[38ch] text-[14px] leading-relaxed text-fg-2">
              An AI agent that market-makes on Perpl from your own account and steps aside when Smart Traders move. Built for Monad Metropolis.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:col-span-7">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="text-[13px] font-semibold">{c.title}</p>
                <ul className="mt-4 grid gap-2.5 text-[14px]">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {'external' in l
                        ? <a href={l.href} target="_blank" rel="noreferrer" className="text-fg-2 transition-colors hover:text-fg">{l.label}</a>
                        : <Link href={l.href} className="text-fg-2 transition-colors hover:text-fg">{l.label}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="grid gap-x-12 gap-y-3 border-t border-line py-7 text-[12.5px] leading-relaxed text-fg-3 md:grid-cols-2">
          <p><NetworkNote /></p>
          <p>Market making can lose money: Monday reports results and does not promise profit, and Smart Trader signals can be wrong or late. You keep control: stop, kill, revoke, and withdraw directly on Perpl.</p>
        </div>
      </div>
    </footer>
  );
}
