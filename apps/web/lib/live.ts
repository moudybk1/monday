'use client';

import { useEffect, useState } from 'react';
import type { DashboardState } from '@monday/core';
import { ApiError, api } from './api';

const wsUrl = () => process.env.NEXT_PUBLIC_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:3001/ws`;

/** The server pushes every second. Six silent seconds means the picture on screen is old; twelve, the socket is dead. */
const STALE_MS = 6_000;
const DEAD_MS = 12_000;

/**
 * Live dashboard state. `auth` streams the signed-in user's own runner, `account` naming whose: when it changes the
 * stream is reopened and the old account's data dropped. `public` streams the house account for the landing page.
 */
export function useLive(mode: 'auth' | 'public', onGone?: () => void, account?: string | null) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setState(null); // never show one account's numbers under another
    // Per run, not a ref: under StrictMode or Fast Refresh a second run must not revive the first one's pending open().
    let stopped = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let last = Date.now();
    const watchdog = setInterval(() => {
      const silent = Date.now() - last;
      setStale(silent > STALE_MS);
      // A half-open socket (laptop sleep, network change) never fires close by itself: close it so onclose reconnects.
      if (silent > DEAD_MS && ws?.readyState === WebSocket.OPEN) ws.close();
    }, 2_000);

    // First paint from REST, then the socket takes over.
    api<DashboardState | null>(mode === 'auth' ? '/state' : '/public/preview').then((s) => s && setState((cur) => cur ?? s)).catch(() => {});

    const reconnect = () => {
      if (!stopped) retry = setTimeout(open, Math.min(15_000, 1_000 * 2 ** attempt++));
    };
    const open = async () => {
      if (stopped) return;
      try {
        const hello = mode === 'auth' ? { type: 'auth', ticket: (await api<{ ticket: string }>('/ws-ticket')).ticket } : { type: 'public' };
        if (stopped) return;
        const socket = new WebSocket(wsUrl());
        ws = socket;
        last = Date.now();
        socket.onopen = () => {
          setConnected(true);
          socket.send(JSON.stringify(hello));
        };
        socket.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as { type: string; data?: DashboardState };
          if (msg.data) {
            attempt = 0; // healthy only once data flows, not merely once the socket opens
            last = Date.now();
            setStale(false);
            setState(msg.data);
          } else if (msg.type === 'error') {
            // The server no longer has a runner for this session (key removed, or a simulated server restarted).
            onGone?.();
            socket.close();
          }
        };
        socket.onclose = () => {
          setConnected(false);
          reconnect();
        };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onGone?.(); // signed out, here or in another tab
        reconnect();
      }
    };
    void open();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, account]);

  return { state, connected: connected && !stale };
}
