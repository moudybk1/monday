'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeToggle } from './theme-toggle';
import { Wordmark, cx } from './ui';

const NAV = [
  { href: '/app', label: 'Terminal' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/app/policy', label: 'Policy' },
  { href: '/evidence', label: 'Evidence' },
];
const isOn = (href: string, path: string) => (href === '/analytics' ? path.startsWith('/analytics') : path === href);

/**
 * The header the app and analytics share: the mark left, the sections centred, status and account right, 44px.
 * Below 1024px the sections take a second row of their own instead of running into the account.
 */
export function AppHeader({ nav = true, children }: { nav?: boolean; children?: ReactNode }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 grid flex-none grid-cols-[auto_minmax(0,1fr)] border-b border-line bg-canvas px-3 lg:h-11 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex h-11 items-center"><Wordmark size={18} /></div>
      {nav && (
        <nav aria-label="App" className="col-span-2 row-start-2 -mx-3 flex h-9 items-stretch justify-center gap-1 border-t border-line lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:h-auto lg:border-0">
          {NAV.map((n) => {
            const on = isOn(n.href, path);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={cx('flex items-center px-3 text-[12.5px]', on ? 'font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]' : 'text-fg-3 hover:text-fg')}>
                {n.label}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="flex h-11 items-center justify-end gap-2 lg:col-start-3">
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
