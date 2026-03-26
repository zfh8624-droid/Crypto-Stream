import { useEffect, useRef, useCallback, useState } from "react";

export type WSStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseWebSocketOptions {
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  reconnectDelay?: number;
}

export function useWebSocket(
  url: string | null,
  options: UseWebSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const disconnect = useCallback(() => {
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
  }, []);

  const connect = useCallback(
    (wsUrl: string) => {
      disconnect();
      setStatus("connecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        optionsRef.current.onOpen?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          optionsRef.current.onMessage(data);
        } catch {
          optionsRef.current.onMessage(event.data);
        }
      };

      ws.onerror = () => {
        setStatus("error");
        optionsRef.current.onError?.();
      };

      ws.onclose = () => {
        setStatus("disconnected");
        optionsRef.current.onClose?.();
        const delay = optionsRef.current.reconnectDelay ?? 3000;
        reconnectTimerRef.current = setTimeout(() => {
          if (wsRef.current === ws) {
            connect(wsUrl);
          }
        }, delay);
      };

      return ws;
    },
    [disconnect]
  );

  const send = useCallback((data: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    if (!url) {
      disconnect();
      return;
    }
    const ws = connect(url);
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
    };
  }, [url, connect, disconnect]);

  return { status, send, disconnect, connect };
}
