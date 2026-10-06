import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '../..');
// One .env at the repo root serves both apps.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {}

const nextConfig: NextConfig = {
  transpilePackages: ['@monday/core'],
  // The same NETWORK switch the server reads decides which chain the wallet talks to.
  env: { NEXT_PUBLIC_NETWORK: process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet' },
  turbopack: { root },
  outputFileTracingRoot: root,
  // The browser only ever talks to this origin, so the session cookie stays first-party and SameSite=Strict.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:3001'}/api/:path*` }];
  },
};

export default nextConfig;
