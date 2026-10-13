'use client';

import { ListIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { ThemeToggle } from './theme-toggle';

type Links = { href: string; label: string }[];

/** The desktop row of page links. The current page keeps its underline (.navlink in globals.css). */
export function SiteNav({ links }: { links: Links }) {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1 text-[15px] font-medium md:flex" aria-label="Main">
      {links.map((l) => {
        const on = !l.href.includes('#') && path.startsWith(new URL(l.href, 'http://x').pathname);
        return (
          <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined} className="navlink px-3 py-1.5 text-fg-2 transition-colors hover:text-fg aria-[current=page]:text-fg">
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phones: the same links as the desktop bar, behind one button. A native popover, so Escape, a tap outside and
 * focus going back to the button come from the browser; a link only has to close it.
 */
export function SiteMenu({ links }: { links: Links }) {
  const menu = useRef<HTMLDivElement>(null);
  return (
    <>
      <button type="button" popoverTarget="site-menu" aria-label="Menu" className="grid size-8 place-items-center rounded-sm text-fg-2 hover:bg-raised hover:text-fg md:hidden">
        <ListIcon size={18} />
      </button>
      <div ref={menu} id="site-menu" popover="auto" className="md:hidden inset-x-0 top-12 bottom-auto m-0 h-auto w-full max-w-none border-0 border-b border-line bg-void p-2 text-fg">
        <nav aria-label="Main menu" className="grid">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => menu.current?.hidePopover()} className="flex h-12 items-center rounded-sm px-3 text-[16px] text-fg-2 hover:bg-raised hover:text-fg">
              {l.label}
            </Link>
          ))}
          <div className="mt-1 flex h-12 items-center justify-between border-t border-line px-3 text-[14px] text-fg-3">
            Theme <ThemeToggle />
          </div>
        </nav>
      </div>
    </>
  );
}
