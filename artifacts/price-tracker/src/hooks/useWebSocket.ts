import { useEffect, useRef, useCallback, useState } from "react";

export type WSStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseWebSocketOptions {
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  reconnectDelay?: number;
  heartbeatMs?: number;
}

export function useWebSocket(
  url: string | null,
  options: UseWebSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgAtRef = useRef<number>(Date.now());
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(
    (wsUrl: string) => {
      // Tear down any existing connection first
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      setStatus("connecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        lastMsgAtRef.current = Date.now();
        setStatus("connected");
        optionsRef.current.onOpen?.();

        const hbMs = optionsRef.current.heartbeatMs;
        if (hbMs && hbMs > 0) {
          clearHeartbeat();
          heartbeatTimerRef.current = setInterval(() => {
            if (wsRef.current !== ws) return;
            const idle = Date.now() - lastMsgAtRef.current;
            if (idle > hbMs && ws.readyState === WebSocket.OPEN) {
              console.warn(`[WS] Idle ${idle}ms, reconnecting…`);
              ws.onclose = null;
              ws.close();
              wsRef.current = null;
              reconnectTimerRef.current = setTimeout(
                () => connect(wsUrl),
                optionsRef.current.reconnectDelay ?? 2000
              );
            }
          }, Math.max(hbMs / 2, 5000));
        }
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        lastMsgAtRef.current = Date.now();
        try {
          optionsRef.current.onMessage(JSON.parse(event.data));
        } catch {
          optionsRef.current.onMessage(event.data);
        }
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        setStatus("error");
        optionsRef.current.onError?.();
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // stale close — ignore
        clearHeartbeat();
        wsRef.current = null;
        setStatus("disconnected");
        optionsRef.current.onClose?.();
        reconnectTimerRef.current = setTimeout(
          () => connect(wsUrl),
          optionsRef.current.reconnectDelay ?? 3000
        );
      };

      return ws;
    },
    [clearHeartbeat]
  );

  const disconnect = useCallback(() => {
    clearHeartbeat();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, [clearHeartbeat]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    if (!url) {
      disconnect();
      return;
    }
    connect(url);
    return () => {
      // Tear down cleanly without triggering reconnect
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, connect, disconnect, clearHeartbeat]);

  return { status, send, disconnect, connect };
}
