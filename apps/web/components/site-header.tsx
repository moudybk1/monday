import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ScrollHeader, SiteMenu, SiteNav } from './site-menu';
import { at } from '@/lib/hosts';
import { Wordmark } from './ui';

const LINKS = [
  { href: at('/#modes'), label: 'Modes' },
  { href: at('/#how'), label: 'How It Works' },
  { href: at('/system'), label: 'System' },
  { href: at('/analytics'), label: 'Analytics' },
];

/**
 * Header for the public pages: 64px, with a 26px lockup, 16px links and a 44px button, sized to sit with the landing's
 * large type (the user found the 48px bar too small, 2026-11-15). Aligned to the page's own column so the wordmark sits
 * over the content's left edge. Clear over the top of the page, solid once it scrolls (.site-header in globals.css);
 * hidden while scrolling down, back on the first scroll up (ScrollHeader).
 */
export function SiteHeader() {
  return (
    <ScrollHeader className="site-header sticky top-0 z-30 h-16 border-b backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1320px] items-center justify-between gap-2 px-4 sm:px-8 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-6">
        <Wordmark size={26} />
        {/* Phones get every link in the menu instead of a row that cannot fit them. */}
        <SiteNav links={LINKS} />
        <div className="flex items-center gap-1 md:justify-self-end">
          {/* The one call to action on the public pages: a button with an arrow box whose arrow swings while pointed at. The
              public pages have no theme switch: the landing is always dark (the terminal keeps its own switch). */}
          <Link
            href={at('/app')}
            className="group ml-1 inline-flex h-11 items-center gap-3 whitespace-nowrap rounded-lg bg-fg pl-5 pr-1.5 text-[15px] font-semibold text-canvas transition-opacity duration-200 hover:opacity-90 active:translate-y-px md:ml-2"
          >
            Launch App
            <span aria-hidden className="grid size-8 place-items-center rounded-md bg-canvas text-fg">
              <ArrowRightIcon size={15} weight="bold" className="nudge" />
            </span>
          </Link>
          <SiteMenu links={LINKS} />
        </div>
      </div>
    </ScrollHeader>
  );
}

const COLUMNS = [
  { title: 'Product', links: [{ href: at('/app'), label: 'Launch App' }, { href: at('/analytics'), label: 'Perpl Analytics' }, { href: at('/analytics/screener'), label: 'Screener' }, { href: at('/analytics/flow'), label: 'Flow' }] },
  { title: 'Learn', links: [{ href: at('/#modes'), label: 'Modes' }, { href: at('/#how'), label: 'How It Works' }, { href: at('/system'), label: 'System' }, { href: at('/system#kimi'), label: 'Kimi, the Risk Governor' }, { href: at('/#faq'), label: 'Questions' }] },
  { title: 'Built On', links: [{ href: 'https://perpl.xyz', label: 'Perpl', external: true }, { href: 'https://www.monad.xyz', label: 'Monad', external: true }] },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
        <div className="grid gap-12 py-16 md:grid-cols-12">
          <div className="md:col-span-5">
            <Wordmark size={22} />
            <p className="mt-5 max-w-[38ch] text-[15px] leading-relaxed text-fg-2">
              An AI trading terminal for Perpl: a market maker, Agentic Trade and TWAP, all trading from your own account. Built for Monad Metropolis.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:col-span-7">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="text-[14px] font-semibold">{c.title}</p>
                <ul className="mt-4 grid gap-2.5 text-[15px]">
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
      </div>
    </footer>
  );
}
