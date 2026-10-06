'use client';

import { MoonIcon, SunIcon } from '@phosphor-icons/react';

export function ThemeToggle() {
  const flip = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('monday-theme', next);
    } catch {}
  };
  return (
    <button type="button" onClick={flip} aria-label="Switch between dark and light theme" className="grid size-7 place-items-center rounded-sm text-fg-2 hover:bg-raised hover:text-fg">
      <SunIcon size={15} className="hidden dark:block" />
      <MoonIcon size={15} className="dark:hidden" />
    </button>
  );
}
