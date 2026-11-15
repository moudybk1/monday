import type { Metadata } from 'next';
import { Geist_Mono, Host_Grotesk, Public_Sans } from 'next/font/google';
import './globals.css';

// Text in Host Grotesk (neutral, crisp, rarely seen yet), chosen by the user on 2026-11-15 from a specimen against
// Schibsted Grotesk, Hanken Grotesk, Onest, Albert Sans, IBM Plex Sans and Manrope, the font before it.
// Numbers (.num) in Public Sans, the user's pick the same day after two number-font specimens.
// Geist Mono only for hashes and addresses.
const sans = Host_Grotesk({ subsets: ['latin'], variable: '--font-text', display: 'swap' });
const numbers = Public_Sans({ subsets: ['latin'], variable: '--font-numbers', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-figures', display: 'swap', preload: false });

const description = 'An AI trading terminal for Perpl: a market maker, Agentic Trade and TWAP, trading from your own account inside limits you set.';
export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: { default: 'Monday - AI trading terminal for Perpl', template: '%s - Monday' },
  description,
  openGraph: { type: 'website', siteName: 'Monday', title: 'Monday - AI trading terminal for Perpl', description },
  twitter: { card: 'summary_large_image', title: 'Monday - AI trading terminal for Perpl', description },
};

// Always dark: the theme switch was removed at the user's request (2026-11-15), so a light choice saved before is ignored.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${numbers.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
