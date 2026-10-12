// A small model call for the analytics pages: short prompts, a JSON or plain-text answer, a hard timeout. The same
// provider settings as the trading governor (LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL); claude-code, which
// runs the laptop's own login, is not offered here because this process serves the public.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const { provider, apiKey, baseUrl, model: configured } = config.llm;
// STATS_LLM_MODEL picks a quicker model for the pages than the one the governor thinks with.
const model = (process.env.STATS_LLM_MODEL ?? '').trim() || configured || (provider === 'openai-compatible' ? '' : 'claude-haiku-5-5');
export const llmReady = Boolean(apiKey && model && (provider === 'anthropic' || (provider === 'openai-compatible' && baseUrl)));
const anthropic = llmReady && provider === 'anthropic' ? new Anthropic({ apiKey, baseURL: baseUrl || undefined, timeout: 30_000, maxRetries: 0 }) : null;

/**
 * One answer, at most `maxTokens` long, within `timeoutMs`. Throws when the model is off, slow or refuses.
 * The request stays minimal on purpose: on b.ai, kimi-k2.6 rejects any `temperature` with a 400 and answers an empty
 * string in JSON mode or under a `max_tokens` cap (measured 2026-10-11), so the OpenAI-compatible call sends only the
 * model, the messages and, for Kimi, thinking off. Callers that want JSON ask for it in the prompt and the parser accepts fenced replies; the
 * prompts themselves keep the answers short.
 */
export async function ask(system: string, user: string, { maxTokens = 300, timeoutMs = 25_000, model: which = model } = {}): Promise<string> {
  if (!llmReady) throw new Error('No model configured');
  if (anthropic) {
    const res = await anthropic.messages.create({ model: which, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { timeout: timeoutMs });
    const text = res.content.find((b) => b.type === 'text');
    if (!text) throw new Error('no text block');
    return text.text;
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    // Kimi thinks before it writes by default: about 2,700 hidden tokens and 38 s for a wallet summary, against 4 s and
    // 160 tokens with thinking off (measured on b.ai 2026-10-12). These are short, factual tasks, so it stays off.
    body: JSON.stringify({ model: which, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...(/^kimi/i.test(which) ? { thinking: { type: 'disabled' } } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? '';
}

/** The model was late (our timeout or an abort), as against refusing or failing (a 400 when the account is out of credit). */
export const timedOut = (e: unknown) => e instanceof Anthropic.APIConnectionTimeoutError || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'));

/** The first JSON object in a reply, however the model wrapped it. */
export function firstJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  for (let end = text.indexOf('}', start); start >= 0 && end >= 0; end = text.indexOf('}', end + 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      // not closed yet: try the next brace
    }
  }
  throw new SyntaxError('no JSON object in the reply');
}
