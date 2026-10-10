import type { Metadata } from 'next';
import { JetBrains_Mono, Mona_Sans } from 'next/font/google';
import './globals.css';

// Sentences in Mona Sans, every number in JetBrains Mono.
const sans = Mona_Sans({ subsets: ['latin'], variable: '--font-mona', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Monday', template: '%s - Monday' },
  description: 'An AI agent that market-makes on Perpl from your own account and pulls its quotes when Smart Traders move.',
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
