import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { at } from '@/lib/hosts';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

const BTN = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,filter] duration-150 active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0';
const VARIANT = {
  primary: 'bg-accent text-accent-fg not-disabled:hover:brightness-110',
  ghost: 'border border-line-2 text-fg not-disabled:hover:bg-raised-2',
  quiet: 'text-fg-2 not-disabled:hover:bg-raised not-disabled:hover:text-fg',
  danger: 'border border-ask/70 text-ask-fg not-disabled:hover:bg-ask-deep not-disabled:hover:text-white',
  /** On an accent surface: the page colours swapped, so the button still reads as the one thing to press. */
  inverse: 'bg-accent-fg text-accent not-disabled:hover:opacity-90',
} as const;
const SIZE = { xs: 'h-6 px-2 text-[13px]', sm: 'h-7 px-2.5 text-[13px]', md: 'h-9 px-3.5 text-[14px]', lg: 'h-11 px-5 text-[15px]' } as const;

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

/** A state chip: small, medium weight, sentence case. It reads as an instrument readout, not a decoration. */
export function Tag({ tone = 'neutral', children, className }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex h-5 items-center rounded-sm border px-1.5 capitalize text-[12px] font-medium leading-none whitespace-nowrap', TONE[tone], className)}>{children}</span>;
}

/** A market in a table: a click opens it on the Terminal's chart and book. Plain text where nothing can open it. */
export function SymButton<S extends string>({ sym, onPick, className, children = sym }: { sym: S; onPick?: (s: S) => void; className?: string; children?: ReactNode }) {
  if (!onPick) return <span className={className}>{children}</span>;
  return <button type="button" onClick={() => onPick(sym)} title={`Show ${sym} on the chart`} className={cx('cursor-pointer underline-offset-2 hover:underline', className)}>{children}</button>;
}

/** A market's coin logo (public/coins, the same files the chart uses). One without a file hides instead of showing a broken image. */
export function CoinIcon({ sym, className }: { sym: string; className?: string }) {
  return <img src={`/coins/${sym}.png`} alt="" className={cx('size-4 flex-none rounded-full', className)} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
}

// The Dusk mark (brand kit, 2026-11-15): a sun half set on the horizon and its reflection in three fading bars.
// Drawn in its own 48-unit box (8 6 48 48), centred on (32, 30).
export const DUSK_SUN = 'M10 30A22 22 0 0 1 54 30Z';
/** [x, y, width, opacity] of each bar under the sun; 4 units tall, fully rounded. */
export const DUSK_BARS: [number, number, number, number][] = [[10.7, 33.5, 42.6, 0.9], [13.9, 40.5, 36.21, 0.6], [21.81, 47.5, 20.37, 0.35]];

/** The mark's shapes, in whatever colour the parent gives them (`fill`). */
function DuskShapes() {
  return (
    <>
      <path d={DUSK_SUN} />
      {DUSK_BARS.map(([x, y, w, o]) => <rect key={y} x={x} y={y} width={w} height={4} rx={2} opacity={o} />)}
    </>
  );
}

/** The mark, in the brand colour of the current theme (periwinkle on dark, indigo on light). */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="8 6 48 48" fill="var(--accent)" className={className} aria-hidden>
      <DuskShapes />
    </svg>
  );
}

