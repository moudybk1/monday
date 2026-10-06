// One reconnecting JSON WebSocket, shared by the market-data feed and the
// trading venue: exponential backoff capped at 30 s, plus a silence watchdog.

import WebSocket from 'ws';

export interface Link {
  /** False when the socket is not open; the frame is dropped. */
  send(frame: unknown): boolean;
  /** Drop the socket and come back through the normal close path (used on sequence gaps). */
  bounce(): void;
  /** The session is healthy: reset the reconnect backoff. */
  ok(): void;
  stop(): void;
}

export interface LinkHandlers {
  /** Socket opened. Send the first frame now: the server's idle window is 5-10 s. */
  open(): void;
  frame(msg: any): void;
  /** Socket closed. Return false to stay down. */
  closed(code: number, reason: string): boolean;
}

// Both servers push a heartbeat every block (~0.4 s), so 10 s of silence means
// a half-open connection or a stuck handshake.
const SILENCE_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export function openLink(url: string, h: LinkHandlers): Link {
  let ws: WebSocket | undefined;
  let attempt = 0;
  let lastFrameAt = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    const sock = (ws = new WebSocket(url));
    lastFrameAt = Date.now();
    sock.on('open', () => h.open());
    sock.on('message', (raw) => {
      lastFrameAt = Date.now();
      try {
        h.frame(JSON.parse(raw.toString()));
      } catch (e) {
        // Never log the frame itself. A handler bug must not take the socket (or the process) down.
        console.error('[perpl] frame handler failed:', e instanceof Error ? e.message : e);
      }
    });
    sock.on('error', () => {}); // 'close' always follows and carries the outcome
    sock.on('close', (code, reason) => {
      if (stopped) return;
      ws = undefined;
      if (!h.closed(code, reason.toString())) return stop();
      // 1001 = the instance is shutting down; the docs say reconnect immediately.
      retry = setTimeout(connect, code === 1001 ? 0 : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
    });
  };

  const watchdog = setInterval(() => {
    if (ws && Date.now() - lastFrameAt > SILENCE_MS) ws.terminate();
  }, 2_000);

  const stop = () => {
    stopped = true;
    clearInterval(watchdog);
    clearTimeout(retry);
    ws?.terminate();
    ws = undefined;
  };

  connect();
  return {
    send(frame) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(frame));
      return true;
    },
    bounce: () => ws?.terminate(),
    ok: () => void (attempt = 0),
    stop,
  };
}
