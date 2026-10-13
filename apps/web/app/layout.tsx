import type { Metadata } from 'next';
import { Geist_Mono, Manrope } from 'next/font/google';
import './globals.css';

// Text and numbers in Manrope (tall x-height, clear tabular figures at small sizes), chosen by the user on 2026-10-14
// from a specimen against Geist, Plus Jakarta Sans and Inter. Geist Mono only for hashes and addresses.
const sans = Manrope({ subsets: ['latin'], variable: '--font-text', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-figures', display: 'swap', preload: false });

const description = 'An AI trading terminal for Perpl: a market maker, Agentic Trade and TWAP, trading from your own account inside limits you set.';
export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: { default: 'Monday - AI trading terminal for Perpl', template: '%s - Monday' },
  description,
  openGraph: { type: 'website', siteName: 'Monday', title: 'Monday - AI trading terminal for Perpl', description },
  twitter: { card: 'summary_large_image', title: 'Monday - AI trading terminal for Perpl', description },
};

// A terminal is dark unless the user chose otherwise. Set before first paint so the page never flashes.
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem('monday-theme')||'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