// "Monday" from the brand kit's lockup, as outlines.
const LETTERS = 'M5.46875 0.0H17.7734375V-30.76171875C17.7734375 -38.134765625 22.509765625 -42.138671875 28.076171875 -42.138671875C33.544921875 -42.138671875 37.451171875 -38.4765625 37.451171875 -32.861328125V0.0H49.4140625V-31.640625C49.4140625 -37.79296875 53.271484375 -42.138671875 59.521484375 -42.138671875C64.794921875 -42.138671875 69.091796875 -39.111328125 69.091796875 -32.275390625V0.0H81.4453125V-34.033203125C81.4453125 -46.142578125 73.92578125 -52.587890625 64.16015625 -52.587890625C56.640625 -52.587890625 50.48828125 -48.779296875 47.75390625 -42.822265625C45.60546875 -48.73046875 39.892578125 -52.587890625 32.91015625 -52.587890625C26.416015625 -52.587890625 20.5078125 -49.267578125 17.3828125 -42.626953125V-51.5625H5.46875Z M111.880859375 1.171875C127.06640625 1.171875 137.3203125 -9.716796875 137.3203125 -25.732421875C137.3203125 -41.748046875 127.06640625 -52.734375 111.880859375 -52.734375C96.6953125 -52.734375 86.44140625 -41.748046875 86.44140625 -25.732421875C86.44140625 -9.716796875 96.6953125 1.171875 111.880859375 1.171875ZM111.880859375 -9.130859375C103.921875 -9.130859375 98.892578125 -15.4296875 98.892578125 -25.732421875C98.892578125 -36.083984375 103.970703125 -42.431640625 111.880859375 -42.431640625C119.7421875 -42.431640625 124.8203125 -36.03515625 124.8203125 -25.732421875C124.8203125 -15.478515625 119.791015625 -9.130859375 111.880859375 -9.130859375Z M154.62109375 -29.150390625C154.62109375 -37.939453125 159.455078125 -41.796875 165.900390625 -41.796875C172.4921875 -41.796875 176.30078125 -37.841796875 176.30078125 -30.2734375V0.0H188.654296875V-32.2265625C188.654296875 -45.458984375 181.037109375 -52.587890625 170.24609375 -52.587890625C163.166015625 -52.587890625 157.94140625 -49.462890625 154.42578125 -43.65234375V-51.5625H142.31640625V0.0H154.62109375Z M216.013671875 1.025390625C222.751953125 1.025390625 228.416015625 -1.904296875 231.638671875 -7.861328125H231.736328125V0.0H243.845703125V-72.75390625H231.541015625V-44.23828125H231.443359375C228.123046875 -49.90234375 222.60546875 -52.587890625 215.916015625 -52.587890625C202.68359375 -52.587890625 193.69921875 -41.69921875 193.69921875 -25.830078125C193.69921875 -9.765625 202.537109375 1.025390625 216.013671875 1.025390625ZM218.89453125 -9.27734375C211.27734375 -9.27734375 206.150390625 -15.13671875 206.150390625 -25.830078125C206.150390625 -36.474609375 211.27734375 -42.3828125 218.89453125 -42.3828125C226.951171875 -42.3828125 232.224609375 -35.83984375 232.224609375 -25.830078125C232.224609375 -15.771484375 226.951171875 -9.27734375 218.89453125 -9.27734375Z M267.005859375 0.830078125C275.404296875 0.830078125 279.75 -2.685546875 282.19140625 -7.275390625H282.38671875V0.0H294.49609375V-35.15625C294.49609375 -45.8984375 286.537109375 -52.587890625 273.109375 -52.587890625C259.6328125 -52.587890625 251.234375 -45.80078125 250.6484375 -35.546875H262.513671875C262.85546875 -39.892578125 266.859375 -43.017578125 272.865234375 -43.017578125C278.7734375 -43.017578125 282.2890625 -39.892578125 282.2890625 -35.498046875V-35.107421875C282.2890625 -31.591796875 279.017578125 -31.4453125 269.447265625 -30.37109375C258.802734375 -29.248046875 249.18359375 -26.3671875 249.18359375 -14.6484375C249.18359375 -4.345703125 256.751953125 0.830078125 267.005859375 0.830078125ZM270.033203125 -8.30078125C264.662109375 -8.30078125 261.1953125 -10.693359375 261.1953125 -14.74609375C261.1953125 -19.43359375 265.6875 -21.337890625 270.9609375 -22.119140625C276.0390625 -22.900390625 280.82421875 -23.681640625 282.337890625 -24.658203125V-19.091796875C282.337890625 -13.0859375 278.08984375 -8.30078125 270.033203125 -8.30078125Z M302.8125 20.41015625H310.869140625C318.33984375 20.41015625 323.41796875 16.552734375 326.494140625 8.49609375L349.541015625 -51.5625H336.650390625L327.2265625 -24.70703125C325.908203125 -20.8984375 324.6875 -17.08984375 323.515625 -13.28125C322.34375 -17.08984375 321.07421875 -20.8984375 319.8046875 -24.70703125L310.33203125 -51.5625H297.294921875L317.16796875 -0.29296875L315.263671875 4.6875C313.798828125 8.740234375 312.236328125 10.400390625 308.916015625 10.400390625H302.8125Z';

/**
 * The lockup: the brand kit's mark and letters, re-set on 2026-11-15 because the kit's version (mark from the baseline
 * to the top of the d) sat high against an all-lowercase word. Same size, but the mark is centred so its horizon line
 * meets the middle of the letters (x-height 52.6 units), and it stands 26 units clear of the m instead of 21.
 * Mark in the brand colour; letters take the text colour so one file serves both themes.
 */
export function Wordmark({ href = at('/'), size = 20 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex text-fg" aria-label="Monday home">
      <svg height={size} viewBox="0 -72.75 438.85 93.16" aria-hidden>
        <g fill="var(--accent)" transform="translate(-15.65,-71.52) scale(1.5647)"><DuskShapes /></g>
        <path fill="currentColor" transform="translate(89.3,0)" d={LETTERS} />
      </svg>
    </Link>
  );
}

/** A terminal panel: hard edge, fixed header, body that scrolls on its own. */
export function Panel({ title, aside, children, className, bodyClassName }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('panel', className)}>
      <header className="flex h-8 flex-none items-center justify-between gap-3 border-b border-line px-2.5">
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        {aside ? <div className="flex flex-none items-center gap-1.5 text-[13px] text-fg-3">{aside}</div> : null}
      </header>
      <div className={cx('scroll min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-medium">{label}</label>
      {children}
      {error ? <p role="alert" className="text-[13px] text-ask-fg">{error}</p> : hint ? <p className="text-[13px] text-fg-3">{hint}</p> : null}
    </div>
  );
}
export const INPUT = 'h-9 w-full rounded-sm border border-line-2 bg-raised px-3 text-[14px] text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('rounded-sm bg-raised motion-safe:animate-pulse', className)} aria-hidden />;
}

export function Notice({ tone = 'neutral', children, action }: { tone?: 'neutral' | 'warn' | 'ask'; children: ReactNode; action?: ReactNode }) {
  const t = { neutral: 'border-line-2 bg-raised text-fg-2', warn: 'border-warn/45 bg-warn/8 text-warn', ask: 'border-ask bg-ask-deep text-white' }[tone];
  return (
    <div role={tone === 'neutral' ? 'status' : 'alert'} className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sm border px-3 py-1.5 text-[13px]', t)}>
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}
