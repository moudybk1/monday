import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '../..');
// One .env at the repo root serves both apps.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {}

const nextConfig: NextConfig = {
  transpilePackages: ['@monday/core'],
  // next dev would otherwise write AGENTS.md and CLAUDE.md into apps/web on every start.
  agentRules: false,
  // The same NETWORK switch the server reads decides which chain the wallet talks to.
  env: { NEXT_PUBLIC_NETWORK: process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet' },
  turbopack: {
    root,
    // wagmi's Base Account connector pulls in @coinbase/cdp-sdk, a server SDK whose optional x402 imports break the build.
    // The browser never calls it, so it resolves to a stub.
    resolveAlias: { '@coinbase/cdp-sdk': './lib/cdp-sdk-stub.js' },
  },
  outputFileTracingRoot: root,
  // Browser hardening on every page. No page may be framed (a trading screen under someone else's overlay is a
  // clickjacking target). A full content security policy is still to come: it needs a report-only trial with the wallets.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' }, // per host; browsers ignore it over plain http (local dev)
      ],
    }];
  },
  // The evidence page is gone (2026-10-12); links to it, shared before, land on the home page.
  async redirects() {
    return [{ source: '/evidence', destination: '/', permanent: false }];
  },
  // The browser only ever talks to this origin, so the session cookie stays first-party and SameSite=Strict.
  async rewrites() {
    // Public stats come from their own process (npm run indexer), everything else from the trading server.
    return [
      { source: '/api/stats/:path*', destination: `${process.env.STATS_URL ?? 'http://localhost:3002'}/api/stats/:path*` },
      { source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:3001'}/api/:path*` },
    ];
  },
};

export default nextConfig;
