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

// One quote form of the Spread v2 symbol; the second is this one rotated 180 degrees.
const SPREAD = 'M36 0H82V20L32 70V80H20C8.9543 80 0 71.0457 0 60V36C0 16.1177 16.1177 0 36 0Z';

/**
 * The mark: two equal quote forms, bid and ask, rotated about one centre with the spread open between them.
 * Compact canvas from the Spread v2 kit, the one meant for 16-48 px.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-10 -22 148 148" fill="#FFA630" aria-hidden>
      <path d={SPREAD} />
      <path d={SPREAD} transform="rotate(180 64 52)" />
    </svg>
  );
}

// "Monday" from the Spread v2 lockup: Mona Sans 620 as outlines, [path, x offset] per letter.
const LETTERS: [string, number][] = [
  ['M73.0013 0V729H289.5922L404.3976 374.991L451.7324 189.8572H458.799L506.0672 374.991L620.2727 729H836.3969V0H703.4027V350.2702L707.4693 601.4725H699.936L630.6005 368.0038L513.5301 0H397.0013L280.7977 367.87L211.0621 601.4725H202.9955L207.0621 349.8035V0Z', 0],
  ['M300.7998 -9.2Q241 -9.2 192.6002 9.5001Q144.2003 28.2001 109.0004 64.3Q73.8005 100.4 54.8006 151.2999Q35.8007 202.1998 35.8007 265.9996Q35.8007 348.5995 67.5006 410.5994Q99.2006 472.5994 158.7004 507.4993Q218.2002 542.3993 300.7998 542.3993Q360.1996 542.3993 408.5994 523.6993Q456.9993 504.9993 491.7991 468.8993Q526.599 432.7993 545.5989 381.9994Q564.5989 331.1995 564.5989 266.3997Q564.5989 184.7998 533.0989 122.6999Q501.599 60.6 442.5992 25.7Q383.5994 -9.2 300.7998 -9.2ZM300.3998 96.9972Q340.4006 96.9972 370.5013 115.9976Q400.6019 134.9979 417.1023 172.8985Q433.6027 210.7991 433.6027 266.3997Q433.6027 308.2001 424.4025 339.9005Q415.2023 371.601 397.7019 393.3013Q380.2015 415.0017 355.901 425.8019Q331.6005 436.6022 300.7998 436.6022Q260.799 436.6022 230.4983 417.4018Q200.1976 398.2014 183.4973 360.6008Q166.7969 323.0002 166.7969 265.9996Q166.7969 224.5992 175.9971 192.8988Q185.1973 161.1984 202.8976 139.898Q220.598 118.5977 245.3986 107.7974Q270.1991 96.9972 300.3998 96.9972Z', 904],
  ['M66.4008 0V533.1993H190.3971L195.397 432.9987H201.7969Q224.197 487.799 271.2972 515.0991Q318.3975 542.3993 375.5977 542.3993Q415.9977 542.3993 450.4977 530.1993Q484.9977 517.9993 510.5977 491.5992Q536.1976 465.1992 550.4976 422.6992Q564.7976 380.1992 564.7976 319.7992V0H435.4014V292.2001Q435.4014 341.0009 423.8011 373.1013Q412.2009 405.2018 388.2005 420.802Q364.2001 436.4022 325.5995 436.4022Q284.7988 436.4022 255.6982 416.8019Q226.5977 397.2015 210.9973 365.2009Q195.397 333.2002 195.397 294.3992V0Z', 1499],
  ['M257.0006 -9.2Q208.4006 -9.2 168.1006 9.6Q127.8007 28.4 98.8007 63.8Q69.8007 99.2 54.3007 150.4999Q38.8007 201.7998 38.8007 266.7997Q38.8007 353.9995 66.3007 415.7994Q93.8007 477.5994 142.8007 510.1993Q191.8007 542.7993 257.0006 542.7993Q298.8009 542.7993 333.2011 529.7992Q367.6013 516.7991 392.1014 493.3989Q416.6016 469.9987 427.8016 438.1984H433.4015V729H562.7977V0H440.0013L435.0015 95.801H427.8016Q410.8015 48.6006 365.2013 19.7003Q319.6011 -9.2 257.0006 -9.2ZM302.7991 96.1971Q345.9998 96.1971 375.0003 115.3975Q404.0009 134.5979 418.7012 166.9984Q433.4015 199.3989 433.4015 238.9994V295Q433.4015 335.8004 418.1012 368.101Q402.8009 400.4015 374.1003 419.1019Q345.3998 437.8022 305.799 437.8022Q261.7985 437.8022 231.798 417.202Q201.7975 396.6017 186.3972 358.4011Q170.9968 320.2006 170.9968 266.7997Q170.9968 214.7988 185.7972 176.0983Q200.5975 137.3977 229.998 116.7974Q259.3986 96.1971 302.7991 96.1971Z', 2123],
  ['M257.0006 -9.2Q208.4006 -9.2 168.1006 9.6Q127.8007 28.4 98.8007 63.8Q69.8007 99.2 54.3007 150.4999Q38.8007 201.7998 38.8007 266.7997Q38.8007 353.9995 66.3007 415.7994Q93.8007 477.5994 142.8007 510.1993Q191.8007 542.7993 257.0006 542.7993Q298.8009 542.7993 333.2011 529.7992Q367.6013 516.7991 392.1014 493.3989Q416.6016 469.9987 427.8016 438.1984H435.0015L440.0013 533.1993H562.7977V0H440.0013L435.0015 95.801H427.8016Q410.8015 48.6006 365.2013 19.7003Q319.6011 -9.2 257.0006 -9.2ZM302.7991 96.1971Q345.9998 96.1971 375.0003 115.3975Q404.0009 134.5979 418.7012 166.9984Q433.4015 199.3989 433.4015 238.9994V295Q433.4015 335.8004 418.1012 368.101Q402.8009 400.4015 374.1003 419.1019Q345.3998 437.8022 305.799 437.8022Q261.7985 437.8022 231.798 417.202Q201.7975 396.6017 186.3972 358.4011Q170.9968 320.2006 170.9968 266.7997Q170.9968 214.7988 185.7972 176.0983Q200.5975 137.3977 229.998 116.7974Q259.3986 96.1971 302.7991 96.1971Z', 2745],
  ['M58.3998 -167V-60.603H118.5992Q141.5994 -60.603 157.4995 -54.603Q173.3995 -48.6029 184.5996 -35.8028Q195.7997 -23.0027 202.9998 -3.2025L230.8003 68.3988V14.0004L13.6005 533.1993H155.9963L249.3976 257.1986L281.1987 160.3964H286.9987L316.5997 257.1986L404.2009 533.1993H542.7969L329.3959 -33.2018Q310.1962 -84.8009 283.3966 -114.1005Q256.597 -143.4001 221.6975 -155.2001Q186.798 -167 142.1984 -167Z', 3365],
];

/** The full lockup, cropped to its ink. Symbol in amber; letters take the text colour so one file serves both themes. */
export function Wordmark({ href = '/', size = 20 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex text-fg" aria-label="Monday home">
      <svg height={size} viewBox="24 24 556 104" aria-hidden>
        <g fill="#FFA630" transform="translate(24 24)">
          <path d={SPREAD} />
          <path d={SPREAD} transform="rotate(180 64 52)" />
        </g>
        <g fill="currentColor" transform="translate(180.5539 104.662) scale(0.102 -0.102)">
          {LETTERS.map(([l, x]) => <path key={x} d={l} transform={`translate(${x} 0)`} />)}
        </g>
      </svg>
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
