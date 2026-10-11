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

/** One answer, at most `maxTokens` long, within `timeoutMs`. Throws when the model is off, slow or refuses. */
export async function ask(system: string, user: string, { maxTokens = 300, timeoutMs = 25_000, json = false } = {}): Promise<string> {
  if (!llmReady) throw new Error('No model configured');
  if (anthropic) {
    const res = await anthropic.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { timeout: timeoutMs });
    const text = res.content.find((b) => b.type === 'text');
    if (!text) throw new Error('no text block');
    return text.text;
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? '';
}

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
