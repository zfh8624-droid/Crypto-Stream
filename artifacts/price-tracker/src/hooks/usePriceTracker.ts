import { useState, useCallback, useRef, useEffect } from "react";
import { useWebSocket, WSStatus } from "./useWebSocket";

export interface PriceEntry {
  symbol: string;
  price: number | null;
  prevPrice: number | null;
  change24h: number | null;
  change24hPct: number | null;
  volume: number | null;
  lastUpdate: Date | null;
  flash: "up" | "down" | null;
}

export interface CryptoConfig {
  type: "crypto";
  wsUrl: string;
  symbols: string[];
}

export interface StockConfig {
  type: "stock";
  wsUrl: string;
  token: string;
  symbols: string[];
}

export type TrackerConfig = CryptoConfig | StockConfig;

function getBackendWSUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/binance`;
}

export function useBinanceTracker(config: CryptoConfig) {
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sendRef = useRef<((data: unknown) => void) | null>(null);
  const binanceWsUrlRef = useRef(config.wsUrl);

  const symbolsKey = config.symbols.sort().join(",");

  useEffect(() => {
    if (binanceWsUrlRef.current !== config.wsUrl && sendRef.current) {
      binanceWsUrlRef.current = config.wsUrl;
      sendRef.current({ type: "set_ws_url", wsUrl: config.wsUrl });
    }
  }, [config.wsUrl]);

  const handleTicker = (msg: Record<string, unknown>) => {
    const symbol = (msg.s as string)?.replace("USDT", "") ?? "";
    if (!symbol) return;

    setPrices((prev) => {
      const old = prev[symbol];
      const newPrice = parseFloat(msg.c as string);
      const flash =
        old?.price != null
          ? newPrice > old.price
            ? "up"
            : newPrice < old.price
            ? "down"
            : null
          : null;

      if (flash && flashTimers.current[symbol]) {
        clearTimeout(flashTimers.current[symbol]);
      }

      const next: PriceEntry = {
        symbol,
        price: newPrice,
        prevPrice: old?.price ?? null,
        change24h: parseFloat(msg.P as string) ?? null,
        change24hPct: parseFloat(msg.P as string) ?? null,
        volume: parseFloat(msg.v as string) ?? null,
        lastUpdate: new Date(),
        flash,
      };

      if (flash) {
        flashTimers.current[symbol] = setTimeout(() => {
          setPrices((p) => ({
            ...p,
            [symbol]: { ...p[symbol], flash: null },
          }));
        }, 800);
      }

      return { ...prev, [symbol]: next };
    });
  };

  const onMessage = useCallback((data: unknown) => {
    handleTicker(data as Record<string, unknown>);
  }, []);

  const onOpen = useCallback(() => {
    if (sendRef.current) {
      sendRef.current({ type: "set_ws_url", wsUrl: config.wsUrl });
      if (config.symbols.length > 0) {
        sendRef.current({ type: "subscribe", symbols: config.symbols });
      }
    }
  }, [symbolsKey, config.wsUrl]);

  const wsUrl = getBackendWSUrl();
  const { status, send } = useWebSocket(wsUrl, { onMessage, onOpen, heartbeatMs: 60000 });
  sendRef.current = send;

  // 当 symbols 变化时，重新订阅所有资产
  useEffect(() => {
    if (sendRef.current && config.symbols.length > 0) {
      sendRef.current({ type: "subscribe", symbols: config.symbols });
    }
  }, [symbolsKey]);

  const subscribe = useCallback((symbols: string[]) => {
    if (sendRef.current) {
      sendRef.current({ type: "subscribe", symbols });
    }
  }, []);

  const unsubscribe = useCallback((symbols: string[]) => {
    if (sendRef.current) {
      sendRef.current({ type: "unsubscribe", symbols });
    }
  }, []);

  return { prices, status, subscribe, unsubscribe };
}

export function useFinnhubTracker(config: StockConfig) {
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sendRef = useRef<((data: unknown) => void) | null>(null);

  const symbolsKey = config.symbols.sort().join(",");

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.type === "trade" && Array.isArray(msg.data)) {
      for (const trade of msg.data as Array<Record<string, unknown>>) {
        const symbol = trade.s as string;
        if (!symbol) continue;
        const newPrice = trade.p as number;

        setPrices((prev) => {
          const old = prev[symbol];
          const flash =
            old?.price != null
              ? newPrice > old.price
                ? "up"
                : newPrice < old.price
                ? "down"
                : null
              : null;

          if (flash && flashTimers.current[symbol]) {
            clearTimeout(flashTimers.current[symbol]);
          }

          const next: PriceEntry = {
            symbol,
            price: newPrice,
            prevPrice: old?.price ?? null,
            change24h: null,
            change24hPct: null,
            volume: trade.v as number ?? null,
            lastUpdate: new Date(),
            flash,
          };

          if (flash) {
            flashTimers.current[symbol] = setTimeout(() => {
              setPrices((p) => ({
                ...p,
                [symbol]: { ...p[symbol], flash: null },
              }));
            }, 800);
          }

          return { ...prev, [symbol]: next };
        });
      }
    }
  }, []);

  const onOpen = useCallback(() => {
    if (sendRef.current) {
      for (const sym of config.symbols) {
        sendRef.current({ type: "subscribe", symbol: sym });
      }
    }
  }, [symbolsKey]);

  const wsUrlWithToken = config.token
    ? `${config.wsUrl}?token=${config.token}`
    : null;

  const { status, send } = useWebSocket(wsUrlWithToken, { onMessage, onOpen, heartbeatMs: 60000 });
  sendRef.current = send;

  // 当 symbols 变化时，重新订阅所有资产
  useEffect(() => {
    if (sendRef.current && config.symbols.length > 0) {
      for (const sym of config.symbols) {
        sendRef.current({ type: "subscribe", symbol: sym });
      }
    }
  }, [symbolsKey]);

  return { prices, status };
}
