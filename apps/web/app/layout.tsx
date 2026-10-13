import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import './globals.css';

// Sentences in Instrument Sans, every number in IBM Plex Mono (the same character width as the mono it replaced, so
// price columns keep their alignment).
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-text', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-figures', display: 'swap' });

const description = 'An AI agent that market-makes on Perpl from your own account and pulls its quotes when Smart Traders move.';
export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: { default: 'Monday - AI market maker on Perpl', template: '%s - Monday' },
  description,
  openGraph: { type: 'website', siteName: 'Monday', title: 'Monday - AI market maker on Perpl', description },
  twitter: { card: 'summary', title: 'Monday - AI market maker on Perpl', description },
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
