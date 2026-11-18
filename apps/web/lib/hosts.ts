// In production the site, the app and the analytics each have a host of their own (mondaytrade.xyz, app., analytics.).
// Locally, or before those hosts exist, all three are one origin: these are empty and every link stays relative.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? '';
const APP = process.env.NEXT_PUBLIC_APP_URL ?? '';
const ANALYTICS = process.env.NEXT_PUBLIC_ANALYTICS_URL ?? '';

/** The analytics pages are switched off for now: no links to them, and their URLs redirect home (next.config.ts). */
export const analyticsOn = process.env.NEXT_PUBLIC_ANALYTICS === 'on';

/** A page's address on the host that serves it: signed-in pages (My Monday included) on the app's, public analytics on theirs. */
export function at(path: string): string {
  if (/^\/(app|analytics\/monday)(?=[/?#]|$)/.test(path)) return APP + path;
  if (/^\/analytics(?=[/?#]|$)/.test(path)) return ANALYTICS + path;
  return SITE + path;
}
