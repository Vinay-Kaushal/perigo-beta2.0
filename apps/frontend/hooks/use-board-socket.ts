"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getToken } from "./api";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";

export type ServerMessage =
  | { type: "board:event"; payload: { boardId: string; type: string; actorId: string; data: unknown; timestamp: string } }
  | { type: "board:joined"; boardId: string }
  | { type: "board:join_denied"; boardId: string; reason: string }
  | { type: "presence:sync"; boardId: string; users: Array<{ userId: string; name: string; color: string }> }
  | { type: "presence:cursor"; boardId: string; userId: string; name: string; color: string; x: number; y: number }
  | { type: "presence:left"; boardId: string; userId: string }
  | { type: "task:typing"; boardId: string; taskId: string; userId: string; isTyping: boolean };

/**
 * One socket per board view. Reconnects with backoff on drop, re-joins the
 * board room automatically once the connection (re)opens, and exposes a
 * small pub/sub so multiple components (board columns, presence bar, task
 * dialog) can each listen for just the message types they care about
 * without fighting over a single onmessage handler.
 */
export function useBoardSocket(boardId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<(msg: ServerMessage) => void>());
  const [connected, setConnected] = useState(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;

    function connect() {
      const token = getToken();
      if (!token) return;

      const ws = new WebSocket(`${WS_URL}/?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempt.current = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "board:join", boardId }));
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const listener of listenersRef.current) listener(msg);
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        // Exponential backoff, capped at 10s, so a dead backend doesn't
        // get hammered with reconnect attempts.
        const delay = Math.min(10_000, 500 * 2 ** reconnectAttempt.current);
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [boardId]);

  const subscribe = useCallback((listener: (msg: ServerMessage) => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, subscribe, send };
}
