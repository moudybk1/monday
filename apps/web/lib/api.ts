export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
  }
}

/** Fired when the server says this tab acts for a different account than the one signed in (another tab switched). */
export const ACCOUNT_CHANGED = 'monday:account-changed';

// The account this tab is showing. Every change the tab asks for names it, and the server refuses one meant for an
// account that is no longer signed in, instead of applying it to whoever is.
let shown: string | null = null;
export const showAccount = (wallet: string | null) => void (shown = wallet);

/** Same-origin call; Next rewrites /api to the Monday server. */
export async function api<T>(path: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  if (shown && (init?.method ?? 'GET') !== 'GET') headers['x-monday-account'] = shown;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (data?.error === 'account_changed') window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Request failed.', data?.field);
  }
  return data as T;
}
