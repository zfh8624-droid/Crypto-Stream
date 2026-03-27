import { useState, useCallback, useRef, useEffect } from "react";
import { useWebSocket, WSStatus } from "./useWebSocket";

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
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sendRef = useRef<((data: unknown) => void) | null>(null);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const handleQuotes = useCallback((msg: { type: string; data?: AShareQuote[] }) => {
    if (msg.type === "quotes" && Array.isArray(msg.data)) {
      setPrices((prev) => {
        const next = { ...prev };
        for (const q of msg.data!) {
          const old = prev[q.code];
          const flash =
            old?.price != null
              ? q.price > old.price ? "up" : q.price < old.price ? "down" : null
              : null;
          if (flash && flashTimers.current[q.code]) clearTimeout(flashTimers.current[q.code]);
          next[q.code] = { ...q, flash };
          if (flash) {
            flashTimers.current[q.code] = setTimeout(() => {
              setPrices((p) => ({ ...p, [q.code]: { ...p[q.code], flash: null } }));
            }, 800);
          }
        }
        return next;
      });
    }
  }, []);

  const onMessage = useCallback((data: unknown) => {
    handleQuotes(data as { type: string; data?: AShareQuote[] });
  }, [handleQuotes]);

  const onOpen = useCallback(() => {
    if (sendRef.current && symbolsRef.current.length > 0) {
      sendRef.current({ type: "subscribe", codes: symbolsRef.current });
    }
  }, []);

  const wsUrl = getBackendWSUrl();
  const { status: wsStatus, send } = useWebSocket(wsUrl, { 
    onMessage, 
    onOpen, 
    heartbeatMs: 60000 
  });
  sendRef.current = send;

  useEffect(() => {
    setStatus(wsStatus);
  }, [wsStatus]);

  const subscribe = useCallback((codes: string[]) => {
    if (sendRef.current) {
      sendRef.current({ type: "subscribe", codes });
    }
  }, []);

  const unsubscribe = useCallback((codes: string[]) => {
    if (sendRef.current) {
      sendRef.current({ type: "unsubscribe", codes });
    }
  }, []);

  useEffect(() => {
    if (wsStatus === "connected" && symbols.length > 0) {
      subscribe(symbols);
    }
  }, [symbols.join(","), wsStatus, subscribe]);

  return { prices, status, subscribe, unsubscribe };
}
