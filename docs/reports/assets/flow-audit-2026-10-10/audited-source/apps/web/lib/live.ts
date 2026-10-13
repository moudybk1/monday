'use client';

import { useEffect, useRef, useState } from 'react';
import type { DashboardState } from '@monday/core';
import { api } from './api';

const wsUrl = () => process.env.NEXT_PUBLIC_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:3001/ws`;

/**
 * Live dashboard state. `auth` streams the signed-in user's own runner;
 * `public` streams the house account for the landing page.
 */
export function useLive(mode: 'auth' | 'public', onGone?: () => void) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let last = Date.now();
    // The server pushes every second. Six silent seconds means the picture on screen is old.
    const watchdog = setInterval(() => setStale(Date.now() - last > 6_000), 2_000);

    // First paint from REST, then the socket takes over.
    api<DashboardState | null>(mode === 'auth' ? '/state' : '/public/preview').then((s) => s && setState((cur) => cur ?? s)).catch(() => {});

    const open = async () => {
      if (stop.current) return;
      try {
        const hello = mode === 'auth' ? { type: 'auth', ticket: (await api<{ ticket: string }>('/ws-ticket')).ticket } : { type: 'public' };
        if (stop.current) return;
        ws = new WebSocket(wsUrl());
        ws.onopen = () => {
          attempt = 0;
          setConnected(true);
          ws?.send(JSON.stringify(hello));
        };
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as { type: string; data?: DashboardState };
          if (msg.data) {
            last = Date.now();
            setStale(false);
            setState(msg.data);
          } else if (msg.type === 'error') {
            // The server no longer has a runner for this session (key removed, or a simulated server restarted).
            onGone?.();
          }
        };
        ws.onclose = () => {
          setConnected(false);
          if (!stop.current) retry = setTimeout(open, Math.min(15_000, 1_000 * 2 ** attempt++));
        };
      } catch {
        if (!stop.current) retry = setTimeout(open, Math.min(15_000, 1_000 * 2 ** attempt++));
      }
    };
    void open();

    return () => {
      stop.current = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return { state, connected: connected && !stale };
}
