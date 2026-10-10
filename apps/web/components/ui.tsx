import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

const BTN = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,filter] duration-150 active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0';
const VARIANT = {
  primary: 'bg-accent text-accent-fg not-disabled:hover:brightness-110',
  ghost: 'border border-line-2 text-fg not-disabled:hover:bg-raised-2',
  quiet: 'text-fg-2 not-disabled:hover:bg-raised not-disabled:hover:text-fg',
  danger: 'border border-ask/70 text-ask-fg not-disabled:hover:bg-ask-deep not-disabled:hover:text-white',
} as const;
const SIZE = { xs: 'h-6 px-2 text-[11.5px]', sm: 'h-7 px-2.5 text-[12px]', md: 'h-9 px-3.5 text-[13px]', lg: 'h-11 px-5 text-[14px]' } as const;

type BtnProps = { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE; className?: string; children: ReactNode };

export function Button({ variant = 'primary', size = 'md', className, ...p }: BtnProps & ComponentProps<'button'>) {
  return <button type="button" {...p} className={cx(BTN, VARIANT[variant], SIZE[size], className)} />;
}
export function ButtonLink({ variant = 'primary', size = 'md', className, ...p }: BtnProps & ComponentProps<typeof Link>) {
  return <Link {...p} className={cx(BTN, VARIANT[variant], SIZE[size], className)} />;
}

const TONE = {
  neutral: 'border-line-2 text-fg-2',
  accent: 'border-accent/45 bg-accent/12 text-accent',
  solid: 'border-transparent bg-fg text-canvas',
  bid: 'border-bid/50 bg-bid/10 text-bid-fg',
  ask: 'border-ask/55 bg-ask/12 text-ask-fg',
  warn: 'border-warn/50 text-warn',
} as const;

/** A state chip. Mono, small, uppercase: it reads as an instrument readout, not a decoration. */
export function Tag({ tone = 'neutral', children, className }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={cx('num inline-flex h-[18px] items-center rounded-sm border px-1.5 text-[10.5px] font-medium uppercase leading-none tracking-[0.04em] whitespace-nowrap', TONE[tone], className)}>{children}</span>;
}

/**
 * The mark: an M whose right leg has dropped out of line, in amber.
 * One side of the quote steps aside. Geometry only, no illustration.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M5 25V6l9.5 11.5L24 6" stroke="currentColor" strokeWidth="4.4" strokeLinejoin="miter" strokeMiterlimit="8" />
      <path d="M26.2 11v18" stroke="var(--accent)" strokeWidth="4.4" />
    </svg>
  );
}

export function Wordmark({ href = '/', size = 20 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-fg" aria-label="Monday home">
      <Mark size={size} />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">Monday</span>
    </Link>
  );
}

/** A terminal panel: hard edge, fixed header, body that scrolls on its own. */
export function Panel({ title, aside, children, className, bodyClassName }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('panel', className)}>
      <header className="flex h-8 flex-none items-center justify-between gap-3 border-b border-line px-2.5">
        <h2 className="truncate text-[12px] font-semibold">{title}</h2>
        {aside ? <div className="flex flex-none items-center gap-1.5 text-[11.5px] text-fg-3">{aside}</div> : null}
      </header>
      <div className={cx('scroll min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium">{label}</label>
      {children}
      {error ? <p role="alert" className="text-[12.5px] text-ask-fg">{error}</p> : hint ? <p className="text-[12.5px] text-fg-3">{hint}</p> : null}
    </div>
  );
}
export const INPUT = 'h-9 w-full rounded-sm border border-line-2 bg-raised px-3 text-[13px] text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('rounded-sm bg-raised motion-safe:animate-pulse', className)} aria-hidden />;
}

export function Notice({ tone = 'neutral', children, action }: { tone?: 'neutral' | 'warn' | 'ask'; children: ReactNode; action?: ReactNode }) {
  const t = { neutral: 'border-line-2 bg-raised text-fg-2', warn: 'border-warn/45 bg-warn/8 text-warn', ask: 'border-ask bg-ask-deep text-white' }[tone];
  return (
    <div role={tone === 'neutral' ? 'status' : 'alert'} className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sm border px-3 py-1.5 text-[12.5px]', t)}>
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}
