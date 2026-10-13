import { expect, it } from 'vitest';

// Before config loads: a keyed RPC URL, as QuickNode and BlockVision hand them out.
Object.assign(process.env, { VENUE: 'sim', DATABASE_PATH: ':memory:', MONAD_RPC_URL: 'https://x.monad-mainnet.quiknode.pro/0123456789abcdef/', STATS_RPC_URL: 'https://monad-mainnet.blockvision.org/v1/keyKEYkey', NANSEN_API_KEY: '', LLM_API_KEY: '', TELEGRAM_BOT_TOKEN: '123456:telegramSecretToken', ENVIO_API_TOKEN: '' });
const { redact } = await import('./config');

it('a failed RPC call cannot put its keyed URL, or a token, into a log line', () => {
  const viemLike = 'HTTP request failed.\n\nStatus: 429\nURL: https://x.monad-mainnet.quiknode.pro/0123456789abcdef\nRequest body: {}\n\nVersion: viem@2';
  expect(redact(viemLike)).toContain('URL: https://x.monad-mainnet.quiknode.pro/…');
  expect(redact(viemLike)).not.toContain('0123456789abcdef');
  expect(redact('getLogs failed at https://monad-mainnet.blockvision.org/v1/keyKEYkey')).not.toContain('keyKEYkey');
  expect(redact('fetch https://api.telegram.org/bot123456:telegramSecretToken/sendMessage')).not.toContain('telegramSecretToken');
});
