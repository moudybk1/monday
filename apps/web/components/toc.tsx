'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { cx } from './ui';

/**
 * "On this page" for a long article: the section being read is marked, and the marker slides between sections. The
 * current section is the last one whose top has passed a line a fifth of the way down the screen.
 */
export function Toc({ items }: { items: { id: string; label: string }[] }) {
  const [on, setOn] = useState(items[0]?.id);
  const reduce = useReducedMotion();
  useEffect(() => {
    const els = items.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => e != null);
    const io = new IntersectionObserver(() => {
      const line = window.innerHeight * 0.2;
      let current = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      setOn(current);
    }, { rootMargin: '0px 0px -80% 0px', threshold: [0, 1] });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  return (
    <ol className="relative grid gap-0.5 border-l border-line-2 text-[13px]">
      {items.map((t) => (
        <li key={t.id} className="relative">
          {on === t.id && <motion.span layoutId="toc-on" aria-hidden className="absolute -left-px inset-y-0 w-0.5 bg-accent" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }} />}
          <a href={`#${t.id}`} aria-current={on === t.id ? 'location' : undefined} className={cx('block py-1 pl-4 transition-colors', on === t.id ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg')}>{t.label}</a>
        </li>
      ))}
    </ol>
  );
}
