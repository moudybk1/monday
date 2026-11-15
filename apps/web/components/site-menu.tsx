'use client';

import { ListIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

type Links = { href: string; label: string }[];

/**
 * The public header's own element. It slides up out of view while the reader scrolls down and comes back as soon as
 * they scroll up a little (8px). Always shown near the top of the page and while the phone menu is open; CSS keeps it
 * shown while focus is inside it (.site-header in globals.css).
 */
export function ScrollHeader({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = window.scrollY;
    let up = 0;
    let raf = 0;
    const show = (on: boolean) => { el.dataset.hidden = on ? 'false' : 'true'; };
    const tick = () => {
      raf = 0;
      const y = window.scrollY;
      const d = y - last;
      last = y;
      if (y < 80 || document.getElementById('site-menu')?.matches(':popover-open')) { up = 0; return show(true); }
      if (d > 0) { up = 0; if (y > 120) show(false); }
      else if (d < 0) { up -= d; if (up > 8) show(true); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);
  return <header ref={ref} data-hidden="false" className={className}>{children}</header>;
}

/** The desktop row of page links. The current page keeps its underline (.navlink in globals.css). */
export function SiteNav({ links }: { links: Links }) {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1.5 text-[16px] font-medium md:flex" aria-label="Main">
      {links.map((l) => {
        const on = !l.href.includes('#') && path.startsWith(new URL(l.href, 'http://x').pathname);
        return (
          <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined} className="navlink whitespace-nowrap px-3.5 py-2 text-fg-2 transition-colors hover:text-fg aria-[current=page]:text-fg">
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
      <button type="button" popoverTarget="site-menu" aria-label="Menu" className="grid size-10 place-items-center rounded-md text-fg-2 hover:bg-raised hover:text-fg md:hidden">
        <ListIcon size={22} />
      </button>
      <div ref={menu} id="site-menu" popover="auto" className="md:hidden inset-x-0 top-16 bottom-auto m-0 h-auto w-full max-w-none border-0 border-b border-line bg-void p-2 text-fg">
        <nav aria-label="Main menu" className="grid">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => menu.current?.hidePopover()} className="flex h-12 items-center rounded-sm px-3 text-[16px] text-fg-2 hover:bg-raised hover:text-fg">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
