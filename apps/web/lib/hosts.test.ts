import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('puts each page on the host that serves it, and stays relative when no hosts are set', async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://m.xyz');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.m.xyz');
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_URL', 'https://analytics.m.xyz');
  const { at } = await import('./hosts');
  expect(at('/app')).toBe('https://app.m.xyz/app');
  expect(at('/app/policy')).toBe('https://app.m.xyz/app/policy');
  expect(at('/app?next=/analytics/monday')).toBe('https://app.m.xyz/app?next=/analytics/monday');
  expect(at('/analytics/monday')).toBe('https://app.m.xyz/analytics/monday'); // needs the session
  expect(at('/analytics')).toBe('https://analytics.m.xyz/analytics');
  expect(at('/analytics/wallet/42')).toBe('https://analytics.m.xyz/analytics/wallet/42');
  expect(at('/analyticsx')).toBe('https://m.xyz/analyticsx');
  expect(at('/decisions/7')).toBe('https://m.xyz/decisions/7');
  expect(at('/#how')).toBe('https://m.xyz/#how');

  vi.unstubAllEnvs();
  vi.resetModules();
  expect((await import('./hosts')).at('/app/policy')).toBe('/app/policy');
});
