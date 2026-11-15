'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { at } from '@/lib/hosts';
import { Wordmark, cx } from './ui';

// In the order a user goes through them: set Monday up, then watch it trade.
const NAV = [
  { href: '/app/setup', label: 'Setup' },
  { href: '/app', label: 'Terminal' },
  { href: '/analytics', label: 'Analytics' },
];
// Setup covers the choice of what to run and each one's own setup: the market maker's policy and onboarding too.
const isOn = (href: string, path: string) =>
  href === '/analytics' ? path.startsWith('/analytics')
  : href === '/app/setup' ? path.startsWith('/app/setup') || path === '/app/policy' || path === '/app/onboarding'
  : path === href;

/**
 * The header the app and analytics share: the mark left, the sections centred, status and account right, 56px (a step
 * under the site header's 64, since the terminal below it needs the height).
 * Below 1024px the sections take a second row of their own instead of running into the account.
 */
export function AppHeader({ nav = true, children }: { nav?: boolean; children?: ReactNode }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 grid flex-none grid-cols-[auto_minmax(0,1fr)] border-b border-line bg-canvas px-4 lg:h-14 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex h-14 items-center"><Wordmark size={24} /></div>
      {/* The sections as tabs in one track, the current one lifted, like the landing's mode chips. */}
      {nav && (
        <nav aria-label="App" className="col-span-2 row-start-2 -mx-4 flex items-center justify-center border-t border-line py-1.5 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:border-0 lg:py-0">
          <span className="flex gap-0.5 rounded-lg bg-raised p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
            {NAV.map((n) => {
              const on = isOn(n.href, path);
              return (
                <Link key={n.href} href={at(n.href)} aria-current={on ? 'page' : undefined} className={cx('flex h-9 items-center rounded-md px-[1.125rem] text-[15px] font-medium transition-colors duration-200', on ? 'bg-raised-2 text-fg shadow-[inset_0_0_0_1px_var(--line-2)]' : 'text-fg-2 hover:text-fg')}>
                  {n.label}
                </Link>
              );
            })}
          </span>
        </nav>
      )}
      <div className="flex h-14 items-center justify-end gap-2 lg:col-start-3">
        {children}
      </div>
    </header>
  );
}
