"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";

export interface RealtimeEvent {
  scope: "board" | "org" | "user";
  targetId: string;
  type: string;
  actorId: string | null;
  data: any;
  timestamp: string;
}

export type ServerFrame =
  | { type: "ready"; userId: string }
  | { type: "event"; channel: string; event: RealtimeEvent }
  | { type: "subscribed" | "unsubscribed"; channel: string; reason?: string }
  | { type: "subscribe_denied"; channel: string; reason: string }
  | { type: "presence:sync"; channel: string; users: Array<{ userId: string; name: string; color: string }> }
  | { type: "presence:cursor"; channel: string; userId: string; name: string; color: string; x: number; y: number }
  | { type: "presence:left"; channel: string; userId: string }
  | { type: "task:typing"; channel: string; taskId: string; userId: string; isTyping: boolean }
  | { type: "pong" | "error"; message?: string };

type Listener = (frame: ServerFrame) => void;
export type ConnectionState = "connecting" | "live" | "offline";

interface RealtimeContextValue {
  state: ConnectionState;
  subscribe: (channel: string) => () => void;
  listen: (listener: Listener) => () => void;
  send: (message: Record<string, unknown>) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * One socket for the whole session. Authenticates with a single-use ticket
 * from the API (never the JWT in the URL), reconnects with capped backoff,
 * and re-subscribes to every channel components still hold on reconnect.
 * Channel subscriptions are reference-counted across components.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [state, setState] = useState<ConnectionState>("offline");
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<Listener>());
  const channels = useRef(new Map<string, number>());

  const rawSend = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (cancelled) return;
      setState("connecting");
      let ticket: string;
      try {
        ticket = (await api.post<{ ticket: string }>("/auth/ws-ticket")).ticket;
      } catch {
        return scheduleReconnect();
      }
      if (cancelled) return;

      const ws = new WebSocket(`${WS_URL}/?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(e.data);
        } catch {
          return;
        }
        if (frame.type === "ready") {
          attempt = 0;
          setState("live");
          for (const channel of channels.current.keys()) ws.send(JSON.stringify({ type: "subscribe", channel }));
        }
        for (const l of listeners.current) l(frame);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!cancelled) scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    }

    function scheduleReconnect() {
      if (cancelled) return;
      setState("offline");
      const delay = Math.min(15_000, 500 * 2 ** attempt) + Math.random() * 300;
      attempt++;
      timer = setTimeout(connect, delay);
    }

    // Reconnect promptly when the tab comes back or the network returns.
    const wake = () => {
      if (!wsRef.current && !cancelled) {
        if (timer) clearTimeout(timer);
        attempt = 0;
        connect();
      }
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      wsRef.current?.close();
      wsRef.current = null;
      setState("offline");
    };
  }, [enabled]);

  const subscribe = useCallback(
    (channel: string) => {
      const count = channels.current.get(channel) ?? 0;
      channels.current.set(channel, count + 1);
      if (count === 0) rawSend({ type: "subscribe", channel });
      return () => {
        const current = channels.current.get(channel) ?? 0;
        if (current <= 1) {
          channels.current.delete(channel);
          rawSend({ type: "unsubscribe", channel });
        } else {
          channels.current.set(channel, current - 1);
        }
      };
    },
    [rawSend]
  );

  const listen = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return <RealtimeContext.Provider value={{ state, subscribe, listen, send: rawSend }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside RealtimeProvider");
  return ctx;
}

/**
 * Subscribes to a channel (`org:<id>` / `board:<id>`; pass null for the
 * personal user channel, which is always on) and calls `onEvent` for its events.
 */
export function useChannelEvents(channel: string | null | undefined, onEvent: (event: RealtimeEvent) => void, opts: { personal?: boolean } = {}) {
  const { subscribe, listen } = useRealtime();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!channel && !opts.personal) return;
    const unsub = channel ? subscribe(channel) : () => {};
    const unlisten = listen((frame) => {
      if (frame.type !== "event") return;
      if (channel ? frame.channel === channel : frame.channel.startsWith("user:")) handler.current(frame.event);
    });
    return () => {
      unlisten();
      unsub();
    };
  }, [channel, opts.personal, subscribe, listen]);
}

export function useFrames(onFrame: Listener) {
  const { listen } = useRealtime();
  const handler = useRef(onFrame);
  handler.current = onFrame;
  useEffect(() => listen((f) => handler.current(f)), [listen]);
}
