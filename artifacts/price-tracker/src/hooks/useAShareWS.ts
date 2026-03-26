import { useState, useCallback, useRef, useEffect } from "react";
import { WSStatus } from "./useWebSocket";

export interface AShareQuote {
  code: string;
  name: string;
  price: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  change: number;
  changePct: number;
  time: string;
  flash?: "up" | "down" | null;
}

function getBackendWSUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ashare`;
}

export function useAShareTracker(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, AShareQuote>>({});
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    setStatus("connecting");
    const url = getBackendWSUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      if (symbolsRef.current.length > 0) {
        ws.send(
          JSON.stringify({ type: "subscribe", codes: symbolsRef.current })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          data?: AShareQuote[];
        };
        if (msg.type === "quotes" && Array.isArray(msg.data)) {
          setPrices((prev) => {
            const next = { ...prev };
            for (const q of msg.data!) {
              const old = prev[q.code];
              const flash =
                old?.price != null
                  ? q.price > old.price
                    ? "up"
                    : q.price < old.price
                    ? "down"
                    : null
                  : null;

              if (flash && flashTimers.current[q.code]) {
                clearTimeout(flashTimers.current[q.code]);
              }

              next[q.code] = { ...q, flash };

              if (flash) {
                flashTimers.current[q.code] = setTimeout(() => {
                  setPrices((p) => ({
                    ...p,
                    [q.code]: { ...p[q.code], flash: null },
                  }));
                }, 800);
              }
            }
            return next;
          });
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => setStatus("error");

    ws.onclose = () => {
      setStatus("disconnected");
      reconnectRef.current = setTimeout(() => connect(), 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const subscribe = useCallback((codes: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", codes }));
    }
  }, []);

  const unsubscribe = useCallback((codes: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", codes }));
    }
  }, []);

  useEffect(() => {
    if (status === "connected" && symbols.length > 0) {
      subscribe(symbols);
    }
  }, [symbols.join(","), status, subscribe]);

  return { prices, status, subscribe, unsubscribe };
}
